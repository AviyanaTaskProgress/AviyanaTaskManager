-- ============================================================
-- 03: Go backend-less — move audit logging + Slack notifications
-- into Postgres itself (Supabase). Run this in the SQL Editor.
-- After this, the frontend talks to Supabase directly and no
-- separate server (Render/Railway/etc.) needs to be hosted or paid for.
-- ============================================================

-- pg_net lets Postgres make outbound HTTP calls (used to ping Slack directly
-- from a trigger, instead of a Node backend doing it).
create extension if not exists pg_net;

-- ------------------------------------------------------------
-- 1. Audit log writing, now done inside the database.
--    The frontend calls this RPC instead of inserting directly
--    (there is intentionally no INSERT policy on audit_logs for
--    regular users — this function is the only door in).
-- ------------------------------------------------------------
create or replace function public.log_audit_event(
  p_action text,
  p_category audit_category,
  p_target text,
  p_details text default '',
  p_status audit_status default 'success'
)
returns public.audit_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_signature text;
  v_row public.audit_logs;
begin
  select id into v_actor_id from public.users where auth_user_id = auth.uid();

  v_signature := 'SHA256:' || encode(
    hmac(v_actor_id::text || p_action || p_target || now()::text, 'aviyana-audit-signing', 'sha256'),
    'hex'
  );

  insert into public.audit_logs (actor_id, action, category, target, details, encrypted_signature, status)
  values (v_actor_id, p_action, p_category, p_target, p_details, v_signature, p_status)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.log_audit_event(text, audit_category, text, text, audit_status) to authenticated;

-- ------------------------------------------------------------
-- 2. Slack notifications, fired directly from Postgres triggers
--    whenever a task changes status or gets submitted/approved.
-- ------------------------------------------------------------
create or replace function public.notify_slack(p_event text, p_summary text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config record;
  v_should_notify boolean;
begin
  select * into v_config from public.slack_config where department is null limit 1;
  if v_config is null or v_config.webhook_url is null or not v_config.is_connected then
    return;
  end if;

  v_should_notify := case p_event
    when 'assigned'          then v_config.notify_on_task_assigned
    when 'deadline_alert'    then v_config.notify_on_deadline_alert
    when 'approval_request'  then v_config.notify_on_approval_requested
    when 'completed'         then v_config.notify_on_task_completed
    else false
  end;
  if not v_should_notify then
    return;
  end if;

  perform net.http_post(
    url := v_config.webhook_url,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('text', p_summary)
  );

  insert into public.slack_notification_log (config_id, type, channel, summary, status)
  values (v_config.id, p_event, v_config.channel, p_summary, 'delivered');
end;
$$;

-- Fires whenever a task is inserted or its status/approval_status changes.
create or replace function public.trg_task_slack_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignee_name text;
begin
  select name into v_assignee_name from public.users where id = new.assignee_id;

  if TG_OP = 'INSERT' then
    perform public.notify_slack('assigned', format('📌 New task assigned: "%s" → %s (%s)', new.title, v_assignee_name, new.department));
  elsif TG_OP = 'UPDATE' then
    if new.status = 'pending_approval' and old.status is distinct from 'pending_approval' then
      perform public.notify_slack('approval_request', format('📝 Approval requested: "%s" by %s', new.title, v_assignee_name));
    elsif new.status = 'completed' and old.status is distinct from 'completed' then
      perform public.notify_slack('completed', format('✅ Task completed: "%s" (%s)', new.title, new.department));
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_on_task_slack_notify on public.tasks;
create trigger trg_on_task_slack_notify
  after insert or update on public.tasks
  for each row execute function public.trg_task_slack_notify();

-- ------------------------------------------------------------
-- 3. Slack "Test connection" button, now an RPC instead of an
--    Express route.
-- ------------------------------------------------------------
create or replace function public.test_slack_connection()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_config record;
  v_response record;
begin
  select * into v_config from public.slack_config where department is null limit 1;
  if v_config is null or v_config.webhook_url is null then
    return jsonb_build_object('success', false, 'message', 'No webhook URL configured');
  end if;

  select * into v_response from net.http_post(
    url := v_config.webhook_url,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('text', '📡 Aviyana test ping')
  );

  update public.slack_config
    set is_connected = (v_response.status_code between 200 and 299),
        last_tested_at = now()
    where id = v_config.id;

  insert into public.slack_notification_log (config_id, type, channel, summary, status)
  values (v_config.id, 'test', v_config.channel, 'Test connection ping',
          case when v_response.status_code between 200 and 299 then 'delivered' else 'failed' end);

  return jsonb_build_object('success', v_response.status_code between 200 and 299);
end;
$$;

grant execute on function public.test_slack_connection() to authenticated;

-- ------------------------------------------------------------
-- 4. Approvals — RPCs so the "who can approve" check happens in
--    one trusted place instead of being re-implemented per query.
-- ------------------------------------------------------------
create or replace function public.submit_task_for_approval(p_task_id uuid, p_note text default null)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_row public.tasks;
begin
  select id into v_user_id from public.users where auth_user_id = auth.uid();

  update public.tasks
    set status = 'pending_approval', approval_status = 'pending'
    where id = p_task_id and assignee_id = v_user_id
    returning * into v_row;

  if v_row.id is null then
    raise exception 'Not allowed: only the assignee can submit this task';
  end if;

  if p_note is not null then
    insert into public.task_remarks (task_id, author_id, text, type)
    values (p_task_id, v_user_id, p_note, 'approval_request');
  end if;

  perform public.log_audit_event('task.submitted_for_approval', 'approval', p_task_id::text, '', 'success');

  return v_row;
end;
$$;

grant execute on function public.submit_task_for_approval(uuid, text) to authenticated;

create or replace function public.decide_task_approval(p_task_id uuid, p_decision approval_status, p_comment text default null)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_can_approve boolean;
  v_row public.tasks;
begin
  select id, (permissions->>'canApproveTasks')::boolean into v_user_id, v_can_approve
    from public.users where auth_user_id = auth.uid();

  if not coalesce(v_can_approve, false) then
    raise exception 'Not allowed: missing canApproveTasks permission';
  end if;

  update public.tasks
    set approval_status = p_decision,
        approved_by = v_user_id,
        approval_date = now(),
        status = case when p_decision = 'approved' then 'completed' else 'in_progress' end,
        completed_date = case when p_decision = 'approved' then current_date else completed_date end
    where id = p_task_id
    returning * into v_row;

  if p_comment is not null then
    insert into public.task_remarks (task_id, author_id, text, type)
    values (p_task_id, v_user_id, p_comment, 'approval_action');
  end if;

  perform public.log_audit_event(
    'task.' || p_decision::text, 'approval', p_task_id::text, '',
    case when p_decision = 'rejected' then 'warning' else 'success' end
  );

  return v_row;
end;
$$;

grant execute on function public.decide_task_approval(uuid, approval_status, text) to authenticated;

-- ------------------------------------------------------------
-- 5. increment_task_logged_hours needs security definer too now
--    that there's no service-role backend calling it.
-- ------------------------------------------------------------
create or replace function public.increment_task_logged_hours(p_task_id uuid, p_hours numeric)
returns void
language sql
security definer
set search_path = public
as $$
  update public.tasks set logged_hours = logged_hours + p_hours where id = p_task_id;
$$;

grant execute on function public.increment_task_logged_hours(uuid, numeric) to authenticated;
