import { UserRole } from '../types';

/** Every tab id that exists in the app's top-level navigation. */
export type NavTabId = 'dashboard' | 'tasks' | 'chat' | 'approvals' | 'team' | 'reports' | 'audit' | 'settings';

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

export function isTabVisible(tabId: NavTabId, role: UserRole): boolean {
  if (role === 'staff') return STAFF_VISIBLE_TABS.includes(tabId);
  // dept_head, chief_officer, super_admin see the full set. 'viewer' never
  // calls this — it has its own standalone screen — but default closed
  // (false) rather than open, in case that ever changes.
  if (role === 'viewer') return false;
  return true;
}
