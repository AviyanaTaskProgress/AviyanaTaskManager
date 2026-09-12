-- =====================================================================
-- 09_enable_realtime.sql
-- =====================================================================
-- Adds `tasks` and `notifications` to Supabase's realtime publication so
-- the frontend can subscribe to live changes (task assigned/approved/
-- updated, new notification) instead of only refreshing on click or
-- after its own mutations. Postgres Realtime still respects each table's
-- existing RLS SELECT policies — a subscriber only receives change events
-- for rows they'd be allowed to read anyway.
--
-- Wrapped in DO blocks because `ALTER PUBLICATION ... ADD TABLE` has no
-- IF NOT EXISTS form — running this twice would otherwise error.
--
-- Run this once, after 08_clamp_user_permissions.sql, in the Supabase SQL editor.
-- =====================================================================

do $$
begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then
  null;
end $$;
