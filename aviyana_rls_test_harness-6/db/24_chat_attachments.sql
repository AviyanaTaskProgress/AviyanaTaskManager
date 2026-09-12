-- =====================================================================
-- 24_chat_attachments.sql
-- =====================================================================
-- Adds file attachment support to chat messages — feature request
-- following this session's chat/RLS work. Mirrors the existing
-- task-attachments pattern from 15_storage_avatars_and_attachments.sql
-- for consistency: a public-read storage bucket with random UUID-based
-- paths (obscure-but-not-secret), write access gated by RLS, actual
-- confidentiality enforced by conversation membership via the
-- `messages` table's own RLS (unaffected by this migration).
--
-- `text` becomes nullable — an attachment-only message (no caption) is
-- a normal thing to send, matching how most chat apps behave.
--
-- Run this once, after 23_protect_notification_triggers.sql, in the
-- Supabase SQL editor.
-- =====================================================================

alter table public.messages alter column text drop not null;

alter table public.messages
  add column if not exists attachment_url  text,
  add column if not exists attachment_name text,
  add column if not exists attachment_kind text check (attachment_kind in ('image', 'file'));

-- A message must have a caption, an attachment, or both — never neither.
alter table public.messages drop constraint if exists messages_has_content;
alter table public.messages
  add constraint messages_has_content
  check (
    (text is not null and length(trim(text)) > 0)
    or attachment_url is not null
  );

insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', true)
on conflict (id) do nothing;

-- Same shape as task_files_insert/delete in
-- 15_storage_avatars_and_attachments.sql: any authenticated member of
-- SOME conversation can upload (the actual per-conversation gate is on
-- the `messages` row itself via messages_insert, which this bucket's
-- objects get attached to); only the uploader or a Super Admin can
-- delete their own uploaded file.
drop policy if exists chat_files_insert on storage.objects;
create policy chat_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-attachments');

drop policy if exists chat_files_delete on storage.objects;
create policy chat_files_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (owner = auth.uid() or public.current_app_role() = 'super_admin')
  );
