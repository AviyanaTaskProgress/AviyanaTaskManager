-- ============================================================
-- 06: Promote ishan@aviyana.lk to Super Admin (full access)
-- Run this AFTER 05_role_based_access.sql, and after this email
-- has signed up at least once (or been provisioned via the Team
-- page and then completed signup — see 04_link_invited_users.sql).
-- ============================================================

update public.users
set
  role = 'super_admin',
  title = coalesce(nullif(title, ''), 'Super Admin'),
  permissions = '{
    "canCreateTasks": true,
    "canApproveTasks": true,
    "canManageUsers": true,
    "canViewAuditLogs": true,
    "canExportReports": true,
    "canConfigureSlack": true,
    "canEditAllTasks": true,
    "canViewExecutiveAnalytics": true
  }'::jsonb
where email = 'ishan@aviyana.lk';

-- Verify it worked:
select id, name, email, role, department, permissions
from public.users
where email = 'ishan@aviyana.lk';
