-- =====================================================================
-- FULL_DATA_CLEAR.sql
-- =====================================================================
-- ⚠️ DESTRUCTIVE — this permanently deletes almost all data.
--
-- Kept:
--   - public.departments        (org structure, not "data")
--   - public.slack_config       (Slack webhook settings)
--   - the user ishan@aviyana.lk (auth.users + public.users row)
--
-- Deleted (cannot be undone — no backup, no soft-delete):
--   - all tasks, task_remarks, task_attachments
--   - all chat conversations, conversation_members, messages
--   - all notifications
--   - all audit_logs (append-only table — this is the one case where
--     that "immutable" guarantee is intentionally bypassed, via
--     TRUNCATE, since it doesn't fire the row-level triggers that
--     normally block DELETE/UPDATE on this table)
--   - slack_notification_log (delivery history only — slack_config
--     itself, the actual webhook/channel settings, is left untouched)
--   - chief_officer_department_access overrides
--   - every user account except ishan@aviyana.lk (auth + profile row)
--
-- Not touched: storage.objects (uploaded avatar/attachment files in
-- the `avatars` / `task-attachments` buckets stay in storage, just
-- unreferenced — harmless, but you can clear those buckets separately
-- from the Storage tab if you want a fully clean slate).
--
-- Run this ONLY when you're sure. There is no confirmation prompt.
-- =====================================================================

begin;

-- Audit logs — TRUNCATE bypasses the append-only trigger (it only
-- fires on row-level DELETE/UPDATE, not on TRUNCATE).
truncate public.audit_logs;

-- Chat — deleting conversations cascades to conversation_members and
-- messages automatically (both have ON DELETE CASCADE on conversation_id).
delete from public.conversations;

-- Task-related child tables (must go before tasks/users, due to
-- ON DELETE RESTRICT on their author/uploader columns).
delete from public.task_attachments;
delete from public.task_remarks;
delete from public.notifications;

-- Tasks themselves.
delete from public.tasks;

-- Chief officer per-department access overrides.
delete from public.chief_officer_department_access;

-- Slack delivery history only — slack_config (webhook URL, channel,
-- notification toggles) is left completely untouched.
delete from public.slack_notification_log;

-- Every account except ishan@aviyana.lk. Deleting from auth.users
-- cascades to the matching public.users row (auth_user_id has
-- ON DELETE CASCADE). The second delete catches any public.users rows
-- with no auth account yet (pending invites that were never accepted).
delete from auth.users where lower(email) <> 'ishan@aviyana.lk';
delete from public.users where lower(email) <> 'ishan@aviyana.lk';

commit;

-- ---------------------------------------------------------------------
-- Verify — every count below should be 0 except users (1) and
-- departments/slack_config (unchanged from before).
-- ---------------------------------------------------------------------
select 'tasks' as table_name, count(*) from public.tasks
union all select 'task_remarks', count(*) from public.task_remarks
union all select 'task_attachments', count(*) from public.task_attachments
union all select 'conversations', count(*) from public.conversations
union all select 'messages', count(*) from public.messages
union all select 'notifications', count(*) from public.notifications
union all select 'audit_logs', count(*) from public.audit_logs
union all select 'slack_notification_log', count(*) from public.slack_notification_log
union all select 'chief_officer_department_access', count(*) from public.chief_officer_department_access
union all select 'users (should be 1)', count(*) from public.users
union all select 'departments (unchanged)', count(*) from public.departments
union all select 'slack_config (unchanged)', count(*) from public.slack_config;
