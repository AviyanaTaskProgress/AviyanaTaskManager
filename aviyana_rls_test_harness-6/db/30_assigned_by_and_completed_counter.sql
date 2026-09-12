-- =====================================================================
-- 30_assigned_by_and_completed_counter.sql
-- =====================================================================
-- Two independent, small fixes bundled together:
--
--   A. tasks.assigned_by_id — for the "I'm logging this task for
--      myself, but someone else actually instructed it" case (e.g. a
--      Dept Head verbally told a Staff member to do something, and the
--      Staff member is entering it themselves). Purely informational —
--      distinct from created_by_id (who clicked Save) and assignee_id
--      (who's doing the work). Only meaningful/shown in the UI when
--      assignee_id = created_by_id (self-logged task).
--
--   B. users.tasks_completed was never actually wired to anything —
--      grep confirms no trigger/RPC touches it anywhere in this repo,
--      so it's been silently stuck wherever it started (mostly 0)
--      regardless of real approvals. This adds a trigger that keeps it
--      in sync with tasks.status going forward, covering every path
--      that can flip a task to/from 'completed' (TaskModal manual
--      edit, TasksView drag-to-Completed, decide_task_approval(),
--      confirm_task_payment(), and reassignment of an
--      already-completed task) — plus a one-time backfill to correct
--      today's drifted values before the trigger takes over.
--
-- Run this once, after 29_task_payment_workflow.sql, in the Supabase
-- SQL editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. assigned_by_id
-- ---------------------------------------------------------------------
alter table public.tasks
  add column if not exists assigned_by_id uuid references public.users(id) on delete set null;

-- No RLS changes needed — this is a plain column covered by the
-- existing tasks_insert/tasks_update policies, same as title/priority/
-- everything else.

-- ---------------------------------------------------------------------
-- B. tasks_completed — one-time backfill first, so the counter is
--    accurate before the trigger starts maintaining it incrementally.
-- ---------------------------------------------------------------------
update public.users u
  set tasks_completed = (
    select count(*) from public.tasks t
    where t.assignee_id = u.id and t.status = 'completed'
  );

create or replace function public.trg_tasks_sync_completed_counter()
returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'completed' then
      update public.users set tasks_completed = tasks_completed + 1 where id = new.assignee_id;
    end if;
    return new;
  end if;

  -- Reassigning an already-completed task moves the credit rather than
  -- double-counting or losing it.
  if new.status = 'completed' and old.status = 'completed' and new.assignee_id is distinct from old.assignee_id then
    update public.users set tasks_completed = greatest(tasks_completed - 1, 0) where id = old.assignee_id;
    update public.users set tasks_completed = tasks_completed + 1 where id = new.assignee_id;
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'completed' and old.status <> 'completed' then
      update public.users set tasks_completed = tasks_completed + 1 where id = new.assignee_id;
    elsif old.status = 'completed' and new.status <> 'completed' then
      update public.users set tasks_completed = greatest(tasks_completed - 1, 0) where id = old.assignee_id;
    end if;
  end if;

  return new;
exception when others then
  -- Same defensive pattern as notify_push()/notify_slack()
  -- (23_protect_notification_triggers.sql): a bug in this side-effect
  -- must never block the real task write that triggered it.
  raise warning 'trg_tasks_sync_completed_counter failed (swallowed to protect the caller): %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_tasks_sync_completed_counter on public.tasks;
create trigger trg_tasks_sync_completed_counter
  after insert or update of status, assignee_id on public.tasks
  for each row execute function public.trg_tasks_sync_completed_counter();
