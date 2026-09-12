-- =====================================================================
-- 21_audit_followups.sql
-- =====================================================================
-- Closes three items left open in AVIYANA_FULL_SYSTEM_AUDIT.md:
--
--   1. Department name uniqueness was only checked case-insensitively
--      in the client (TeamManagementView.tsx's addDepartment), while
--      `departments.name` is a plain `text primary key` — case-
--      sensitive at the database level. Two Super Admins racing to add
--      "Engineering" / "ENGINEERING" could both succeed. Fixed with a
--      unique index on lower(name), which is race-safe at the DB level
--      (the client-side check stays too, for a fast/friendly error
--      instead of waiting on a DB round-trip to find out).
--
--   2. task_remarks' insert policy checked *who* was posting (must be
--      posting as themselves) but never checked they could actually
--      *see* the task they were commenting on, unlike remarks_select
--      (which already inherits task visibility correctly, because its
--      `exists (select 1 from tasks ...)` subquery is itself subject to
--      RLS on `tasks` for the querying user). Fixed by adding the same
--      exists() check to remarks_insert.
--
--   3. Tasks that were marked "completed" via the Edit Task modal
--      before TaskModal.tsx's completedDate fix have `completed_date`
--      null in the database. This one-time backfill sets it to
--      `updated_at::date` (best available proxy for "when it was last
--      touched", i.e. when it was marked complete) for any row that's
--      `status = 'completed'` and `completed_date is null`. Safe to
--      run multiple times — it only ever fills nulls, never overwrites
--      a real completed_date.
--
-- Run this once, after 20_push_notifications.sql, in the Supabase SQL
-- editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Case-insensitive department uniqueness, enforced at the DB level.
-- ---------------------------------------------------------------------
create unique index if not exists departments_name_lower_unique
  on public.departments (lower(name));

-- ---------------------------------------------------------------------
-- 2. task_remarks insert must respect the same visibility as select.
-- ---------------------------------------------------------------------
drop policy if exists remarks_insert on public.task_remarks;
create policy remarks_insert on public.task_remarks
  for insert
  with check (
    author_id = (public.current_app_user()).id
    and exists (select 1 from public.tasks t where t.id = task_id)
  );

-- ---------------------------------------------------------------------
-- 3. One-time backfill for tasks completed before the modal fix.
-- ---------------------------------------------------------------------
update public.tasks
set completed_date = updated_at::date
where status = 'completed'
  and completed_date is null;
