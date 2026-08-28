import { describe, expect, it } from 'vitest';
import { isTabVisible, NavTabId } from './navigation';
import { UserRole } from '../types';

const ALL_TABS: NavTabId[] = ['dashboard', 'tasks', 'chat', 'approvals', 'team', 'reports', 'audit', 'settings', 'backups'];

describe('isTabVisible', () => {
  it('staff only see Dashboard, Tasks, and Chat', () => {
    const visible = ALL_TABS.filter((t) => isTabVisible(t, 'staff'));
    expect(visible).toEqual(['dashboard', 'tasks', 'chat']);
  });

  it('staff never see management-facing tabs (Team, Reports, Audit, Settings, Approvals, Backups)', () => {
    for (const tab of ['approvals', 'team', 'reports', 'audit', 'settings', 'backups'] as NavTabId[]) {
      expect(isTabVisible(tab, 'staff')).toBe(false);
    }
  });

  it('viewer sees no tabs in this navigation at all — it has its own standalone screen', () => {
    for (const tab of ALL_TABS) {
      expect(isTabVisible(tab, 'viewer')).toBe(false);
    }
  });

  it.each<UserRole>(['dept_head', 'chief_officer'])(
    '%s sees every tab except Backups (Super Admin only)',
    (role) => {
      for (const tab of ALL_TABS) {
        expect(isTabVisible(tab, role)).toBe(tab !== 'backups');
      }
    }
  );

  it('super_admin sees the full tab set, including Backups', () => {
    for (const tab of ALL_TABS) {
      expect(isTabVisible(tab, 'super_admin')).toBe(true);
    }
  });
});
