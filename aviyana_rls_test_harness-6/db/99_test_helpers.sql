-- =====================================================================
-- 99_test_helpers.sql — test-only session helpers
-- =====================================================================
-- Run LAST, after every real migration (public.users must already
-- exist). Not part of the app's actual migration chain — never copy
-- this into a real Supabase project.
-- =====================================================================

-- Switch the current session to act as a given app user for the rest
-- of the transaction. Mirrors what PostgREST does per-request in real
-- Supabase (sets the jwt claim GUCs) plus an actual
-- `SET ROLE authenticated` so RLS is genuinely enforced (the
-- connecting superuser would otherwise bypass RLS entirely).
--
-- NOTE (matches a bug the team already hit once, see handoff notes):
-- this must stay a plain procedure, NOT security definer — Postgres
-- forbids `SET ROLE`/`SET LOCAL ROLE` inside a security definer
-- function. Split into a lookup (security definer, safe) and a plain
-- role-switch (not security definer) that calls it.
create or replace function public.__test_lookup_auth_id(p_email text)
returns uuid
language sql stable security definer as $$
  select auth_user_id from public.users where lower(email) = lower(p_email);
$$;

create or replace procedure public.test_act_as(p_email text)
language plpgsql as $$
declare
  v_auth_id uuid;
begin
  v_auth_id := public.__test_lookup_auth_id(p_email);
  if v_auth_id is null then
    raise exception 'test_act_as: no auth_user_id found for email %', p_email;
  end if;
  perform set_config('request.jwt.claim.sub', v_auth_id::text, false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  set role authenticated;
end;
$$;

create or replace procedure public.test_act_as_anon()
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim.role', 'anon', false);
  set role anon;
end;
$$;

-- Simple pass/fail assertion — raises (aborting the run, same as
-- ON_ERROR_STOP) on failure, notices on success, so a clean run prints
-- one PASS line per test and a failing one stops right at the culprit.
create or replace function public.assert_true(p_cond boolean, p_msg text)
returns void language plpgsql as $$
begin
  if not p_cond then
    raise exception 'FAIL: %', p_msg;
  else
    raise notice 'PASS: %', p_msg;
  end if;
end;
$$;

create or replace procedure public.test_reset_role()
language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim.role', '', false);
end;
$$;
