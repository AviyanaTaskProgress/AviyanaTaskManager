-- =====================================================================
-- 35_missing_indexes.sql
-- =====================================================================
-- Backend engineering review (2026-09) found tasks.created_by_id and
-- tasks.assigned_by_id had no index, unlike assignee_id/department/
-- status/due_date (schema.sql). Both are queried directly in RLS
-- (tasks_select checks created_by_id = self) and will matter more as
-- task volume grows — cheap to add now before it's a real slow-query
-- investigation later.
--
-- Run this once, after 34_audit_fixes_delete_policy_and_search_path.sql,
-- in the Supabase SQL editor.
-- =====================================================================

create index if not exists idx_tasks_created_by on public.tasks(created_by_id);
create index if not exists idx_tasks_assigned_by on public.tasks(assigned_by_id);

-- Also helps: notifications lookups are always filtered by user_id
-- (every db.ts call does `.eq('user_id', ...)`) — already covered by
-- schema.sql's idx_notifications_user(user_id, read), no gap there,
-- confirmed while auditing this.
