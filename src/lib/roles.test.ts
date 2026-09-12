import { describe, expect, it } from 'vitest';
import { defaultPermissionsForRole, assignableRoles, editableRoleOptions } from './roles';
import { UserRole } from '../types';

const ROLES: UserRole[] = ['super_admin', 'ceo', 'chief_officer', 'dept_head', 'staff', 'chairman'];

describe('defaultPermissionsForRole', () => {
  it('staff gets no elevated permissions at all', () => {
    const perms = defaultPermissionsForRole('staff');
    expect(Object.values(perms).every((v) => v === false)).toBe(true);
  });

  it('super_admin gets every permission', () => {
    const perms = defaultPermissionsForRole('super_admin');
    expect(Object.values(perms).every((v) => v === true)).toBe(true);
  });

  it('chief_officer can manage users, view analytics, and create (but not approve) tasks', () => {
    const perms = defaultPermissionsForRole('chief_officer');
    expect(perms.canManageUsers).toBe(true);
    expect(perms.canViewExecutiveAnalytics).toBe(true);
    expect(perms.canCreateTasks).toBe(true);
    expect(perms.canApproveTasks).toBe(false);
  });

  it('dept_head can run day-to-day task operations but not see executive analytics', () => {
    const perms = defaultPermissionsForRole('dept_head');
    expect(perms.canCreateTasks).toBe(true);
    expect(perms.canApproveTasks).toBe(true);
    expect(perms.canManageUsers).toBe(true);
    expect(perms.canViewExecutiveAnalytics).toBe(false);
  });

  it('ceo can create/approve/edit tasks and view analytics, but cannot manage users, view audit logs, or configure Slack', () => {
    const perms = defaultPermissionsForRole('ceo');
    expect(perms.canCreateTasks).toBe(true);
    expect(perms.canApproveTasks).toBe(true);
    expect(perms.canEditAllTasks).toBe(true);
    expect(perms.canExportReports).toBe(true);
    expect(perms.canViewExecutiveAnalytics).toBe(true);
    expect(perms.canManageUsers).toBe(false);
    expect(perms.canViewAuditLogs).toBe(false);
    expect(perms.canConfigureSlack).toBe(false);
  });

  it('chairman gets no elevated permissions at all (status-only via a dedicated read-only screen, not a permission flag)', () => {
    const perms = defaultPermissionsForRole('chairman');
    expect(Object.values(perms).every((v) => v === false)).toBe(true);
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

describe('assignableRoles', () => {
  it('super_admin can assign every role, including ceo, chairman, super_admin and viewer', () => {
    const roles = assignableRoles('super_admin');
    expect(roles).toEqual(
      expect.arrayContaining(['staff', 'dept_head', 'chief_officer', 'ceo', 'super_admin', 'viewer', 'chairman'])
    );
  });

  it('chief_officer can only assign staff or dept_head — never chief_officer, super_admin, or viewer', () => {
    const roles = assignableRoles('chief_officer');
    expect(roles).toEqual(['staff', 'dept_head']);
    expect(roles).not.toContain('super_admin');
    expect(roles).not.toContain('viewer');
  });

  it('dept_head can only assign staff', () => {
    expect(assignableRoles('dept_head')).toEqual(['staff']);
  });

  it('staff and viewer (which never provision users) fall back to the most restrictive set', () => {
    expect(assignableRoles('staff')).toEqual(['staff']);
    expect(assignableRoles('viewer')).toEqual(['staff']);
  });
});

describe('editableRoleOptions', () => {
  it("always includes the target user's current role, even if the actor couldn't newly assign it", () => {
    // Regression test for the bug fixed in AVIYANA_FULL_SYSTEM_AUDIT.md
    // §1: a Chief Officer opening a Viewer's edit form must still see
    // "Viewer" as an option so the <select> isn't left with an orphaned
    // value that matches no <option>.
    const options = editableRoleOptions('chief_officer', 'viewer');
    expect(options).toContain('viewer');
  });

  it('never offers a role the actor cannot actually save, beyond the current one', () => {
    // A dept_head editing a staff member should only ever see 'staff' —
    // not 'dept_head', 'chief_officer', etc. — since the RLS policy for
    // dept_head-managed rows requires role = 'staff' on both read and
    // write; offering more would fail server-side with a raw DB error.
    const options = editableRoleOptions('dept_head', 'staff');
    expect(options).toEqual(['staff']);
  });

  it('does not duplicate the current role if it was already assignable', () => {
    const options = editableRoleOptions('super_admin', 'staff');
    expect(options.filter((r) => r === 'staff')).toHaveLength(1);
  });

  it("super_admin editing another super_admin still sees the full assignable set", () => {
    const options = editableRoleOptions('super_admin', 'super_admin');
    expect(options).toEqual(
      expect.arrayContaining(['staff', 'dept_head', 'chief_officer', 'super_admin', 'viewer'])
    );
  });
});
