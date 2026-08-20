-- =====================================================================
-- 07_fix_slack_sync_http.sql
-- =====================================================================
-- Bug: notify_slack() and test_slack_connection() called net.http_post()
-- (the pg_net extension), which is ASYNCHRONOUS — it only returns a
-- request id, never a response row. Reading v_response.status_code off
-- that result throws a SQL error, which the frontend swallows and shows
-- as "Webhook delivery simulated" regardless of whether the URL is valid.
--
-- Fix: use the synchronous `http` extension instead, which returns a
-- real response (status, content, headers) immediately — so
-- test_slack_connection() can honestly report success/failure.
--
-- Run this once, after 06_promote_super_admin.sql, in the Supabase SQL editor.
-- =====================================================================

create extension if not exists http with schema extensions;

-- ------------------------------------------------------------
-- notify_slack(): fire-and-forget on task events, now synchronous.
-- ------------------------------------------------------------
create or replace function public.notify_slack(p_event text, p_summary text)
returns void
language plpgsql
security definer
set search_path = public, extensions
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

  perform extensions.http_post(
    v_config.webhook_url,
    jsonb_build_object('text', p_summary)::text,
    'application/json'
  );

  insert into public.slack_notification_log (config_id, type, channel, summary, status)
  values (v_config.id, p_event, v_config.channel, p_summary, 'delivered');
end;
$$;

-- ------------------------------------------------------------
-- test_slack_connection(): now actually reads the real HTTP status.
-- ------------------------------------------------------------
create or replace function public.test_slack_connection()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_config record;
  v_response extensions.http_response;
  v_ok boolean;
begin
  select * into v_config from public.slack_config where department is null limit 1;
  if v_config is null or v_config.webhook_url is null then
    return jsonb_build_object('success', false, 'message', 'No webhook URL configured');
  end if;

  select * into v_response from extensions.http_post(
    v_config.webhook_url,
    jsonb_build_object('text', '📡 Aviyana test ping')::text,
    'application/json'
  );

  v_ok := v_response.status between 200 and 299;

  update public.slack_config
    set is_connected = v_ok,
        last_tested_at = now()
    where id = v_config.id;

  insert into public.slack_notification_log (config_id, type, channel, summary, status)
  values (v_config.id, 'test', v_config.channel, 'Test connection ping',
          case when v_ok then 'delivered' else 'failed' end);

  return jsonb_build_object(
    'success', v_ok,
    'message', case when v_ok then 'Delivered' else 'Slack responded with status ' || v_response.status::text end
  );
end;
$$;

grant execute on function public.test_slack_connection() to authenticated;
