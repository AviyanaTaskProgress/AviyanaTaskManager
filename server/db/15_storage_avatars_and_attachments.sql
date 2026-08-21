-- =====================================================================
-- 15_storage_avatars_and_attachments.sql
-- =====================================================================
-- Adds real file-upload support:
--   1. `avatars` storage bucket — profile pictures (replaces the
--      "paste an image URL" field with actual device upload).
--   2. `task-attachments` storage bucket + `task_attachments` metadata
--      table — files AND links attached to a task, visible to anyone
--      who can already see that task.
--
-- Both buckets are public-read (simplest to wire up from the browser —
-- no signed-URL generation needed) with random UUID-based paths, so a
-- file is only discoverable if you already have its exact link from
-- inside the app. Write access (upload/delete) is still gated by RLS.
-- This is an internal small-team tool — if per-file confidentiality is
-- ever needed, switch these to private buckets + signed URLs.
--
-- Run this once, after 14_fix_audit_signature_hmac.sql, in the Supabase
-- SQL editor.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('task-attachments', 'task-attachments', true)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- avatars: any authenticated user can upload/replace an avatar file
-- under their own user-id folder; a Super Admin can upload under
-- anyone's folder (needed for the Team page's profile editor).
-- ------------------------------------------------------------
drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (
      public.current_app_role() = 'super_admin'
      or (storage.foldername(name))[1] = (select id::text from public.users where auth_user_id = auth.uid())
    )
  );

drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (
      public.current_app_role() = 'super_admin'
      or (storage.foldername(name))[1] = (select id::text from public.users where auth_user_id = auth.uid())
    )
  );

drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (
      public.current_app_role() = 'super_admin'
      or (storage.foldername(name))[1] = (select id::text from public.users where auth_user_id = auth.uid())
    )
  );

-- ------------------------------------------------------------
-- task-attachments: any authenticated user can upload; only the
-- uploader or a Super Admin can delete. (Read is via the public bucket
-- URL — the real access gate is the task_attachments table below,
-- which is what the UI actually queries to list/show attachments.)
-- ------------------------------------------------------------
drop policy if exists task_files_insert on storage.objects;
create policy task_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'task-attachments');

drop policy if exists task_files_delete on storage.objects;
create policy task_files_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'task-attachments' and owner = auth.uid());

-- ------------------------------------------------------------
-- task_attachments: metadata for both uploaded files and pasted links,
-- attached to a task. RLS mirrors the same visibility rule as
-- tasks_select (05_role_based_access.sql) so attachments are exactly as
-- visible as the task they belong to.
-- ------------------------------------------------------------
create table if not exists public.task_attachments (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.tasks(id) on delete cascade,
  uploaded_by   uuid not null references public.users(id) on delete restrict,
  kind          text not null check (kind in ('file', 'link')),
  url           text not null,
  file_name     text,
  file_size     bigint,
  mime_type     text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_attachments_task on public.task_attachments(task_id);

alter table public.task_attachments enable row level security;

drop policy if exists attachments_select on public.task_attachments;
create policy attachments_select on public.task_attachments
  for select using (
    exists (
      select 1 from public.tasks t
      where t.id = task_attachments.task_id
        and (
          t.assignee_id = (public.current_app_user()).id
          or t.created_by_id = (public.current_app_user()).id
          or public.current_app_role() in ('super_admin', 'chief_officer')
          or (public.current_app_role() = 'dept_head' and t.department = (public.current_app_user()).department)
        )
    )
  );

drop policy if exists attachments_insert on public.task_attachments;
create policy attachments_insert on public.task_attachments
  for insert with check (
    uploaded_by = (public.current_app_user()).id
    and exists (
      select 1 from public.tasks t
      where t.id = task_attachments.task_id
        and (
          t.assignee_id = (public.current_app_user()).id
          or t.created_by_id = (public.current_app_user()).id
          or public.current_app_role() in ('super_admin', 'chief_officer')
          or (public.current_app_role() = 'dept_head' and t.department = (public.current_app_user()).department)
        )
    )
  );

drop policy if exists attachments_delete on public.task_attachments;
create policy attachments_delete on public.task_attachments
  for delete using (
    uploaded_by = (public.current_app_user()).id
    or public.current_app_role() = 'super_admin'
  );
