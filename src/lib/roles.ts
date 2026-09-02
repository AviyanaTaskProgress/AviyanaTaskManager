import { UserRole } from '../types';

/** Short label — for badges/chips. */
export const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  chief_officer: 'Chief Officer',
  dept_head: 'Dept Head',
  staff: 'Staff',
  viewer: 'Viewer',
};

/** Longer, descriptive label — for menus / dropdowns. */
export const ROLE_LABEL_LONG: Record<UserRole, string> = {
  super_admin: 'Super Admin — Full Access',
  chief_officer: 'Chief Officer',
  dept_head: 'Department Head',
  staff: 'Staff Employee',
  viewer: 'Viewer — Read-Only Dashboard',
};

export const ROLE_BADGE_CLASSES: Record<UserRole, string> = {
  super_admin: 'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300',
  chief_officer: 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300',
  dept_head: 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300',
  staff: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300',
  viewer: 'bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300',
};

export const ROLE_BADGE_CLASSES_SOFT: Record<UserRole, string> = {
  super_admin: 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300',
  chief_officer: 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300',
  dept_head: 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300',
  staff: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300',
  viewer: 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300',
};

/** Default permission set applied when Team-page admin picks a role for a new user. */
export function defaultPermissionsForRole(role: UserRole) {
  switch (role) {
    case 'super_admin':
      return {
        canCreateTasks: true,
        canApproveTasks: true,
        canManageUsers: true,
        canViewAuditLogs: true,
        canExportReports: true,
        canConfigureSlack: true,
        canEditAllTasks: true,
        canViewExecutiveAnalytics: true,
      };
    case 'chief_officer':
      // Reports + user creation across departments, and (per the
      // 2026-09 role-based access review) can also delegate tasks to
      // anyone in any department — same cross-department reach as
      // Super Admin for task creation specifically, just without
      // approval authority. See 32_chief_officer_cross_dept_tasks.sql.
      return {
        canCreateTasks: true,
        canApproveTasks: false,
        canManageUsers: true,
        canViewAuditLogs: true,
        canExportReports: true,
        canConfigureSlack: false,
        canEditAllTasks: false,
        canViewExecutiveAnalytics: true,
      };
    case 'dept_head':
      return {
        canCreateTasks: true,
        canApproveTasks: true,
        canManageUsers: true,
        canViewAuditLogs: true,
        canExportReports: true,
        canConfigureSlack: true,
        canEditAllTasks: true,
        canViewExecutiveAnalytics: false,
      };
    case 'staff':
      return {
        canCreateTasks: false,
        canApproveTasks: false,
        canManageUsers: false,
        canViewAuditLogs: false,
        canExportReports: false,
        canConfigureSlack: false,
        canEditAllTasks: false,
        canViewExecutiveAnalytics: false,
      };
    case 'viewer':
    default:
      // Strictly read-only: sees the cross-department executive dashboard
      // (via role-based visibility, not this flag) and nothing else.
      return {
        canCreateTasks: false,
        canApproveTasks: false,
        canManageUsers: false,
        canViewAuditLogs: false,
        canExportReports: false,
        canConfigureSlack: false,
        canEditAllTasks: false,
        canViewExecutiveAnalytics: true,
      };
  }
}

/**
 * Which roles a given actor is allowed to assign when provisioning or
 * editing a team member — mirrors the RLS policies in
 * 05_role_based_access.sql / 18_viewer_role_and_dashboard.sql (a
 * dept_head can only ever write role='staff' rows, a chief_officer can
 * write 'staff'/'dept_head', only super_admin can write everything).
 * This is the single source of truth for both the "New User" and
 * "Edit Profile" role dropdowns in TeamManagementView.tsx, so they can
 * never drift out of sync with each other.
 */
export function assignableRoles(actorRole: UserRole): UserRole[] {
  switch (actorRole) {
    case 'super_admin':
      return ['staff', 'dept_head', 'chief_officer', 'super_admin', 'viewer'];
    case 'chief_officer':
      return ['staff', 'dept_head'];
    default:
      // dept_head (and anyone else who somehow reaches this form) can
      // only ever add/edit staff.
      return ['staff'];
  }
}

/**
 * Options for a role <select> that's editing an *existing* user, rather
 * than creating a new one. Always includes the role the target user
 * currently has, even if the actor isn't normally allowed to *assign*
 * that role — otherwise the <select>'s value wouldn't match any
 * rendered <option> (e.g. a Chief Officer opening a Viewer's profile),
 * which most browsers show as nothing visibly selected, risking an
 * accidental role change while the admin was just trying to fix a name
 * or avatar. Actually saving a role outside assignableRoles(actorRole)
 * still gets rejected server-side by RLS — this only fixes the display.
 */
export function editableRoleOptions(actorRole: UserRole, currentTargetRole: UserRole): UserRole[] {
  return Array.from(new Set<UserRole>([...assignableRoles(actorRole), currentTargetRole]));
}
