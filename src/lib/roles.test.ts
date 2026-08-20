import { describe, expect, it } from 'vitest';
import { defaultPermissionsForRole } from './roles';
import { UserRole } from '../types';

const ROLES: UserRole[] = ['super_admin', 'chief_officer', 'dept_head', 'staff'];

describe('defaultPermissionsForRole', () => {
  it('staff gets no elevated permissions at all', () => {
    const perms = defaultPermissionsForRole('staff');
    expect(Object.values(perms).every((v) => v === false)).toBe(true);
  });

  it('super_admin gets every permission', () => {
    const perms = defaultPermissionsForRole('super_admin');
    expect(Object.values(perms).every((v) => v === true)).toBe(true);
  });

  it('chief_officer can manage users and view analytics, but cannot create/approve tasks', () => {
    const perms = defaultPermissionsForRole('chief_officer');
    expect(perms.canManageUsers).toBe(true);
    expect(perms.canViewExecutiveAnalytics).toBe(true);
    expect(perms.canCreateTasks).toBe(false);
    expect(perms.canApproveTasks).toBe(false);
  });

  it('dept_head can run day-to-day task operations but not see executive analytics', () => {
    const perms = defaultPermissionsForRole('dept_head');
    expect(perms.canCreateTasks).toBe(true);
    expect(perms.canApproveTasks).toBe(true);
    expect(perms.canManageUsers).toBe(true);
    expect(perms.canViewExecutiveAnalytics).toBe(false);
  });

  it('every role produces a value for every permission key (no undefined gaps)', () => {
    const keys = [
      'canCreateTasks',
      'canApproveTasks',
      'canManageUsers',
      'canViewAuditLogs',
      'canExportReports',
      'canConfigureSlack',
      'canEditAllTasks',
      'canViewExecutiveAnalytics',
    ] as const;
    for (const role of ROLES) {
      const perms = defaultPermissionsForRole(role);
      for (const key of keys) {
        expect(typeof perms[key]).toBe('boolean');
      }
    }
  });
});
