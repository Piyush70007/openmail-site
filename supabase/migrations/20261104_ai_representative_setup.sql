-- Additive Phase 1 foundation for My AI. This migration does not alter the
-- existing domains, mailboxes, messages, or mail delivery routes.

create table if not exists public.ai_profiles (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  company_name text not null default '',
  company_description text not null default '',
  products_services text not null default '',
  pricing text not null default '',
  business_hours text not null default '',
  policies text not null default '',
  enabled boolean not null default false,
  reply_mode text not null default 'draft' check (reply_mode = 'draft'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  entry_type text not null check (entry_type in ('faq', 'service', 'pricing', 'policy')),
  content text not null check (length(content) between 1 and 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_knowledge_entries_owner_created_idx
  on public.ai_knowledge_entries (owner_id, created_at desc);

-- Shared free-tier guard: at most 10 generated drafts per account and 25 for
-- the whole OpenMail deployment per UTC day. This conservative app cap keeps
-- the default model's free token allowance from being exhausted too quickly.
-- These limits are separate from and do not alter existing email send quotas.
create table if not exists public.openmail_ai_draft_usage (
  usage_day date not null,
  quota_key text not null,
  usage_count integer not null default 0 check (usage_count >= 0),
  primary key (usage_day, quota_key)
);

alter table public.ai_profiles enable row level security;
alter table public.ai_knowledge_entries enable row level security;
alter table public.openmail_ai_draft_usage enable row level security;

grant select, insert, update, delete on public.ai_profiles, public.ai_knowledge_entries to service_role;
revoke all on table public.openmail_ai_draft_usage from public, anon, authenticated;
grant select, insert, update, delete on public.openmail_ai_draft_usage to service_role;

create or replace function public.consume_openmail_ai_draft_quota(
  p_owner uuid,
  p_user_limit integer default 10,
  p_global_limit integer default 25
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_day date := (clock_timestamp() at time zone 'utc')::date;
  v_usage integer;
begin
  if p_owner is null or p_user_limit < 1 or p_user_limit > 50 or p_global_limit < 1 or p_global_limit > 500 then
    raise exception 'invalid OpenMail AI quota request';
  end if;

  insert into public.openmail_ai_draft_usage (usage_day, quota_key, usage_count)
  values (v_day, 'global', 1)
  on conflict (usage_day, quota_key)
  do update set usage_count = public.openmail_ai_draft_usage.usage_count + 1
    where public.openmail_ai_draft_usage.usage_count < p_global_limit
  returning usage_count into v_usage;
  if not found then
    return false;
  end if;

  insert into public.openmail_ai_draft_usage (usage_day, quota_key, usage_count)
  values (v_day, 'user:' || p_owner::text, 1)
  on conflict (usage_day, quota_key)
  do update set usage_count = public.openmail_ai_draft_usage.usage_count + 1
    where public.openmail_ai_draft_usage.usage_count < p_user_limit
  returning usage_count into v_usage;
  if not found then
    update public.openmail_ai_draft_usage
      set usage_count = greatest(usage_count - 1, 0)
      where usage_day = v_day and quota_key = 'global';
    return false;
  end if;

  delete from public.openmail_ai_draft_usage where usage_day < v_day - 31;
  return true;
end;
$function$;

revoke all on function public.consume_openmail_ai_draft_quota(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_openmail_ai_draft_quota(uuid, integer, integer) to service_role;

drop policy if exists "Owners can read their AI profile" on public.ai_profiles;
create policy "Owners can read their AI profile" on public.ai_profiles
  for select to authenticated using (owner_id = auth.uid());

drop policy if exists "Owners can manage their AI profile" on public.ai_profiles;
create policy "Owners can manage their AI profile" on public.ai_profiles
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "Owners can read their AI knowledge" on public.ai_knowledge_entries;
create policy "Owners can read their AI knowledge" on public.ai_knowledge_entries
  for select to authenticated using (owner_id = auth.uid());

drop policy if exists "Owners can manage their AI knowledge" on public.ai_knowledge_entries;
create policy "Owners can manage their AI knowledge" on public.ai_knowledge_entries
  for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());

notify pgrst, 'reload schema';
