-- =====================================================================
-- 29_task_payment_workflow.sql
-- =====================================================================
-- Feature: some tasks have a payment attached to them (e.g. a vendor
-- invoice, a contractor fee) that has to be settled by higher
-- management (Super Admin / Chief Officer) AFTER the normal approval
-- sign-off, before the task can be considered truly complete.
--
-- New flow for a payment-linked task:
--   todo -> in_progress -> in_review -> [approved] -> pending_payment
--     -> [higher management confirms payment] -> completed
-- Non-payment tasks are completely unaffected: [approved] -> completed,
-- same as today.
--
-- IMPORTANT — run this in two steps if your SQL editor errors with
-- "unsafe use of new value of enum type":
--   Step A: run ONLY the first statement below (ALTER TYPE ... ADD
--           VALUE) by itself, then run it again.
--   Step B: run the rest of the file.
-- This is a known Postgres restriction (a brand-new enum value can't
-- be referenced later in the very same transaction it was added in,
-- in some editor/session configurations) — not a bug in this
-- migration. Everything below Step A is idempotent, so re-running the
-- whole file after Step A already succeeded is safe.
--
-- Run this once, after 28_task_display_id.sql, in the Supabase SQL
-- editor.
-- =====================================================================

alter type task_status add value if not exists 'pending_payment';

-- ---------------------------------------------------------------------
-- 1. Payment columns on tasks.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_payment_status') then
    create type task_payment_status as enum ('not_applicable', 'pending', 'paid');
  end if;
end $$;

alter table public.tasks add column if not exists requires_payment boolean not null default false;
alter table public.tasks add column if not exists payment_amount numeric(12,2);
alter table public.tasks add column if not exists payment_status task_payment_status not null default 'not_applicable';
alter table public.tasks add column if not exists payment_confirmed_by uuid references public.users(id) on delete set null;
alter table public.tasks add column if not exists payment_confirmed_at timestamptz;
alter table public.tasks add column if not exists payment_notes text;

create index if not exists idx_tasks_payment_status on public.tasks(payment_status);

-- Keeps requires_payment/payment_status from drifting apart no matter
-- which code path writes to them (TaskModal create/edit, the RPCs
-- below, or a future admin tool): flipping requires_payment off always
-- resets payment_status to not_applicable, and turning it on seeds
-- payment_status to 'pending' if it was sitting at not_applicable.
create or replace function public.trg_tasks_payment_consistency()
returns trigger language plpgsql as $$
begin
  if new.requires_payment then
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

drop trigger if exists trg_tasks_payment_consistency on public.tasks;
create trigger trg_tasks_payment_consistency
  before insert or update of requires_payment, payment_status on public.tasks
  for each row execute function public.trg_tasks_payment_consistency();

-- ---------------------------------------------------------------------
-- 2. decide_task_approval() — approving a payment-linked task now
--    lands on 'pending_payment' instead of 'completed'. Rejected path
--    is unchanged. completed_date only stamps when the task is
--    ACTUALLY done (i.e. approved AND no payment pending).
--
--    Bare column names on the right of SET refer to the pre-update row
--    (requires_payment here), so this reads the task's own flag
--    without an extra lookup.
-- ---------------------------------------------------------------------
create or replace function public.decide_task_approval(p_task_id uuid, p_decision approval_status, p_comment text default null)
returns public.tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_role user_role;
  v_dept text;
  v_can_approve boolean;
  v_task_dept text;
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
        status = (case
                    when p_decision = 'approved' and requires_payment then 'pending_payment'
                    when p_decision = 'approved' then 'completed'
                    else 'in_progress'
                  end)::task_status,
        completed_date = case
                    when p_decision = 'approved' and not requires_payment then current_date
                    else completed_date
                  end
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

-- ---------------------------------------------------------------------
-- 3. confirm_task_payment() — the "higher management" step. Only
--    Super Admin / Chief Officer can call this (role check inside the
--    function, same style as decide_task_approval — not left to table
--    RLS, since Chief Officer isn't in tasks_update's policy today and
--    shouldn't need to be for this one specific action).
--
--    Guarded so it only fires for tasks genuinely awaiting payment —
--    calling it on a task that isn't requires_payment/pending is a
--    no-op-with-error, not a silent overwrite.
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
