-- =====================================================================
-- 08_clamp_user_permissions.sql
-- =====================================================================
-- Gap: the `permissions` jsonb on a user row is set entirely by the
-- client (see defaultPermissionsForRole() in src/lib/roles.ts). The
-- RLS policies from 05_role_based_access.sql check WHO can write a row
-- and WHICH role/department it's in, but never checked WHAT permissions
-- that row was being given. A Dept Head or Chief Officer using the
-- Supabase client directly (not through the UI) could create a 'staff'
-- row with permissions.canManageUsers = true, permissions.canEditAllTasks
-- = true, etc. — well beyond what the UI would ever send.
--
-- Fix: a BEFORE INSERT/UPDATE trigger that clamps `permissions` down to
-- a fixed per-role ceiling for any actor who isn't a Super Admin. It can
-- only ever narrow permissions, never widen them, so it's safe to apply
-- even to rows the UI already builds correctly.
--
-- Run this once, after 07_fix_slack_sync_http.sql, in the Supabase SQL editor.
-- =====================================================================

create or replace function public.role_permission_ceiling(p_role user_role)
returns jsonb
language sql
immutable
as $$
  select case p_role
    when 'super_admin' then
      '{"canCreateTasks":true,"canApproveTasks":true,"canManageUsers":true,"canViewAuditLogs":true,"canExportReports":true,"canConfigureSlack":true,"canEditAllTasks":true,"canViewExecutiveAnalytics":true}'::jsonb
    when 'chief_officer' then
      '{"canCreateTasks":false,"canApproveTasks":false,"canManageUsers":true,"canViewAuditLogs":true,"canExportReports":true,"canConfigureSlack":false,"canEditAllTasks":false,"canViewExecutiveAnalytics":true}'::jsonb
    when 'dept_head' then
      '{"canCreateTasks":true,"canApproveTasks":true,"canManageUsers":true,"canViewAuditLogs":true,"canExportReports":true,"canConfigureSlack":true,"canEditAllTasks":true,"canViewExecutiveAnalytics":false}'::jsonb
    else
      -- staff
      '{"canCreateTasks":false,"canApproveTasks":false,"canManageUsers":false,"canViewAuditLogs":false,"canExportReports":false,"canConfigureSlack":false,"canEditAllTasks":false,"canViewExecutiveAnalytics":false}'::jsonb
  end;
$$;

create or replace function public.clamp_user_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ceiling jsonb;
  v_key text;
  v_clamped jsonb;
begin
  -- Super Admins are trusted to set permissions directly (including
  -- granting the ceiling itself to a new Super Admin/Chief Officer).
  if public.current_app_role() = 'super_admin' then
    return new;
  end if;

  v_ceiling := public.role_permission_ceiling(new.role);
  v_clamped := coalesce(new.permissions, '{}'::jsonb);

  for v_key in select jsonb_object_keys(v_ceiling) loop
    if coalesce((v_clamped->>v_key)::boolean, false)
       and not coalesce((v_ceiling->>v_key)::boolean, false)
    then
      v_clamped := jsonb_set(v_clamped, array[v_key], 'false'::jsonb);
    end if;
  end loop;

  new.permissions := v_clamped;
  return new;
end;
$$;

drop trigger if exists trg_clamp_user_permissions on public.users;
create trigger trg_clamp_user_permissions
  before insert or update of permissions, role on public.users
  for each row execute function public.clamp_user_permissions();
