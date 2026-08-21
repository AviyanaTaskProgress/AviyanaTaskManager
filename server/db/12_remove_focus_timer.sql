-- =====================================================================
-- 12_remove_focus_timer.sql
-- =====================================================================
-- The "Focus Timer" feature has been removed from the app entirely —
-- a timer that can just be left running while doing no work measured
-- nothing real. The workflow is now simply: assign a task, the assignee
-- updates progress %, adds remarks, and submits for approval.
--
-- This drops the time_sessions table (nothing in the frontend reads or
-- writes it anymore) and the increment_task_logged_hours() RPC (whose
-- only caller was the timer's "save session" step).
--
-- This is destructive — it deletes any historical timer session rows.
-- If you want to keep that history for reference, export
-- `select * from public.time_sessions` first.
--
-- Run this once, after 11_fix_slack_config_singleton.sql, in the
-- Supabase SQL editor.
-- =====================================================================

drop function if exists public.increment_task_logged_hours(uuid, numeric);
drop table if exists public.time_sessions;
