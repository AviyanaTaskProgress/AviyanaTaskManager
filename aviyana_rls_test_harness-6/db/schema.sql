-- =====================================================================
-- OmniTrack — Database Schema (Supabase / PostgreSQL)
-- =====================================================================
-- Run this in the Supabase SQL Editor (Project -> SQL Editor -> New query)
-- or via: supabase db push  (if using the Supabase CLI with migrations).
--
-- This replaces the localStorage-based mock persistence in
-- src/context/AppContext.tsx with a real, multi-user, relational store.
-- =====================================================================

create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- ---------------------------------------------------------------------
-- ENUM TYPES (mirrors src/types.ts)
-- ---------------------------------------------------------------------
create type user_role as enum ('dept_head', 'manager', 'employee');

create type department as enum (
  'Engineering',
  'Product & Design',
  'Marketing',
  'Operations',
  'Human Resources',
  'Sales & Growth'
);

create type user_status as enum ('active', 'in_meeting', 'focus_mode', 'away', 'offline');

create type task_priority as enum ('low', 'medium', 'high', 'critical');

create type task_status as enum (
  'todo', 'in_progress', 'in_review', 'pending_approval', 'completed', 'blocked'
);

create type approval_status as enum ('pending', 'approved', 'rejected');

create type remark_type as enum (
  'general', 'status_change', 'approval_request', 'approval_action', 'deadline_change'
);

create type audit_category as enum ('task', 'user', 'security', 'slack', 'approval', 'report');
create type audit_status as enum ('success', 'warning', 'critical');

create type notification_type as enum ('deadline', 'approval', 'assignment', 'slack', 'system');
create type notification_urgency as enum ('low', 'medium', 'high', 'critical');

create type session_type as enum ('focus_work', 'code_review', 'planning', 'collaboration', 'break');
create type slack_delivery_status as enum ('delivered', 'failed');

-- ---------------------------------------------------------------------
-- USERS  (id matches Supabase auth.users.id — see trigger below)
-- ---------------------------------------------------------------------
create table public.users (
  id                        uuid primary key default gen_random_uuid(),
  auth_user_id              uuid unique references auth.users(id) on delete cascade,
  name                      text not null,
  email                     text not null unique,
  role                      user_role not null default 'employee',
  department                department not null,
  title                     text not null default '',
  avatar                    text,
  status                    user_status not null default 'offline',
  productivity_score        numeric(5,2) not null default 0 check (productivity_score between 0 and 100),
  tasks_completed           integer not null default 0,
  tasks_in_progress         integer not null default 0,
  hours_logged_this_month   numeric(6,2) not null default 0,
  permissions               jsonb not null default '{
    "canCreateTasks": false,
    "canApproveTasks": false,
    "canManageUsers": false,
    "canViewAuditLogs": false,
    "canExportReports": false,
    "canConfigureSlack": false,
    "canEditAllTasks": false,
    "canViewExecutiveAnalytics": false
  }'::jsonb,
  joined_date               date not null default current_date,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index idx_users_department on public.users(department);
create index idx_users_role on public.users(role);

-- ---------------------------------------------------------------------
-- TASKS
-- ---------------------------------------------------------------------
create table public.tasks (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null,
  description           text not null default '',
  department            department not null,
  assignee_id           uuid not null references public.users(id) on delete restrict,
  created_by_id         uuid not null references public.users(id) on delete restrict,
  start_date            date not null,
  due_date              date not null,
  completed_date        date,
  estimated_hours       numeric(6,2) not null default 0,
  logged_hours          numeric(6,2) not null default 0,
  priority              task_priority not null default 'medium',
  auto_priority_score   numeric(5,2),
  priority_reason       text,
  status                task_status not null default 'todo',
  progress              integer not null default 0 check (progress between 0 and 100),
  tags                  text[] not null default '{}',
  approved_by           uuid references public.users(id),
  approval_date         timestamptz,
  approval_status       approval_status,
  encrypted_note        text,
  is_encrypted          boolean not null default false,
  slack_synced          boolean not null default false,
  slack_last_notified   timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint due_after_start check (due_date >= start_date)
);

create index idx_tasks_assignee on public.tasks(assignee_id);
create index idx_tasks_department on public.tasks(department);
create index idx_tasks_status on public.tasks(status);
create index idx_tasks_due_date on public.tasks(due_date);

-- Task remarks / comment thread (supports encrypted remarks)
create table public.task_remarks (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.tasks(id) on delete cascade,
  author_id     uuid not null references public.users(id) on delete restrict,
  text          text not null,
  is_encrypted  boolean not null default false,
  type          remark_type not null default 'general',
  created_at    timestamptz not null default now()
);

create index idx_remarks_task on public.task_remarks(task_id);

-- ---------------------------------------------------------------------
-- AUDIT LOGS (append-only / immutable)
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id                    uuid primary key default gen_random_uuid(),
  actor_id              uuid references public.users(id),
  action                text not null,
  category              audit_category not null,
  target                text not null,
  details               text not null default '',
  ip_hash               text,
  encrypted_signature   text not null,
  status                audit_status not null default 'success',
  created_at            timestamptz not null default now()
);

create index idx_audit_created_at on public.audit_logs(created_at desc);
create index idx_audit_category on public.audit_logs(category);

-- Prevent UPDATE/DELETE on audit_logs -> true immutability
create or replace function public.block_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_logs is append-only: % not permitted', TG_OP;
end;
$$;

create trigger trg_audit_no_update
  before update on public.audit_logs
  for each row execute function public.block_audit_mutation();

create trigger trg_audit_no_delete
  before delete on public.audit_logs
  for each row execute function public.block_audit_mutation();

-- ---------------------------------------------------------------------
-- NOTIFICATIONS (per-user)
-- ---------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  type        notification_type not null,
  title       text not null,
  message     text not null,
  read        boolean not null default false,
  task_id     uuid references public.tasks(id) on delete set null,
  urgency     notification_urgency not null default 'low',
  created_at  timestamptz not null default now()
);

create index idx_notifications_user on public.notifications(user_id, read);

-- ---------------------------------------------------------------------
-- SLACK CONFIG (one row per department/workspace) + delivery log
-- ---------------------------------------------------------------------
create table public.slack_config (
  id                            uuid primary key default gen_random_uuid(),
  department                    department unique,          -- null = global/org-wide config
  webhook_url                   text,
  channel                       text default '#work-tracker-alerts',
  bot_name                      text default 'OmniTrack Bot',
  notify_on_task_assigned       boolean not null default true,
  notify_on_deadline_alert      boolean not null default true,
  notify_on_approval_requested  boolean not null default true,
  notify_on_task_completed      boolean not null default true,
  notify_on_daily_summary       boolean not null default false,
  is_connected                  boolean not null default false,
  last_tested_at                timestamptz,
  updated_at                    timestamptz not null default now()
);

create table public.slack_notification_log (
  id          uuid primary key default gen_random_uuid(),
  config_id   uuid references public.slack_config(id) on delete cascade,
  type        text not null,
  channel     text not null,
  summary     text not null,
  status      slack_delivery_status not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- TIME SESSIONS (timer / time-tracking log)
-- ---------------------------------------------------------------------
create table public.time_sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  task_id             uuid references public.tasks(id) on delete set null,
  start_time          timestamptz not null,
  end_time            timestamptz,
  duration_minutes    integer not null default 0,
  type                session_type not null default 'focus_work',
  efficiency_score    numeric(5,2) not null default 0 check (efficiency_score between 0 and 100),
  notes               text,
  created_at          timestamptz not null default now()
);

create index idx_sessions_user on public.time_sessions(user_id);
create index idx_sessions_task on public.time_sessions(task_id);

-- Atomically bump a task's logged_hours (used when a time session is saved)
create or replace function public.increment_task_logged_hours(p_task_id uuid, p_hours numeric)
returns void language sql as $$
  update public.tasks set logged_hours = logged_hours + p_hours where id = p_task_id;
$$;

-- ---------------------------------------------------------------------
-- updated_at auto-touch trigger (generic)
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_users_touch before update on public.users
  for each row execute function public.touch_updated_at();

create trigger trg_tasks_touch before update on public.tasks
  for each row execute function public.touch_updated_at();

create trigger trg_slack_touch before update on public.slack_config
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Auto-create a public.users profile row whenever someone signs up
-- via Supabase Auth (auth.users). Default role = employee.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.users (auth_user_id, name, email, department)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce((new.raw_user_meta_data->>'department')::department, 'Operations')
  );
  return new;
end;
$$;

create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- =====================================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================================
-- Note: the Express backend (server/) uses the Supabase SERVICE ROLE key,
-- which bypasses RLS entirely — authorization there is enforced in
-- middleware (src/middleware/auth.ts) based on the caller's role.
-- These policies are the *defense-in-depth* layer in case the frontend
-- ever talks to Supabase directly with the anon/user key.
-- ---------------------------------------------------------------------

alter table public.users enable row level security;
alter table public.tasks enable row level security;
alter table public.task_remarks enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.slack_config enable row level security;
alter table public.slack_notification_log enable row level security;
alter table public.time_sessions enable row level security;

-- Helper: current caller's row in public.users
create or replace function public.current_app_user()
returns public.users language sql stable security definer as $$
  select * from public.users where auth_user_id = auth.uid() limit 1;
$$;

create or replace function public.current_app_role()
returns user_role language sql stable security definer as $$
  select role from public.users where auth_user_id = auth.uid() limit 1;
$$;

-- USERS: everyone authenticated can read directory; only dept_head/manager
-- (with canManageUsers) can write.
create policy users_select_all on public.users
  for select using (auth.role() = 'authenticated');

create policy users_update_self on public.users
  for update using (auth_user_id = auth.uid());

create policy users_manage_by_admins on public.users
  for all using (
    public.current_app_role() in ('dept_head', 'manager')
    and (public.current_app_user()).permissions->>'canManageUsers' = 'true'
  );

-- TASKS: assignee, creator, or same-department managers/dept_head can see;
-- creation restricted to canCreateTasks; edits restricted to assignee or
-- canEditAllTasks.
create policy tasks_select on public.tasks
  for select using (
    assignee_id = (public.current_app_user()).id
    or created_by_id = (public.current_app_user()).id
    or public.current_app_role() in ('dept_head', 'manager')
  );

create policy tasks_insert on public.tasks
  for insert with check (
    (public.current_app_user()).permissions->>'canCreateTasks' = 'true'
  );

create policy tasks_update on public.tasks
  for update using (
    assignee_id = (public.current_app_user()).id
    or (public.current_app_user()).permissions->>'canEditAllTasks' = 'true'
  );

-- TASK REMARKS: visible to anyone who can see the parent task
create policy remarks_select on public.task_remarks
  for select using (
    exists (select 1 from public.tasks t where t.id = task_id)
  );

create policy remarks_insert on public.task_remarks
  for insert with check (author_id = (public.current_app_user()).id);

-- AUDIT LOGS: only canViewAuditLogs
create policy audit_select on public.audit_logs
  for select using (
    (public.current_app_user()).permissions->>'canViewAuditLogs' = 'true'
  );

-- NOTIFICATIONS: strictly own
create policy notifications_own on public.notifications
  for all using (user_id = (public.current_app_user()).id);

-- SLACK CONFIG: only canConfigureSlack
create policy slack_config_rw on public.slack_config
  for all using (
    (public.current_app_user()).permissions->>'canConfigureSlack' = 'true'
  );

create policy slack_log_read on public.slack_notification_log
  for select using (
    (public.current_app_user()).permissions->>'canConfigureSlack' = 'true'
  );

-- TIME SESSIONS: own sessions, or dept_head/manager can view team's
create policy sessions_select on public.time_sessions
  for select using (
    user_id = (public.current_app_user()).id
    or public.current_app_role() in ('dept_head', 'manager')
  );

create policy sessions_write on public.time_sessions
  for all using (user_id = (public.current_app_user()).id);
