-- =====================================================================
-- 10_fix_slack_log_status_cast.sql
-- =====================================================================
-- Bug: test_slack_connection() inserted
--   (case when v_ok then 'delivered' else 'failed' end)
-- into slack_notification_log.status, which is the enum type
-- slack_delivery_status ('delivered' | 'failed'). A CASE expression
-- whose branches are both plain string literals resolves to `text`,
-- and Postgres has no implicit cast from text to a user-defined enum —
-- hence "column "status" is of type slack_delivery_status but
-- expression is of type text".
--
-- Fix: cast the CASE expression explicitly to slack_delivery_status.
--
-- Run this once, after 09_enable_realtime.sql, in the Supabase SQL editor.
-- =====================================================================

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
  values (
    v_config.id, 'test', v_config.channel, 'Test connection ping',
    (case when v_ok then 'delivered' else 'failed' end)::slack_delivery_status
  );

  return jsonb_build_object(
    'success', v_ok,
    'message', case when v_ok then 'Delivered' else 'Slack responded with status ' || v_response.status::text end
  );
end;
$$;

grant execute on function public.test_slack_connection() to authenticated;
