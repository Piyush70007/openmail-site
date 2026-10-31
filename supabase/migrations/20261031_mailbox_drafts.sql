-- Add account-backed drafts and an index for the Starred view.
-- Safe to run more than once on an existing OpenMail Supabase project.

alter table public.messages
  drop constraint if exists messages_folder_check;

alter table public.messages
  add constraint messages_folder_check
  check (folder in ('inbox', 'sent', 'archive', 'spam', 'trash', 'drafts'));

alter table public.messages
  drop constraint if exists messages_status_check;

alter table public.messages
  add constraint messages_status_check
  check (status in ('received', 'sending', 'sent', 'failed', 'draft'));

create index if not exists messages_starred_mailbox_created_idx
  on public.messages (mailbox_id, created_at desc)
  where starred = true and folder <> 'trash';
