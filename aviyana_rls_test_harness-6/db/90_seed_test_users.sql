-- =====================================================================
-- 90_seed_test_users.sql — one test user per role, seeded via the same
-- auth.users -> trg_on_auth_user_created -> public.users path a real
-- signup takes, then promoted/tweaked to the exact role/dept needed.
-- =====================================================================

insert into auth.users (id, email, raw_user_meta_data)
values
  (gen_random_uuid(), 'super@test.local',  jsonb_build_object('name', 'Sam SuperAdmin')),
  (gen_random_uuid(), 'chief@test.local',  jsonb_build_object('name', 'Cara ChiefOfficer')),
  (gen_random_uuid(), 'depthead.eng@test.local', jsonb_build_object('name', 'Dinesh DeptHead Eng')),
  (gen_random_uuid(), 'depthead.mar@test.local', jsonb_build_object('name', 'Mala DeptHead Mkt')),
  (gen_random_uuid(), 'staff.eng@test.local', jsonb_build_object('name', 'Sanju Staff Eng')),
  (gen_random_uuid(), 'staff.eng2@test.local', jsonb_build_object('name', 'Sithara Staff Eng')),
  (gen_random_uuid(), 'staff.mar@test.local', jsonb_build_object('name', 'Malik Staff Mkt')),
  (gen_random_uuid(), 'viewer@test.local', jsonb_build_object('name', 'Vinod Viewer'));

-- Set full/role-appropriate permissions explicitly (mirrors
-- src/lib/roles.ts's defaultPermissionsForRole so the harness matches
-- what the app itself would actually grant).
update public.users set
  role = 'super_admin', department = 'Engineering',
  permissions = '{"canCreateTasks":true,"canApproveTasks":true,"canManageUsers":true,"canViewAuditLogs":true,"canExportReports":true,"canConfigureSlack":true,"canEditAllTasks":true,"canViewExecutiveAnalytics":true}'::jsonb
  where email = 'super@test.local';

update public.users set
  role = 'chief_officer', department = 'Engineering',
  permissions = '{"canCreateTasks":true,"canApproveTasks":false,"canManageUsers":true,"canViewAuditLogs":true,"canExportReports":true,"canConfigureSlack":false,"canEditAllTasks":false,"canViewExecutiveAnalytics":true}'::jsonb
  where email = 'chief@test.local';

update public.users set
  role = 'dept_head', department = 'Engineering',
  permissions = '{"canCreateTasks":true,"canApproveTasks":true,"canManageUsers":true,"canViewAuditLogs":true,"canExportReports":true,"canConfigureSlack":true,"canEditAllTasks":true,"canViewExecutiveAnalytics":false}'::jsonb
  where email = 'depthead.eng@test.local';

update public.users set
  role = 'dept_head', department = 'Marketing',
  permissions = '{"canCreateTasks":true,"canApproveTasks":true,"canManageUsers":true,"canViewAuditLogs":true,"canExportReports":true,"canConfigureSlack":true,"canEditAllTasks":true,"canViewExecutiveAnalytics":false}'::jsonb
  where email = 'depthead.mar@test.local';

update public.users set
  role = 'staff', department = 'Engineering',
  permissions = '{"canCreateTasks":false,"canApproveTasks":false,"canManageUsers":false,"canViewAuditLogs":false,"canExportReports":false,"canConfigureSlack":false,"canEditAllTasks":false,"canViewExecutiveAnalytics":false}'::jsonb
  where email in ('staff.eng@test.local', 'staff.eng2@test.local');

update public.users set
  role = 'staff', department = 'Marketing',
  permissions = '{"canCreateTasks":false,"canApproveTasks":false,"canManageUsers":false,"canViewAuditLogs":false,"canExportReports":false,"canConfigureSlack":false,"canEditAllTasks":false,"canViewExecutiveAnalytics":false}'::jsonb
  where email = 'staff.mar@test.local';

update public.users set
  role = 'viewer', department = 'Engineering',
  permissions = '{"canCreateTasks":false,"canApproveTasks":false,"canManageUsers":false,"canViewAuditLogs":false,"canExportReports":false,"canConfigureSlack":false,"canEditAllTasks":false,"canViewExecutiveAnalytics":true}'::jsonb
  where email = 'viewer@test.local';

-- Quick sanity printout.
select email, role, department from public.users order by role, email;
