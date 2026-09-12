-- =====================================================================
-- 14_fix_audit_signature_hmac.sql
-- =====================================================================
-- Bug: log_audit_event() calls hmac(...) to sign every audit log entry,
-- but pgcrypto (which provides hmac()) is installed into Supabase's
-- `extensions` schema by default — and this function's
-- `set search_path = public` never included that schema. Every call has
-- been failing with "function hmac(text, unknown, unknown) does not
-- exist" since the very first migration.
--
-- Impact was wider than it looked:
--   - For most actions (create/update/delete task, add user, permission
--     changes, Slack config...) the frontend wrapper (db.logAuditEvent)
--     catches this error and only logs it to the browser console — so
--     those actions still worked, they just silently never recorded an
--     audit log entry. The Audit Logs page has likely been empty (or
--     missing entries) since day one.
--   - For decide_task_approval(), log_audit_event() is called directly
--     inside the same database function/transaction with `perform` (no
--     exception handling) — so this failure rolled back the entire
--     approval, not just the log entry. This compounded with the
--     separate enum-cast bug fixed in 13_fix_approval_status_cast.sql.
--
-- Fix: include `extensions` in the function's search_path (matching the
-- pattern already used in 07_fix_slack_sync_http.sql for the same class
-- of issue).
--
-- Run this once, after 13_fix_approval_status_cast.sql, in the Supabase
-- SQL editor.
-- =====================================================================

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
set search_path = public, extensions
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
