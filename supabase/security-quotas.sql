-- OpenMail abuse controls. Apply this additive migration in the Supabase SQL Editor.
-- It adds a private quota ledger and a server-only atomic counter function.

create table if not exists public.openmail_api_usage (
  owner_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('dns_check', 'domain_create', 'domain_verify', 'mailbox_create', 'email_send')),
  window_start timestamptz not null,
  usage_count integer not null default 0 check (usage_count >= 0),
  primary key (owner_id, action, window_start)
);

alter table public.openmail_api_usage enable row level security;
revoke all on table public.openmail_api_usage from public, anon, authenticated, service_role;

create or replace function public.consume_openmail_quota(p_owner uuid, p_action text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_limit integer;
  v_window_seconds integer;
  v_window_start timestamptz;
  v_usage integer;
  v_allowed boolean;
begin
  if p_owner is null then
    raise exception 'owner is required';
  end if;

  case p_action
    when 'dns_check' then
      v_limit := 30;
      v_window_seconds := 3600;
    when 'domain_create' then
      v_limit := 2;
      v_window_seconds := 86400;
    when 'domain_verify' then
      v_limit := 12;
      v_window_seconds := 3600;
    when 'mailbox_create' then
      v_limit := 20;
      v_window_seconds := 86400;
    when 'email_send' then
      v_limit := 10;
      v_window_seconds := 86400;
    else
      raise exception 'unknown OpenMail quota action';
  end case;

  v_window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / v_window_seconds) * v_window_seconds
  );

  insert into public.openmail_api_usage (owner_id, action, window_start, usage_count)
  values (p_owner, p_action, v_window_start, 1)
  on conflict (owner_id, action, window_start)
  do update set usage_count = public.openmail_api_usage.usage_count + 1
    where public.openmail_api_usage.usage_count < v_limit
  returning usage_count into v_usage;
  v_allowed := found;

  delete from public.openmail_api_usage
    where owner_id = p_owner
      and window_start < clock_timestamp() - interval '32 days';

  return v_allowed;
end;
$function$;

revoke all on function public.consume_openmail_quota(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_openmail_quota(uuid, text) to service_role;

notify pgrst, 'reload schema';
