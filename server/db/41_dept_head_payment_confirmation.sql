-- =====================================================================
-- 41_dept_head_payment_confirmation.sql
-- =====================================================================
-- Dept Head can now confirm payments themselves — full amount, no cap —
-- for tasks/subtasks in their OWN department only. Previously
-- confirm_task_payment()/confirm_subtask_payment() were hard-restricted
-- to super_admin/chief_officer (29_task_payment_workflow.sql,
-- 38_subtask_partial_payments.sql); every payment needed escalation to
-- higher management even for routine departmental spend a Dept Head
-- already handles in practice.
--
-- Both functions are re-declared here, identical to the
-- 38_subtask_partial_payments.sql versions except for the role check,
-- which now also allows a dept_head whose OWN department matches the
-- task's department. Super Admin / Chief Officer keep unrestricted
-- (any department) authority exactly as before.
--
-- Run this once, after 40_chief_officer_task_edit.sql, in the Supabase
-- SQL editor.
-- =====================================================================

create or replace function public.confirm_task_payment(p_task_id uuid, p_notes text default null)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_role    user_role;
  v_dept    text;
  v_task_dept text;
  v_row     public.tasks;
begin
  select id, role, department into v_user_id, v_role, v_dept from public.users where auth_user_id = auth.uid();
  select t.department into v_task_dept from public.tasks t where t.id = p_task_id;

  if not (
    v_role in ('super_admin', 'chief_officer')
    or (v_role = 'dept_head' and v_task_dept is not distinct from v_dept)
  ) then
    raise exception 'Not allowed: only higher management or this task''s own Dept Head can confirm payment';
  end if;

  update public.tasks
    set payment_status = 'paid',
        payment_confirmed_by = v_user_id,
        payment_confirmed_at = now(),
        payment_notes = coalesce(p_notes, payment_notes),
        status = 'completed',
        completed_date = current_date
    where id = p_task_id
      and requires_payment = true
      and payment_status = 'pending'
    returning * into v_row;

  if v_row.id is null then
    raise exception 'Task not found, or is not currently awaiting payment confirmation';
  end if;

  -- Sweep any subtask payments this task had split out that were still
  -- pending — a whole-task confirmation covers them too.
  update public.task_subtasks
    set payment_status = 'paid',
        payment_confirmed_by = v_user_id,
        payment_confirmed_at = now()
    where task_id = p_task_id
      and payment_amount is not null
      and payment_status = 'pending';

  perform public.notify_push(
    array[v_row.assignee_id],
    'Payment confirmed',
    v_row.title,
    '/'
  );

  perform public.log_audit_event('task.payment_confirmed', 'approval', p_task_id::text, coalesce(p_notes, ''), 'success');

  return v_row;
end;
$$;

grant execute on function public.confirm_task_payment(uuid, text) to authenticated;

create or replace function public.confirm_subtask_payment(p_subtask_id uuid, p_notes text default null)
returns public.task_subtasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id   uuid;
  v_role      user_role;
  v_dept      text;
  v_task_dept text;
  v_row       public.task_subtasks;
  v_task_id   uuid;
  v_all_paid  boolean;
  v_task      public.tasks;
begin
  select id, role, department into v_user_id, v_role, v_dept from public.users where auth_user_id = auth.uid();
  select t.department into v_task_dept
    from public.task_subtasks s join public.tasks t on t.id = s.task_id
    where s.id = p_subtask_id;

  if not (
    v_role in ('super_admin', 'chief_officer')
    or (v_role = 'dept_head' and v_task_dept is not distinct from v_dept)
  ) then
    raise exception 'Not allowed: only higher management or this task''s own Dept Head can confirm payment';
  end if;

  update public.task_subtasks
    set payment_status = 'paid',
        payment_confirmed_by = v_user_id,
        payment_confirmed_at = now(),
        payment_notes = coalesce(p_notes, payment_notes)
    where id = p_subtask_id
      and payment_amount is not null
      and payment_status = 'pending'
    returning * into v_row;

  if v_row.id is null then
    raise exception 'Subtask not found, or is not currently awaiting payment confirmation';
  end if;

  v_task_id := v_row.task_id;
  select * into v_task from public.tasks where id = v_task_id;

  -- Every subtask that was ever given a payment share must now be paid
  -- for the task to complete — one still-pending subtask keeps the
  -- whole task on 'pending_payment', by design (unchanged from 38).
  select not exists (
    select 1 from public.task_subtasks
    where task_id = v_task_id and payment_amount is not null and payment_status <> 'paid'
  ) into v_all_paid;

  if v_all_paid and v_task.status = 'pending_payment' then
    update public.tasks
      set payment_status = 'paid', status = 'completed', completed_date = current_date
      where id = v_task_id;

    perform public.notify_push(array[v_task.assignee_id], 'Payment confirmed', v_task.title, '/');
  end if;

  perform public.log_audit_event('task.subtask_payment_confirmed', 'approval', p_subtask_id::text, coalesce(p_notes, ''), 'success');

  return v_row;
end;
$$;

grant execute on function public.confirm_subtask_payment(uuid, text) to authenticated;
