-- =====================================================================
-- 91_new_feature_tests.sql — regression tests for this session's new
-- features: subtasks + auto-progress (27), task_display_id (28),
-- payment-linked approval (29), assigned_by_id + tasks_completed (30).
--
-- Run via psql -v ON_ERROR_STOP=1 — a FAIL raises and stops the run
-- right at the failing assertion; a clean run prints one PASS per
-- test. Not a replacement for the project's full 27-test RLS suite —
-- this file only covers what's new since that suite was last run.
-- =====================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------
-- Fixture: one Engineering task, created by the Eng Dept Head,
-- assigned to staff.eng.
-- ---------------------------------------------------------------------
call public.test_act_as('depthead.eng@test.local');

insert into public.tasks (title, department, assignee_id, created_by_id, start_date, due_date)
values (
  'Ship the new dashboard',
  'Engineering',
  (select id from public.users where email = 'staff.eng@test.local'),
  (select id from public.users where email = 'depthead.eng@test.local'),
  current_date, current_date + 7
);

call public.test_reset_role();

do $$
declare v_task_id uuid; v_display_id text; v_progress int;
begin
  select id, task_display_id, progress into v_task_id, v_display_id, v_progress
    from public.tasks where title = 'Ship the new dashboard';
  perform public.assert_true(v_task_id is not null, 'fixture task was created');
  perform public.assert_true(v_display_id ~ '^ENG-\d{4}$', format('task_display_id is ENG-#### (got %s)', v_display_id));
  perform public.assert_true(v_progress = 0, 'fresh task with no subtasks keeps its manual progress (0)');
end $$;

-- =====================================================================
-- 27_task_subtasks.sql
-- =====================================================================

-- Test 1: assignee can add a subtask to their own task.
call public.test_act_as('staff.eng@test.local');
do $$
declare v_task_id uuid;
begin
  select id into v_task_id from public.tasks where title = 'Ship the new dashboard';
  insert into public.task_subtasks (task_id, title, created_by_id)
  values (v_task_id, 'Wire up the API', (select id from public.users where email = 'staff.eng@test.local'));
  insert into public.task_subtasks (task_id, title, created_by_id)
  values (v_task_id, 'Build the chart component', (select id from public.users where email = 'staff.eng@test.local'));
end $$;
call public.test_reset_role();

do $$
declare v_count int;
begin
  select count(*) into v_count from public.task_subtasks
    where task_id = (select id from public.tasks where title = 'Ship the new dashboard');
  perform public.assert_true(v_count = 2, 'assignee successfully added 2 subtasks');
end $$;

-- Test 2: someone outside the task (different dept, not assignee/creator,
-- no canEditAllTasks) CANNOT add a subtask.
call public.test_act_as('staff.mar@test.local');
do $$
declare v_task_id uuid; v_failed boolean := false;
begin
  select id into v_task_id from public.tasks where title = 'Ship the new dashboard';
  begin
    insert into public.task_subtasks (task_id, title, created_by_id)
    values (v_task_id, 'Should not be allowed', (select id from public.users where email = 'staff.mar@test.local'));
  exception when insufficient_privilege or others then
    v_failed := true;
  end;
  perform public.assert_true(v_failed, 'unrelated staff cannot add a subtask to someone else''s task (RLS blocks it)');
end $$;
call public.test_reset_role();

-- Test 3: viewer cannot add a subtask even to a task they can see.
call public.test_act_as('viewer@test.local');
do $$
declare v_task_id uuid; v_failed boolean := false;
begin
  select id into v_task_id from public.tasks where title = 'Ship the new dashboard';
  begin
    insert into public.task_subtasks (task_id, title, created_by_id)
    values (v_task_id, 'Viewer should not be able to do this', (select id from public.users where email = 'viewer@test.local'));
  exception when insufficient_privilege or others then
    v_failed := true;
  end;
  perform public.assert_true(v_failed, 'viewer role cannot write a subtask (read-only enforced)');
end $$;
call public.test_reset_role();

-- Test 4: auto-progress — 0 of 2 done -> 0%, 1 of 2 -> 50%, 2 of 2 -> 100%.
do $$
declare v_task_id uuid; v_progress int; v_sub1 uuid; v_sub2 uuid;
begin
  select id into v_task_id from public.tasks where title = 'Ship the new dashboard';
  select id into v_sub1 from public.task_subtasks where task_id = v_task_id and title = 'Wire up the API';
  select id into v_sub2 from public.task_subtasks where task_id = v_task_id and title = 'Build the chart component';

  select progress into v_progress from public.tasks where id = v_task_id;
  perform public.assert_true(v_progress = 0, 'progress is 0% with 0 of 2 subtasks done');

  update public.task_subtasks set is_completed = true where id = v_sub1;
  select progress into v_progress from public.tasks where id = v_task_id;
  perform public.assert_true(v_progress = 50, format('progress is 50%% with 1 of 2 subtasks done (got %s)', v_progress));

  update public.task_subtasks set is_completed = true where id = v_sub2;
  select progress into v_progress from public.tasks where id = v_task_id;
  perform public.assert_true(v_progress = 100, format('progress is 100%% with 2 of 2 subtasks done (got %s)', v_progress));
end $$;

-- Test 5: completion stamps completed_at/completed_by (with WHO did it —
-- needs an authenticated actor, current_app_user() is null for the
-- postgres superuser test-runner), and unchecking clears them.
call public.test_act_as('staff.eng@test.local');
do $$
declare v_sub1 uuid; v_completed_at timestamptz; v_completed_by uuid;
begin
  select id into v_sub1 from public.task_subtasks
    where task_id = (select id from public.tasks where title = 'Ship the new dashboard') and title = 'Wire up the API';

  -- Test 4 already completed this one (as the postgres test-runner, no
  -- app-user context) — reset it first so the false->true transition
  -- we're actually testing here happens under staff.eng's identity.
  update public.task_subtasks set is_completed = false where id = v_sub1;
  update public.task_subtasks set is_completed = true where id = v_sub1;

  select completed_at, completed_by into v_completed_at, v_completed_by from public.task_subtasks where id = v_sub1;
  perform public.assert_true(v_completed_at is not null and v_completed_by is not null, 'completing a subtask stamps completed_at/completed_by');

  update public.task_subtasks set is_completed = false where id = v_sub1;
  select completed_at, completed_by into v_completed_at, v_completed_by from public.task_subtasks where id = v_sub1;
  perform public.assert_true(v_completed_at is null and v_completed_by is null, 'un-completing a subtask clears completed_at/completed_by');

  -- restore both to completed for later assertions to stay consistent
  update public.task_subtasks set is_completed = true
    where task_id = (select id from public.tasks where title = 'Ship the new dashboard');
end $$;
call public.test_reset_role();

-- Test 6: deleting a subtask recalculates progress (2 of 2 -> delete
-- one incomplete one out of a fresh pair -> should not go stale).
do $$
declare v_task_id uuid; v_sub3 uuid; v_progress int;
begin
  select id into v_task_id from public.tasks where title = 'Ship the new dashboard';
  insert into public.task_subtasks (task_id, title, created_by_id)
    values (v_task_id, 'Extra step (will be deleted)', (select id from public.users where email = 'staff.eng@test.local'))
    returning id into v_sub3;

  select progress into v_progress from public.tasks where id = v_task_id;
  perform public.assert_true(v_progress = 66 or v_progress = 67, format('progress recalculated to ~2/3 after adding an incomplete 3rd subtask (got %s)', v_progress));

  delete from public.task_subtasks where id = v_sub3;
  select progress into v_progress from public.tasks where id = v_task_id;
  perform public.assert_true(v_progress = 100, format('progress back to 100%% after deleting the incomplete extra subtask (got %s)', v_progress));
end $$;

-- Test 7: an attachment's subtask_id must belong to the same task_id.
do $$
declare v_task_id uuid; v_other_task_id uuid; v_sub1 uuid; v_failed boolean := false;
begin
  select id into v_task_id from public.tasks where title = 'Ship the new dashboard';
  select id into v_sub1 from public.task_subtasks where task_id = v_task_id limit 1;

  insert into public.tasks (title, department, assignee_id, created_by_id, start_date, due_date)
  values ('Unrelated task', 'Engineering',
    (select id from public.users where email = 'staff.eng@test.local'),
    (select id from public.users where email = 'depthead.eng@test.local'),
    current_date, current_date + 3)
  returning id into v_other_task_id;

  begin
    insert into public.task_attachments (task_id, subtask_id, uploaded_by, kind, url)
    values (v_other_task_id, v_sub1, (select id from public.users where email = 'depthead.eng@test.local'), 'link', 'https://example.com');
  exception when others then
    v_failed := true;
  end;
  perform public.assert_true(v_failed, 'attachment insert rejected when subtask_id belongs to a different task_id');
end $$;

-- =====================================================================
-- 28_task_display_id.sql
-- =====================================================================

-- Test 8: sequential tasks in the same department get sequential codes.
do $$
declare v_first text; v_second text; v_first_n int; v_second_n int;
begin
  insert into public.tasks (title, department, assignee_id, created_by_id, start_date, due_date)
  values ('Sequential A', 'Marketing',
    (select id from public.users where email = 'staff.mar@test.local'),
    (select id from public.users where email = 'depthead.mar@test.local'),
    current_date, current_date + 3)
  returning task_display_id into v_first;

  insert into public.tasks (title, department, assignee_id, created_by_id, start_date, due_date)
  values ('Sequential B', 'Marketing',
    (select id from public.users where email = 'staff.mar@test.local'),
    (select id from public.users where email = 'depthead.mar@test.local'),
    current_date, current_date + 3)
  returning task_display_id into v_second;

  perform public.assert_true(v_first ~ '^MAR-\d{4}$' and v_second ~ '^MAR-\d{4}$', 'both Marketing tasks got MAR-#### ids');

  v_first_n := split_part(v_first, '-', 2)::int;
  v_second_n := split_part(v_second, '-', 2)::int;
  perform public.assert_true(v_second_n = v_first_n + 1, format('sequence incremented by exactly 1 (%s -> %s)', v_first_n, v_second_n));
end $$;

-- Test 9: task_display_id is globally unique (constraint-level check).
do $$
declare v_dupe_failed boolean := false;
begin
  begin
    update public.tasks set task_display_id = (select task_display_id from public.tasks where title = 'Sequential A')
      where title = 'Sequential B';
  exception when unique_violation then
    v_dupe_failed := true;
  end;
  perform public.assert_true(v_dupe_failed, 'task_display_id unique constraint rejects a manual duplicate');
end $$;

-- =====================================================================
-- 29_task_payment_workflow.sql
-- =====================================================================

-- Test 10: approving a NON-payment task completes it directly, as before.
do $$
declare v_task_id uuid; v_status task_status; v_completed_date date;
begin
  select id into v_task_id from public.tasks where title = 'Ship the new dashboard';
  update public.tasks set status = 'in_review' where id = v_task_id;
end $$;

call public.test_act_as('depthead.eng@test.local');
select public.decide_task_approval(
  (select id from public.tasks where title = 'Ship the new dashboard'),
  'approved', 'Looks solid, ship it.'
);
call public.test_reset_role();

do $$
declare v_status task_status; v_completed_date date;
begin
  select status, completed_date into v_status, v_completed_date from public.tasks where title = 'Ship the new dashboard';
  perform public.assert_true(v_status = 'completed', format('non-payment task goes straight to completed on approval (got %s)', v_status));
  perform public.assert_true(v_completed_date is not null, 'completed_date stamped for a non-payment approval');
end $$;

-- Test 11: approving a PAYMENT-linked task lands on pending_payment, not completed.
do $$
declare v_task_id uuid;
begin
  insert into public.tasks (title, department, assignee_id, created_by_id, start_date, due_date, requires_payment, payment_amount, status)
  values ('Pay the design vendor', 'Engineering',
    (select id from public.users where email = 'staff.eng@test.local'),
    (select id from public.users where email = 'depthead.eng@test.local'),
    current_date, current_date + 3, true, 1500.00, 'in_review')
  returning id into v_task_id;
end $$;

call public.test_act_as('depthead.eng@test.local');
select public.decide_task_approval(
  (select id from public.tasks where title = 'Pay the design vendor'),
  'approved', 'Approved, just needs payment now.'
);
call public.test_reset_role();

do $$
declare v_status task_status; v_payment_status task_payment_status; v_completed_date date;
begin
  select status, payment_status, completed_date into v_status, v_payment_status, v_completed_date
    from public.tasks where title = 'Pay the design vendor';
  perform public.assert_true(v_status = 'pending_payment', format('payment-linked task lands on pending_payment after approval (got %s)', v_status));
  perform public.assert_true(v_payment_status = 'pending', 'payment_status is pending after approval');
  perform public.assert_true(v_completed_date is null, 'completed_date stays NULL until payment is confirmed');
end $$;

-- Test 12: a staff member (not higher management) cannot confirm payment.
call public.test_act_as('staff.eng@test.local');
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.confirm_task_payment((select id from public.tasks where title = 'Pay the design vendor'), 'trying anyway');
  exception when others then
    v_failed := true;
  end;
  perform public.assert_true(v_failed, 'staff cannot call confirm_task_payment (higher-management-only check inside the function)');
end $$;
call public.test_reset_role();

-- Test 13: Chief Officer (higher management) CAN confirm payment -> task completes.
call public.test_act_as('chief@test.local');
select public.confirm_task_payment((select id from public.tasks where title = 'Pay the design vendor'), 'Wired the payment today.');
call public.test_reset_role();

do $$
declare v_status task_status; v_payment_status task_payment_status; v_completed_date date; v_confirmed_by uuid;
begin
  select status, payment_status, completed_date, payment_confirmed_by into v_status, v_payment_status, v_completed_date, v_confirmed_by
    from public.tasks where title = 'Pay the design vendor';
  perform public.assert_true(v_status = 'completed', 'task completes once Chief Officer confirms payment');
  perform public.assert_true(v_payment_status = 'paid', 'payment_status flips to paid');
  perform public.assert_true(v_completed_date is not null, 'completed_date stamped once payment confirmed');
  perform public.assert_true(v_confirmed_by = (select id from public.users where email = 'chief@test.local'), 'payment_confirmed_by records who confirmed it');
end $$;

-- Test 14: confirm_task_payment on a task that isn't awaiting payment is a clean no-op-with-error.
call public.test_act_as('chief@test.local');
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.confirm_task_payment((select id from public.tasks where title = 'Ship the new dashboard'), null);
  exception when others then
    v_failed := true;
  end;
  perform public.assert_true(v_failed, 'confirm_task_payment refuses a task that is not requires_payment+pending');
end $$;
call public.test_reset_role();

-- Test 15: requires_payment consistency trigger — flipping it off resets payment_status.
do $$
declare v_task_id uuid; v_payment_status task_payment_status;
begin
  insert into public.tasks (title, department, assignee_id, created_by_id, start_date, due_date, requires_payment)
  values ('Consistency check task', 'Engineering',
    (select id from public.users where email = 'staff.eng@test.local'),
    (select id from public.users where email = 'depthead.eng@test.local'),
    current_date, current_date + 3, true)
  returning id into v_task_id;

  select payment_status into v_payment_status from public.tasks where id = v_task_id;
  perform public.assert_true(v_payment_status = 'pending', 'requires_payment=true seeds payment_status=pending automatically');

  update public.tasks set requires_payment = false where id = v_task_id;
  select payment_status into v_payment_status from public.tasks where id = v_task_id;
  perform public.assert_true(v_payment_status = 'not_applicable', 'turning requires_payment off resets payment_status to not_applicable');
end $$;

-- =====================================================================
-- 30_assigned_by_and_completed_counter.sql
-- =====================================================================

-- Test 16: tasks_completed increments when a task becomes completed.
do $$
declare v_before int; v_after int;
begin
  select tasks_completed into v_before from public.users where email = 'staff.eng2@test.local';

  insert into public.tasks (title, department, assignee_id, created_by_id, start_date, due_date, status)
  values ('Counter check task', 'Engineering',
    (select id from public.users where email = 'staff.eng2@test.local'),
    (select id from public.users where email = 'depthead.eng@test.local'),
    current_date, current_date + 3, 'in_progress');

  update public.tasks set status = 'completed', completed_date = current_date where title = 'Counter check task';

  select tasks_completed into v_after from public.users where email = 'staff.eng2@test.local';
  perform public.assert_true(v_after = v_before + 1, format('tasks_completed incremented by 1 (%s -> %s)', v_before, v_after));
end $$;

-- Test 17: reopening a completed task decrements the counter back.
do $$
declare v_before int; v_after int;
begin
  select tasks_completed into v_before from public.users where email = 'staff.eng2@test.local';
  update public.tasks set status = 'in_progress' where title = 'Counter check task';
  select tasks_completed into v_after from public.users where email = 'staff.eng2@test.local';
  perform public.assert_true(v_after = v_before - 1, format('tasks_completed decremented by 1 on reopen (%s -> %s)', v_before, v_after));
end $$;

-- Test 18: reassigning an already-completed task moves the credit.
do $$
declare v_before_old int; v_after_old int; v_before_new int; v_after_new int;
begin
  update public.tasks set status = 'completed', completed_date = current_date where title = 'Counter check task';

  select tasks_completed into v_before_old from public.users where email = 'staff.eng2@test.local';
  select tasks_completed into v_before_new from public.users where email = 'staff.eng@test.local';

  update public.tasks set assignee_id = (select id from public.users where email = 'staff.eng@test.local')
    where title = 'Counter check task';

  select tasks_completed into v_after_old from public.users where email = 'staff.eng2@test.local';
  select tasks_completed into v_after_new from public.users where email = 'staff.eng@test.local';

  perform public.assert_true(v_after_old = v_before_old - 1, 'old assignee loses the completed-task credit on reassignment');
  perform public.assert_true(v_after_new = v_before_new + 1, 'new assignee gains the completed-task credit on reassignment');
end $$;

-- Test 19: a Staff member CAN self-log a task for themselves (fixed by
-- 31_staff_self_log_tasks.sql — the harness caught this policy gap:
-- tasks_insert previously had no path for 'staff' at all), and
-- assigned_by_id records who verbally instructed it.
call public.test_act_as('staff.eng@test.local');
do $$
declare v_self_id uuid; v_dept_head_id uuid;
begin
  select id into v_self_id from public.users where email = 'staff.eng@test.local';
  select id into v_dept_head_id from public.users where email = 'depthead.eng@test.local';

  insert into public.tasks (title, department, assignee_id, created_by_id, assigned_by_id, start_date, due_date)
  values ('Self-logged task', 'Engineering', v_self_id, v_self_id, v_dept_head_id, current_date, current_date + 2);
end $$;
call public.test_reset_role();

do $$
declare v_assigned_by uuid;
begin
  select assigned_by_id into v_assigned_by from public.tasks where title = 'Self-logged task';
  perform public.assert_true(v_assigned_by = (select id from public.users where email = 'depthead.eng@test.local'), 'assigned_by_id correctly records the instructing dept head on a self-logged task');
end $$;

-- Test 19b: a Staff member still CANNOT self-log a task assigned to
-- someone ELSE (the policy only opens the door for a genuine self-log,
-- assignee_id = created_by_id = self — not a backdoor to assigning
-- other people's work).
call public.test_act_as('staff.eng@test.local');
do $$
declare v_self_id uuid; v_other_id uuid; v_failed boolean := false;
begin
  select id into v_self_id from public.users where email = 'staff.eng@test.local';
  select id into v_other_id from public.users where email = 'staff.eng2@test.local';
  begin
    insert into public.tasks (title, department, assignee_id, created_by_id, start_date, due_date)
    values ('Staff should not be able to assign this to someone else', 'Engineering', v_other_id, v_self_id, current_date, current_date + 2);
  exception when insufficient_privilege or others then
    v_failed := true;
  end;
  perform public.assert_true(v_failed, 'staff self-log policy does not allow assigning a task to someone else');
end $$;
call public.test_reset_role();

-- Test 21 (was 20): tasks_completed backfill is accurate for the whole
-- table (re-derive independently and compare, catching any drift the
-- trigger-based approach might have introduced across every test above).
do $$
declare v_mismatch_count int;
begin
  select count(*) into v_mismatch_count
  from public.users u
  where u.tasks_completed <> (
    select count(*) from public.tasks t where t.assignee_id = u.id and t.status = 'completed'
  );
  perform public.assert_true(v_mismatch_count = 0, format('tasks_completed matches real completed-task counts for every user (%s mismatches)', v_mismatch_count));
end $$;

-- Test 22: Chief Officer can now create/assign a task in a department
-- that isn't their own (32_chief_officer_cross_dept_tasks.sql).
call public.test_act_as('chief@test.local');
do $$
declare v_task_id uuid; v_dept text;
begin
  insert into public.tasks (title, department, assignee_id, created_by_id, start_date, due_date)
  values ('Cross-dept task by Chief Officer', 'Marketing',
    (select id from public.users where email = 'staff.mar@test.local'),
    (select id from public.users where email = 'chief@test.local'),
    current_date, current_date + 3)
  returning id, department into v_task_id, v_dept;
  perform public.assert_true(v_dept = 'Marketing', 'Chief Officer successfully created a task in a department other than their own');
end $$;
call public.test_reset_role();

-- =====================================================================
-- 33_task_reminders_and_alarms.sql
-- =====================================================================

-- Test 23: send_deadline_reminders() creates a 'deadline' notification
-- for the ASSIGNEE of a task due in exactly 3 days.
do $$
declare v_task_id uuid; v_assignee uuid;
begin
  select id into v_assignee from public.users where email = 'staff.eng@test.local';
  insert into public.tasks (title, department, assignee_id, created_by_id, start_date, due_date, status)
  values ('3-day reminder task', 'Engineering', v_assignee,
    (select id from public.users where email = 'depthead.eng@test.local'),
    current_date, current_date + 3, 'in_progress')
  returning id into v_task_id;

  perform public.send_deadline_reminders();

  perform public.assert_true(
    exists(select 1 from public.notifications where task_id = v_task_id and type = 'deadline' and user_id = v_assignee and urgency = 'medium'),
    '3-day reminder creates a deadline notification for the real assignee'
  );
end $$;

-- Test 24: running it again immediately does NOT duplicate (dedup via task_reminder_log).
do $$
declare v_task_id uuid; v_count int;
begin
  select id into v_task_id from public.tasks where title = '3-day reminder task';
  perform public.send_deadline_reminders();
  select count(*) into v_count from public.notifications where task_id = v_task_id and type = 'deadline';
  perform public.assert_true(v_count = 1, format('3-day reminder is not duplicated on a second run (count=%s)', v_count));
end $$;

-- Test 25: a task due in exactly 1 day gets a 'high' urgency reminder.
do $$
declare v_task_id uuid; v_assignee uuid;
begin
  select id into v_assignee from public.users where email = 'staff.eng2@test.local';
  insert into public.tasks (title, department, assignee_id, created_by_id, start_date, due_date, status)
  values ('1-day reminder task', 'Engineering', v_assignee,
    (select id from public.users where email = 'depthead.eng@test.local'),
    current_date, current_date + 1, 'in_progress')
  returning id into v_task_id;

  perform public.send_deadline_reminders();

  perform public.assert_true(
    exists(select 1 from public.notifications where task_id = v_task_id and type = 'deadline' and user_id = v_assignee and urgency = 'high'),
    '1-day reminder creates a high-urgency deadline notification for the real assignee'
  );
end $$;

-- Test 26: Dept Head can ring an alarm for a task in their own department.
call public.test_act_as('depthead.eng@test.local');
do $$
declare v_task_id uuid;
begin
  select id into v_task_id from public.tasks where title = 'Ship the new dashboard';
  perform public.ring_task_alarm(v_task_id);
end $$;
call public.test_reset_role();

-- Assertion runs as the postgres test-runner (not the dept_head), since
-- notifications RLS correctly restricts reading a notification to its
-- own target user — the dept_head who triggered it can't read the
-- assignee's copy back, same as any other user's private notification.
do $$
declare v_task_id uuid; v_assignee uuid;
begin
  select id, assignee_id into v_task_id, v_assignee from public.tasks where title = 'Ship the new dashboard';
  perform public.assert_true(
    exists(select 1 from public.notifications where task_id = v_task_id and type = 'alarm' and user_id = v_assignee),
    'Dept Head can ring an alarm for a task in their own department'
  );
end $$;

-- Test 27: Dept Head CANNOT ring an alarm for a task outside their department.
call public.test_act_as('depthead.eng@test.local');
do $$
declare v_task_id uuid; v_failed boolean := false;
begin
  select id into v_task_id from public.tasks where title = 'Sequential A'; -- Marketing dept task
  begin
    perform public.ring_task_alarm(v_task_id);
  exception when others then
    v_failed := true;
  end;
  perform public.assert_true(v_failed, 'Dept Head cannot ring an alarm for a task outside their department');
end $$;
call public.test_reset_role();

-- Test 28: Staff cannot ring an alarm at all.
call public.test_act_as('staff.eng@test.local');
do $$
declare v_task_id uuid; v_failed boolean := false;
begin
  select id into v_task_id from public.tasks where title = 'Ship the new dashboard';
  begin
    perform public.ring_task_alarm(v_task_id);
  exception when others then
    v_failed := true;
  end;
  perform public.assert_true(v_failed, 'Staff cannot ring a task alarm (upper-level-only action)');
end $$;
call public.test_reset_role();

-- Test 29: cooldown — ringing the same task twice within 15 minutes is rejected.
call public.test_act_as('depthead.eng@test.local');
do $$
declare v_task_id uuid; v_failed boolean := false;
begin
  select id into v_task_id from public.tasks where title = 'Ship the new dashboard'; -- already rung in test 26
  begin
    perform public.ring_task_alarm(v_task_id);
  exception when others then
    v_failed := true;
  end;
  perform public.assert_true(v_failed, 'ringing the same task again inside the 15-minute cooldown is rejected');
end $$;
call public.test_reset_role();

-- Test 30: Chief Officer CAN ring an alarm cross-department (matches
-- their cross-department task-creation reach from migration 32).
call public.test_act_as('chief@test.local');
do $$
declare v_task_id uuid;
begin
  select id into v_task_id from public.tasks where title = 'Sequential A'; -- Marketing dept task
  perform public.ring_task_alarm(v_task_id);
end $$;
call public.test_reset_role();

do $$
declare v_task_id uuid; v_assignee uuid;
begin
  select id, assignee_id into v_task_id, v_assignee from public.tasks where title = 'Sequential A';
  perform public.assert_true(
    exists(select 1 from public.notifications where task_id = v_task_id and type = 'alarm' and user_id = v_assignee),
    'Chief Officer can ring an alarm cross-department'
  );
end $$;

-- =====================================================================
-- 34_audit_fixes_delete_policy_and_search_path.sql
-- =====================================================================

-- Test 31: Super Admin can now actually delete a task (previously
-- silently matched 0 rows — no tasks_delete policy existed at all).
do $$
declare v_task_id uuid;
begin
  insert into public.tasks (title, department, assignee_id, created_by_id, start_date, due_date)
  values ('Deletable by super admin', 'Engineering',
    (select id from public.users where email = 'staff.eng@test.local'),
    (select id from public.users where email = 'depthead.eng@test.local'),
    current_date, current_date + 3)
  returning id into v_task_id;
end $$;

call public.test_act_as('super@test.local');
do $$
begin
  delete from public.tasks where title = 'Deletable by super admin';
end $$;
call public.test_reset_role();

do $$
begin
  perform public.assert_true(
    not exists(select 1 from public.tasks where title = 'Deletable by super admin'),
    'Super Admin can now actually delete a task (tasks_delete policy fix)'
  );
end $$;

-- Test 32: a Dept Head CANNOT delete a task outside their own department.
do $$
declare v_marketing_task_id uuid;
begin
  select id into v_marketing_task_id from public.tasks where title = 'Sequential A'; -- Marketing dept
  perform set_config('app.audit_test_marketing_task_id', v_marketing_task_id::text, false);
end $$;

call public.test_act_as('depthead.eng@test.local');
do $$
begin
  delete from public.tasks where id = current_setting('app.audit_test_marketing_task_id')::uuid;
end $$;
call public.test_reset_role();

-- Checked as the postgres test-runner (dept_head.eng can't even SELECT
-- a Marketing task in the first place — tasks_select correctly hides
-- it — so the id has to come from, and be verified by, a role that can
-- actually see it).
do $$
begin
  perform public.assert_true(
    exists(select 1 from public.tasks where title = 'Sequential A'),
    'Dept Head cannot delete a task outside their own department'
  );
end $$;

-- Test 33: an unrelated Staff member can no longer call the internal
-- recalc_task_progress_from_subtasks() helper directly (search_path /
-- public-execute lockdown) — this was proven exploitable before the
-- fix (RLS-bypassing write via a SECURITY DEFINER function anyone
-- could call).
call public.test_act_as('staff.mar@test.local');
do $$
declare v_task_id uuid; v_failed boolean := false;
begin
  select id into v_task_id from public.tasks where title = 'Ship the new dashboard'; -- not staff.mar's task
  begin
    perform public.recalc_task_progress_from_subtasks(v_task_id);
  exception when others then
    v_failed := true;
  end;
  perform public.assert_true(v_failed, 'unrelated staff can no longer call recalc_task_progress_from_subtasks() directly');
end $$;
call public.test_reset_role();

-- Test 34: legitimate client-facing RPCs are still callable after the
-- execute lockdown (spot-check one that every role uses).
call public.test_act_as('staff.eng@test.local');
do $$
declare v_result record; v_failed boolean := false;
begin
  begin
    select * into v_result from public.log_audit_event('audit.smoke_test', 'task', 'n/a', '', 'success');
  exception when others then
    v_failed := true;
  end;
  perform public.assert_true(not v_failed, 'legitimate client-facing RPCs (log_audit_event) remain callable after the execute lockdown');
end $$;
call public.test_reset_role();

-- Test 35: a user can still flip their own notification's `read` flag
-- (column-level grant didn't accidentally break the one thing it's
-- supposed to still allow).
call public.test_act_as('staff.eng@test.local');
do $$
declare v_notif_id uuid; v_failed boolean := false;
begin
  select id into v_notif_id from public.notifications where user_id = (select id from public.users where email = 'staff.eng@test.local') limit 1;
  if v_notif_id is not null then
    begin
      update public.notifications set read = true where id = v_notif_id;
    exception when others then
      v_failed := true;
    end;
    perform public.assert_true(not v_failed, 'a user can still mark their own notification as read');
  else
    perform public.assert_true(true, 'a user can still mark their own notification as read (skipped — none seeded)');
  end if;
end $$;
call public.test_reset_role();

-- Test 36: a user CANNOT rewrite the content of their own notification
-- (only `read` is grantable now — everything else on an UPDATE is
-- column-privilege-denied).
call public.test_act_as('staff.eng@test.local');
do $$
declare v_notif_id uuid; v_failed boolean := false;
begin
  select id into v_notif_id from public.notifications where user_id = (select id from public.users where email = 'staff.eng@test.local') limit 1;
  if v_notif_id is not null then
    begin
      update public.notifications set title = 'forged title' where id = v_notif_id;
    exception when others then
      v_failed := true;
    end;
    perform public.assert_true(v_failed, 'a user cannot rewrite the title/content of their own notification');
  else
    perform public.assert_true(true, 'a user cannot rewrite notification content (skipped — none seeded)');
  end if;
end $$;
call public.test_reset_role();

-- Test 37: anon (unauthenticated) sees zero rows anywhere, despite
-- table-level grants existing — RLS is the real gate.
call public.test_act_as_anon();
do $$
declare v_count int;
begin
  select count(*) into v_count from public.tasks;
  perform public.assert_true(v_count = 0, 'anon role sees zero tasks despite table grants (RLS holds)');
end $$;
call public.test_reset_role();

-- Test 38: payment_amount cannot be negative (DB-level constraint,
-- not just the client's bypassable min={0}).
do $$
declare v_failed boolean := false;
begin
  begin
    insert into public.tasks (title, department, assignee_id, created_by_id, start_date, due_date, requires_payment, payment_amount)
    values ('Negative payment test', 'Engineering',
      (select id from public.users where email = 'staff.eng@test.local'),
      (select id from public.users where email = 'depthead.eng@test.local'),
      current_date, current_date + 3, true, -500);
  exception when others then
    v_failed := true;
  end;
  perform public.assert_true(v_failed, 'a negative payment_amount is rejected at the DB level');
end $$;

-- =====================================================================
-- 36_backup_restore_covers_new_tables.sql
-- =====================================================================

-- Test 39: full backup -> restore round trip preserves subtasks,
-- department task counters (so new task IDs don't collide), and
-- doesn't double-count tasks_completed.
call public.test_act_as('super@test.local');
do $$
declare
  v_task_id uuid;
  v_backup_id uuid;
  v_subtask_count_before int;
  v_subtask_count_after int;
  v_completed_before int;
  v_completed_after int;
  v_new_task_display_id text;
begin
  -- A task with 2 subtasks (1 done), so progress/auto-calc and the
  -- subtask rows themselves both need to survive the round trip.
  insert into public.tasks (title, department, assignee_id, created_by_id, start_date, due_date, status, completed_date)
  values ('Backup round-trip task', 'Engineering',
    (select id from public.users where email = 'staff.eng@test.local'),
    (select id from public.users where email = 'depthead.eng@test.local'),
    current_date, current_date + 3, 'completed', current_date)
  returning id into v_task_id;

  insert into public.task_subtasks (task_id, title, is_completed, created_by_id)
  values
    (v_task_id, 'Step A', true, (select id from public.users where email = 'super@test.local')),
    (v_task_id, 'Step B', false, (select id from public.users where email = 'super@test.local'));

  select count(*) into v_subtask_count_before from public.task_subtasks;
  select tasks_completed into v_completed_before from public.users where email = 'staff.eng@test.local';

  v_backup_id := public.create_backup('audit test backup');
  perform public.restore_backup(v_backup_id);

  select count(*) into v_subtask_count_after from public.task_subtasks;
  select tasks_completed into v_completed_after from public.users where email = 'staff.eng@test.local';

  perform public.assert_true(v_subtask_count_after = v_subtask_count_before, format('subtasks survive a restore (before=%s, after=%s)', v_subtask_count_before, v_subtask_count_after));
  perform public.assert_true(v_completed_after = v_completed_before, format('tasks_completed is not double-counted by a restore (before=%s, after=%s)', v_completed_before, v_completed_after));

  -- The real-world consequence of a lost counter: creating a new task
  -- right after a restore must NOT collide with an existing display id.
  insert into public.tasks (title, department, assignee_id, created_by_id, start_date, due_date)
  values ('Post-restore task', 'Engineering',
    (select id from public.users where email = 'staff.eng@test.local'),
    (select id from public.users where email = 'depthead.eng@test.local'),
    current_date, current_date + 3)
  returning task_display_id into v_new_task_display_id;

  perform public.assert_true(
    not exists(select 1 from public.tasks where task_display_id = v_new_task_display_id having count(*) > 1),
    format('a new task created after restore gets a unique display id (got %s)', v_new_task_display_id)
  );
end $$;
call public.test_reset_role();

-- department_task_counters is intentionally locked down from direct
-- client access (RLS enabled, zero policies — see 28_task_display_id.sql)
-- so even a super_admin app-role can't SELECT it directly — checking
-- this one via the postgres test-runner instead, same pattern used
-- throughout this suite for tables that aren't meant to be client-
-- readable at all.
do $$
declare v_counter int;
begin
  select next_seq into v_counter from public.department_task_counters where department_name = 'Engineering';
  perform public.assert_true(v_counter is not null and v_counter > 1, format('department_task_counters survived the restore (got %s)', v_counter));
end $$;

-- =====================================================================
-- End-to-end lifecycle scenario (QA pass, 2026-09)
-- =====================================================================
-- Chains together everything in one realistic flow instead of testing
-- each piece in isolation, to catch interaction bugs the isolated
-- assertions above wouldn't: create -> subtasks -> submit -> approve
-- (payment-linked) -> confirm payment -> verify every derived number
-- stays consistent at each step. Then the rejection path separately.

-- ---- Happy path: payment-linked task, full lifecycle ----
call public.test_act_as('depthead.eng@test.local');
do $$
declare v_task_id uuid;
begin
  insert into public.tasks (title, department, assignee_id, created_by_id, start_date, due_date, requires_payment, payment_amount)
  values ('E2E: Vendor invoice task', 'Engineering',
    (select id from public.users where email = 'staff.eng@test.local'),
    (select id from public.users where email = 'depthead.eng@test.local'),
    current_date, current_date + 5, true, 25000.00);
end $$;
call public.test_reset_role();

-- Staff adds 3 subtasks and completes them one at a time, checking
-- progress at every step (not just the start/end).
call public.test_act_as('staff.eng@test.local');
do $$
declare v_task_id uuid; v_sub1 uuid; v_sub2 uuid; v_sub3 uuid; v_progress int;
begin
  select id into v_task_id from public.tasks where title = 'E2E: Vendor invoice task';

  insert into public.task_subtasks (task_id, title, created_by_id) values (v_task_id, 'Get 3 quotes', (select id from public.users where email = 'staff.eng@test.local')) returning id into v_sub1;
  insert into public.task_subtasks (task_id, title, created_by_id) values (v_task_id, 'Pick a vendor', (select id from public.users where email = 'staff.eng@test.local')) returning id into v_sub2;
  insert into public.task_subtasks (task_id, title, created_by_id) values (v_task_id, 'Submit invoice', (select id from public.users where email = 'staff.eng@test.local')) returning id into v_sub3;

  update public.task_subtasks set is_completed = true where id = v_sub1;
  select progress into v_progress from public.tasks where id = v_task_id;
  perform public.assert_true(v_progress = 33, format('E2E: progress at 1/3 subtasks is 33%% (got %s)', v_progress));

  update public.task_subtasks set is_completed = true where id = v_sub2;
  select progress into v_progress from public.tasks where id = v_task_id;
  perform public.assert_true(v_progress = 67, format('E2E: progress at 2/3 subtasks is 67%% (got %s)', v_progress));

  update public.task_subtasks set is_completed = true where id = v_sub3;
  select progress into v_progress from public.tasks where id = v_task_id;
  perform public.assert_true(v_progress = 100, format('E2E: progress at 3/3 subtasks is 100%% (got %s)', v_progress));

  perform public.submit_task_for_approval(v_task_id, 'All subtasks done, ready for review.');
end $$;
call public.test_reset_role();

do $$
declare v_status task_status;
begin
  select status into v_status from public.tasks where title = 'E2E: Vendor invoice task';
  perform public.assert_true(v_status = 'pending_approval', format('E2E: submitting for approval moves status to pending_approval (got %s)', v_status));
end $$;

-- Dept Head approves — payment-linked, so it must land on
-- pending_payment, NOT completed, and tasks_completed must NOT have
-- incremented yet (the work is done, but the task itself isn't).
call public.test_act_as('depthead.eng@test.local');
do $$
declare v_task_id uuid;
begin
  select id into v_task_id from public.tasks where title = 'E2E: Vendor invoice task';
  perform public.decide_task_approval(v_task_id, 'approved', 'Looks good, just needs payment.');
end $$;
call public.test_reset_role();

do $$
declare v_status task_status; v_payment_status task_payment_status; v_completed_before int;
begin
  select status, payment_status into v_status, v_payment_status from public.tasks where title = 'E2E: Vendor invoice task';
  perform public.assert_true(v_status = 'pending_payment', format('E2E: approving a payment-linked task lands on pending_payment (got %s)', v_status));
  perform public.assert_true(v_payment_status = 'pending', 'E2E: payment_status is pending after approval');

  select tasks_completed into v_completed_before from public.users where email = 'staff.eng@test.local';
  perform set_config('app.e2e_completed_before', v_completed_before::text, false);
end $$;

-- Chief Officer confirms payment — NOW it's really done.
call public.test_act_as('chief@test.local');
do $$
declare v_task_id uuid;
begin
  select id into v_task_id from public.tasks where title = 'E2E: Vendor invoice task';
  perform public.confirm_task_payment(v_task_id, 'Bank transfer completed 2026-09-05.');
end $$;
call public.test_reset_role();

do $$
declare v_status task_status; v_payment_status task_payment_status; v_completed_date date;
  v_completed_before int; v_completed_after int;
begin
  select status, payment_status, completed_date into v_status, v_payment_status, v_completed_date
    from public.tasks where title = 'E2E: Vendor invoice task';
  perform public.assert_true(v_status = 'completed', format('E2E: confirming payment completes the task (got %s)', v_status));
  perform public.assert_true(v_payment_status = 'paid', 'E2E: payment_status is paid');
  perform public.assert_true(v_completed_date is not null, 'E2E: completed_date is stamped once payment is confirmed');

  v_completed_before := current_setting('app.e2e_completed_before')::int;
  select tasks_completed into v_completed_after from public.users where email = 'staff.eng@test.local';
  perform public.assert_true(v_completed_after = v_completed_before + 1, format('E2E: tasks_completed increments exactly once, at final completion (%s -> %s)', v_completed_before, v_completed_after));

  perform public.assert_true(
    (select count(*) from public.task_subtasks where task_id = (select id from public.tasks where title = 'E2E: Vendor invoice task') and is_completed) = 3,
    'E2E: all 3 subtasks are still marked completed at the end of the lifecycle'
  );
end $$;

-- ---- Rejection path: a second task, sent back instead of approved ----
call public.test_act_as('depthead.eng@test.local');
do $$
begin
  insert into public.tasks (title, department, assignee_id, created_by_id, start_date, due_date)
  values ('E2E: Task that gets rejected', 'Engineering',
    (select id from public.users where email = 'staff.eng2@test.local'),
    (select id from public.users where email = 'depthead.eng@test.local'),
    current_date, current_date + 5);
end $$;
call public.test_reset_role();

call public.test_act_as('staff.eng2@test.local');
do $$
declare v_task_id uuid;
begin
  select id into v_task_id from public.tasks where title = 'E2E: Task that gets rejected';
  perform public.submit_task_for_approval(v_task_id, 'Done, please review.');
end $$;
call public.test_reset_role();

call public.test_act_as('depthead.eng@test.local');
do $$
declare v_task_id uuid;
begin
  select id into v_task_id from public.tasks where title = 'E2E: Task that gets rejected';
  perform public.decide_task_approval(v_task_id, 'rejected', 'Needs more work on the edge cases.');
end $$;
call public.test_reset_role();

do $$
declare v_status task_status; v_remark_count int;
begin
  select status into v_status from public.tasks where title = 'E2E: Task that gets rejected';
  perform public.assert_true(v_status = 'in_progress', format('E2E: a rejected task goes back to in_progress (got %s)', v_status));

  select count(*) into v_remark_count from public.task_remarks
    where task_id = (select id from public.tasks where title = 'E2E: Task that gets rejected')
      and text like '%edge cases%';
  perform public.assert_true(v_remark_count = 1, 'E2E: the rejection comment was recorded as a remark on the task');
end $$;

-- =====================================================================
-- 38_subtask_partial_payments.sql
-- =====================================================================

-- Full scenario: Rs. 100,000 task split into 4 subtask payments of
-- Rs. 25,000 each, confirmed one at a time — task must NOT complete
-- until the last one is confirmed.
call public.test_act_as('depthead.eng@test.local');
do $$
declare v_task_id uuid;
begin
  insert into public.tasks (title, department, assignee_id, created_by_id, start_date, due_date, requires_payment, payment_amount, status)
  values ('Partial payment task', 'Engineering',
    (select id from public.users where email = 'staff.eng@test.local'),
    (select id from public.users where email = 'depthead.eng@test.local'),
    current_date, current_date + 5, true, 100000.00, 'in_review');
end $$;
call public.test_reset_role();

call public.test_act_as('staff.eng@test.local');
do $$
declare v_task_id uuid;
begin
  select id into v_task_id from public.tasks where title = 'Partial payment task';
  insert into public.task_subtasks (task_id, title, payment_amount, created_by_id) values
    (v_task_id, 'Phase 1', 25000.00, (select id from public.users where email = 'staff.eng@test.local')),
    (v_task_id, 'Phase 2', 25000.00, (select id from public.users where email = 'staff.eng@test.local')),
    (v_task_id, 'Phase 3', 25000.00, (select id from public.users where email = 'staff.eng@test.local')),
    (v_task_id, 'Phase 4', 25000.00, (select id from public.users where email = 'staff.eng@test.local'));
end $$;
call public.test_reset_role();

do $$
declare v_count int;
begin
  select count(*) into v_count from public.task_subtasks
    where task_id = (select id from public.tasks where title = 'Partial payment task') and payment_status = 'pending';
  perform public.assert_true(v_count = 4, format('all 4 subtask payments auto-seeded to pending (got %s)', v_count));
end $$;

-- Approve the task — payment-linked, so it lands on pending_payment.
call public.test_act_as('depthead.eng@test.local');
do $$
declare v_task_id uuid;
begin
  select id into v_task_id from public.tasks where title = 'Partial payment task';
  perform public.decide_task_approval(v_task_id, 'approved', 'Approved, payment in 4 phases.');
end $$;
call public.test_reset_role();

-- Confirm 3 of 4 — task must still be pending_payment, not completed.
call public.test_act_as('chief@test.local');
do $$
declare v_sub_id uuid;
begin
  select id into v_sub_id from public.task_subtasks where task_id = (select id from public.tasks where title = 'Partial payment task') and title = 'Phase 1';
  perform public.confirm_subtask_payment(v_sub_id, 'Paid via bank transfer.');
  select id into v_sub_id from public.task_subtasks where task_id = (select id from public.tasks where title = 'Partial payment task') and title = 'Phase 2';
  perform public.confirm_subtask_payment(v_sub_id);
  select id into v_sub_id from public.task_subtasks where task_id = (select id from public.tasks where title = 'Partial payment task') and title = 'Phase 3';
  perform public.confirm_subtask_payment(v_sub_id);
end $$;
call public.test_reset_role();

do $$
declare v_status task_status; v_paid_count int; v_paid_amount numeric;
begin
  select status into v_status from public.tasks where title = 'Partial payment task';
  perform public.assert_true(v_status = 'pending_payment', format('task stays pending_payment with 3 of 4 subtask payments confirmed (got %s)', v_status));

  select count(*), coalesce(sum(payment_amount), 0) into v_paid_count, v_paid_amount
    from public.task_subtasks
    where task_id = (select id from public.tasks where title = 'Partial payment task') and payment_status = 'paid';
  perform public.assert_true(v_paid_count = 3 and v_paid_amount = 75000.00, format('3 subtasks paid, Rs 75,000 of Rs 100,000 (got count=%s, amount=%s)', v_paid_count, v_paid_amount));
end $$;

-- Confirm the 4th and final payment — NOW the task completes.
call public.test_act_as('chief@test.local');
do $$
declare v_sub_id uuid;
begin
  select id into v_sub_id from public.task_subtasks where task_id = (select id from public.tasks where title = 'Partial payment task') and title = 'Phase 4';
  perform public.confirm_subtask_payment(v_sub_id);
end $$;
call public.test_reset_role();

do $$
declare v_status task_status; v_payment_status task_payment_status; v_completed_date date;
begin
  select status, payment_status, completed_date into v_status, v_payment_status, v_completed_date
    from public.tasks where title = 'Partial payment task';
  perform public.assert_true(v_status = 'completed', format('task completes once ALL 4 subtask payments are confirmed (got %s)', v_status));
  perform public.assert_true(v_payment_status = 'paid', 'task-level payment_status flips to paid once every subtask payment is in');
  perform public.assert_true(v_completed_date is not null, 'completed_date is stamped when the final subtask payment completes the task');
end $$;

-- Cannot set a subtask payment on a task that doesn't require payment.
call public.test_act_as('staff.eng@test.local');
do $$
declare v_task_id uuid; v_failed boolean := false;
begin
  select id into v_task_id from public.tasks where title = 'Ship the new dashboard'; -- requires_payment = false
  begin
    insert into public.task_subtasks (task_id, title, payment_amount, created_by_id)
    values (v_task_id, 'Should not be allowed', 5000.00, (select id from public.users where email = 'staff.eng@test.local'));
  exception when others then
    v_failed := true;
  end;
  perform public.assert_true(v_failed, 'cannot set a subtask payment amount on a task that does not require payment');
end $$;
call public.test_reset_role();

-- Staff cannot directly mark their own subtask payment as paid (column
-- lockdown — must go through confirm_subtask_payment()).
call public.test_act_as('staff.eng@test.local');
do $$
declare v_sub_id uuid; v_failed boolean := false;
begin
  insert into public.tasks (title, department, assignee_id, created_by_id, start_date, due_date, requires_payment, payment_amount)
  values ('Self-serve payment attempt task', 'Engineering', (select id from public.users where email = 'staff.eng@test.local'), (select id from public.users where email = 'staff.eng@test.local'), current_date, current_date + 3, true, 5000.00);
end $$;
call public.test_reset_role();

do $$
declare v_task_id uuid;
begin
  select id into v_task_id from public.tasks where title = 'Self-serve payment attempt task';
  perform set_config('app.e2e_selfserve_task_id', v_task_id::text, false);
end $$;

call public.test_act_as('staff.eng@test.local');
do $$
declare v_task_id uuid; v_sub_id uuid; v_failed boolean := false;
begin
  v_task_id := current_setting('app.e2e_selfserve_task_id')::uuid;
  insert into public.task_subtasks (task_id, title, payment_amount, created_by_id)
  values (v_task_id, 'My own subtask', 5000.00, (select id from public.users where email = 'staff.eng@test.local'))
  returning id into v_sub_id;

  begin
    update public.task_subtasks set payment_status = 'paid' where id = v_sub_id;
  exception when others then
    v_failed := true;
  end;
  perform public.assert_true(v_failed, 'staff cannot directly set their own subtask payment_status to paid (column-level lockdown)');
end $$;
call public.test_reset_role();

-- Chief Officer whole-task confirm sweeps any still-pending subtask
-- payments along with it (the "one bank transfer covers everything"
-- path stays consistent with subtask-level state).
call public.test_act_as('depthead.eng@test.local');
do $$
declare v_task_id uuid;
begin
  insert into public.tasks (title, department, assignee_id, created_by_id, start_date, due_date, requires_payment, payment_amount, status)
  values ('Lump sum sweep task', 'Engineering',
    (select id from public.users where email = 'staff.eng@test.local'),
    (select id from public.users where email = 'depthead.eng@test.local'),
    current_date, current_date + 3, true, 40000.00, 'in_review');
end $$;
call public.test_reset_role();

call public.test_act_as('staff.eng@test.local');
do $$
declare v_task_id uuid;
begin
  select id into v_task_id from public.tasks where title = 'Lump sum sweep task';
  insert into public.task_subtasks (task_id, title, payment_amount, created_by_id) values
    (v_task_id, 'Part A', 20000.00, (select id from public.users where email = 'staff.eng@test.local')),
    (v_task_id, 'Part B', 20000.00, (select id from public.users where email = 'staff.eng@test.local'));
end $$;
call public.test_reset_role();

call public.test_act_as('depthead.eng@test.local');
do $$
declare v_task_id uuid;
begin
  select id into v_task_id from public.tasks where title = 'Lump sum sweep task';
  perform public.decide_task_approval(v_task_id, 'approved', null);
end $$;
call public.test_reset_role();

call public.test_act_as('super@test.local');
do $$
declare v_task_id uuid;
begin
  select id into v_task_id from public.tasks where title = 'Lump sum sweep task';
  perform public.confirm_task_payment(v_task_id, 'Paid in one transfer.');
end $$;
call public.test_reset_role();

do $$
declare v_status task_status; v_unpaid_subtasks int;
begin
  select status into v_status from public.tasks where title = 'Lump sum sweep task';
  perform public.assert_true(v_status = 'completed', format('lump-sum confirm still completes the task (got %s)', v_status));

  select count(*) into v_unpaid_subtasks from public.task_subtasks
    where task_id = (select id from public.tasks where title = 'Lump sum sweep task')
      and payment_amount is not null and payment_status <> 'paid';
  perform public.assert_true(v_unpaid_subtasks = 0, 'confirm_task_payment() sweeps any still-pending subtask payments along with it');
end $$;

\echo '==================================================================='
\echo 'ALL 91_new_feature_tests.sql ASSERTIONS PASSED'
\echo '==================================================================='
