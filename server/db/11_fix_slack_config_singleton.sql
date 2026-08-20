-- =====================================================================
-- 11_fix_slack_config_singleton.sql
-- =====================================================================
-- Bug: `department` has a plain `UNIQUE` constraint, and the app was
-- upserting with `ON CONFLICT (department)` while always writing
-- department = NULL for the one global Slack config. In standard SQL,
-- NULL is never equal to another NULL for uniqueness purposes — so
-- ON CONFLICT never matched, and every "Save Slack Configuration" click
-- silently INSERTed a new duplicate row instead of updating the
-- existing one.
--
-- Once there were 2+ rows with department IS NULL, getSlackConfig()'s
-- `.maybeSingle()` started throwing a "multiple rows returned" error,
-- which the app quietly caught and treated as "no config" — hence the
-- webhook looking configured right after saving, then "missing" again
-- on the next reload.
--
-- Fix (two parts):
--   1. Delete the duplicate rows here, keeping only the most recently
--      updated one.
--   2. Add a real partial unique index that correctly enforces "at most
--      one row with department IS NULL" (a plain UNIQUE column can't do
--      this — NULLs are never 'equal' — so this indexes a constant
--      expression instead, which Postgres *does* enforce uniqueness on).
--
-- The corresponding app-side fix (05_fix_slack_config_write.md, applied
-- directly to src/lib/db.ts) stops relying on ON CONFLICT for this
-- table entirely and does an explicit select-then-update-or-insert.
--
-- Run this once, after 10_fix_slack_log_status_cast.sql, in the
-- Supabase SQL editor.
-- =====================================================================

delete from public.slack_config
where department is null
  and id not in (
    select id from public.slack_config
    where department is null
    order by updated_at desc
    limit 1
  );

create unique index if not exists slack_config_global_singleton
  on public.slack_config ((true))
  where department is null;
