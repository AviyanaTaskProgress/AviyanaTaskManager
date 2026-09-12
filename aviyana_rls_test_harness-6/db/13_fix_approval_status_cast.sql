-- =====================================================================
-- 13_fix_approval_status_cast.sql
-- =====================================================================
-- Bug: decide_task_approval() set
--   status = case when p_decision = 'approved' then 'completed' else 'in_progress' end
-- tasks.status is the enum type task_status, not text. A CASE expression
-- whose branches are both plain string literals resolves to `text` in
-- Postgres, and there's no implicit cast from text to a user-defined
-- enum — so this UPDATE has been throwing
--   "column "status" is of type task_status but expression is of type text"
-- on every single approve/reject click since this function was created
-- in 05_role_based_access.sql. (Same root cause as the Slack test-button
-- bug fixed in 07/10 — a CASE expression needs an explicit cast to an
-- enum target, it never gets one automatically.)
--
-- Run this once, after 12_remove_focus_timer.sql, in the Supabase SQL editor.
-- =====================================================================

create or replace function public.decide_task_approval(p_task_id uuid, p_decision approval_status, p_comment text default null)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_role user_role;
  v_dept department;
  v_can_approve boolean;
  v_task_dept department;
  v_row public.tasks;
begin
  select id, role, department, (permissions->>'canApproveTasks')::boolean
    into v_user_id, v_role, v_dept, v_can_approve
    from public.users where auth_user_id = auth.uid();

  if not coalesce(v_can_approve, false) then
    raise exception 'Not allowed: missing canApproveTasks permission';
  end if;

  select department into v_task_dept from public.tasks where id = p_task_id;

  if v_role = 'dept_head' and v_task_dept is distinct from v_dept then
    raise exception 'Not allowed: this task is outside your department';
  end if;

  update public.tasks
    set approval_status = p_decision,
        approved_by = v_user_id,
        approval_date = now(),
        status = (case when p_decision = 'approved' then 'completed' else 'in_progress' end)::task_status,
        completed_date = case when p_decision = 'approved' then current_date else completed_date end
    where id = p_task_id
    returning * into v_row;

  if p_comment is not null then
    insert into public.task_remarks (task_id, author_id, text, type)
    values (p_task_id, v_user_id, p_comment, 'approval_action');
  end if;

  perform public.log_audit_event(
    'task.' || p_decision::text, 'approval', p_task_id::text, '',
    (case when p_decision = 'rejected' then 'warning' else 'success' end)::audit_status
  );

  return v_row;
end;
$$;

grant execute on function public.decide_task_approval(uuid, approval_status, text) to authenticated;
