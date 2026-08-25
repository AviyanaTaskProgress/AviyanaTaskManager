-- =====================================================================
-- 17_dynamic_departments.sql
-- =====================================================================
-- Departments were a fixed Postgres ENUM (6 hardcoded values, mirrored
-- in src/types.ts). This migration turns them into a real table so a
-- Super Admin can add a new department from the app instead of needing
-- a code change + migration every time the org restructures.
--
-- After this runs, `public.departments` is the source of truth.
-- `users.department`, `tasks.department`, `slack_config.department`,
-- and `chief_officer_department_access.department` all become plain
-- `text` columns with a foreign key into `departments(name)` — same
-- data integrity as the enum had, just extensible at runtime.
--
-- Run this once, after 16_chat_direct_and_group.sql, in the Supabase
-- SQL editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The new departments table, seeded with the 6 existing values.
-- ---------------------------------------------------------------------
create table if not exists public.departments (
  name        text primary key,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

insert into public.departments (name) values
  ('Engineering'),
  ('Product & Design'),
  ('Marketing'),
  ('Operations'),
  ('Human Resources'),
  ('Sales & Growth')
on conflict (name) do nothing;

alter table public.departments enable row level security;

-- Everyone signed in can read the department list (needed to populate
-- dropdowns). Only a Super Admin can add one — this is an org-structure
-- change, same trust level as the chief_officer_department_access table.
drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments
  for select using (auth.role() = 'authenticated');

drop policy if exists departments_insert_super_admin on public.departments;
create policy departments_insert_super_admin on public.departments
  for insert with check (public.current_app_role() = 'super_admin');

-- ---------------------------------------------------------------------
-- 2. Convert every `department`-enum column to text + FK.
--
--    Postgres tracks a policy's column dependencies across every table
--    its USING/CHECK expression touches — not just the table the policy
--    is defined on. Because department shows up (directly or via a
--    join/subquery) in policies on users, tasks, time_sessions, and
--    task_attachments, ALL of those have to be dropped before the
--    column type changes, then recreated afterward with the exact same
--    logic they have today (05_role_based_access.sql / 15_storage_...).
--    Every step is guarded so this section is safe to re-run if it
--    fails partway through.
-- ---------------------------------------------------------------------
drop policy if exists users_manage_by_chief_officer on public.users;
drop policy if exists users_manage_by_dept_head on public.users;
drop policy if exists tasks_select on public.tasks;
drop policy if exists tasks_insert on public.tasks;
drop policy if exists tasks_update on public.tasks;
drop policy if exists attachments_select on public.task_attachments;
drop policy if exists attachments_insert on public.task_attachments;
drop function if exists public.chief_officer_dept_level(uuid, department);

-- time_sessions was dropped entirely in 12_remove_focus_timer.sql — only
-- touch it here if some other DB still has it (never got 12 applied).
do $$
begin
  if to_regclass('public.time_sessions') is not null then
    execute 'drop policy if exists sessions_select on public.time_sessions';
  end if;
end $$;

do $$
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'users' and column_name = 'department') <> 'text' then
    alter table public.users alter column department type text using department::text;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_department_fkey') then
    alter table public.users add constraint users_department_fkey foreign key (department) references public.departments(name);
  end if;
end $$;

do $$
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'tasks' and column_name = 'department') <> 'text' then
    alter table public.tasks alter column department type text using department::text;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_department_fkey') then
    alter table public.tasks add constraint tasks_department_fkey foreign key (department) references public.departments(name);
  end if;
end $$;

do $$
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'slack_config' and column_name = 'department') <> 'text' then
    alter table public.slack_config alter column department type text using department::text;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'slack_config_department_fkey') then
    alter table public.slack_config add constraint slack_config_department_fkey foreign key (department) references public.departments(name);
  end if;
end $$;

do $$
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'chief_officer_department_access' and column_name = 'department') <> 'text' then
    alter table public.chief_officer_department_access alter column department type text using department::text;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chief_officer_dept_access_department_fkey') then
    alter table public.chief_officer_department_access add constraint chief_officer_dept_access_department_fkey foreign key (department) references public.departments(name);
  end if;
end $$;

drop type if exists public.department;

-- ---------------------------------------------------------------------
-- 3. Recreate the functions that referenced the enum type, now with
--    `text` instead. Logic is unchanged from 05_role_based_access.sql /
--    13_fix_approval_status_cast.sql — only the department type differs.
-- ---------------------------------------------------------------------
create or replace function public.chief_officer_dept_level(p_chief_id uuid, p_department text)
returns text language sql stable security definer as $$
  select coalesce(
    (select access_level from public.chief_officer_department_access
     where chief_officer_id = p_chief_id and department = p_department),
    'full'
  );
$$;

-- Recreate every policy dropped above — identical logic to
-- 05_role_based_access.sql / 15_storage_avatars_and_attachments.sql,
-- just now comparing against a `text` department instead of the enum.

drop policy if exists users_manage_by_dept_head on public.users;
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

drop policy if exists users_manage_by_chief_officer on public.users;
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

drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select using (
    assignee_id = (public.current_app_user()).id
    or created_by_id = (public.current_app_user()).id
    or public.current_app_role() in ('super_admin', 'chief_officer')
    or (public.current_app_role() = 'dept_head' and department = (public.current_app_user()).department)
  );

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert with check (
    (public.current_app_user()).permissions->>'canCreateTasks' = 'true'
    and (
      public.current_app_role() = 'super_admin'
      or (public.current_app_role() = 'dept_head' and department = (public.current_app_user()).department)
    )
  );

drop policy if exists tasks_update on public.tasks;
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

-- time_sessions was dropped entirely in 12_remove_focus_timer.sql — only
-- recreate this policy if some other DB still has that table.
do $$
begin
  if to_regclass('public.time_sessions') is not null then
    execute 'drop policy if exists sessions_select on public.time_sessions';
    execute $sql$
      create policy sessions_select on public.time_sessions
        for select using (
          user_id = (public.current_app_user()).id
          or public.current_app_role() in ('super_admin', 'chief_officer')
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

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer as $$
declare
  existing_id uuid;
begin
  select id into existing_id
  from public.users
  where lower(email) = lower(new.email)
    and auth_user_id is null
  limit 1;

  if existing_id is not null then
    update public.users
    set auth_user_id = new.id,
        name = coalesce(nullif(new.raw_user_meta_data->>'name', ''), name)
    where id = existing_id;
  else
    insert into public.users (auth_user_id, name, email, department, role)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
      new.email,
      coalesce(new.raw_user_meta_data->>'department', 'Operations'),
      'staff'
    );
  end if;

  return new;
end;
$$;

create or replace function public.decide_task_approval(p_task_id uuid, p_decision approval_status, p_comment text default null)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_role user_role;
  v_dept text;
  v_can_approve boolean;
  v_task_dept text;
  v_row public.tasks;
begin
  select id, role, department, (permissions->>'canApproveTasks')::boolean
    into v_user_id, v_role, v_dept, v_can_approve
    from public.users where auth_user_id = auth.uid();

  if not coalesce(v_can_approve, false) then
    raise exception 'Not allowed: missing canApproveTasks permission';
  end if;

  select department into v_task_dept from public.tasks where id = p_task_id;

  if v_role = 'dept_head' and v_task_dept is distinct from v_dept then
    raise exception 'Not allowed: this task is outside your department';
  end if;

  update public.tasks
    set approval_status = p_decision,
        approved_by = v_user_id,
        approval_date = now(),
        status = (case when p_decision = 'approved' then 'completed' else 'in_progress' end)::task_status,
        completed_date = case when p_decision = 'approved' then current_date else completed_date end
    where id = p_task_id
    returning * into v_row;

  if p_comment is not null then
    insert into public.task_remarks (task_id, author_id, text, type)
    values (p_task_id, v_user_id, p_comment, 'approval_action');
  end if;

  perform public.log_audit_event(
    'task.' || p_decision::text, 'approval', p_task_id::text, '',
    (case when p_decision = 'rejected' then 'warning' else 'success' end)::audit_status
  );

  return v_row;
end;
$$;

grant execute on function public.decide_task_approval(uuid, approval_status, text) to authenticated;
