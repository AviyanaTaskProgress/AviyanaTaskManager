-- =====================================================================
-- 42_ceo_and_chairman_roles.sql
-- =====================================================================
-- Adds two new roles to the 6-tier structure the board proposed:
-- Chairman | Super Admin | CEO | CO | Department Head | Staff.
--
--   ceo        Functionally the same operating tier as super_admin for
--              the capabilities below, EXCEPT it does not get user
--              management (canManageUsers), audit log access, or Slack
--              configuration — those stay Super-Admin-only. Confirmed
--              capability matrix:
--                - Create/assign tasks, any department (unconditional)
--                - Approve/reject submitted tasks (via canApproveTasks)
--                - Edit ANY task (unconditional)
--                - Delete ANY task (unconditional)
--                - Confirm ANY payment, any department/amount
--                - Backup/Restore the whole system
--                - Set Chief Officer's department access levels
--                - Export reports, view executive analytics dashboard
--
--   chairman   Strictly read-only, narrower than the existing 'viewer'
--              role — sees task STATUS only (not descriptions, remarks,
--              attachments, or payment figures). RLS can only restrict
--              which ROWS are visible, not which columns within a row a
--              particular app-role can see (every browser session
--              connects through the single 'authenticated' Postgres
--              role, same as every other role in this app) — so, same
--              defense-in-depth split already used for 'viewer'
--              (18_viewer_role_and_dashboard.sql): RLS here grants
--              Chairman the same full-row SELECT as chief_officer/ceo
--              (needed so the status rollup can be computed at all),
--              and the REAL restriction to status-only is enforced in
--              the frontend via a dedicated ChairmanDashboardView that
--              never requests or renders description/remarks/
--              attachments/payment fields. Chairman gets NO write
--              access anywhere (not in any insert/update/delete policy
--              below, same as it never appearing in any affirmative
--              branch of those policies).
--
-- ⚠️ IMPORTANT — RUN IN TWO STEPS, exactly like 29_task_payment_workflow.sql's
-- enum-value note: Postgres will not let a newly-added enum value be
-- used for a comparison/cast in the SAME transaction it was added in
-- ("unsafe use of new value of enum type"). If your SQL editor wraps
-- the whole pasted file in one transaction:
--   1. Run ONLY the two `alter type ... add value` lines below by
--      themselves first.
--   2. Then run the rest of this file (everything after that point) as
--      a second paste. Everything below is idempotent, so re-running
--      the whole file after that is safe.
--
-- Run this once, after 41_dept_head_payment_confirmation.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- STEP 1 — run these two lines alone, then come back for the rest.
-- ---------------------------------------------------------------------
alter type user_role add value if not exists 'ceo';
alter type user_role add value if not exists 'chairman';


-- ---------------------------------------------------------------------
-- STEP 2 — run everything below after Step 1 has committed.
-- ---------------------------------------------------------------------

-- Permission ceiling (08_clamp_user_permissions.sql's privilege-escalation
-- guard) — every role must appear here explicitly, or a role update
-- silently falls through to the "else" (staff-level, all-false) branch.
create or replace function public.role_permission_ceiling(p_role user_role)
returns jsonb
language sql
immutable
as $$
  select case p_role
    when 'super_admin' then
      '{"canCreateTasks":true,"canApproveTasks":true,"canManageUsers":true,"canViewAuditLogs":true,"canExportReports":true,"canConfigureSlack":true,"canEditAllTasks":true,"canViewExecutiveAnalytics":true}'::jsonb
    when 'ceo' then
      '{"canCreateTasks":true,"canApproveTasks":true,"canManageUsers":false,"canViewAuditLogs":false,"canExportReports":true,"canConfigureSlack":false,"canEditAllTasks":true,"canViewExecutiveAnalytics":true}'::jsonb
    when 'chief_officer' then
      '{"canCreateTasks":true,"canApproveTasks":false,"canManageUsers":true,"canViewAuditLogs":true,"canExportReports":true,"canConfigureSlack":false,"canEditAllTasks":false,"canViewExecutiveAnalytics":true}'::jsonb
    when 'dept_head' then
      '{"canCreateTasks":true,"canApproveTasks":true,"canManageUsers":true,"canViewAuditLogs":true,"canExportReports":true,"canConfigureSlack":true,"canEditAllTasks":true,"canViewExecutiveAnalytics":false}'::jsonb
    when 'chairman' then
      '{"canCreateTasks":false,"canApproveTasks":false,"canManageUsers":false,"canViewAuditLogs":false,"canExportReports":false,"canConfigureSlack":false,"canEditAllTasks":false,"canViewExecutiveAnalytics":false}'::jsonb
    else
      -- staff, viewer
      '{"canCreateTasks":false,"canApproveTasks":false,"canManageUsers":false,"canViewAuditLogs":false,"canExportReports":false,"canConfigureSlack":false,"canEditAllTasks":false,"canViewExecutiveAnalytics":false}'::jsonb
  end;
$$;

-- tasks_select: ceo and chairman both need full-row read (see header
-- note on why Chairman's real restriction is frontend-side).
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select using (
    assignee_id = (public.current_app_user()).id
    or created_by_id = (public.current_app_user()).id
    or public.current_app_role() in ('super_admin', 'ceo', 'chief_officer', 'viewer', 'chairman')
    or (public.current_app_role() = 'dept_head' and department = (public.current_app_user()).department)
  );

-- tasks_insert: ceo gets the same unconditional (any department) reach
-- as super_admin/chief_officer.
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert with check (
    (
      (public.current_app_user()).permissions->>'canCreateTasks' = 'true'
      and (
        public.current_app_role() in ('super_admin', 'ceo', 'chief_officer')
        or (public.current_app_role() = 'dept_head' and department = (public.current_app_user()).department)
      )
    )
    or (
      public.current_app_role() = 'staff'
      and assignee_id = (public.current_app_user()).id
      and created_by_id = (public.current_app_user()).id
    )
  );

-- tasks_update: ceo joins super_admin/chief_officer's unconditional tier
-- (chief_officer added in 40_chief_officer_task_edit.sql).
drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update using (
    public.current_app_role() not in ('viewer', 'chairman')
    and (
      assignee_id = (public.current_app_user()).id
      or public.current_app_role() in ('super_admin', 'ceo', 'chief_officer')
      or (
        (public.current_app_user()).permissions->>'canEditAllTasks' = 'true'
        and public.current_app_role() = 'dept_head'
        and department = (public.current_app_user()).department
      )
    )
  );

-- tasks_delete: ceo joins super_admin (34_audit_fixes_delete_policy_and_search_path.sql).
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete using (
    assignee_id = (public.current_app_user()).id
    or public.current_app_role() in ('super_admin', 'ceo')
    or (
      (public.current_app_user()).permissions->>'canEditAllTasks' = 'true'
      and public.current_app_role() = 'dept_head'
      and department = (public.current_app_user()).department
    )
  );

-- Payment confirmation: ceo joins the unconditional (any department)
-- tier alongside super_admin/chief_officer; dept_head keeps its
-- own-department-only reach from 41_dept_head_payment_confirmation.sql.
create or replace function public.confirm_task_payment(p_task_id uuid, p_notes text default null)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_role    user_role;
  v_dept    text;
  v_task_dept text;
  v_row     public.tasks;
begin
  select id, role, department into v_user_id, v_role, v_dept from public.users where auth_user_id = auth.uid();
  select t.department into v_task_dept from public.tasks t where t.id = p_task_id;

  if not (
    v_role in ('super_admin', 'ceo', 'chief_officer')
    or (v_role = 'dept_head' and v_task_dept is not distinct from v_dept)
  ) then
    raise exception 'Not allowed: only higher management or this task''s own Dept Head can confirm payment';
  end if;

  update public.tasks
    set payment_status = 'paid',
        payment_confirmed_by = v_user_id,
        payment_confirmed_at = now(),
        payment_notes = coalesce(p_notes, payment_notes),
        status = 'completed',
        completed_date = current_date
    where id = p_task_id
      and requires_payment = true
      and payment_status = 'pending'
    returning * into v_row;

  if v_row.id is null then
    raise exception 'Task not found, or is not currently awaiting payment confirmation';
  end if;

  update public.task_subtasks
    set payment_status = 'paid',
        payment_confirmed_by = v_user_id,
        payment_confirmed_at = now()
    where task_id = p_task_id
      and payment_amount is not null
      and payment_status = 'pending';

  perform public.notify_push(array[v_row.assignee_id], 'Payment confirmed', v_row.title, '/');
  perform public.log_audit_event('task.payment_confirmed', 'approval', p_task_id::text, coalesce(p_notes, ''), 'success');

  return v_row;
end;
$$;

grant execute on function public.confirm_task_payment(uuid, text) to authenticated;

create or replace function public.confirm_subtask_payment(p_subtask_id uuid, p_notes text default null)
returns public.task_subtasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id   uuid;
  v_role      user_role;
  v_dept      text;
  v_task_dept text;
  v_row       public.task_subtasks;
  v_task_id   uuid;
  v_all_paid  boolean;
  v_task      public.tasks;
begin
  select id, role, department into v_user_id, v_role, v_dept from public.users where auth_user_id = auth.uid();
  select t.department into v_task_dept
    from public.task_subtasks s join public.tasks t on t.id = s.task_id
    where s.id = p_subtask_id;

  if not (
    v_role in ('super_admin', 'ceo', 'chief_officer')
    or (v_role = 'dept_head' and v_task_dept is not distinct from v_dept)
  ) then
    raise exception 'Not allowed: only higher management or this task''s own Dept Head can confirm payment';
  end if;

  update public.task_subtasks
    set payment_status = 'paid',
        payment_confirmed_by = v_user_id,
        payment_confirmed_at = now(),
        payment_notes = coalesce(p_notes, payment_notes)
    where id = p_subtask_id
      and payment_amount is not null
      and payment_status = 'pending'
    returning * into v_row;

  if v_row.id is null then
    raise exception 'Subtask not found, or is not currently awaiting payment confirmation';
  end if;

  v_task_id := v_row.task_id;
  select * into v_task from public.tasks where id = v_task_id;

  select not exists (
    select 1 from public.task_subtasks
    where task_id = v_task_id and payment_amount is not null and payment_status <> 'paid'
  ) into v_all_paid;

  if v_all_paid and v_task.status = 'pending_payment' then
    update public.tasks
      set payment_status = 'paid', status = 'completed', completed_date = current_date
      where id = v_task_id;

    perform public.notify_push(array[v_task.assignee_id], 'Payment confirmed', v_task.title, '/');
  end if;

  perform public.log_audit_event('task.subtask_payment_confirmed', 'approval', p_subtask_id::text, coalesce(p_notes, ''), 'success');

  return v_row;
end;
$$;

grant execute on function public.confirm_subtask_payment(uuid, text) to authenticated;

-- Backup/Restore: ceo joins super_admin.
drop policy if exists backups_super_admin_only on public.backups;
create policy backups_super_admin_only on public.backups
  for all
  using (public.current_app_role() in ('super_admin', 'ceo'))
  with check (public.current_app_role() in ('super_admin', 'ceo'));

drop policy if exists backup_settings_super_admin_only on public.backup_settings;
create policy backup_settings_super_admin_only on public.backup_settings
  for all
  using (public.current_app_role() in ('super_admin', 'ceo'))
  with check (public.current_app_role() in ('super_admin', 'ceo'));

-- create_backup()/restore_backup() (26_backup_restore.sql) rely on this
-- same RLS policy rather than their own inline role check, so no
-- function body changes needed there.

-- Chief Officer department access levels: ceo joins super_admin.
drop policy if exists chief_access_super_admin_only on public.chief_officer_department_access;
create policy chief_access_super_admin_only on public.chief_officer_department_access
  for all
  using (public.current_app_role() in ('super_admin', 'ceo'))
  with check (public.current_app_role() in ('super_admin', 'ceo'));
