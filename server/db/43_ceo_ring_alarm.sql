-- =====================================================================
-- 43_ceo_ring_alarm.sql
-- =====================================================================
-- Two follow-ups to 42_ceo_and_chairman_roles.sql, both confirmed
-- explicitly:
--
--   A. Adds 'ceo' to ring_task_alarm()'s allowed roles
--      (33_task_reminders_and_alarms.sql). Same 15-minute cooldown,
--      same department restriction for dept_head — ceo gets the same
--      unrestricted (any department) reach as super_admin/chief_officer.
--
--   B. Adds 'ceo' to group-chat creation (conversations_insert,
--      18_viewer_role_and_dashboard.sql), alongside dept_head/
--      chief_officer/super_admin. Also adds 'chairman' to the
--      read-only exclusion there, for the same reason 'viewer' is
--      excluded — this was a pre-existing gap (chairman didn't exist
--      yet when that policy was last written) rather than something
--      newly requested.
--
-- Run this once, after 42_ceo_and_chairman_roles.sql, in the Supabase
-- SQL editor. No enum values are touched, so this is a normal
-- single-paste migration (no two-step split needed).
-- =====================================================================

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

  if v_actor_role not in ('super_admin', 'ceo', 'chief_officer', 'dept_head') then
    raise exception 'Not allowed: only Super Admin, CEO, Chief Officer, or Dept Head can ring a task alarm';
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

-- Group chat creation: ceo joins dept_head/chief_officer/super_admin
-- (18_viewer_role_and_dashboard.sql). chairman added to the read-only
-- exclusion alongside viewer, for the same reason viewer is excluded.
drop policy if exists conversations_insert on public.conversations;
create policy conversations_insert on public.conversations
  for insert with check (
    created_by = (public.current_app_user()).id
    and public.current_app_role() not in ('viewer', 'chairman')
    and (
      type = 'direct'
      or (type = 'group' and public.current_app_role() in ('dept_head', 'ceo', 'chief_officer', 'super_admin'))
    )
  );
