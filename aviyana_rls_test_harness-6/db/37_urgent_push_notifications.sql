-- =====================================================================
-- 37_urgent_push_notifications.sql
-- =====================================================================
-- "What's still missing before launch" pass found: Ring Alarm's push
-- notification (the fallback channel for when the app isn't open in
-- the foreground — AlarmSiren.tsx only rings while the tab is actually
-- open) is indistinguishable from a routine deadline reminder at the
-- OS level. notify_push() never carried any urgency signal through the
-- chain (SQL function -> Edge Function -> service worker), so both
-- show as an ordinary, auto-dismissing notification — defeating half
-- the point of a dedicated "hard to miss" alarm feature for anyone who
-- isn't actively looking at the app when it's rung.
--
-- Fixed by adding an optional p_urgent flag to notify_push(), forwarded
-- through to the push payload; ring_task_alarm() is the only caller
-- that sets it true. The companion changes (Edge Function reading
-- `urgent` from the payload, service worker setting
-- requireInteraction/vibrate when present) are in
-- supabase/functions/send-push/index.ts and public/sw.js — deploy the
-- Edge Function again after this migration:
--   supabase functions deploy send-push
--
-- Existing callers (deadline reminders, task assignment, approval,
-- new message/remark) are untouched — the new parameter defaults to
-- false, so they keep behaving exactly as before.
--
-- Run this once, after 36_backup_restore_covers_new_tables.sql, in the
-- Supabase SQL editor.
-- =====================================================================

-- CREATE OR REPLACE with an added trailing parameter does NOT replace
-- the old 4-argument overload in Postgres — it creates a genuinely
-- separate function, and every existing 4-argument call site
-- (trg_notify_task_assigned, trg_notify_task_approval,
-- trg_notify_new_message, trg_notify_new_remark,
-- send_deadline_reminders) then fails with "function ... is not
-- unique", because both overloads' defaults could match. Confirmed via
-- the harness before adding this line. The old signature must be
-- dropped explicitly first.
drop function if exists public.notify_push(uuid[], text, text, text);

create or replace function public.notify_push(
  p_user_ids uuid[],
  p_title text,
  p_body text,
  p_url text default '/',
  p_urgent boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
begin
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return;
  end if;

  select value into v_url    from public._push_config where key = 'edge_function_url';
  select value into v_secret from public._push_config where key = 'trigger_secret';

  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := jsonb_build_object(
      'user_ids', to_jsonb(p_user_ids),
      'title', p_title,
      'body', p_body,
      'url', p_url,
      'urgent', p_urgent
    )
  );
exception when others then
  raise warning 'notify_push failed (swallowed to protect the caller): %', sqlerrm;
end;
$$;

-- Re-declared, not newly granted — this keeps the same lockdown from
-- 34_audit_fixes_delete_policy_and_search_path.sql (internal/trigger-
-- only, no direct client access).
revoke execute on function public.notify_push(uuid[], text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.notify_push(uuid[], text, text, text, boolean) to service_role;

-- ring_task_alarm() now passes p_urgent := true — re-declared with
-- that one change, body otherwise identical to 33_task_reminders_and_alarms.sql.
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
    '/',
    true -- p_urgent — this is the one call site that should ever set it
  );

  perform public.log_audit_event('task.alarm_rung', 'task', p_task_id::text, '', 'warning');

  return v_row;
end;
$$;

grant execute on function public.ring_task_alarm(uuid) to authenticated;
