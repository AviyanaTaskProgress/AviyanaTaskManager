-- =====================================================================
-- 34_audit_fixes_delete_policy_and_search_path.sql
-- =====================================================================
-- Pre-launch full audit (2026-09) found two issues, both fixed here:
--
-- A. REAL BUG — public.tasks has never had a DELETE RLS policy (not
--    introduced this session — this predates it). RLS is enabled with
--    zero DELETE policies, which means DELETE FROM tasks silently
--    matches ZERO ROWS for every single role, including Super Admin.
--    Confirmed by testing: `delete from tasks where id = ...` as
--    Super Admin returns "DELETE 0", no error. The Supabase JS client
--    doesn't surface this as an error either (no rows matched isn't a
--    failure), so src/context/AppContext.tsx's deleteTask() shows a
--    "Task deleted." success toast and removes it from local state —
--    but the row is still in the database and reappears on the next
--    full reload. The "Delete" button has been silently non-functional
--    for every role. Fixed by adding a real tasks_delete policy,
--    scoped identically to tasks_update (assignee, Super Admin, or
--    Dept Head with canEditAllTasks in their own department) — the
--    companion frontend fix (TaskModal.tsx) now only shows the Delete
--    button when the current user actually satisfies this, instead of
--    the previous blanket "anyone who isn't Staff".
--
-- B. HARDENING — 7 SECURITY DEFINER functions added in this session's
--    migrations (27, 28, 30) were missing `set search_path`, unlike
--    every other SECURITY DEFINER function in this codebase (see
--    decide_task_approval, log_audit_event, confirm_task_payment,
--    etc., which all set it). Without a pinned search_path, a
--    SECURITY DEFINER function resolves unqualified identifiers
--    (built-ins like now(), or any bare function/table name) against
--    the CALLER's search_path, not a fixed one — the classic Postgres
--    "search_path hijacking" risk for elevated-privilege functions.
--    All table/function references inside these 7 already happen to
--    be schema-qualified (public.xxx), so this was not an active
--    exploit path, but it's inconsistent with the rest of the
--    codebase's defensive convention and worth closing before launch.
--    Re-declared here with CREATE OR REPLACE FUNCTION, bodies
--    unchanged except for the added `set search_path = public`.
--
-- Run this once, after 33_task_reminders_and_alarms.sql, in the
-- Supabase SQL editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- A. tasks_delete
-- ---------------------------------------------------------------------
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete using (
    assignee_id = (public.current_app_user()).id
    or public.current_app_role() = 'super_admin'
    or (
      (public.current_app_user()).permissions->>'canEditAllTasks' = 'true'
      and public.current_app_role() = 'dept_head'
      and department = (public.current_app_user()).department
    )
  );

-- ---------------------------------------------------------------------
-- B. search_path hardening — 27_task_subtasks.sql
-- ---------------------------------------------------------------------
create or replace function public.trg_subtask_stamp_completion()
returns trigger language plpgsql security definer set search_path = public as $$
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

create or replace function public.trg_attachment_subtask_consistency()
returns trigger language plpgsql security definer set search_path = public as $$
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

create or replace function public.recalc_task_progress_from_subtasks(p_task_id uuid)
returns void language plpgsql security definer set search_path = public as $$
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
returns trigger language plpgsql security definer set search_path = public as $$
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

-- ---------------------------------------------------------------------
-- B. search_path hardening — 28_task_display_id.sql
-- ---------------------------------------------------------------------
create or replace function public.trg_departments_assign_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_base text;
  v_candidate text;
  v_suffix integer := 1;
begin
  if new.code is not null and length(trim(new.code)) > 0 then
    new.code := upper(trim(new.code));
    return new;
  end if;

  v_base := public.derive_department_code(new.name);
  v_candidate := v_base;
  while exists (select 1 from public.departments where code = v_candidate and name <> new.name) loop
    v_suffix := v_suffix + 1;
    v_candidate := v_base || v_suffix::text;
  end loop;

  new.code := v_candidate;
  return new;
end;
$$;

create or replace function public.trg_tasks_generate_display_id()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_seq integer;
begin
  if new.task_display_id is not null then
    return new;
  end if;

  select code into v_code from public.departments where name = new.department;
  v_code := coalesce(v_code, 'GEN');

  insert into public.department_task_counters (department_name, next_seq)
  values (new.department, 2)
  on conflict (department_name) do update
    set next_seq = public.department_task_counters.next_seq + 1
  returning next_seq - 1 into v_seq;

  new.task_display_id := v_code || '-' || lpad(v_seq::text, 4, '0');
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- B. search_path hardening — 30_assigned_by_and_completed_counter.sql
-- ---------------------------------------------------------------------
create or replace function public.trg_tasks_sync_completed_counter()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'completed' then
      update public.users set tasks_completed = tasks_completed + 1 where id = new.assignee_id;
    end if;
    return new;
  end if;

  if new.status = 'completed' and old.status = 'completed' and new.assignee_id is distinct from old.assignee_id then
    update public.users set tasks_completed = greatest(tasks_completed - 1, 0) where id = old.assignee_id;
    update public.users set tasks_completed = tasks_completed + 1 where id = new.assignee_id;
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'completed' and old.status <> 'completed' then
      update public.users set tasks_completed = tasks_completed + 1 where id = new.assignee_id;
    elsif old.status = 'completed' and new.status <> 'completed' then
      update public.users set tasks_completed = greatest(tasks_completed - 1, 0) where id = old.assignee_id;
    end if;
  end if;

  return new;
exception when others then
  raise warning 'trg_tasks_sync_completed_counter failed (swallowed to protect the caller): %', sqlerrm;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- C. SYSTEM-WIDE FINDING — no migration anywhere in this project has
--    ever REVOKEd anything, which in plain Postgres means EVERY
--    function ever created (this session's and all prior ones) is
--    executable by the PUBLIC pseudo-role by default — which
--    authenticated/anon inherit from, since nothing overrides it.
--
--    Proven exploitable in the harness: an unrelated `staff` user
--    (not the assignee, not in the task's department) can call
--    `select recalc_task_progress_from_subtasks('<any task id>')`
--    directly and it succeeds — a SECURITY DEFINER function bypasses
--    RLS entirely, so this is a real unauthorized write, not just an
--    unused surface. The same is true of every other internal
--    trigger-only helper (notify_push, notify_slack,
--    send_deadline_reminders, every trg_* function, etc.) — none of
--    them are meant to be called directly by a client at all, they
--    only ever need to fire via the trigger mechanism or from inside
--    another SECURITY DEFINER function (both of which are UNAFFECTED
--    by revoking direct-call EXECUTE — Postgres doesn't check EXECUTE
--    privilege for trigger firing, and a SECURITY DEFINER function's
--    internal calls run as its owner regardless of the caller's own
--    grants).
--
--    Locked down to exactly the internal/trigger-only SECURITY
--    DEFINER functions — deliberately NOT a blanket
--    "REVOKE ... ON ALL FUNCTIONS", which would also catch
--    gen_random_uuid() and break every table's `id` column DEFAULT
--    (default expressions evaluate under the INSERTing role's own
--    privileges, not the table owner's). Left untouched: functions
--    referenced directly inside RLS policy expressions
--    (current_app_role, current_app_user, chief_officer_dept_level,
--    is_conversation_member — RLS evaluates these as the querying
--    role, so revoking would break every RLS-protected query on
--    every table) and the legitimate client-facing RPCs the frontend
--    actually calls via supabase.rpc() (confirm_task_payment,
--    create_backup, decide_task_approval, list_my_conversations,
--    log_audit_event, restore_backup, ring_task_alarm,
--    submit_task_for_approval, test_slack_connection).
-- ---------------------------------------------------------------------
revoke execute on function public.block_self_privilege_escalation() from public, anon, authenticated;
revoke execute on function public.clamp_user_permissions() from public, anon, authenticated;
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.notify_push(p_user_ids uuid[], p_title text, p_body text, p_url text) from public, anon, authenticated;
revoke execute on function public.notify_slack(p_event text, p_summary text) from public, anon, authenticated;
revoke execute on function public.recalc_task_progress_from_subtasks(p_task_id uuid) from public, anon, authenticated;
revoke execute on function public.send_deadline_reminders() from public, anon, authenticated;
revoke execute on function public.trg_attachment_subtask_consistency() from public, anon, authenticated;
revoke execute on function public.trg_departments_assign_code() from public, anon, authenticated;
revoke execute on function public.trg_notify_new_message() from public, anon, authenticated;
revoke execute on function public.trg_notify_new_remark() from public, anon, authenticated;
revoke execute on function public.trg_notify_task_approval() from public, anon, authenticated;
revoke execute on function public.trg_notify_task_assigned() from public, anon, authenticated;
revoke execute on function public.trg_subtask_stamp_completion() from public, anon, authenticated;
revoke execute on function public.trg_subtasks_recalc_progress() from public, anon, authenticated;
revoke execute on function public.trg_task_slack_notify() from public, anon, authenticated;
revoke execute on function public.trg_tasks_generate_display_id() from public, anon, authenticated;
revoke execute on function public.trg_tasks_sync_completed_counter() from public, anon, authenticated;

-- service_role is the trusted backend/admin role (used by Edge
-- Functions with the service key, never exposed to the browser) — give
-- it explicit access back so nothing server-side is caught by the
-- revoke above even if a future Edge Function needs to call one of
-- these directly.
grant execute on function public.block_self_privilege_escalation() to service_role;
grant execute on function public.clamp_user_permissions() to service_role;
grant execute on function public.handle_new_auth_user() to service_role;
grant execute on function public.notify_push(p_user_ids uuid[], p_title text, p_body text, p_url text) to service_role;
grant execute on function public.notify_slack(p_event text, p_summary text) to service_role;
grant execute on function public.recalc_task_progress_from_subtasks(p_task_id uuid) to service_role;
grant execute on function public.send_deadline_reminders() to service_role;
grant execute on function public.trg_attachment_subtask_consistency() to service_role;
grant execute on function public.trg_departments_assign_code() to service_role;
grant execute on function public.trg_notify_new_message() to service_role;
grant execute on function public.trg_notify_new_remark() to service_role;
grant execute on function public.trg_notify_task_approval() to service_role;
grant execute on function public.trg_notify_task_assigned() to service_role;
grant execute on function public.trg_subtask_stamp_completion() to service_role;
grant execute on function public.trg_subtasks_recalc_progress() to service_role;
grant execute on function public.trg_task_slack_notify() to service_role;
grant execute on function public.trg_tasks_generate_display_id() to service_role;
grant execute on function public.trg_tasks_sync_completed_counter() to service_role;

-- Safety default for every migration written after this one — a new
-- SECURITY DEFINER helper that forgets an explicit grant now defaults
-- to NOT publicly executable, instead of silently repeating this exact
-- gap. Covers both the implicit PUBLIC grant and (in case this
-- project's default privileges were ever configured to auto-grant
-- authenticated/anon on new functions, the way this harness's own
-- shim does) an explicit default grant to those roles too. Client-
-- facing RPCs still need (and already get, by established convention)
-- an explicit `grant execute ... to authenticated`.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- D. notifications data-integrity gap — notifications_own (pre-existing,
--    not introduced this session) is `FOR ALL USING (user_id = self)`
--    with no WITH CHECK, which Postgres defaults to reusing USING for
--    writes too — so it correctly stops anyone from inserting/updating
--    a notification addressed to someone else. But it does NOT stop a
--    user from rewriting the CONTENT of their own past notifications —
--    title, message, urgency, even task_id — since RLS only filters
--    rows, not columns. The only two things the app itself ever
--    updates are the `read` flag (markNotificationRead /
--    markAllNotificationsRead) — genuine writes to anything else were
--    never intended to be possible. Column-level GRANT (independent of
--    and layered on top of RLS) closes this: `read` stays writable,
--    everything else on an existing row becomes read-only to the
--    client, without touching INSERT (still needs every column, for
--    createNotification()) or SELECT.
-- ---------------------------------------------------------------------
revoke update on public.notifications from authenticated;
grant update (read) on public.notifications to authenticated;

-- ---------------------------------------------------------------------
-- E. tasks.payment_amount had no CHECK constraint — a negative amount
--    could be written via direct API/RPC call (the client's `min={0}`
--    on the number input is trivially bypassed, it's not a real
--    boundary). Follows this table's own existing convention
--    (tasks_progress_check, due_after_start) that numeric/date
--    invariants belong at the DB level, not just in the form.
-- ---------------------------------------------------------------------
alter table public.tasks
  add constraint tasks_payment_amount_nonnegative check (payment_amount is null or payment_amount >= 0);
