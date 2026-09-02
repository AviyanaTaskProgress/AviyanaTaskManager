import { Task, User } from '../types';

// Backend engineering review (2026-09): TaskModal.tsx grew to 1300+
// lines this session (subtasks, payments, reminders, delete, all in
// one component) with zero test coverage on any of its logic — these
// permission checks in particular gate destructive/disruptive actions
// (Delete, Ring Alarm, Confirm Payment) and are exactly the kind of
// thing a small refactor could silently break without anyone noticing
// until a real user hits it in production. Extracted as pure functions
// so they're testable without rendering the component at all.
//
// Each one is written to mirror a specific RLS policy or RPC
// permission check server-side — see the comment on each for which —
// so the UI never shows a button that would just fail server-side, but
// these are UI conveniences only; the server-side check is still the
// real security boundary in every case.

/** Mirrors tasks_delete RLS (34_audit_fixes_delete_policy_and_search_path.sql). */
export function canDeleteTask(currentUser: User, task: Task | null | undefined): boolean {
  if (!task) return false;
  return (
    task.assigneeId === currentUser.id ||
    currentUser.role === 'super_admin' ||
    (currentUser.role === 'dept_head' && !!currentUser.permissions.canEditAllTasks && task.department === currentUser.department)
  );
}

/** Mirrors ring_task_alarm()'s role/department check (33_task_reminders_and_alarms.sql). */
export function canRingAlarm(currentUser: User, task: Task | null | undefined): boolean {
  if (!task) return false;
  if (task.status === 'completed') return false;
  if (task.assigneeId === currentUser.id) return false; // ringing yourself makes no sense
  return (
    currentUser.role === 'super_admin' ||
    currentUser.role === 'chief_officer' ||
    (currentUser.role === 'dept_head' && task.department === currentUser.department)
  );
}

/** Mirrors confirm_task_payment()'s role check (29_task_payment_workflow.sql). */
export function canConfirmPayment(currentUser: User): boolean {
  return currentUser.role === 'super_admin' || currentUser.role === 'chief_officer';
}

/**
 * A "self-logged" task is one where the assignee is also the creator —
 * the only case the "who actually assigned this?" field applies to
 * (30_assigned_by_and_completed_counter.sql / TaskModal's
 * assignedById selector).
 */
export function isSelfLoggedTask(task: Pick<Task, 'assigneeId' | 'createdById'>): boolean {
  return task.assigneeId === task.createdById;
}

/** Mirrors tasks_insert RLS's Staff self-log branch (31_staff_self_log_tasks.sql). */
export function isDepartmentLockedForRole(role: User['role']): boolean {
  return role === 'dept_head' || role === 'staff';
}

export function isAssigneePickerHiddenForRole(role: User['role']): boolean {
  return role === 'staff';
}

/** Staff must record who instructed a self-logged task; everyone else keeps it optional. */
export function isAssignedByRequiredForRole(role: User['role']): boolean {
  return role === 'staff';
}
