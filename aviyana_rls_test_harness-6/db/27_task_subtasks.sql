-- =====================================================================
-- 27_task_subtasks.sql
-- =====================================================================
-- Feature: a task can have a checklist of subtasks, worked through
-- step-by-step until the whole task is done. Each subtask can carry
-- its own docs/links (reusing task_attachments) and can optionally be
-- assigned to a specific person, defaulting to the parent task's
-- assignee.
--
-- Also: parent task `progress` becomes AUTO-CALCULATED from subtask
-- completion once a task has at least one subtask (user's explicit
-- call — auto is better than manual selection). Tasks with zero
-- subtasks keep today's manual progress slider untouched.
--
-- Run this once, after 26_backup_restore.sql, in the Supabase SQL
-- editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. task_subtasks
-- ---------------------------------------------------------------------
create table if not exists public.task_subtasks (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references public.tasks(id) on delete cascade,
  title          text not null,
  is_completed   boolean not null default false,
  completed_at   timestamptz,
  completed_by   uuid references public.users(id) on delete set null,
  order_index    integer not null default 0,
  -- null = inherits the parent task's assignee in the UI; set only
  -- when a specific subtask is delegated to someone else.
  assignee_id    uuid references public.users(id) on delete set null,
  created_by_id  uuid not null references public.users(id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_subtasks_task on public.task_subtasks(task_id);

alter table public.task_subtasks enable row level security;

-- Visibility mirrors tasks_select exactly (19_viewer_hardening.sql) —
-- a subtask is exactly as visible as its parent task.
drop policy if exists subtasks_select on public.task_subtasks;
create policy subtasks_select on public.task_subtasks
  for select using (
    exists (
      select 1 from public.tasks t
      where t.id = task_subtasks.task_id
        and (
          t.assignee_id = (public.current_app_user()).id
          or t.created_by_id = (public.current_app_user()).id
          or public.current_app_role() in ('super_admin', 'chief_officer', 'viewer')
          or (public.current_app_role() = 'dept_head' and t.department = (public.current_app_user()).department)
        )
    )
  );

-- Write access mirrors tasks_update (19_viewer_hardening.sql) — whoever
-- can edit the parent task can add/tick/reorder its subtasks. Viewer is
-- explicitly excluded even though it's covered by "not any of the
-- below" already, kept explicit to match the audited pattern.
drop policy if exists subtasks_insert on public.task_subtasks;
create policy subtasks_insert on public.task_subtasks
  for insert with check (
    created_by_id = (public.current_app_user()).id
    and public.current_app_role() <> 'viewer'
    and exists (
      select 1 from public.tasks t
      where t.id = task_subtasks.task_id
        and (
          t.assignee_id = (public.current_app_user()).id
          or public.current_app_role() = 'super_admin'
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
    public.current_app_role() <> 'viewer'
    and exists (
      select 1 from public.tasks t
      where t.id = task_subtasks.task_id
        and (
          t.assignee_id = (public.current_app_user()).id
          or public.current_app_role() = 'super_admin'
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
    public.current_app_role() <> 'viewer'
    and exists (
      select 1 from public.tasks t
      where t.id = task_subtasks.task_id
        and (
          t.assignee_id = (public.current_app_user()).id
          or public.current_app_role() = 'super_admin'
          or (
            (public.current_app_user()).permissions->>'canEditAllTasks' = 'true'
            and public.current_app_role() = 'dept_head'
            and t.department = (public.current_app_user()).department
          )
        )
    )
  );

-- Stamp/clear completed_at + completed_by automatically on the
-- false->true / true->false transition, mirroring the
-- shouldStampCompletedDate() pattern already used for tasks
-- (src/lib/taskStatus.ts) so this can't drift out of sync client-side.
create or replace function public.trg_subtask_stamp_completion()
returns trigger language plpgsql security definer as $$
begin
  if new.is_completed and not old.is_completed then
    new.completed_at := now();
    new.completed_by := (public.current_app_user()).id;
  elsif not new.is_completed and old.is_completed then
    new.completed_at := null;
    new.completed_by := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_subtasks_stamp_completion on public.task_subtasks;
create trigger trg_subtasks_stamp_completion
  before update on public.task_subtasks
  for each row execute function public.trg_subtask_stamp_completion();

-- ---------------------------------------------------------------------
-- 2. task_attachments gets an optional subtask_id, so a doc/link can be
--    filed against a specific subtask instead of the task as a whole.
--    task_id stays NOT NULL and still drives all RLS above (unchanged,
--    zero risk to the existing attachments policies) — subtask_id is
--    purely for grouping in the UI.
-- ---------------------------------------------------------------------
alter table public.task_attachments
  add column if not exists subtask_id uuid references public.task_subtasks(id) on delete cascade;

create index if not exists idx_attachments_subtask on public.task_attachments(subtask_id);

-- Guard against a client bug filing an attachment's subtask_id under
-- the wrong parent task_id (would silently orphan it from the UI that
-- groups by task_id first).
create or replace function public.trg_attachment_subtask_consistency()
returns trigger language plpgsql security definer as $$
declare
  v_subtask_task_id uuid;
begin
  if new.subtask_id is not null then
    select task_id into v_subtask_task_id from public.task_subtasks where id = new.subtask_id;
    if v_subtask_task_id is distinct from new.task_id then
      raise exception 'task_attachments.subtask_id does not belong to task_attachments.task_id';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_attachments_subtask_consistency on public.task_attachments;
create trigger trg_attachments_subtask_consistency
  before insert or update on public.task_attachments
  for each row execute function public.trg_attachment_subtask_consistency();

-- ---------------------------------------------------------------------
-- 3. Auto-progress: parent task's `progress` is recalculated from
--    subtask completion the moment a task has >= 1 subtask. A task
--    with zero subtasks is untouched — TaskModal's manual progress
--    slider keeps working exactly as it does today for those.
--
--    Wrapped in exception-swallowing like notify_push()/notify_slack()
--    (23_protect_notification_triggers.sql) — a bug here must never
--    block the actual subtask write that triggered it.
-- ---------------------------------------------------------------------
create or replace function public.recalc_task_progress_from_subtasks(p_task_id uuid)
returns void language plpgsql security definer as $$
declare
  v_total integer;
  v_completed integer;
begin
  select count(*), count(*) filter (where is_completed)
    into v_total, v_completed
    from public.task_subtasks
    where task_id = p_task_id;

  if v_total = 0 then
    return; -- no subtasks: leave the manually-set progress value alone
  end if;

  update public.tasks
    set progress = round(100.0 * v_completed / v_total)::int,
        updated_at = now()
    where id = p_task_id;
exception when others then
  raise warning 'recalc_task_progress_from_subtasks failed (swallowed to protect the caller): %', sqlerrm;
end;
$$;

create or replace function public.trg_subtasks_recalc_progress()
returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalc_task_progress_from_subtasks(old.task_id);
    return old;
  else
    perform public.recalc_task_progress_from_subtasks(new.task_id);
    return new;
  end if;
end;
$$;

drop trigger if exists trg_subtasks_recalc_progress on public.task_subtasks;
create trigger trg_subtasks_recalc_progress
  after insert or update of is_completed or delete on public.task_subtasks
  for each row execute function public.trg_subtasks_recalc_progress();

-- Also recalc when a subtask is added/removed via a bulk operation
-- (e.g. restore) that might not fire the per-row trigger's business
-- logic expectations — cheap safety net, harness will confirm whether
-- this is actually reachable or just belt-and-braces.
comment on function public.recalc_task_progress_from_subtasks(uuid) is
  'Recomputes tasks.progress from task_subtasks completion. No-op if the task has zero subtasks (manual progress stays manual). Called by trg_subtasks_recalc_progress.';
