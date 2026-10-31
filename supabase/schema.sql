-- OpenMail's first hosted-mailbox schema.
-- Run in the Supabase SQL editor before adding the project keys to Vercel.

create extension if not exists pgcrypto;

create table if not exists public.domains (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  domain_name text not null unique,
  provider_domain_id text not null unique,
  status text not null default 'pending',
  dns_records jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mailboxes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  domain_id uuid not null references public.domains(id) on delete cascade,
  local_part text not null,
  address text not null unique,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  unique (domain_id, local_part)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  mailbox_id uuid not null references public.mailboxes(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  from_address text not null,
  to_addresses text[] not null default '{}',
  subject text not null default '',
  preview text not null default '',
  text_body text not null default '',
  folder text not null default 'inbox' check (folder in ('inbox', 'sent', 'archive', 'spam', 'trash', 'drafts')),
  status text not null default 'received' check (status in ('received', 'sending', 'sent', 'failed', 'draft')),
  provider_email_id text,
  client_request_id uuid,
  attachment_metadata jsonb not null default '[]'::jsonb,
  read_at timestamptz,
  starred boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists messages_owner_client_request_unique
  on public.messages (owner_id, client_request_id)
  where client_request_id is not null;

create unique index if not exists messages_provider_inbound_unique
  on public.messages (provider_email_id, mailbox_id)
  where provider_email_id is not null and direction = 'inbound';

create index if not exists messages_mailbox_folder_created_idx
  on public.messages (mailbox_id, folder, created_at desc);

create index if not exists messages_starred_mailbox_created_idx
  on public.messages (mailbox_id, created_at desc)
  where starred = true and folder <> 'trash';

alter table public.domains enable row level security;
alter table public.mailboxes enable row level security;
alter table public.messages enable row level security;

-- The Vercel Functions use Supabase's server-only secret/service-role key.
-- RLS is bypassed for that role, but PostgreSQL table grants are still required.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.domains, public.mailboxes, public.messages to service_role;

drop policy if exists "Owners can read their domains" on public.domains;
create policy "Owners can read their domains" on public.domains
  for select to authenticated using (owner_id = auth.uid());

drop policy if exists "Owners can read their mailboxes" on public.mailboxes;
create policy "Owners can read their mailboxes" on public.mailboxes
  for select to authenticated using (owner_id = auth.uid());

drop policy if exists "Owners can read their messages" on public.messages;
create policy "Owners can read their messages" on public.messages
  for select to authenticated using (owner_id = auth.uid());

-- All writes go through authenticated Vercel Functions. Keep the service role key
-- server-side; never expose it through browser code or a public environment variable.
