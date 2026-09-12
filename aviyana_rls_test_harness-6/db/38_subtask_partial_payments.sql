-- =====================================================================
-- 38_subtask_partial_payments.sql
-- =====================================================================
-- Feature: a payment-linked task's total amount can be split across
-- its subtasks (e.g. a Rs. 100,000 task paid out as 4 separate
-- Rs. 25,000 subtask payments instead of one lump sum). Each subtask
-- payment is confirmed independently by Super Admin/Chief Officer, and
-- the task only reaches 'completed' once every subtask that has a
-- payment amount assigned has actually been paid — a partial payment
-- alone does not complete the task.
--
-- tasks.requires_payment/payment_amount stays the single source of
-- truth for "does this task involve money, and how much in total" —
-- subtask-level amounts are an optional allocation of that total, not
-- a replacement for it. A task can still use the existing single
-- lump-sum confirm_task_payment() RPC (29_task_payment_workflow.sql)
-- unchanged if nobody ever splits it across subtasks.
--
-- Run this once, after 37_urgent_push_notifications.sql, in the
-- Supabase SQL editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columns — mirrors tasks' own payment columns exactly.
-- ---------------------------------------------------------------------
alter table public.task_subtasks add column if not exists payment_amount numeric(12,2);
alter table public.task_subtasks add column if not exists payment_status task_payment_status not null default 'not_applicable';
alter table public.task_subtasks add column if not exists payment_confirmed_by uuid references public.users(id) on delete set null;
alter table public.task_subtasks add column if not exists payment_confirmed_at timestamptz;
alter table public.task_subtasks add column if not exists payment_notes text;

alter table public.task_subtasks
  add constraint task_subtasks_payment_amount_nonnegative check (payment_amount is null or payment_amount >= 0);

create index if not exists idx_task_subtasks_payment_status on public.task_subtasks(payment_status);

-- ---------------------------------------------------------------------
-- 2. Consistency + guard trigger — same pattern as
--    trg_tasks_payment_consistency (29_task_payment_workflow.sql),
--    plus a guard stopping a subtask payment from being set up on a
--    task that isn't itself marked as requiring payment (a subtask
--    payment only ever makes sense as a slice of the task's own
--    payment_amount).
-- ---------------------------------------------------------------------
create or replace function public.trg_subtask_payment_consistency()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_task_requires_payment boolean;
begin
  if new.payment_amount is not null then
    select requires_payment into v_task_requires_payment from public.tasks where id = new.task_id;
    if not coalesce(v_task_requires_payment, false) then
      raise exception 'Cannot set a subtask payment amount unless the task itself is marked as requiring payment';
    end if;

    if new.payment_status = 'not_applicable' then
      new.payment_status := 'pending';
    end if;
  else
    new.payment_status := 'not_applicable';
    new.payment_confirmed_by := null;
    new.payment_confirmed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_subtasks_payment_consistency on public.task_subtasks;
create trigger trg_subtasks_payment_consistency
  before insert or update of payment_amount, payment_status on public.task_subtasks
  for each row execute function public.trg_subtask_payment_consistency();

-- ---------------------------------------------------------------------
-- 3. RLS column lockdown — subtasks_update (27_task_subtasks.sql)
--    lets the assignee (or a permitted Dept Head) update ANY column on
--    their own task's subtasks, which without this would let someone
--    mark their own subtask payment as 'paid' directly, bypassing the
--    higher-management-only confirm below entirely. payment_amount
--    stays normally editable (splitting the total across subtasks is
--    an ordinary task-setup step, not a "money changed hands" claim) —
--    only the confirmation fields are locked to RPC-only.
-- ---------------------------------------------------------------------
revoke update on public.task_subtasks from authenticated;
grant update (title, is_completed, order_index, assignee_id, payment_amount) on public.task_subtasks to authenticated;

-- ---------------------------------------------------------------------
-- 4. confirm_subtask_payment() — the per-subtask equivalent of
--    confirm_task_payment(). Same role check. Once every subtask on
--    the task that has a payment_amount assigned is 'paid', the task
--    itself completes automatically — a partial payment keeps the
--    task sitting on 'pending_payment' exactly as before.
-- ---------------------------------------------------------------------
create or replace function public.confirm_subtask_payment(p_subtask_id uuid, p_notes text default null)
returns public.task_subtasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_role user_role;
  v_row public.task_subtasks;
  v_task_id uuid;
  v_all_paid boolean;
  v_task public.tasks;
begin
  select id, role into v_user_id, v_role from public.users where auth_user_id = auth.uid();

  if v_role not in ('super_admin', 'chief_officer') then
    raise exception 'Not allowed: only higher management can confirm a subtask payment';
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
  -- whole task on 'pending_payment', by design.
  select not exists (
    select 1 from public.task_subtasks
    where task_id = v_task_id and payment_amount is not null and payment_status <> 'paid'
  ) into v_all_paid;

  if v_all_paid and v_task.status = 'pending_payment' then
    update public.tasks
      set payment_status = 'paid',
          status = 'completed',
          completed_date = current_date
      where id = v_task_id;

    perform public.notify_push(
      array[v_task.assignee_id],
      'Payment confirmed',
      v_task.title,
      '/'
    );
  end if;

  perform public.log_audit_event('task.subtask_payment_confirmed', 'approval', p_subtask_id::text, coalesce(p_notes, ''), 'success');

  return v_row;
end;
$$;

grant execute on function public.confirm_subtask_payment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5. confirm_task_payment() — extended so the "pay it all at once"
--    lump-sum path (e.g. one bank transfer covering every subtask's
--    share) stays consistent with subtask-level state instead of
--    leaving subtasks stuck on 'pending' while the task itself shows
--    completed. Re-declared with this one addition; everything else
--    identical to 29_task_payment_workflow.sql.
-- ---------------------------------------------------------------------
create or replace function public.confirm_task_payment(p_task_id uuid, p_notes text default null)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_role user_role;
  v_row public.tasks;
begin
  select id, role into v_user_id, v_role from public.users where auth_user_id = auth.uid();

  if v_role not in ('super_admin', 'chief_officer') then
    raise exception 'Not allowed: only higher management can confirm a task payment';
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
