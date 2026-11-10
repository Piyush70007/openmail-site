-- Additive OpenMail AI phases 2–5. Existing mailboxes and provider settings remain intact.

create table if not exists public.ai_representatives (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('support', 'sales', 'billing', 'careers')),
  display_name text not null check (length(display_name) between 1 and 80),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, kind),
  unique (owner_id, id)
);

alter table public.ai_knowledge_entries
  add column if not exists representative_id uuid;
alter table public.ai_knowledge_documents
  add column if not exists representative_id uuid;
alter table public.ai_mailbox_settings
  add column if not exists representative_id uuid;
alter table public.messages
  add column if not exists ai_representative_id uuid,
  add column if not exists ai_workflow_id uuid;
alter table public.ai_auto_reply_jobs
  add column if not exists representative_id uuid,
  add column if not exists workflow_id uuid,
  add column if not exists confidence numeric(4,3),
  add column if not exists evidence_source_ids text[] not null default '{}';

create table if not exists public.ai_workflows (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  mailbox_id uuid not null references public.mailboxes(id) on delete cascade,
  name text not null check (length(name) between 1 and 100),
  enabled boolean not null default false,
  trigger_mode text not null check (trigger_mode in ('all_inbound', 'contains_any')),
  match_terms text[] not null default '{}',
  action text not null check (action in ('route_to_rep', 'create_draft', 'verified_reply', 'human_review')),
  representative_id uuid,
  priority integer not null default 50 check (priority between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  check (cardinality(match_terms) <= 12),
  check ((trigger_mode = 'all_inbound' and cardinality(match_terms) = 0)
      or (trigger_mode = 'contains_any' and cardinality(match_terms) between 1 and 12)),
  check ((action = 'human_review' and representative_id is null)
      or (action <> 'human_review' and representative_id is not null))
);

alter table public.ai_auto_reply_jobs
  drop constraint if exists ai_auto_reply_jobs_status_check;
alter table public.ai_auto_reply_jobs
  add constraint ai_auto_reply_jobs_status_check
  check (status in ('processing', 'auto_sent', 'human_review', 'ignored', 'failed', 'draft_created', 'workflow_applied'));

create table if not exists public.ai_simulation_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  representative_id uuid,
  test_name text not null check (length(test_name) between 1 and 100),
  expected_decision text not null check (expected_decision in ('auto_reply', 'human_review')),
  actual_decision text not null check (actual_decision in ('auto_reply', 'human_review')),
  passed boolean not null,
  confidence numeric(4,3),
  evidence_validated boolean not null default false,
  model text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.ai_trust_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  mailbox_id uuid references public.mailboxes(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  representative_id uuid,
  workflow_id uuid,
  event_type text not null check (event_type in (
    'auto_sent', 'human_review', 'ignored', 'automation_failed', 'simulation', 'workflow_routed',
    'workflow_draft', 'feedback_correct', 'feedback_correction', 'feedback_resolved',
    'feedback_escalated'
  )),
  confidence numeric(4,3) check (confidence is null or confidence between 0 and 1),
  evidence_source_ids text[] not null default '{}',
  model text not null default '',
  correction_note text not null default '' check (length(correction_note) <= 2000),
  idempotency_key text not null unique check (length(idempotency_key) between 1 and 200),
  created_at timestamptz not null default now()
);

create index if not exists ai_representatives_owner_idx
  on public.ai_representatives (owner_id, kind);
create index if not exists ai_knowledge_entries_rep_idx
  on public.ai_knowledge_entries (owner_id, representative_id, created_at desc);
create index if not exists ai_knowledge_documents_rep_idx
  on public.ai_knowledge_documents (owner_id, representative_id, created_at desc);
create index if not exists ai_workflows_mailbox_priority_idx
  on public.ai_workflows (owner_id, mailbox_id, enabled, priority, created_at);
create index if not exists ai_auto_reply_jobs_rep_created_idx
  on public.ai_auto_reply_jobs (owner_id, representative_id, created_at desc);
create index if not exists ai_auto_reply_jobs_workflow_idx
  on public.ai_auto_reply_jobs (owner_id, workflow_id, created_at desc)
  where workflow_id is not null;
create index if not exists ai_simulation_runs_owner_created_idx
  on public.ai_simulation_runs (owner_id, created_at desc);
create index if not exists ai_trust_events_owner_created_idx
  on public.ai_trust_events (owner_id, created_at desc);
create index if not exists ai_trust_events_rep_created_idx
  on public.ai_trust_events (owner_id, representative_id, created_at desc);
create unique index if not exists ai_trust_events_one_feedback_per_message_idx
  on public.ai_trust_events (owner_id, message_id)
  where event_type in ('feedback_correct', 'feedback_correction', 'feedback_resolved', 'feedback_escalated');

-- Composite parent keys let the database enforce that a service-role write
-- cannot associate an account's message or workflow with another owner's mailbox.
create unique index if not exists mailboxes_owner_id_id_idx
  on public.mailboxes (owner_id, id);
create unique index if not exists messages_owner_id_id_idx
  on public.messages (owner_id, id);

alter table public.ai_knowledge_entries
  drop constraint if exists ai_knowledge_entries_owner_rep_fk;
alter table public.ai_knowledge_entries
  add constraint ai_knowledge_entries_owner_rep_fk
  foreign key (owner_id, representative_id)
  references public.ai_representatives (owner_id, id) on delete restrict;
alter table public.ai_knowledge_documents
  drop constraint if exists ai_knowledge_documents_owner_rep_fk;
alter table public.ai_knowledge_documents
  add constraint ai_knowledge_documents_owner_rep_fk
  foreign key (owner_id, representative_id)
  references public.ai_representatives (owner_id, id) on delete restrict;
alter table public.ai_mailbox_settings
  drop constraint if exists ai_mailbox_settings_owner_rep_fk;
alter table public.ai_mailbox_settings
  add constraint ai_mailbox_settings_owner_rep_fk
  foreign key (owner_id, representative_id)
  references public.ai_representatives (owner_id, id) on delete restrict;
alter table public.messages
  drop constraint if exists messages_owner_ai_rep_fk;
alter table public.messages
  add constraint messages_owner_ai_rep_fk
  foreign key (owner_id, ai_representative_id)
  references public.ai_representatives (owner_id, id) on delete restrict;
alter table public.ai_workflows
  drop constraint if exists ai_workflows_owner_rep_fk;
alter table public.ai_workflows
  add constraint ai_workflows_owner_rep_fk
  foreign key (owner_id, representative_id)
  references public.ai_representatives (owner_id, id) on delete restrict;
alter table public.messages
  drop constraint if exists messages_mailbox_id_fkey;
alter table public.messages
  add constraint messages_owner_mailbox_fk
  foreign key (owner_id, mailbox_id)
  references public.mailboxes (owner_id, id) on delete cascade;
alter table public.ai_workflows
  drop constraint if exists ai_workflows_mailbox_id_fkey;
alter table public.ai_workflows
  add constraint ai_workflows_owner_mailbox_fk
  foreign key (owner_id, mailbox_id)
  references public.mailboxes (owner_id, id) on delete cascade;
alter table public.ai_auto_reply_jobs
  drop constraint if exists ai_auto_reply_jobs_mailbox_id_fkey;
alter table public.ai_auto_reply_jobs
  drop constraint if exists ai_auto_reply_jobs_inbound_message_id_fkey;
alter table public.ai_auto_reply_jobs
  add constraint ai_auto_reply_jobs_owner_mailbox_fk
  foreign key (owner_id, mailbox_id)
  references public.mailboxes (owner_id, id) on delete cascade;
alter table public.ai_auto_reply_jobs
  add constraint ai_auto_reply_jobs_owner_inbound_fk
  foreign key (owner_id, inbound_message_id)
  references public.messages (owner_id, id) on delete cascade;
alter table public.messages
  drop constraint if exists messages_owner_ai_workflow_fk;
alter table public.messages
  add constraint messages_owner_ai_workflow_fk
  foreign key (owner_id, ai_workflow_id)
  references public.ai_workflows (owner_id, id) on delete restrict;
alter table public.ai_auto_reply_jobs
  drop constraint if exists ai_auto_reply_jobs_owner_rep_fk;
alter table public.ai_auto_reply_jobs
  add constraint ai_auto_reply_jobs_owner_rep_fk
  foreign key (owner_id, representative_id)
  references public.ai_representatives (owner_id, id) on delete restrict;
alter table public.ai_auto_reply_jobs
  drop constraint if exists ai_auto_reply_jobs_owner_workflow_fk;
alter table public.ai_auto_reply_jobs
  add constraint ai_auto_reply_jobs_owner_workflow_fk
  foreign key (owner_id, workflow_id)
  references public.ai_workflows (owner_id, id) on delete restrict;
alter table public.ai_simulation_runs
  drop constraint if exists ai_simulation_runs_owner_rep_fk;
alter table public.ai_simulation_runs
  add constraint ai_simulation_runs_owner_rep_fk
  foreign key (owner_id, representative_id)
  references public.ai_representatives (owner_id, id) on delete restrict;
alter table public.ai_trust_events
  drop constraint if exists ai_trust_events_owner_rep_fk;
alter table public.ai_trust_events
  add constraint ai_trust_events_owner_rep_fk
  foreign key (owner_id, representative_id)
  references public.ai_representatives (owner_id, id) on delete restrict;
alter table public.ai_trust_events
  drop constraint if exists ai_trust_events_owner_workflow_fk;
alter table public.ai_trust_events
  add constraint ai_trust_events_owner_workflow_fk
  foreign key (owner_id, workflow_id)
  references public.ai_workflows (owner_id, id) on delete restrict;

alter table public.ai_representatives enable row level security;
alter table public.ai_workflows enable row level security;
alter table public.ai_simulation_runs enable row level security;
alter table public.ai_trust_events enable row level security;
revoke all on table public.ai_representatives, public.ai_workflows, public.ai_simulation_runs, public.ai_trust_events from public, anon, authenticated;
grant select, insert, update, delete on table public.ai_representatives, public.ai_workflows, public.ai_simulation_runs, public.ai_trust_events to service_role;

create or replace function public.ensure_openmail_ai_representatives(p_owner uuid)
returns setof public.ai_representatives
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_owner is null then raise exception 'invalid OpenMail owner'; end if;
  insert into public.ai_representatives (owner_id, kind, display_name)
  values
    (p_owner, 'support', 'Support'),
    (p_owner, 'sales', 'Sales'),
    (p_owner, 'billing', 'Billing'),
    (p_owner, 'careers', 'Careers')
  on conflict (owner_id, kind) do nothing;
  return query select * from public.ai_representatives where owner_id = p_owner order by kind;
end;
$function$;
revoke all on function public.ensure_openmail_ai_representatives(uuid) from public, anon, authenticated;
grant execute on function public.ensure_openmail_ai_representatives(uuid) to service_role;

create or replace function public.save_openmail_ai_knowledge_for_rep(
  p_owner uuid, p_representative uuid, p_title text, p_entry_type text, p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_count integer; v_entry public.ai_knowledge_entries;
begin
  if p_owner is null or length(coalesce(p_title, '')) not between 1 and 120
    or p_entry_type not in ('faq', 'service', 'pricing', 'policy')
    or length(coalesce(p_content, '')) not between 1 and 8000
    or not exists (select 1 from public.ai_representatives where owner_id = p_owner and id = p_representative and enabled) then
    raise exception 'invalid OpenMail AI representative knowledge entry';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 2801));
  select count(*) into v_count from public.ai_knowledge_entries where owner_id = p_owner;
  if v_count >= 100 then raise exception using errcode = '23514', message = 'You can keep up to 100 knowledge notes.'; end if;
  insert into public.ai_knowledge_entries (owner_id, representative_id, title, entry_type, content)
  values (p_owner, p_representative, p_title, p_entry_type, p_content) returning * into v_entry;
  return jsonb_build_object('id', v_entry.id, 'representative_id', v_entry.representative_id,
    'title', v_entry.title, 'entry_type', v_entry.entry_type, 'content', v_entry.content,
    'created_at', v_entry.created_at, 'updated_at', v_entry.updated_at);
end;
$function$;
revoke all on function public.save_openmail_ai_knowledge_for_rep(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.save_openmail_ai_knowledge_for_rep(uuid, uuid, text, text, text) to service_role;

create or replace function public.save_openmail_ai_document_for_rep(
  p_owner uuid, p_representative uuid, p_file_name text, p_mime_type text, p_content_hash text, p_extracted_text text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_count integer; v_document public.ai_knowledge_documents;
begin
  if p_owner is null or length(coalesce(p_file_name, '')) not between 1 and 160
    or p_mime_type not in ('text/plain', 'text/markdown', 'text/csv', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    or coalesce(length(p_extracted_text), 0) not between 1 and 40000
    or coalesce(p_content_hash, '') !~ '^[0-9a-f]{64}$'
    or not exists (select 1 from public.ai_representatives where owner_id = p_owner and id = p_representative and enabled) then
    raise exception 'invalid OpenMail AI representative document';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 1701));
  if exists (select 1 from public.ai_knowledge_documents where owner_id = p_owner and content_hash = p_content_hash) then
    raise exception using errcode = '23505', message = 'This document has already been uploaded.';
  end if;
  select count(*) into v_count from public.ai_knowledge_documents where owner_id = p_owner;
  if v_count >= 10 then raise exception using errcode = '23514', message = 'You can keep up to 10 knowledge documents.'; end if;
  insert into public.ai_knowledge_documents (owner_id, representative_id, file_name, mime_type, content_hash, extracted_text)
  values (p_owner, p_representative, p_file_name, p_mime_type, p_content_hash, p_extracted_text)
  returning * into v_document;
  return jsonb_build_object('id', v_document.id, 'representative_id', v_document.representative_id,
    'file_name', v_document.file_name, 'mime_type', v_document.mime_type, 'created_at', v_document.created_at,
    'character_count', length(v_document.extracted_text));
end;
$function$;
revoke all on function public.save_openmail_ai_document_for_rep(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_openmail_ai_document_for_rep(uuid, uuid, text, text, text, text) to service_role;

create or replace function public.get_openmail_ai_trust_metrics(p_owner uuid, p_days integer default 30, p_mailbox uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare v_from timestamptz; v_result jsonb;
begin
  if p_owner is null or p_days not between 1 and 365 then raise exception 'invalid OpenMail trust dashboard request'; end if;
  if p_mailbox is not null and not exists (select 1 from public.mailboxes where id = p_mailbox and owner_id = p_owner) then
    raise exception 'invalid OpenMail mailbox';
  end if;
  v_from := now() - make_interval(days => p_days);
  select jsonb_build_object(
    'periodDays', p_days,
    'generatedAt', now(),
    'totals', jsonb_build_object(
      'automaticReplies', count(*) filter (where e.event_type = 'auto_sent'),
    'escalations', count(distinct e.message_id) filter (where e.event_type = 'human_review' or e.event_type = 'feedback_escalated'),
      'corrections', count(*) filter (where e.event_type = 'feedback_correction'),
      'markedCorrect', count(*) filter (where e.event_type = 'feedback_correct'),
      'successfulResolutions', count(*) filter (where e.event_type = 'feedback_resolved'),
      'workflowDrafts', count(*) filter (where e.event_type = 'workflow_draft'),
      'workflowRoutes', count(*) filter (where e.event_type = 'workflow_routed'),
      'simulatorCases', (select count(*) from public.ai_simulation_runs s where s.owner_id = p_owner and s.created_at >= v_from),
      'simulatorPassed', (select count(*) from public.ai_simulation_runs s where s.owner_id = p_owner and s.created_at >= v_from and s.passed),
      'labeledAccuracy', case
        when count(*) filter (where e.event_type in ('feedback_correct', 'feedback_correction')) = 0 then null
        else round(100.0 * count(*) filter (where e.event_type = 'feedback_correct') /
          count(*) filter (where e.event_type in ('feedback_correct', 'feedback_correction')), 1)
      end
    ),
    'byRepresentative', coalesce((
      select jsonb_agg(to_jsonb(g) order by g.kind)
      from (
        select r.id, r.kind, r.display_name as name,
          count(*) filter (where e.event_type = 'auto_sent') as "automaticReplies",
          count(distinct e.message_id) filter (where e.event_type = 'human_review' or e.event_type = 'feedback_escalated') as escalations,
          count(*) filter (where e.event_type = 'feedback_correction') as corrections,
          count(*) filter (where e.event_type = 'feedback_resolved') as resolutions
        from public.ai_representatives r
        left join public.ai_trust_events e on e.representative_id = r.id and e.owner_id = p_owner
          and e.created_at >= v_from and (p_mailbox is null or e.mailbox_id = p_mailbox)
        where r.owner_id = p_owner group by r.id, r.kind, r.display_name
      ) g
    ), '[]'::jsonb)
  ) into v_result
  from public.ai_trust_events e
  where e.owner_id = p_owner and e.created_at >= v_from and (p_mailbox is null or e.mailbox_id = p_mailbox);
  return coalesce(v_result, '{}'::jsonb);
end;
$function$;
revoke all on function public.get_openmail_ai_trust_metrics(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.get_openmail_ai_trust_metrics(uuid, integer, uuid) to service_role;

notify pgrst, 'reload schema';
