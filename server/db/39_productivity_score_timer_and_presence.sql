-- =====================================================================
-- 39_productivity_score_timer_and_presence.sql
-- =====================================================================
-- Three related features, all three previously dead columns on
-- `users` (productivity_score, hours_logged_this_month, status) that
-- had defaults from schema.sql but nothing anywhere in 38 prior
-- migrations ever wrote to them:
--
--   A. Productivity Score — a blend of on-time completion rate,
--      overall completion rate, and completed-volume this month.
--      Recomputed by a trigger on `tasks` every time a task's status
--      changes for a user (assignee gains/loses/completes a task).
--
--   B. Hours Logged — re-adds a start/stop task timer. NOTE: this
--      exact feature (`time_sessions` table, `increment_task_logged_
--      hours()`) was deliberately REMOVED in
--      12_remove_focus_timer.sql, with the stated reason "a timer
--      that can just be left running while doing no work measured
--      nothing real." This migration brings it back because it was
--      explicitly requested again, but adds guardrails that didn't
--      exist the first time: only one open session per user at once
--      (starting a new one auto-closes any stale one first), every
--      session is hard-capped at 12 hours when closed (manual or via
--      the daily sweep below), so a forgotten-open timer can't inflate
--      logged hours indefinitely. If gaming is still a concern in
--      practice, pairing this with a mandatory end-of-session note or
--      periodic activity ping is a reasonable follow-up — not done
--      here since it wasn't asked for.
--
--   C. Online/Away/Offline status — fully automatic, driven by a
--      client heartbeat (updates last_seen_at while the tab is open
--      and visible) plus a cron sweep that demotes stale users to
--      'away' then 'offline'. Logging out immediately sets 'offline'
--      rather than waiting for the timeout. This only ever drives the
--      'active'/'away'/'offline' states — if a future feature sets
--      'in_meeting'/'focus_mode' manually, this migration's cron sweep
--      leaves those alone.
--
-- Run this once, after 38_subtask_partial_payments.sql, in the
-- Supabase SQL editor. Everything below is idempotent / safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Schema additions
-- ---------------------------------------------------------------------

alter table public.users
  add column if not exists last_seen_at timestamptz;

create table if not exists public.time_sessions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  task_id           uuid not null references public.tasks(id) on delete cascade,
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  duration_minutes  numeric(7,2),
  created_at        timestamptz not null default now(),
  -- at most one OPEN session per user at a time, enforced below in
  -- start_task_timer() (partial unique index does the same thing more
  -- cheaply at the DB level as a belt-and-braces guard)
  constraint time_sessions_duration_nonneg check (duration_minutes is null or duration_minutes >= 0)
);

create unique index if not exists time_sessions_one_open_per_user
  on public.time_sessions (user_id)
  where ended_at is null;

create index if not exists idx_time_sessions_task on public.time_sessions(task_id);
create index if not exists idx_time_sessions_user_started on public.time_sessions(user_id, started_at);

alter table public.time_sessions enable row level security;

drop policy if exists time_sessions_select_own on public.time_sessions;
create policy time_sessions_select_own on public.time_sessions
  for select using (
    user_id = (public.current_app_user()).id
    or public.current_app_role() in ('super_admin', 'chief_officer')
    or (
      public.current_app_role() = 'dept_head'
      and exists (
        select 1 from public.tasks t
        where t.id = time_sessions.task_id
          and t.department = (public.current_app_user()).department
      )
    )
  );
-- No client-facing insert/update policy — sessions are only ever
-- written through the SECURITY DEFINER RPCs below, same pattern as
-- task_reminder_log in 33_task_reminders_and_alarms.sql.

-- ---------------------------------------------------------------------
-- A. Productivity score
-- ---------------------------------------------------------------------
-- Blend: 50% on-time completion rate + 30% overall completion rate +
-- 20% volume (completed tasks this calendar month, capped at 5 =
-- 100 — tune the cap in one place if 5/month turns out to be the
-- wrong bar for your teams).
create or replace function public.recompute_productivity_score(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_assigned         integer;
  v_completed        integer;
  v_completed_ontime integer;
  v_completed_month  integer;
  v_ontime_rate      numeric;
  v_completion_rate  numeric;
  v_volume_score     numeric;
  v_score            numeric;
begin
  select count(*) into v_assigned
    from public.tasks where assignee_id = p_user_id;

  select count(*) into v_completed
    from public.tasks where assignee_id = p_user_id and status = 'completed';

  select count(*) into v_completed_ontime
    from public.tasks
    where assignee_id = p_user_id and status = 'completed'
      and completed_date is not null and completed_date <= due_date;

  select count(*) into v_completed_month
    from public.tasks
    where assignee_id = p_user_id and status = 'completed'
      and completed_date is not null
      and date_trunc('month', completed_date) = date_trunc('month', current_date);

  v_ontime_rate     := case when v_completed = 0 then 0 else 100.0 * v_completed_ontime / v_completed end;
  v_completion_rate := case when v_assigned = 0 then 0 else 100.0 * v_completed / v_assigned end;
  v_volume_score    := least(100, v_completed_month * 20.0);

  v_score := round(0.5 * v_ontime_rate + 0.3 * v_completion_rate + 0.2 * v_volume_score);

  update public.users
    set productivity_score = greatest(0, least(100, v_score))
    where id = p_user_id;
exception when others then
  -- Never let a bad row (e.g. a user deleted mid-calc) break the
  -- caller's transaction — same defensive pattern used elsewhere for
  -- background recompute functions.
  raise warning 'recompute_productivity_score failed for user %: %', p_user_id, sqlerrm;
end;
$$;

create or replace function public.trg_recompute_productivity_score()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform public.recompute_productivity_score(old.assignee_id);
    return old;
  end if;

  perform public.recompute_productivity_score(new.assignee_id);
  if tg_op = 'UPDATE' and old.assignee_id is distinct from new.assignee_id then
    perform public.recompute_productivity_score(old.assignee_id);
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_recompute_productivity_score on public.tasks;
create trigger tasks_recompute_productivity_score
  after insert or update or delete on public.tasks
  for each row execute function public.trg_recompute_productivity_score();

-- One-time backfill so existing tasks aren't stuck at the 0 default
-- until their next unrelated update.
do $$
declare r record;
begin
  for r in select distinct assignee_id from public.tasks loop
    perform public.recompute_productivity_score(r.assignee_id);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- B. Focus timer -> hours logged
-- ---------------------------------------------------------------------

create or replace function public.recompute_hours_logged_this_month(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_hours numeric;
begin
  select coalesce(sum(duration_minutes), 0) / 60.0 into v_hours
    from public.time_sessions
    where user_id = p_user_id
      and ended_at is not null
      and date_trunc('month', started_at) = date_trunc('month', now());

  update public.users set hours_logged_this_month = round(v_hours, 2) where id = p_user_id;
exception when others then
  raise warning 'recompute_hours_logged_this_month failed for user %: %', p_user_id, sqlerrm;
end;
$$;

-- Starts a timer on a task for the caller. Auto-closes (capped) any
-- session the caller left open, so there is only ever one open timer
-- per user — including across tasks/tabs.
create or replace function public.start_task_timer(p_task_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_new_id  uuid;
begin
  select id into v_user_id from public.users where auth_user_id = auth.uid();
  if v_user_id is null then
    raise exception 'Not signed in';
  end if;

  if not exists (select 1 from public.tasks where id = p_task_id and assignee_id = v_user_id) then
    raise exception 'You can only track time on tasks assigned to you';
  end if;

  perform public.stop_task_timer(); -- closes any stale open session first (no-op if none)

  insert into public.time_sessions (user_id, task_id, started_at)
  values (v_user_id, p_task_id, now())
  returning id into v_new_id;

  return v_new_id;
end;
$$;

-- Stops the caller's currently open session, if any. Duration is
-- capped at 12 hours on close (see migration header) before it's added
-- to the task's logged_hours and the user's monthly total.
create or replace function public.stop_task_timer()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_user_id  uuid;
  v_session  record;
  v_minutes  numeric;
begin
  select id into v_user_id from public.users where auth_user_id = auth.uid();
  if v_user_id is null then
    return;
  end if;

  select * into v_session from public.time_sessions
    where user_id = v_user_id and ended_at is null
    order by started_at desc limit 1;

  if v_session is null then
    return; -- nothing open, nothing to do
  end if;

  v_minutes := least(720, extract(epoch from (now() - v_session.started_at)) / 60.0); -- cap 12h

  update public.time_sessions
    set ended_at = now(), duration_minutes = v_minutes
    where id = v_session.id;

  update public.tasks
    set logged_hours = logged_hours + round(v_minutes / 60.0, 2)
    where id = v_session.task_id;

  perform public.recompute_hours_logged_this_month(v_user_id);
end;
$$;

grant execute on function public.start_task_timer(uuid) to authenticated;
grant execute on function public.stop_task_timer() to authenticated;

-- Daily safety sweep: closes any session left open for more than 12
-- hours (applies the same cap) and refreshes every user's monthly
-- total — this is also what makes hours_logged_this_month correctly
-- roll over to 0 at the start of a new month for someone who hasn't
-- logged anything yet that month.
create or replace function public.daily_time_tracking_sweep()
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select id, task_id, user_id, started_at from public.time_sessions
    where ended_at is null and started_at < now() - interval '12 hours'
  loop
    update public.time_sessions set ended_at = now(), duration_minutes = 720 where id = r.id;
    update public.tasks set logged_hours = logged_hours + 12 where id = r.task_id;
  end loop;

  for r in select id from public.users loop
    perform public.recompute_hours_logged_this_month(r.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- C. Online / away / offline presence
-- ---------------------------------------------------------------------

create or replace function public.heartbeat()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.users
    set last_seen_at = now(),
        status = case when status in ('offline', 'away') then 'active' else status end
    where auth_user_id = auth.uid();
end;
$$;

create or replace function public.set_user_offline()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.users
    set status = 'offline', last_seen_at = now()
    where auth_user_id = auth.uid();
end;
$$;

grant execute on function public.heartbeat() to authenticated;
grant execute on function public.set_user_offline() to authenticated;

-- Only touches the auto-managed lane (active/away/offline) — leaves
-- any manually-set status (e.g. a future 'in_meeting'/'focus_mode'
-- feature) alone.
create or replace function public.sweep_idle_user_status()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.users set status = 'away'
    where status = 'active' and last_seen_at < now() - interval '5 minutes';

  update public.users set status = 'offline'
    where status in ('active', 'away') and last_seen_at < now() - interval '20 minutes';
end;
$$;

-- ---------------------------------------------------------------------
-- pg_cron scheduling (same defensive pattern as 33_task_reminders_and_alarms.sql —
-- warns instead of failing if pg_cron isn't enabled yet; see GO_LIVE_CHECKLIST.md 3.1)
-- ---------------------------------------------------------------------

do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise warning 'pg_cron extension unavailable in this environment — presence sweep and monthly hours rollover will not run until it is enabled (Supabase Cloud: Database > Extensions).';
end $$;

do $$
begin
  perform cron.unschedule('sweep-idle-user-status');
exception when others then
  null;
end $$;

do $$
begin
  perform cron.unschedule('daily-time-tracking-sweep');
exception when others then
  null;
end $$;

do $$
begin
  perform cron.schedule('sweep-idle-user-status', '*/2 * * * *', 'select public.sweep_idle_user_status();');
  perform cron.schedule('daily-time-tracking-sweep', '5 0 * * *', 'select public.daily_time_tracking_sweep();');
exception when others then
  raise warning 'Could not schedule presence/timer cron jobs — pg_cron likely not enabled yet.';
end $$;
