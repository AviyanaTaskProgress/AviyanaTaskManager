-- ============================================================
-- FIX 1: "Database error creating new user" on signup
-- Run this ONCE in Supabase → SQL Editor
-- ============================================================
-- Cause: GoTrue (Supabase Auth) inserts into auth.users using the
-- `supabase_auth_admin` role. Even though handle_new_auth_user() is
-- SECURITY DEFINER, that role still needs explicit grants to write
-- into public.users, or signup fails with a generic error.

grant usage on schema public to supabase_auth_admin;
grant select, insert, update on public.users to supabase_auth_admin;
grant usage, select on all sequences in schema public to supabase_auth_admin;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (auth_user_id, name, email, department)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    coalesce((new.raw_user_meta_data->>'department')::department, 'Operations')
  );
  return new;
end;
$$;
