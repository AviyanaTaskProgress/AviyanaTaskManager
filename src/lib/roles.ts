import { UserRole } from '../types';

/** Short label — for badges/chips. */
export const ROLE_LABEL: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  chief_officer: 'Chief Officer',
  dept_head: 'Dept Head',
  staff: 'Staff',
};

/** Longer, descriptive label — for menus / dropdowns. */
export const ROLE_LABEL_LONG: Record<UserRole, string> = {
  super_admin: 'Super Admin — Full Access',
  chief_officer: 'Chief Officer',
  dept_head: 'Department Head',
  staff: 'Staff Employee',
};

export const ROLE_BADGE_CLASSES: Record<UserRole, string> = {
  super_admin: 'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300',
  chief_officer: 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300',
  dept_head: 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300',
  staff: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300',
};

export const ROLE_BADGE_CLASSES_SOFT: Record<UserRole, string> = {
  super_admin: 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300',
  chief_officer: 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300',
  dept_head: 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300',
  staff: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300',
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
      // Reports + user creation across departments; not an operational
      // task manager/approver by default.
      return {
        canCreateTasks: false,
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
    default:
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
  }
}
