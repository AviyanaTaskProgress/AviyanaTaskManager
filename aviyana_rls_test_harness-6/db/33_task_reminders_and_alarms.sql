-- =====================================================================
-- 33_task_reminders_and_alarms.sql
-- =====================================================================
-- Two related features, both reusing the existing `notifications` table
-- (already realtime-enabled — see 09_enable_realtime.sql — so the
-- frontend's existing subscription picks these up automatically, no
-- new channel needed):
--
--   A. Automatic deadline reminders — 3 days before due, and again 1
--      day before due, for the ASSIGNEE specifically (not whoever
--      happens to have the app open — see note below on why this
--      matters). Runs server-side on a daily pg_cron schedule so it
--      works even if nobody is logged in when it fires.
--
--   B. Manual "Ring Alarm" — Super Admin / Chief Officer / Dept Head
--      (own department only) can force an urgent, hard-to-miss ping to
--      a task's assignee. Frontend turns an unread notifications row
--      with type='alarm' into a persistent, ringing banner that only
--      clears when the assignee opens that specific task (see
--      TaskModal.tsx) — there is deliberately no snooze.
--
-- IMPORTANT PRE-EXISTING BUG THIS SESSION FOUND (not introduced by
-- this migration, but why part A exists): src/context/AppContext.tsx's
-- checkOverdueDeadlines() creates notifications via
-- `user_id: (await db.me()).id` — i.e. for WHOEVER'S BROWSER is
-- currently polling, not the task's actual assignee. A Dept Head with
-- the app open would get "Task Overdue" notifications addressed to
-- themselves for tasks assigned to their Staff, and a Staff member who
-- never opens the app gets no reminder at all. This migration's
-- send_deadline_reminders() is server-side and always targets the real
-- assignee, so it doesn't have this problem — see the companion
-- frontend change note for the client-side scope-down of the old
-- function.
--
-- Run this once, after 32_chief_officer_cross_dept_tasks.sql, in the
-- Supabase SQL editor.
-- =====================================================================

alter type notification_type add value if not exists 'alarm';

-- ---------------------------------------------------------------------
-- A. Automatic deadline reminders
-- ---------------------------------------------------------------------

-- Dedup ledger — guarantees each task gets AT MOST one '3_day' and one
-- '1_day' reminder ever, no matter how many times the cron job runs
-- (daily is the plan, but this makes re-running it manually, or
-- changing the schedule later, safe too).
create table if not exists public.task_reminder_log (
  task_id        uuid not null references public.tasks(id) on delete cascade,
  reminder_type  text not null check (reminder_type in ('3_day', '1_day')),
  sent_at        timestamptz not null default now(),
  primary key (task_id, reminder_type)
);

alter table public.task_reminder_log enable row level security;
-- No client-facing policy — RLS enabled with zero policies denies
-- direct client access entirely; only the SECURITY DEFINER function
-- below (running as the table owner) ever touches this table.

create or replace function public.send_deadline_reminders()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_days int;
  v_type text;
  v_just_logged boolean;
begin
  for r in
    select id, title, due_date, assignee_id
    from public.tasks
    where status not in ('completed')
      and (due_date - current_date) in (3, 1)
  loop
    begin
      v_days := r.due_date - current_date;
      v_type := case when v_days = 3 then '3_day' else '1_day' end;

      with ins as (
        insert into public.task_reminder_log (task_id, reminder_type)
        values (r.id, v_type)
        on conflict (task_id, reminder_type) do nothing
        returning task_id
      )
      select exists(select 1 from ins) into v_just_logged;

      -- Already sent this reminder for this task before (e.g. cron ran
      -- twice today, or the due date hasn't changed since yesterday's
      -- run somehow) — skip silently, this is the normal/expected path
      -- most days for most tasks.
      if not v_just_logged then
        continue;
      end if;

      insert into public.notifications (user_id, type, title, message, task_id, urgency)
      values (
        r.assignee_id,
        'deadline',
        case when v_days = 3 then 'Deadline in 3 days' else 'Deadline tomorrow' end,
        format('"%s" is due on %s.', r.title, r.due_date),
        r.id,
        (case when v_days = 1 then 'high' else 'medium' end)::notification_urgency
      );

      perform public.notify_push(
        array[r.assignee_id],
        case when v_days = 3 then 'Deadline in 3 days' else 'Deadline tomorrow' end,
        r.title,
        '/'
      );
    exception when others then
      -- One bad row (e.g. a deleted assignee) must never take down the
      -- rest of the day's reminder run — same defensive pattern as
      -- notify_push()/notify_slack() (23_protect_notification_triggers.sql).
      raise warning 'send_deadline_reminders: failed for task % (swallowed): %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;

-- Schedule it daily at 08:00 server time. pg_cron is a real Supabase
-- Cloud extension (not available in a plain local Postgres, hence the
-- IF NOT EXISTS + the harness using a stub — see harness README).
-- Unschedule-then-reschedule makes this migration safe to re-run.
do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise warning 'pg_cron extension unavailable in this environment — automatic reminders will not fire until it is enabled (Supabase Cloud: Database > Extensions).';
end $$;

do $$
begin
  perform cron.unschedule('send-deadline-reminders');
exception when others then
  null; -- job didn't exist yet, or pg_cron isn't available — fine either way
end $$;

do $$
begin
  perform cron.schedule('send-deadline-reminders', '0 8 * * *', $cron$select public.send_deadline_reminders();$cron$);
exception when others then
  raise warning 'Could not schedule send-deadline-reminders — pg_cron may not be enabled in this project yet.';
end $$;

-- ---------------------------------------------------------------------
-- B. Manual "Ring Alarm"
-- ---------------------------------------------------------------------

create or replace function public.ring_task_alarm(p_task_id uuid)
returns public.notifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_actor_role user_role;
  v_actor_dept text;
  v_task record;
  v_last_rung timestamptz;
  v_row public.notifications;
begin
  select id, role, department into v_actor_id, v_actor_role, v_actor_dept
    from public.users where auth_user_id = auth.uid();

  if v_actor_role not in ('super_admin', 'chief_officer', 'dept_head') then
    raise exception 'Not allowed: only Super Admin, Chief Officer, or Dept Head can ring a task alarm';
  end if;

  select id, title, department, assignee_id into v_task
    from public.tasks where id = p_task_id;

  if v_task.id is null then
    raise exception 'Task not found';
  end if;

  if v_actor_role = 'dept_head' and v_task.department is distinct from v_actor_dept then
    raise exception 'Not allowed: this task is outside your department';
  end if;

  -- Cooldown: at most one ring per task every 15 minutes, so the
  -- button can't be used to spam the same person.
  select max(created_at) into v_last_rung
    from public.notifications
    where task_id = p_task_id and type = 'alarm';

  if v_last_rung is not null and v_last_rung > now() - interval '15 minutes' then
    raise exception 'This task was already rung recently — please wait a few minutes before ringing it again';
  end if;

  insert into public.notifications (user_id, type, title, message, task_id, urgency)
  values (
    v_task.assignee_id,
    'alarm',
    'Urgent: action needed',
    format('%s asked you to check "%s" right away.', (select name from public.users where id = v_actor_id), v_task.title),
    p_task_id,
    'critical'
  )
  returning * into v_row;

  perform public.notify_push(
    array[v_task.assignee_id],
    'Urgent: action needed',
    v_task.title,
    '/'
  );

  perform public.log_audit_event('task.alarm_rung', 'task', p_task_id::text, '', 'warning');

  return v_row;
end;
$$;

grant execute on function public.ring_task_alarm(uuid) to authenticated;
