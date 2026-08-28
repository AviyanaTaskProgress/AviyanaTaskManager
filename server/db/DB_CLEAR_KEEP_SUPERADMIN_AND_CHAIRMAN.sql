-- =====================================================================
-- DB_CLEAR_KEEP_SUPERADMIN_AND_CHAIRMAN.sql
-- =====================================================================
-- ⚠️ DESTRUCTIVE — this permanently deletes almost all data. No backup,
-- no undo. Read the whole file before running it.
--
-- Same shape as FULL_DATA_CLEAR.sql, but keeps EVERY account with
-- role = 'super_admin', PLUS the Chairman's account by email (there is
-- no separate "chairman" role in the system — chairmen@aviyana.lk
-- currently holds the 'viewer' role, so it's matched explicitly below).
--
-- >>> If the Chairman's email is different from chairmen@aviyana.lk,
-- >>> change it on the line marked CHANGE THIS EMAIL before running.
--
-- Kept:
--   - public.departments        (org structure, not "data")
--   - public.slack_config       (Slack webhook settings)
--   - every user with role = 'super_admin'
--   - the Chairman's account (chairmen@aviyana.lk — change if needed)
--
-- Deleted (cannot be undone):
--   - all tasks, task_remarks, task_attachments
--   - all chat conversations, conversation_members, messages
--   - all notifications
--   - all audit_logs (TRUNCATE bypasses the append-only trigger, which
--     only fires on row-level DELETE/UPDATE, not on TRUNCATE)
--   - slack_notification_log (delivery history only — slack_config
--     itself, the actual webhook/channel settings, is left untouched)
--   - chief_officer_department_access overrides
--   - every user account NOT super_admin and NOT the Chairman
--
-- Not touched: storage.objects (uploaded avatar/attachment files stay
-- in storage, just unreferenced — clear those separately from the
-- Storage tab if you want a fully clean slate).
--
-- Run this ONLY when you're sure. There is no confirmation prompt.
-- =====================================================================

begin;

-- Audit logs — TRUNCATE bypasses the append-only trigger.
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

-- Every account except super_admins and the Chairman. Deleting from
-- auth.users cascades to the matching public.users row (auth_user_id
-- has ON DELETE CASCADE). The second delete catches any public.users
-- rows with no auth account yet (pending invites never accepted).
delete from auth.users
where id not in (
  select auth_user_id from public.users
  where role = 'super_admin' or lower(email) = 'chairmen@aviyana.lk' -- CHANGE THIS EMAIL if needed
);

delete from public.users
where role <> 'super_admin' and lower(email) <> 'chairmen@aviyana.lk'; -- CHANGE THIS EMAIL if needed

commit;

-- ---------------------------------------------------------------------
-- Verify — every count below should be 0, except "users kept" (should
-- list only super_admin + Chairman rows) and departments/slack_config
-- (unchanged from before).
-- ---------------------------------------------------------------------
select 'tasks' as table_name, count(*)::text as count from public.tasks
union all select 'task_remarks', count(*)::text from public.task_remarks
union all select 'task_attachments', count(*)::text from public.task_attachments
union all select 'conversations', count(*)::text from public.conversations
union all select 'messages', count(*)::text from public.messages
union all select 'notifications', count(*)::text from public.notifications
union all select 'audit_logs', count(*)::text from public.audit_logs
union all select 'slack_notification_log', count(*)::text from public.slack_notification_log
union all select 'chief_officer_department_access', count(*)::text from public.chief_officer_department_access
union all select 'departments (unchanged)', count(*)::text from public.departments
union all select 'slack_config (unchanged)', count(*)::text from public.slack_config;

-- Shows exactly who was kept — check this list looks right.
select email, role, department from public.users order by role, email;
