-- =====================================================================
-- 40_chief_officer_task_edit.sql
-- =====================================================================
-- Chief Officer can already SEE every task (tasks_select includes
-- 'chief_officer' — 18_viewer_role_and_dashboard.sql), create tasks
-- cross-department (32_chief_officer_cross_dept_tasks.sql), and
-- confirm payments (29_task_payment_workflow.sql) — but was never
-- added to tasks_update itself. 29_task_payment_workflow.sql even has
-- a comment flagging this: "Chief Officer isn't in tasks_update's
-- policy today". TaskModal.tsx has no client-side edit gate at all
-- (it always renders every field editable once a task is open), so a
-- Chief Officer correcting a mistake on someone else's task could open
-- it, edit it, hit Save — and have the write silently rejected by RLS.
--
-- Fix: add chief_officer to tasks_update, same unconditional tier as
-- super_admin (matches the authority they already have for
-- create/payment — a role that can already touch every task in those
-- two ways but not fix a typo on one makes no sense).
--
-- Run this once, after 39_productivity_score_timer_and_presence.sql,
-- in the Supabase SQL editor.
-- =====================================================================

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update using (
    public.current_app_role() <> 'viewer'
    and (
      assignee_id = (public.current_app_user()).id
      or public.current_app_role() in ('super_admin', 'chief_officer')
      or (
        (public.current_app_user()).permissions->>'canEditAllTasks' = 'true'
        and public.current_app_role() = 'dept_head'
        and department = (public.current_app_user()).department
      )
    )
  );
