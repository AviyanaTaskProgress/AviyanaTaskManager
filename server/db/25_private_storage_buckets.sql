-- =====================================================================
-- 25_private_storage_buckets.sql
-- =====================================================================
-- Security hardening, found during a follow-up review of this session's
-- work: avatars, task-attachments, and chat-attachments were all public
-- buckets — "access control" for them was purely the difficulty of
-- guessing a random UUID-based path. Anyone with a leaked URL (browser
-- history, a screenshot, a server log, a shared link) could fetch the
-- file directly, forever, with zero authentication — including someone
-- who was never a member of the conversation or never had access to the
-- task in the first place. This became more consequential once chat
-- attachments were added, since chat can include private 1:1 direct
-- messages.
--
-- Fix: all three buckets are now private. The app (src/lib/storage.ts)
-- now generates a signed URL at upload time instead of a permanent
-- public one — every URL stored in the database from now on requires a
-- cryptographically signed token, not just an unguessable-but-otherwise-
-- unprotected path. Existing rows uploaded before this migration keep
-- their old public-style URLs; those specific files remain reachable
-- under the old model until re-uploaded (this migration does not attempt
-- to retroactively re-sign every existing URL in the database).
--
-- Run this once, after 24_chat_attachments.sql, in the Supabase SQL
-- editor.
-- =====================================================================

update storage.buckets set public = false where id in ('avatars', 'task-attachments', 'chat-attachments');

-- Private buckets require an explicit SELECT policy on storage.objects —
-- without one, createSignedUrl() itself fails (Supabase checks storage
-- RLS before it will issue a signed URL, so a user can't sign a URL for
-- a file they otherwise couldn't read). The original migration only
-- defined INSERT/UPDATE/DELETE policies, since public buckets serve
-- reads directly and never needed SELECT RLS at all.
--
-- Scoped to "any authenticated Aviyana user" rather than fully
-- replicating per-task/per-conversation membership at the storage layer
-- (that logic already lives in task_attachments'/messages' own RLS,
-- which gates what actually appears in the UI). This closes the real
-- gap being fixed here — anonymous, non-logged-in access from anywhere
-- on the internet — without a much larger storage-layer redesign.
drop policy if exists avatars_select on storage.objects;
create policy avatars_select on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

drop policy if exists task_files_select on storage.objects;
create policy task_files_select on storage.objects
  for select to authenticated
  using (bucket_id = 'task-attachments');

drop policy if exists chat_files_select on storage.objects;
create policy chat_files_select on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-attachments');
