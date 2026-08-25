-- =====================================================================
-- 18_viewer_role_and_dashboard.sql
-- =====================================================================
-- Adds a 5th role: 'viewer'.
--
--   viewer   Strictly read-only. Sees every task and every department
--            (like chief_officer's visibility) but cannot create or
--            edit anything anywhere — no tasks, no users, no chat, no
--            Slack config. Intended for people like the Chairman who
--            need to see overall progress without operating the app.
--
-- The frontend gives 'viewer' users a dedicated dashboard-only screen
-- (no sidebar, no "new task"/"edit" buttons reachable at all) — this
-- migration is the defense-in-depth layer under that, in case anything
-- ever talks to Supabase directly with the viewer's own session.
--
-- Run this once, after 17_dynamic_departments.sql, in the Supabase SQL
-- editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Rebuild the user_role enum with 'viewer' added (same technique as
--    05_role_based_access.sql used to go from 3 roles to 4). Guarded so
--    this is safe to re-run if it fails partway through.
--
--    users_manage_by_dept_head and users_manage_by_chief_officer both
--    compare the `role` column directly (not just via current_app_role()),
--    and trg_clamp_user_permissions (08_clamp_user_permissions.sql) is a
--    trigger scoped to "update of role" plus role_permission_ceiling()
--    takes user_role as a parameter — same issue as the department
--    columns in 17_dynamic_departments.sql.
--
--    On top of that: current_app_role() returns user_role, and EVERY
--    policy that compares its result against a role literal (e.g.
--    `public.current_app_role() = 'super_admin'`) gets a hard pg_depend
--    on the enum type itself, not just the column — Postgres reported
--    the full list when this was attempted (see chat history). All of
--    those get dropped before the rename and recreated after, unchanged.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'user_role' and e.enumlabel = 'viewer'
  ) then
    drop policy if exists users_manage_by_dept_head on public.users;
    drop policy if exists users_manage_by_chief_officer on public.users;
    drop policy if exists users_manage_by_super_admin on public.users;
    drop policy if exists tasks_select on public.tasks;
    drop policy if exists tasks_insert on public.tasks;
    drop policy if exists tasks_update on public.tasks;
    drop policy if exists attachments_select on public.task_attachments;
    drop policy if exists attachments_insert on public.task_attachments;
    drop policy if exists attachments_delete on public.task_attachments;
    drop policy if exists chief_access_super_admin_only on public.chief_officer_department_access;
    drop policy if exists departments_insert_super_admin on public.departments;
    drop policy if exists conversations_insert on public.conversations;
    drop policy if exists avatars_insert on storage.objects;
    drop policy if exists avatars_update on storage.objects;
    drop policy if exists avatars_delete on storage.objects;
    drop trigger if exists trg_clamp_user_permissions on public.users;
    drop function if exists public.role_permission_ceiling(user_role);
    drop function if exists public.current_app_role();

    alter type user_role rename to user_role_old;
    create type user_role as enum ('super_admin', 'chief_officer', 'dept_head', 'staff', 'viewer');

    alter table public.users alter column role drop default;
    alter table public.users alter column role type user_role using role::text::user_role;
    alter table public.users alter column role set default 'staff';

    drop type user_role_old;

    -- Recreate current_app_role() first — almost everything below calls it.
    create or replace function public.current_app_role()
    returns user_role language sql stable security definer as $ROLE$
      select role from public.users where auth_user_id = auth.uid() limit 1;
    $ROLE$;

    -- Recreate role_permission_ceiling — identical logic to
    -- 08_clamp_user_permissions.sql, 'viewer' clamped to all-false
    -- except canViewExecutiveAnalytics (matches defaultPermissionsForRole
    -- in src/lib/roles.ts).
    create or replace function public.role_permission_ceiling(p_role user_role)
    returns jsonb
    language sql
    immutable
    as $ceiling$
      select case p_role
        when 'super_admin' then
          '{"canCreateTasks":true,"canApproveTasks":true,"canManageUsers":true,"canViewAuditLogs":true,"canExportReports":true,"canConfigureSlack":true,"canEditAllTasks":true,"canViewExecutiveAnalytics":true}'::jsonb
        when 'chief_officer' then
          '{"canCreateTasks":false,"canApproveTasks":false,"canManageUsers":true,"canViewAuditLogs":true,"canExportReports":true,"canConfigureSlack":false,"canEditAllTasks":false,"canViewExecutiveAnalytics":true}'::jsonb
        when 'dept_head' then
          '{"canCreateTasks":true,"canApproveTasks":true,"canManageUsers":true,"canViewAuditLogs":true,"canExportReports":true,"canConfigureSlack":true,"canEditAllTasks":true,"canViewExecutiveAnalytics":false}'::jsonb
        when 'viewer' then
          '{"canCreateTasks":false,"canApproveTasks":false,"canManageUsers":false,"canViewAuditLogs":false,"canExportReports":false,"canConfigureSlack":false,"canEditAllTasks":false,"canViewExecutiveAnalytics":true}'::jsonb
        else
          -- staff
          '{"canCreateTasks":false,"canApproveTasks":false,"canManageUsers":false,"canViewAuditLogs":false,"canExportReports":false,"canConfigureSlack":false,"canEditAllTasks":false,"canViewExecutiveAnalytics":false}'::jsonb
      end;
    $ceiling$;

    create trigger trg_clamp_user_permissions
      before insert or update of permissions, role on public.users
      for each row execute function public.clamp_user_permissions();

    create policy users_manage_by_dept_head on public.users
      for all
      using (
        public.current_app_role() = 'dept_head'
        and role = 'staff'
        and department = (public.current_app_user()).department
      )
      with check (
        public.current_app_role() = 'dept_head'
        and role = 'staff'
        and department = (public.current_app_user()).department
      );

    create policy users_manage_by_chief_officer on public.users
      for all
      using (
        public.current_app_role() = 'chief_officer'
        and (public.current_app_user()).permissions->>'canManageUsers' = 'true'
        and role in ('staff', 'dept_head')
        and public.chief_officer_dept_level((public.current_app_user()).id, department) = 'full'
      )
      with check (
        public.current_app_role() = 'chief_officer'
        and (public.current_app_user()).permissions->>'canManageUsers' = 'true'
        and role in ('staff', 'dept_head')
        and public.chief_officer_dept_level((public.current_app_user()).id, department) = 'full'
      );

    create policy users_manage_by_super_admin on public.users
      for all
      using (public.current_app_role() = 'super_admin')
      with check (public.current_app_role() = 'super_admin');

    create policy tasks_select on public.tasks
      for select using (
        assignee_id = (public.current_app_user()).id
        or created_by_id = (public.current_app_user()).id
        or public.current_app_role() in ('super_admin', 'chief_officer', 'viewer')
        or (public.current_app_role() = 'dept_head' and department = (public.current_app_user()).department)
      );

    create policy tasks_insert on public.tasks
      for insert with check (
        (public.current_app_user()).permissions->>'canCreateTasks' = 'true'
        and (
          public.current_app_role() = 'super_admin'
          or (public.current_app_role() = 'dept_head' and department = (public.current_app_user()).department)
        )
      );

    create policy tasks_update on public.tasks
      for update using (
        assignee_id = (public.current_app_user()).id
        or public.current_app_role() = 'super_admin'
        or (
          (public.current_app_user()).permissions->>'canEditAllTasks' = 'true'
          and public.current_app_role() = 'dept_head'
          and department = (public.current_app_user()).department
        )
      );

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

    create policy attachments_delete on public.task_attachments
      for delete using (
        uploaded_by = (public.current_app_user()).id
        or public.current_app_role() = 'super_admin'
      );

    create policy chief_access_super_admin_only on public.chief_officer_department_access
      for all
      using (public.current_app_role() = 'super_admin')
      with check (public.current_app_role() = 'super_admin');

    create policy departments_insert_super_admin on public.departments
      for insert with check (public.current_app_role() = 'super_admin');

    -- conversations_insert gets its final ('viewer' excluded) definition
    -- in section 3 below, unconditionally — just drop it here so the
    -- type isn't blocked; nothing else needs to recreate it in between.

    create policy avatars_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'avatars'
        and (
          public.current_app_role() = 'super_admin'
          or (storage.foldername(name))[1] = (select id::text from public.users where auth_user_id = auth.uid())
        )
      );

    create policy avatars_update on storage.objects
      for update to authenticated
      using (
        bucket_id = 'avatars'
        and (
          public.current_app_role() = 'super_admin'
          or (storage.foldername(name))[1] = (select id::text from public.users where auth_user_id = auth.uid())
        )
      );

    create policy avatars_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'avatars'
        and (
          public.current_app_role() = 'super_admin'
          or (storage.foldername(name))[1] = (select id::text from public.users where auth_user_id = auth.uid())
        )
      );
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. TASKS / TIME SESSIONS — viewer reads everything, same breadth as
--    super_admin/chief_officer. It's never added to any INSERT/UPDATE
--    policy, so it stays select-only.
-- ---------------------------------------------------------------------
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select using (
    assignee_id = (public.current_app_user()).id
    or created_by_id = (public.current_app_user()).id
    or public.current_app_role() in ('super_admin', 'chief_officer', 'viewer')
    or (public.current_app_role() = 'dept_head' and department = (public.current_app_user()).department)
  );

-- time_sessions was dropped entirely in 12_remove_focus_timer.sql — only
-- touch it here if some other DB still has that table.
do $$
begin
  if to_regclass('public.time_sessions') is not null then
    execute 'drop policy if exists sessions_select on public.time_sessions';
    execute $sql$
      create policy sessions_select on public.time_sessions
        for select using (
          user_id = (public.current_app_user()).id
          or public.current_app_role() in ('super_admin', 'chief_officer', 'viewer')
          or (
            public.current_app_role() = 'dept_head'
            and exists (
              select 1 from public.users u
              where u.id = time_sessions.user_id and u.department = (public.current_app_user()).department
            )
          )
        )
    $sql$;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. CHAT — a viewer should not be able to start any conversation,
--    direct or group (they have no reason to write anywhere).
-- ---------------------------------------------------------------------
drop policy if exists conversations_insert on public.conversations;
create policy conversations_insert on public.conversations
  for insert with check (
    created_by = (public.current_app_user()).id
    and public.current_app_role() <> 'viewer'
    and (
      type = 'direct'
      or (type = 'group' and public.current_app_role() in ('dept_head', 'chief_officer', 'super_admin'))
    )
  );
