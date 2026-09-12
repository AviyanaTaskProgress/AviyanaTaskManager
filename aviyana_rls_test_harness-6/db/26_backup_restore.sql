-- =====================================================================
-- 26_backup_restore.sql
-- =====================================================================
-- Adds an in-app backup/restore feature, Super Admin only:
--   - "Backup Now" button — snapshots every application-data table into
--     a single JSONB row in a new `backups` table.
--   - A schedule *reminder* (daily/weekly/monthly) — this is a UI
--     reminder only, not an automated server-side job. Backups are
--     manually triggered by a Super Admin; the app just tells them when
--     one is due, based on how long it's been since the last one.
--   - Restore — replaces ALL current application data with a chosen
--     backup's contents (tasks, users, chat, notifications, audit logs
--     — everything this migration covers). A safety snapshot of the
--     CURRENT state is automatically taken immediately before every
--     restore, so a restore mistake can itself be undone by restoring
--     that safety snapshot.
--
-- Explicitly NOT covered by backup/restore:
--   - auth.users (login accounts/passwords) — these are managed by
--     Supabase Auth, not this app, and can't be safely recreated from a
--     SQL backup (passwords are hashed by GoTrue, not visible to this
--     database). Restoring a `users` profile row whose login account
--     was deleted since the backup was taken is impossible — those
--     rows are skipped, and the restore result reports how many.
--   - public._push_config (holds a push-notification signing secret —
--     deliberately excluded from ever being included in a backup blob).
--   - storage.objects (uploaded files) — file *references* (URLs) are
--     backed up as part of the tables that store them, but the actual
--     files in Storage are not duplicated by this feature.
--
-- Run this once, after 25_private_storage_buckets.sql, in the Supabase
-- SQL editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Backups table — one row per snapshot.
-- ---------------------------------------------------------------------
create table if not exists public.backups (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  created_by    uuid references public.users(id) on delete set null,
  label         text,
  table_counts  jsonb not null,
  payload       jsonb not null
);

create index if not exists idx_backups_created_at on public.backups(created_at desc);

alter table public.backups enable row level security;

drop policy if exists backups_super_admin_only on public.backups;
create policy backups_super_admin_only on public.backups
  for all
  using (public.current_app_role() = 'super_admin')
  with check (public.current_app_role() = 'super_admin');

-- ---------------------------------------------------------------------
-- 2. Schedule reminder setting — a single-row table (boolean primary
--    key forces exactly one row to ever exist).
-- ---------------------------------------------------------------------
create table if not exists public.backup_settings (
  id            boolean primary key default true check (id),
  frequency     text not null default 'weekly' check (frequency in ('daily', 'weekly', 'monthly')),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.users(id) on delete set null
);

insert into public.backup_settings (id, frequency) values (true, 'weekly')
on conflict (id) do nothing;

alter table public.backup_settings enable row level security;

drop policy if exists backup_settings_super_admin_only on public.backup_settings;
create policy backup_settings_super_admin_only on public.backup_settings
  for all
  using (public.current_app_role() = 'super_admin')
  with check (public.current_app_role() = 'super_admin');

-- ---------------------------------------------------------------------
-- 3. create_backup() — snapshots every application-data table.
-- ---------------------------------------------------------------------
create or replace function public.create_backup(p_label text default null)
returns uuid
language plpgsql
security definer
as $$
declare
  v_id uuid;
  v_payload jsonb;
  v_counts jsonb;
begin
  if public.current_app_role() <> 'super_admin' then
    raise exception 'Only Super Admin can create a backup';
  end if;

  v_payload := jsonb_build_object(
    'departments', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.departments t),
    'users', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.users t),
    'tasks', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.tasks t),
    'task_remarks', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.task_remarks t),
    'task_attachments', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.task_attachments t),
    'conversations', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.conversations t),
    'conversation_members', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.conversation_members t),
    'messages', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.messages t),
    'notifications', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.notifications t),
    'audit_logs', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.audit_logs t),
    'slack_config', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.slack_config t),
    'slack_notification_log', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.slack_notification_log t),
    'chief_officer_department_access', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.chief_officer_department_access t),
    'push_subscriptions', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.push_subscriptions t)
  );

  v_counts := jsonb_build_object(
    'departments', jsonb_array_length(v_payload->'departments'),
    'users', jsonb_array_length(v_payload->'users'),
    'tasks', jsonb_array_length(v_payload->'tasks'),
    'task_remarks', jsonb_array_length(v_payload->'task_remarks'),
    'task_attachments', jsonb_array_length(v_payload->'task_attachments'),
    'conversations', jsonb_array_length(v_payload->'conversations'),
    'messages', jsonb_array_length(v_payload->'messages'),
    'notifications', jsonb_array_length(v_payload->'notifications'),
    'audit_logs', jsonb_array_length(v_payload->'audit_logs')
  );

  insert into public.backups (created_by, label, payload, table_counts)
  values ((public.current_app_user()).id, p_label, v_payload, v_counts)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.create_backup(text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. restore_backup() — wipes and replaces every application-data
--    table with a chosen backup's contents. Automatically takes a
--    safety snapshot of the current state first.
-- ---------------------------------------------------------------------
create or replace function public.restore_backup(p_backup_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_payload jsonb;
  v_safety_id uuid;
  v_users_total int;
  v_users_restored int;
begin
  if public.current_app_role() <> 'super_admin' then
    raise exception 'Only Super Admin can restore a backup';
  end if;

  select payload into v_payload from public.backups where id = p_backup_id;
  if v_payload is null then
    raise exception 'Backup % not found', p_backup_id;
  end if;

  -- Safety net: snapshot the CURRENT state before wiping it, so a
  -- restore mistake can itself be undone by restoring this snapshot.
  v_safety_id := public.create_backup('Automatic safety snapshot — taken automatically before restoring backup ' || p_backup_id::text);

  -- Wipe current data, children first (FK-safe order). auth.users and
  -- _push_config are never touched by backup/restore — see file header.
  truncate public.audit_logs;
  delete from public.messages;
  delete from public.conversation_members;
  delete from public.conversations;
  delete from public.task_attachments;
  delete from public.task_remarks;
  delete from public.notifications;
  delete from public.tasks;
  delete from public.chief_officer_department_access;
  delete from public.slack_notification_log;
  delete from public.slack_config;
  delete from public.push_subscriptions;
  delete from public.users;
  delete from public.departments;

  -- Re-insert, parents first. Departments and users have a genuine
  -- circular dependency (departments.created_by -> users.id, and
  -- users.department -> departments.name, NOT NULL) — resolved by
  -- inserting departments WITHOUT created_by first, then users, then
  -- backfilling departments.created_by once users exist.
  insert into public.departments (name, created_by, created_at)
  select d.name, null, d.created_at
  from jsonb_populate_recordset(null::public.departments, v_payload->'departments') d;

  v_users_total := jsonb_array_length(v_payload->'users');

  -- Only restore profile rows whose login account still exists today —
  -- a backup can't recreate a deleted auth.users login (see file header).
  insert into public.users
  select u.* from jsonb_populate_recordset(null::public.users, v_payload->'users') u
  where exists (select 1 from auth.users a where a.id = u.auth_user_id);
  get diagnostics v_users_restored = row_count;

  -- Backfill departments.created_by now that users exist — skipping
  -- any whose original creator wasn't restored (their login was
  -- deleted since the backup), leaving that department's created_by
  -- as null rather than failing the whole restore.
  update public.departments d
  set created_by = orig.created_by
  from jsonb_populate_recordset(null::public.departments, v_payload->'departments') orig
  where d.name = orig.name
    and orig.created_by is not null
    and exists (select 1 from public.users pu where pu.id = orig.created_by);

  insert into public.tasks
  select * from jsonb_populate_recordset(null::public.tasks, v_payload->'tasks');
  insert into public.task_remarks
  select * from jsonb_populate_recordset(null::public.task_remarks, v_payload->'task_remarks');
  insert into public.task_attachments
  select * from jsonb_populate_recordset(null::public.task_attachments, v_payload->'task_attachments');
  insert into public.conversations
  select * from jsonb_populate_recordset(null::public.conversations, v_payload->'conversations');
  insert into public.conversation_members
  select * from jsonb_populate_recordset(null::public.conversation_members, v_payload->'conversation_members');
  insert into public.messages
  select * from jsonb_populate_recordset(null::public.messages, v_payload->'messages');
  insert into public.notifications
  select * from jsonb_populate_recordset(null::public.notifications, v_payload->'notifications');
  insert into public.audit_logs
  select * from jsonb_populate_recordset(null::public.audit_logs, v_payload->'audit_logs');
  insert into public.slack_config
  select * from jsonb_populate_recordset(null::public.slack_config, v_payload->'slack_config');
  insert into public.slack_notification_log
  select * from jsonb_populate_recordset(null::public.slack_notification_log, v_payload->'slack_notification_log');
  insert into public.chief_officer_department_access
  select * from jsonb_populate_recordset(null::public.chief_officer_department_access, v_payload->'chief_officer_department_access');
  insert into public.push_subscriptions
  select * from jsonb_populate_recordset(null::public.push_subscriptions, v_payload->'push_subscriptions');

  return jsonb_build_object(
    'safety_backup_id', v_safety_id,
    'users_in_backup', v_users_total,
    'users_restored', v_users_restored,
    'users_skipped', v_users_total - v_users_restored
  );
end;
$$;

grant execute on function public.restore_backup(uuid) to authenticated;
