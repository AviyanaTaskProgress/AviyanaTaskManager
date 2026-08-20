-- =====================================================================
-- 05_role_based_access.sql
-- =====================================================================
-- Moves from the old 3-tier role model (dept_head / manager / employee)
-- to a 4-tier one:
--
--   super_admin    Full access, every department, every action.
--   chief_officer  Cross-department. Can run reports and create users
--                  everywhere by default. A Super Admin can dial a
--                  specific chief officer down to 'limited' (read-only,
--                  no user creation) for individual departments via
--                  chief_officer_department_access.
--   dept_head      Scoped to their own department only. Can add staff
--                  under that department and assign/approve their tasks.
--   staff          Works their assigned tasks and logs progress
--                  (daily/weekly). No admin capabilities.
--
-- 'manager' is merged into 'staff' (least-privilege default) and
-- 'employee' is renamed to 'staff' to match the terminology in use.
--
-- Run this once, after 01/02/03/04, in the Supabase SQL editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Rebuild the user_role enum
-- ---------------------------------------------------------------------
alter type user_role rename to user_role_old;
create type user_role as enum ('super_admin', 'chief_officer', 'dept_head', 'staff');

alter table public.users alter column role drop default;
alter table public.users
  alter column role type user_role
  using (
    case role::text
      when 'dept_head' then 'dept_head'
      else 'staff' -- 'manager' and 'employee' both collapse to 'staff'
    end
  )::user_role;
alter table public.users alter column role set default 'staff';

drop type user_role_old;

-- ---------------------------------------------------------------------
-- 2. Per-department access override for Chief Officers.
--    No row for a (chief_officer, department) pair = 'full' access.
--    Only a Super Admin can read/write this table.
-- ---------------------------------------------------------------------
create table public.chief_officer_department_access (
  id                 uuid primary key default gen_random_uuid(),
  chief_officer_id   uuid not null references public.users(id) on delete cascade,
  department         department not null,
  access_level       text not null default 'full' check (access_level in ('full', 'limited')),
  created_at         timestamptz not null default now(),
  unique (chief_officer_id, department)
);

alter table public.chief_officer_department_access enable row level security;

create policy chief_access_super_admin_only on public.chief_officer_department_access
  for all
  using (public.current_app_role() = 'super_admin')
  with check (public.current_app_role() = 'super_admin');

-- A chief officer can read their own access map (so the UI can show them
-- which departments they're limited in) but never write it.
create policy chief_access_self_read on public.chief_officer_department_access
  for select
  using (chief_officer_id = (public.current_app_user()).id);

-- Helper: effective access level a chief officer has for a department.
create or replace function public.chief_officer_dept_level(p_chief_id uuid, p_department department)
returns text language sql stable security definer as $$
  select coalesce(
    (select access_level from public.chief_officer_department_access
     where chief_officer_id = p_chief_id and department = p_department),
    'full'
  );
$$;

-- ---------------------------------------------------------------------
-- 3. New signups default to 'staff' (was 'employee').
-- ---------------------------------------------------------------------
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
      coalesce((new.raw_user_meta_data->>'department')::department, 'Operations'),
      'staff'
    );
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Stop people editing their own role/department/permissions.
--    (users_update_self only ever let people touch their own row —
--    it never blocked *which* columns, so a staff member could have
--    promoted themselves. Only Super Admin can change these fields.)
-- ---------------------------------------------------------------------
create or replace function public.block_self_privilege_escalation()
returns trigger language plpgsql security definer as $$
begin
  if new.auth_user_id = auth.uid()
     and public.current_app_role() is distinct from 'super_admin'
     and (
       new.role is distinct from old.role
       or new.department is distinct from old.department
       or new.permissions is distinct from old.permissions
     )
  then
    raise exception 'Not allowed: cannot change your own role, department, or permissions';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_block_self_privilege_escalation on public.users;
create trigger trg_block_self_privilege_escalation
  before update on public.users
  for each row execute function public.block_self_privilege_escalation();

-- ---------------------------------------------------------------------
-- 5. USERS RLS — replace the old dept_head/manager policy with
--    role-scoped write access.
-- ---------------------------------------------------------------------
drop policy if exists users_manage_by_admins on public.users;

create policy users_manage_by_super_admin on public.users
  for all
  using (public.current_app_role() = 'super_admin')
  with check (public.current_app_role() = 'super_admin');

-- Chief officer: can create/edit staff & dept_heads (never other chief
-- officers or super admins) in departments where they have 'full' access.
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

-- Dept head: can create/edit staff only, only inside their own department.
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

-- ---------------------------------------------------------------------
-- 6. TASKS RLS — scope dept_head to their own department; chief_officer
--    and super_admin see/manage across departments.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 7. Approval RPC — a dept_head may only decide on tasks in their own
--    department; super_admin/chief_officer (with canApproveTasks) can
--    decide on any.
-- ---------------------------------------------------------------------
create or replace function public.decide_task_approval(p_task_id uuid, p_decision approval_status, p_comment text default null)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_role user_role;
  v_dept department;
  v_can_approve boolean;
  v_task_dept department;
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
        status = case when p_decision = 'approved' then 'completed' else 'in_progress' end,
        completed_date = case when p_decision = 'approved' then current_date else completed_date end
    where id = p_task_id
    returning * into v_row;

  if p_comment is not null then
    insert into public.task_remarks (task_id, author_id, text, type)
    values (p_task_id, v_user_id, p_comment, 'approval_action');
  end if;

  perform public.log_audit_event(
    'task.' || p_decision::text, 'approval', p_task_id::text, '',
    case when p_decision = 'rejected' then 'warning' else 'success' end
  );

  return v_row;
end;
$$;

grant execute on function public.decide_task_approval(uuid, approval_status, text) to authenticated;

-- ---------------------------------------------------------------------
-- 8. TIME SESSIONS — dept_head sees own department, chief/super see all.
-- ---------------------------------------------------------------------
drop policy if exists sessions_select on public.time_sessions;
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
  );
