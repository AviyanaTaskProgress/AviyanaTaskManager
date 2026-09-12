-- =====================================================================
-- 23_protect_notification_triggers.sql
-- =====================================================================
-- Found during a fresh QA/backend audit pass (prompted by the
-- conversations RLS bug — see 22_fix_conversations_returning_gap.sql):
-- neither `notify_push()` (20_push_notifications.sql) nor
-- `notify_slack()` (03_go_backendless.sql, then 07_fix_slack_sync_http.sql)
-- had any exception handling, despite both being explicitly documented
-- as fire-and-forget side-effects that should "never block" the real
-- task/message/remark write that triggers them.
--
-- Confirmed live (not theoretical): temporarily making notify_push()
-- raise an error and attempting a task insert showed the INSERT itself
-- fails with that error — any bug in either notification path (a
-- future code change, an unexpected config row, pg_net/the http
-- extension misbehaving) would silently break task creation, task
-- approval, adding remarks, or sending chat messages, with a confusing
-- error that has nothing to do with what the person was actually doing.
--
-- Fix: both functions now catch `others` and RAISE WARNING instead of
-- letting the error propagate — visible in Postgres logs, but no
-- longer able to abort the calling insert/update. This migration
-- re-applies both function bodies (identical to the now-fixed source
-- files) against an already-deployed database; a fresh install running
-- 07/20 from scratch already gets the fixed versions directly.
--
-- Run this once, after 22_fix_conversations_returning_gap.sql, in the
-- Supabase SQL editor.
-- =====================================================================

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
exception when others then
  raise warning 'notify_slack failed (swallowed to protect the caller): %', sqlerrm;
end;
$$;

create or replace function public.notify_push(p_user_ids uuid[], p_title text, p_body text, p_url text default '/')
returns void
language plpgsql
security definer
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
    body := jsonb_build_object('user_ids', to_jsonb(p_user_ids), 'title', p_title, 'body', p_body, 'url', p_url)
  );
exception when others then
  raise warning 'notify_push failed (swallowed to protect the caller): %', sqlerrm;
end;
$$;
