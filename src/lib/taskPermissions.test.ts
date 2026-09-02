import { describe, expect, it } from 'vitest';
import {
  canDeleteTask,
  canRingAlarm,
  canConfirmPayment,
  isSelfLoggedTask,
  isDepartmentLockedForRole,
  isAssigneePickerHiddenForRole,
  isAssignedByRequiredForRole,
} from './taskPermissions';
import { Task, User } from '../types';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    name: 'Test User',
    email: 'test@aviyana.lk',
    role: 'staff',
    department: 'Engineering',
    title: 'Engineer',
    avatar: '',
    status: 'active',
    productivityScore: 80,
    tasksCompleted: 0,
    tasksInProgress: 0,
    hoursLoggedThisMonth: 0,
    permissions: {
      canCreateTasks: false,
      canApproveTasks: false,
      canManageUsers: false,
      canViewAuditLogs: false,
      canExportReports: false,
      canConfigureSlack: false,
      canEditAllTasks: false,
      canViewExecutiveAnalytics: false,
    },
    joinedDate: '2026-01-01',
    accountActivated: true,
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Test task',
    description: '',
    department: 'Engineering',
    assigneeId: 'assignee-1',
    assigneeName: 'Assignee',
    assigneeAvatar: '',
    createdById: 'creator-1',
    createdByName: 'Creator',
    createdByRole: 'dept_head',
    startDate: '2026-09-01',
    dueDate: '2026-09-10',
    loggedHours: 0,
    priority: 'medium',
    status: 'in_progress',
    progress: 0,
    remarks: [],
    attachments: [],
    subtasks: [],
    tags: [],
    taskDisplayId: 'ENG-0001',
    requiresPayment: false,
    paymentStatus: 'not_applicable',
    hasSplitPayments: false,
    ...overrides,
  };
}

describe('canDeleteTask (mirrors tasks_delete RLS)', () => {
  it('the assignee can delete their own task', () => {
    const user = makeUser({ id: 'assignee-1', role: 'staff' });
    expect(canDeleteTask(user, makeTask({ assigneeId: 'assignee-1' }))).toBe(true);
  });

  it('super_admin can delete any task, any department', () => {
    const user = makeUser({ role: 'super_admin', department: 'Marketing' });
    expect(canDeleteTask(user, makeTask({ department: 'Engineering', assigneeId: 'someone-else' }))).toBe(true);
  });

  it('dept_head with canEditAllTasks can delete a task in their own department', () => {
    const user = makeUser({ role: 'dept_head', department: 'Engineering', permissions: { ...makeUser().permissions, canEditAllTasks: true } });
    expect(canDeleteTask(user, makeTask({ department: 'Engineering', assigneeId: 'someone-else' }))).toBe(true);
  });

  it('dept_head cannot delete a task outside their own department', () => {
    const user = makeUser({ role: 'dept_head', department: 'Engineering', permissions: { ...makeUser().permissions, canEditAllTasks: true } });
    expect(canDeleteTask(user, makeTask({ department: 'Marketing', assigneeId: 'someone-else' }))).toBe(false);
  });

  it('dept_head without canEditAllTasks cannot delete someone else\'s task even in their own department', () => {
    const user = makeUser({ role: 'dept_head', department: 'Engineering', permissions: { ...makeUser().permissions, canEditAllTasks: false } });
    expect(canDeleteTask(user, makeTask({ department: 'Engineering', assigneeId: 'someone-else' }))).toBe(false);
  });

  it('chief_officer cannot delete a task they are not assigned to (not in the delete policy)', () => {
    const user = makeUser({ role: 'chief_officer' });
    expect(canDeleteTask(user, makeTask({ assigneeId: 'someone-else' }))).toBe(false);
  });

  it('returns false with no task (create mode)', () => {
    expect(canDeleteTask(makeUser({ role: 'super_admin' }), null)).toBe(false);
  });
});

describe('canRingAlarm (mirrors ring_task_alarm() RPC)', () => {
  it('super_admin can ring an alarm for anyone, any department', () => {
    const user = makeUser({ role: 'super_admin', department: 'Marketing' });
    expect(canRingAlarm(user, makeTask({ department: 'Engineering', assigneeId: 'someone-else' }))).toBe(true);
  });

  it('chief_officer can ring cross-department (matches migration 32)', () => {
    const user = makeUser({ role: 'chief_officer', department: 'Marketing' });
    expect(canRingAlarm(user, makeTask({ department: 'Engineering', assigneeId: 'someone-else' }))).toBe(true);
  });

  it('dept_head can only ring within their own department', () => {
    const user = makeUser({ role: 'dept_head', department: 'Engineering' });
    expect(canRingAlarm(user, makeTask({ department: 'Marketing', assigneeId: 'someone-else' }))).toBe(false);
  });

  it('staff can never ring an alarm', () => {
    const user = makeUser({ role: 'staff' });
    expect(canRingAlarm(user, makeTask({ assigneeId: 'someone-else' }))).toBe(false);
  });

  it('cannot ring an alarm on a completed task', () => {
    const user = makeUser({ role: 'super_admin' });
    expect(canRingAlarm(user, makeTask({ status: 'completed', assigneeId: 'someone-else' }))).toBe(false);
  });

  it('cannot ring an alarm targeting yourself', () => {
    const user = makeUser({ id: 'me', role: 'super_admin' });
    expect(canRingAlarm(user, makeTask({ assigneeId: 'me' }))).toBe(false);
  });
});

describe('canConfirmPayment (mirrors confirm_task_payment() RPC)', () => {
  it('super_admin and chief_officer can confirm payment', () => {
    expect(canConfirmPayment(makeUser({ role: 'super_admin' }))).toBe(true);
    expect(canConfirmPayment(makeUser({ role: 'chief_officer' }))).toBe(true);
  });

  it('dept_head and staff cannot confirm payment', () => {
    expect(canConfirmPayment(makeUser({ role: 'dept_head' }))).toBe(false);
    expect(canConfirmPayment(makeUser({ role: 'staff' }))).toBe(false);
  });
});

describe('isSelfLoggedTask', () => {
  it('true when assignee and creator are the same person', () => {
    expect(isSelfLoggedTask({ assigneeId: 'x', createdById: 'x' })).toBe(true);
  });

  it('false when assignee and creator differ', () => {
    expect(isSelfLoggedTask({ assigneeId: 'x', createdById: 'y' })).toBe(false);
  });
});

describe('role-based form-field gating (mirrors 31_staff_self_log_tasks.sql)', () => {
  it('department is locked for dept_head and staff, not for super_admin/chief_officer', () => {
    expect(isDepartmentLockedForRole('dept_head')).toBe(true);
    expect(isDepartmentLockedForRole('staff')).toBe(true);
    expect(isDepartmentLockedForRole('super_admin')).toBe(false);
    expect(isDepartmentLockedForRole('chief_officer')).toBe(false);
  });

  it('the assignee picker is hidden only for staff', () => {
    expect(isAssigneePickerHiddenForRole('staff')).toBe(true);
    expect(isAssigneePickerHiddenForRole('dept_head')).toBe(false);
  });

  it('"who assigned this?" is required only for staff', () => {
    expect(isAssignedByRequiredForRole('staff')).toBe(true);
    expect(isAssignedByRequiredForRole('dept_head')).toBe(false);
    expect(isAssignedByRequiredForRole('super_admin')).toBe(false);
  });
});
