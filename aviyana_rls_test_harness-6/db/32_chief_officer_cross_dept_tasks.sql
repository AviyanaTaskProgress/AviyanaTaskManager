-- =====================================================================
-- 32_chief_officer_cross_dept_tasks.sql
-- =====================================================================
-- Role-based access review (2026-09): a Chief Officer, like Super
-- Admin, should be able to delegate a task to anyone in any
-- department — the same cross-department reach as Super Admin for
-- task CREATION specifically, but still no approval authority (that
-- stays with Super Admin / Dept Head, per decide_task_approval()'s own
-- canApproveTasks check, untouched by this migration).
--
-- tasks_insert today only has two branches: (canCreateTasks AND
-- super_admin) or (canCreateTasks AND dept_head-in-own-department) —
-- chief_officer was structurally excluded no matter what its
-- permissions flag said. This adds one more branch, mirroring the
-- super_admin one (any department, no department-match check).
--
-- Run this once, after 31_staff_self_log_tasks.sql, in the Supabase
-- SQL editor.
-- =====================================================================

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert with check (
    (
      (public.current_app_user()).permissions->>'canCreateTasks' = 'true'
      and (
        public.current_app_role() = 'super_admin'
        or public.current_app_role() = 'chief_officer'
        or (public.current_app_role() = 'dept_head' and department = (public.current_app_user()).department)
      )
    )
    or (
      public.current_app_role() = 'staff'
      and assignee_id = (public.current_app_user()).id
      and created_by_id = (public.current_app_user()).id
    )
  );

-- ---------------------------------------------------------------------
-- Companion fix: role_permission_ceiling() (08_clamp_user_permissions.sql)
-- has its own hardcoded per-role permission cap, separate from the
-- frontend default in src/lib/roles.ts. It still said canCreateTasks:
-- false for chief_officer — meaning ANY update to a Chief Officer's
-- user row by anyone other than a Super Admin (even an unrelated
-- change like a name/avatar edit) would silently clamp
-- canCreateTasks back to false, permanently undoing this migration's
-- intent the next time that row was touched. Bring the ceiling in
-- line with the new default so it stops fighting it.
-- ---------------------------------------------------------------------
create or replace function public.role_permission_ceiling(p_role user_role)
returns jsonb
language sql
immutable
as $$
  select case p_role
    when 'super_admin' then
      '{"canCreateTasks":true,"canApproveTasks":true,"canManageUsers":true,"canViewAuditLogs":true,"canExportReports":true,"canConfigureSlack":true,"canEditAllTasks":true,"canViewExecutiveAnalytics":true}'::jsonb
    when 'chief_officer' then
      '{"canCreateTasks":true,"canApproveTasks":false,"canManageUsers":true,"canViewAuditLogs":true,"canExportReports":true,"canConfigureSlack":false,"canEditAllTasks":false,"canViewExecutiveAnalytics":true}'::jsonb
    when 'dept_head' then
      '{"canCreateTasks":true,"canApproveTasks":true,"canManageUsers":true,"canViewAuditLogs":true,"canExportReports":true,"canConfigureSlack":true,"canEditAllTasks":true,"canViewExecutiveAnalytics":false}'::jsonb
    else
      -- staff
      '{"canCreateTasks":false,"canApproveTasks":false,"canManageUsers":false,"canViewAuditLogs":false,"canExportReports":false,"canConfigureSlack":false,"canEditAllTasks":false,"canViewExecutiveAnalytics":false}'::jsonb
  end;
$$;
