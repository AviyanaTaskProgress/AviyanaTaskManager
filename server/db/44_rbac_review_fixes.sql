-- =====================================================================
-- 44_rbac_review_fixes.sql
-- =====================================================================
-- Full RBAC review (#8) — walked every RLS policy in the project
-- against the confirmed 6-role capability matrix (Chairman | Super
-- Admin | CEO | CO | Dept Head | Staff). Found real gaps, independent
-- of anything asked for directly — some pre-existing (nothing to do
-- with CEO/Chairman), some introduced by not fully propagating the
-- new roles to every table that needed it. All fixed here.
--
--   FINDING 1 (pre-existing, most important) — task_remarks.remarks_select
--   had NO role check at all: `exists (select 1 from tasks where id =
--   task_id)`. Since Postgres RLS applies transitively to that
--   subquery, this meant "anyone who can see the task row can read
--   EVERY remark on it" — and tasks_select has always included
--   'viewer', so a Viewer could already read every remark (approval
--   notes, internal comments) on every task via a direct Supabase
--   query, despite the UI never showing this. Adding 'chairman' to
--   tasks_select for the status rollup (42_ceo_and_chairman_roles.sql)
--   would have silently extended the SAME leak to Chairman — directly
--   contradicting "task status only". Tightened to an explicit role
--   list that excludes both viewer and chairman.
--
--   FINDING 2 (pre-existing) — task_subtasks insert/update/delete
--   (27_task_subtasks.sql) never included 'chief_officer' at all, even
--   after 40_chief_officer_task_edit.sql gave Chief Officer
--   unconditional task-edit rights. A Chief Officer editing someone
--   else's task could change its title/status/etc. but not add, tick,
--   or delete a checklist item on it. Fixed to match tasks_update's
--   tier.
--
--   FINDING 3 (new-role follow-through) — task_attachments
--   select/insert, and task_subtasks select/insert/update/delete, were
--   never extended to 'ceo' when 42_ceo_and_chairman_roles.sql added
--   the role — same tier as super_admin/chief_officer everywhere else.
--   task_attachments delete also needed 'ceo' to match the client-side
--   button already shown for it.
--
--   FINDING 4 (most severe — new-role follow-through incomplete) —
--   42_ceo_and_chairman_roles.sql only fixed the RLS policies on the
--   `backups`/`backup_settings` TABLES. create_backup()/restore_backup()
--   themselves (26_backup_restore.sql) have their OWN separate inline
--   check — `if current_app_role() <> 'super_admin' then raise
--   exception` — completely independent of table RLS. Since these are
--   SECURITY DEFINER RPCs, that inline check IS the real gate; the
--   table policy only controls direct reads/writes to the backups
--   list, not whether the RPC itself can be invoked. Net effect: CEO
--   could see the Backup/Restore screen and the backups list, but
--   every actual create/restore call would fail with "Only Super Admin
--   can create a backup" — the opposite of what was confirmed. Fixed
--   below.
--
-- Run this once, after 43_ceo_ring_alarm.sql, in the Supabase SQL
-- editor. No enum values are touched, so this is a normal single-paste
-- migration.
-- =====================================================================

-- FINDING 1 — task_remarks: real visibility check, viewer/chairman excluded.
drop policy if exists remarks_select on public.task_remarks;
create policy remarks_select on public.task_remarks
  for select using (
    exists (
      select 1 from public.tasks t
      where t.id = task_remarks.task_id
        and (
          t.assignee_id = (public.current_app_user()).id
          or t.created_by_id = (public.current_app_user()).id
          or public.current_app_role() in ('super_admin', 'ceo', 'chief_officer')
          or (public.current_app_role() = 'dept_head' and t.department = (public.current_app_user()).department)
        )
    )
  );

-- FINDING 3 — task_attachments: add ceo to select/insert/delete.
drop policy if exists attachments_select on public.task_attachments;
create policy attachments_select on public.task_attachments
  for select using (
    exists (
      select 1 from public.tasks t
      where t.id = task_attachments.task_id
        and (
          t.assignee_id = (public.current_app_user()).id
          or t.created_by_id = (public.current_app_user()).id
          or public.current_app_role() in ('super_admin', 'ceo', 'chief_officer', 'viewer')
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
          or public.current_app_role() in ('super_admin', 'ceo', 'chief_officer')
          or (public.current_app_role() = 'dept_head' and t.department = (public.current_app_user()).department)
        )
    )
  );

drop policy if exists attachments_delete on public.task_attachments;
create policy attachments_delete on public.task_attachments
  for delete using (
    uploaded_by = (public.current_app_user()).id
    or public.current_app_role() in ('super_admin', 'ceo')
  );

-- FINDING 2 + 3 — task_subtasks: add chief_officer (pre-existing gap)
-- and ceo (new-role follow-through) to select/insert/update/delete.
drop policy if exists subtasks_select on public.task_subtasks;
create policy subtasks_select on public.task_subtasks
  for select using (
    exists (
      select 1 from public.tasks t
      where t.id = task_subtasks.task_id
        and (
          t.assignee_id = (public.current_app_user()).id
          or t.created_by_id = (public.current_app_user()).id
          or public.current_app_role() in ('super_admin', 'ceo', 'chief_officer', 'viewer')
          or (public.current_app_role() = 'dept_head' and t.department = (public.current_app_user()).department)
        )
    )
  );

drop policy if exists subtasks_insert on public.task_subtasks;
create policy subtasks_insert on public.task_subtasks
  for insert with check (
    created_by_id = (public.current_app_user()).id
    and public.current_app_role() not in ('viewer', 'chairman')
    and exists (
      select 1 from public.tasks t
      where t.id = task_subtasks.task_id
        and (
          t.assignee_id = (public.current_app_user()).id
          or public.current_app_role() in ('super_admin', 'ceo', 'chief_officer')
          or (
            (public.current_app_user()).permissions->>'canEditAllTasks' = 'true'
            and public.current_app_role() = 'dept_head'
            and t.department = (public.current_app_user()).department
          )
        )
    )
  );

drop policy if exists subtasks_update on public.task_subtasks;
create policy subtasks_update on public.task_subtasks
  for update using (
    public.current_app_role() not in ('viewer', 'chairman')
    and exists (
      select 1 from public.tasks t
      where t.id = task_subtasks.task_id
        and (
          t.assignee_id = (public.current_app_user()).id
          or public.current_app_role() in ('super_admin', 'ceo', 'chief_officer')
          or (
            (public.current_app_user()).permissions->>'canEditAllTasks' = 'true'
            and public.current_app_role() = 'dept_head'
            and t.department = (public.current_app_user()).department
          )
        )
    )
  );

drop policy if exists subtasks_delete on public.task_subtasks;
create policy subtasks_delete on public.task_subtasks
  for delete using (
    public.current_app_role() not in ('viewer', 'chairman')
    and exists (
      select 1 from public.tasks t
      where t.id = task_subtasks.task_id
        and (
          t.assignee_id = (public.current_app_user()).id
          or public.current_app_role() in ('super_admin', 'ceo', 'chief_officer')
          or (
            (public.current_app_user()).permissions->>'canEditAllTasks' = 'true'
            and public.current_app_role() = 'dept_head'
            and t.department = (public.current_app_user()).department
          )
        )
    )
  );

-- FINDING 4 — create_backup()/restore_backup(): add ceo to the inline
-- role check. Bodies otherwise byte-for-byte identical to
-- 26_backup_restore.sql.
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
  if public.current_app_role() not in ('super_admin', 'ceo') then
    raise exception 'Only Super Admin or CEO can create a backup';
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
  if public.current_app_role() not in ('super_admin', 'ceo') then
    raise exception 'Only Super Admin or CEO can restore a backup';
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
