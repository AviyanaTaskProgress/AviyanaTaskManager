-- =====================================================================
-- 31_staff_self_log_tasks.sql
-- =====================================================================
-- Found by the harness (91_new_feature_tests.sql, "assigned_by_id"
-- test) while wiring up item #10 — the "who assigned this?" selector
-- is pointless if the person it's for can never actually save the
-- task in the first place.
--
-- tasks_insert today is structurally: canCreateTasks permission AND
-- (super_admin OR dept_head-in-own-department). 'staff' is not in that
-- OR list at all, regardless of any permission flag — so a Staff
-- member has never been able to log a task for themselves, full stop.
--
-- Fix: add one narrow OR branch — a Staff member (any Staff, no extra
-- permission flag needed, since this is strictly "log my own work",
-- not "create tasks for other people") may insert a task ONLY when
-- they are both the assignee AND the creator (a genuine self-log, not
-- a route to assigning work to someone else). assigned_by_id is where
-- they optionally record who actually instructed it.
--
-- tasks_select/tasks_update need no changes — "assignee_id = self" is
-- already in both, so a Staff member can already see and edit a task
-- once it exists.
--
-- Run this once, after 30_assigned_by_and_completed_counter.sql, in
-- the Supabase SQL editor.
-- =====================================================================

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert with check (
    (
      (public.current_app_user()).permissions->>'canCreateTasks' = 'true'
      and (
        public.current_app_role() = 'super_admin'
        or (public.current_app_role() = 'dept_head' and department = (public.current_app_user()).department)
      )
    )
    or (
      public.current_app_role() = 'staff'
      and assignee_id = (public.current_app_user()).id
      and created_by_id = (public.current_app_user()).id
    )
  );
