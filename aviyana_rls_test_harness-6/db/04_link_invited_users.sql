-- =====================================================================
-- 04_link_invited_users.sql
-- =====================================================================
-- Problem this fixes:
--   "Team → Provision New User" (src/context/AppContext.tsx addUser)
--   inserts a row straight into public.users with a role/department/
--   permissions the admin picked, but NO auth.users row — because the
--   browser only ever holds the Supabase ANON key, never the SERVICE
--   ROLE key. Creating real login credentials (an email+password) can
--   only be done with the service role key or an authenticated signUp
--   call from the person themselves. So today, an admin-provisioned
--   user has a profile row but literally no way to log in — there is
--   no password anywhere for them.
--
--   Worse: if that person later tries to self-sign-up (AuthScreen,
--   "Sign up" tab) with that same email, the OLD trigger below tries
--   to INSERT a second row into public.users, which fails on the
--   `email` unique constraint — signup breaks with a Postgres error.
--
-- Fix:
--   Turn self-signup into a "claim" step. When someone signs up with
--   an email that already exists as an admin-provisioned profile
--   (auth_user_id is null), LINK their new auth.users id to that
--   existing row instead of inserting a duplicate — keeping the
--   role/department/permissions the admin already set. If no such
--   profile exists, behave exactly as before (plain self-signup,
--   defaults to 'employee').
--
-- Run this once, after schema.sql, 01_fix_auth_trigger_permissions.sql
-- and 03_go_backendless.sql, in the Supabase SQL editor.
-- =====================================================================

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer as $$
declare
  existing_id uuid;
begin
  -- Was this email already provisioned by an admin (Team page) but
  -- never activated (no auth_user_id yet)?
  select id into existing_id
  from public.users
  where lower(email) = lower(new.email)
    and auth_user_id is null
  limit 1;

  if existing_id is not null then
    update public.users
    set auth_user_id = new.id,
        -- keep the admin-entered name unless the person typed one at signup
        name = coalesce(nullif(new.raw_user_meta_data->>'name', ''), name)
    where id = existing_id;
  else
    insert into public.users (auth_user_id, name, email, department)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
      new.email,
      coalesce((new.raw_user_meta_data->>'department')::department, 'Operations')
    );
  end if;

  return new;
end;
$$;

-- Trigger `trg_on_auth_user_created` already points at this function name,
-- so replacing the function body above is enough — no need to touch it.
