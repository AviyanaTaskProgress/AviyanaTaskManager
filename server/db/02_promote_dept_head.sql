-- ============================================================
-- FIX 2: Promote your account to Dept Head (full admin)
-- Run this AFTER you've signed up at least once in the app.
-- Run in Supabase → SQL Editor.
-- ============================================================
-- Replace the email below with the one you signed up with.

update public.users
set
  role = 'dept_head',
  title = 'Head of Department',
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
where email = 'you@example.com';   -- 👈 change this to your actual login email

-- Verify it worked:
select id, name, email, role, permissions from public.users where email = 'you@example.com';
