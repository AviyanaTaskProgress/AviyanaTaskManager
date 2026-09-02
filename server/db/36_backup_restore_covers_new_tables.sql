-- =====================================================================
-- 36_backup_restore_covers_new_tables.sql
-- =====================================================================
-- create_backup()/restore_backup() (26_backup_restore.sql) predate
-- every table added later this session (task_subtasks,
-- department_task_counters, task_reminder_log). Found during a
-- "what's still missing before launch" pass, not by running an actual
-- restore against production — but traced through carefully enough to
-- be confident these are real, launch-blocking bugs:
--
-- BUG 1 — restoring ANY backup permanently deletes every subtask.
--   restore_backup() does `delete from public.tasks;`, which CASCADES
--   to task_subtasks (task_id ... on delete cascade) — but
--   task_subtasks was never in the backup payload and is never
--   re-inserted. Every checklist step on every task, gone, with no
--   way back (the automatic pre-restore safety snapshot doesn't help
--   either, since IT also never captured subtasks).
--
-- BUG 2 — restoring a backup corrupts task ID generation going
--   forward. `delete from public.departments;` cascades to
--   department_task_counters (department_name ... on delete cascade),
--   which is also never backed up or restored. The counter isn't
--   touched by re-inserting tasks with their existing task_display_id
--   already set (trg_tasks_generate_display_id only assigns one when
--   the column is null) — so after a restore, the counter for e.g.
--   Engineering silently resets to empty. The next brand-new
--   Engineering task then gets ENG-0001 again, colliding with an
--   already-restored task that has that exact ID and violating
--   tasks_display_id_unique — task creation breaks for that department
--   until someone notices and manually fixes the counter.
--
-- BUG 3 — restoring a backup double-counts users.tasks_completed.
--   Users are restored (with their backed-up tasks_completed value)
--   BEFORE tasks are restored. Re-inserting tasks is a real INSERT,
--   which fires trg_tasks_sync_completed_counter
--   (30_assigned_by_and_completed_counter.sql) — so every completed
--   task being re-inserted adds +1 on top of the already-correct
--   backed-up count, roughly doubling it.
--
-- Fixed by: including task_subtasks/department_task_counters/
-- task_reminder_log in the backup payload, restoring them in FK-safe
-- order (task_subtasks before task_attachments, since attachments can
-- reference a subtask), and recomputing tasks_completed from the
-- actual restored task rows at the end instead of trusting the
-- trigger's running total through the bulk insert.
--
-- Run this once, after 35_missing_indexes.sql, in the Supabase SQL
-- editor.
-- =====================================================================

create or replace function public.create_backup(p_label text default null)
returns uuid
language plpgsql
security definer
set search_path = public
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
    'department_task_counters', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.department_task_counters t),
    'users', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.users t),
    'tasks', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.tasks t),
    'task_subtasks', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.task_subtasks t),
    'task_remarks', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.task_remarks t),
    'task_attachments', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.task_attachments t),
    'task_reminder_log', (select coalesce(jsonb_agg(t), '[]'::jsonb) from public.task_reminder_log t),
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
    'task_subtasks', jsonb_array_length(v_payload->'task_subtasks'),
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

create or replace function public.restore_backup(p_backup_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
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
  -- task_subtasks, task_reminder_log (both cascade from tasks) and
  -- department_task_counters (cascades from departments) don't need
  -- their own explicit delete — wiping tasks/departments below already
  -- removes them.
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
  insert into public.departments (name, code, created_by, created_at)
  select d.name, d.code, null, d.created_at
  from jsonb_populate_recordset(null::public.departments, v_payload->'departments') d;

  insert into public.department_task_counters
  select * from jsonb_populate_recordset(null::public.department_task_counters, v_payload->'department_task_counters');

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
  -- task_subtasks must come before task_attachments — an attachment
  -- can reference a subtask via subtask_id.
  insert into public.task_subtasks
  select * from jsonb_populate_recordset(null::public.task_subtasks, v_payload->'task_subtasks');
  insert into public.task_remarks
  select * from jsonb_populate_recordset(null::public.task_remarks, v_payload->'task_remarks');
  insert into public.task_attachments
  select * from jsonb_populate_recordset(null::public.task_attachments, v_payload->'task_attachments');
  insert into public.task_reminder_log
  select * from jsonb_populate_recordset(null::public.task_reminder_log, v_payload->'task_reminder_log');
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

  -- The bulk task re-insert above fires trg_tasks_sync_completed_counter
  -- once per row, adding on top of each user's already-restored (and
  -- already-correct) tasks_completed value — recompute from the actual
  -- restored rows instead of trusting the running total through that
  -- side effect. Same query as migration 30's original backfill.
  update public.users u
    set tasks_completed = (
      select count(*) from public.tasks t
      where t.assignee_id = u.id and t.status = 'completed'
    );

  return jsonb_build_object(
    'safety_backup_id', v_safety_id,
    'users_in_backup', v_users_total,
    'users_restored', v_users_restored,
    'users_skipped', v_users_total - v_users_restored
  );
end;
$$;

grant execute on function public.restore_backup(uuid) to authenticated;
