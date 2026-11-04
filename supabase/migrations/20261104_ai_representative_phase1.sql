-- Complete Phase 1 AI representative foundations. Additive and safe to rerun.

alter table public.messages
  add column if not exists ai_auto_sent boolean not null default false,
  add column if not exists ai_reply_to_message_id uuid references public.messages(id) on delete set null,
  add column if not exists ai_handoff_status text,
  add column if not exists ai_handoff_reason text,
  add column if not exists ai_auto_submitted boolean not null default false;

alter table public.messages
  drop constraint if exists messages_ai_handoff_status_check;
alter table public.messages
  add constraint messages_ai_handoff_status_check
  check (ai_handoff_status is null or ai_handoff_status in ('pending', 'resolved'));

create index if not exists messages_ai_auto_sent_mailbox_created_idx
  on public.messages (mailbox_id, created_at desc)
  where ai_auto_sent = true and folder = 'sent';

create index if not exists messages_ai_handoff_mailbox_created_idx
  on public.messages (mailbox_id, created_at desc)
  where ai_handoff_status = 'pending';

create unique index if not exists messages_one_ai_auto_reply_per_inbound_idx
  on public.messages (ai_reply_to_message_id)
  where ai_auto_sent = true and ai_reply_to_message_id is not null;

create table if not exists public.ai_mailbox_settings (
  mailbox_id uuid primary key references public.mailboxes(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  auto_reply_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists ai_mailbox_settings_owner_idx
  on public.ai_mailbox_settings (owner_id, mailbox_id);

create table if not exists public.ai_knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null check (length(file_name) between 1 and 160),
  mime_type text not null check (mime_type in ('text/plain', 'text/markdown', 'text/csv', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  extracted_text text not null check (length(extracted_text) between 1 and 40000),
  created_at timestamptz not null default now(),
  unique (owner_id, content_hash)
);

create index if not exists ai_knowledge_documents_owner_created_idx
  on public.ai_knowledge_documents (owner_id, created_at desc);

create table if not exists public.ai_auto_reply_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  mailbox_id uuid not null references public.mailboxes(id) on delete cascade,
  inbound_message_id uuid not null unique references public.messages(id) on delete cascade,
  recipient_email text not null,
  status text not null check (status in ('processing', 'auto_sent', 'human_review', 'ignored', 'failed')),
  reason text not null default '',
  model text not null default '',
  reply_message_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_auto_reply_jobs_cooldown_idx
  on public.ai_auto_reply_jobs (mailbox_id, recipient_email, created_at desc)
  where status = 'auto_sent';

alter table public.ai_mailbox_settings enable row level security;
alter table public.ai_knowledge_documents enable row level security;
alter table public.ai_auto_reply_jobs enable row level security;

revoke all on table public.ai_mailbox_settings, public.ai_knowledge_documents, public.ai_auto_reply_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_mailbox_settings, public.ai_knowledge_documents, public.ai_auto_reply_jobs to service_role;

create or replace function public.save_openmail_ai_document(
  p_owner uuid,
  p_file_name text,
  p_mime_type text,
  p_content_hash text,
  p_extracted_text text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_count integer;
  v_document public.ai_knowledge_documents;
begin
  if p_owner is null
    or length(coalesce(p_file_name, '')) not between 1 and 160
    or p_mime_type not in ('text/plain', 'text/markdown', 'text/csv', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    or coalesce(length(p_extracted_text), 0) not between 1 and 40000
    or coalesce(p_content_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid OpenMail AI document';
  end if;

  -- Serialize uploads for one owner so simultaneous requests cannot bypass the cap.
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 1701));

  if exists (select 1 from public.ai_knowledge_documents where owner_id = p_owner and content_hash = p_content_hash) then
    raise exception using errcode = '23505', message = 'This document has already been uploaded.';
  end if;

  select count(*) into v_count from public.ai_knowledge_documents where owner_id = p_owner;
  if v_count >= 10 then
    raise exception using errcode = '23514', message = 'You can keep up to 10 knowledge documents.';
  end if;

  insert into public.ai_knowledge_documents (owner_id, file_name, mime_type, content_hash, extracted_text)
  values (p_owner, p_file_name, p_mime_type, p_content_hash, p_extracted_text)
  returning * into v_document;

  return jsonb_build_object(
    'id', v_document.id,
    'file_name', v_document.file_name,
    'mime_type', v_document.mime_type,
    'created_at', v_document.created_at,
    'character_count', length(v_document.extracted_text)
  );
end;
$function$;

revoke all on function public.save_openmail_ai_document(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_openmail_ai_document(uuid, text, text, text, text) to service_role;

create or replace function public.save_openmail_ai_knowledge(
  p_owner uuid,
  p_title text,
  p_entry_type text,
  p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_count integer;
  v_entry public.ai_knowledge_entries;
begin
  if p_owner is null
    or length(coalesce(p_title, '')) not between 1 and 120
    or p_entry_type not in ('faq', 'service', 'pricing', 'policy')
    or length(coalesce(p_content, '')) not between 1 and 8000 then
    raise exception 'invalid OpenMail AI knowledge entry';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 2801));
  select count(*) into v_count from public.ai_knowledge_entries where owner_id = p_owner;
  if v_count >= 100 then
    raise exception using errcode = '23514', message = 'You can keep up to 100 knowledge notes.';
  end if;

  insert into public.ai_knowledge_entries (owner_id, title, entry_type, content)
  values (p_owner, p_title, p_entry_type, p_content)
  returning * into v_entry;

  return jsonb_build_object(
    'id', v_entry.id,
    'title', v_entry.title,
    'entry_type', v_entry.entry_type,
    'content', v_entry.content,
    'created_at', v_entry.created_at,
    'updated_at', v_entry.updated_at
  );
end;
$function$;

revoke all on function public.save_openmail_ai_knowledge(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.save_openmail_ai_knowledge(uuid, text, text, text) to service_role;

notify pgrst, 'reload schema';
