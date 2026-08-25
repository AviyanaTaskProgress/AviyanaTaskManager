-- =====================================================================
-- 19_viewer_hardening.sql
-- =====================================================================
-- Found during a post-implementation audit of 16/17/18. Three RLS gaps
-- around the 'viewer' role, all defense-in-depth (none are reachable
-- from the UI today, since viewer never renders TasksView/ChatView —
-- see App.tsx's viewer branch — but RLS should hold even if something
-- talks to Supabase directly):
--
--   1. messages_insert had no role check. If a staff/dept_head/etc.
--      added a viewer to a group, or DMed them, the viewer could send
--      messages via a direct API call despite the app never exposing
--      Chat to them.
--   2. tasks_update's "assignee_id = self" clause bypasses role entirely.
--      If a task were ever assigned to a viewer's user id (shouldn't
--      normally happen, but nothing stopped it), that viewer could edit
--      it directly.
--   3. attachments_select never included 'viewer', unlike tasks_select —
--      inconsistent with the stated design ("sees everything, like
--      chief_officer's visibility"). Not a security hole, just a gap:
--      a viewer would see a task but not its attachments.
--
-- Run this once, after 18_viewer_role_and_dashboard.sql, in the
-- Supabase SQL editor.
-- =====================================================================

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert with check (
    sender_id = (public.current_app_user()).id
    and public.current_app_role() <> 'viewer'
    and public.is_conversation_member(conversation_id)
  );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update using (
    public.current_app_role() <> 'viewer'
    and (
      assignee_id = (public.current_app_user()).id
      or public.current_app_role() = 'super_admin'
      or (
        (public.current_app_user()).permissions->>'canEditAllTasks' = 'true'
        and public.current_app_role() = 'dept_head'
        and department = (public.current_app_user()).department
      )
    )
  );

drop policy if exists attachments_select on public.task_attachments;
create policy attachments_select on public.task_attachments
  for select using (
    exists (
      select 1 from public.tasks t
      where t.id = task_attachments.task_id
        and (
          t.assignee_id = (public.current_app_user()).id
          or t.created_by_id = (public.current_app_user()).id
          or public.current_app_role() in ('super_admin', 'chief_officer', 'viewer')
          or (public.current_app_role() = 'dept_head' and t.department = (public.current_app_user()).department)
        )
    )
  );
