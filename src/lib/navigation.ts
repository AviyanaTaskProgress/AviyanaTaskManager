import { UserRole } from '../types';

/** Every tab id that exists in the app's top-level navigation. */
export type NavTabId = 'dashboard' | 'tasks' | 'chat' | 'approvals' | 'team' | 'reports' | 'audit' | 'settings' | 'backups';

/**
 * Staff get a deliberately small surface: their own task list, a simple
 * personal dashboard (see DashboardView's staff branch), and Chat.
 * Everything management-facing (Team/RBAC, Reports, Audit, Slack config)
 * is hidden — not just permission-gated inside the page, but not even
 * reachable as a tab, on both desktop (Sidebar) and mobile (bottom nav).
 *
 * 'viewer' isn't listed here because that role never reaches this
 * navigation at all — see App.tsx's dedicated viewer branch, which
 * renders ExecutiveDashboardView as the entire app for them.
 */
const STAFF_VISIBLE_TABS: NavTabId[] = ['dashboard', 'tasks', 'chat'];

/** 'backups' is Super Admin only — full database backup/restore is a
 * step above ordinary "team management" access, so even Chief Officer
 * and Dept Head (who see everything else below) don't get this tab. */
const SUPER_ADMIN_ONLY_TABS: NavTabId[] = ['backups'];

export function isTabVisible(tabId: NavTabId, role: UserRole): boolean {
  if (role === 'staff') return STAFF_VISIBLE_TABS.includes(tabId);
  // 'viewer' never calls this — it has its own standalone screen — but
  // default closed (false) rather than open, in case that ever changes.
  if (role === 'viewer') return false;
  if (SUPER_ADMIN_ONLY_TABS.includes(tabId)) return role === 'super_admin';
  // dept_head and chief_officer see everything else.
  return true;
}
