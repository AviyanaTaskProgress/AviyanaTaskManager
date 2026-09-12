-- =====================================================================
-- 00_supabase_mocks.sql — local Postgres shim for the RLS test harness
-- =====================================================================
-- Replicates just enough of a real Supabase project's baked-in
-- environment for server/db/schema.sql and 01..30 to run UNMODIFIED
-- against a plain local Postgres 16:
--   - auth schema: auth.users table, auth.uid()/auth.role() reading
--     PostgREST-style GUCs (request.jwt.claim.sub / .role) — same
--     mechanism Supabase itself uses.
--   - extensions schema (pgcrypto lives here for real; pg_net/http are
--     locally-installed NO-OP stub extensions — see the two dummy
--     extension files added to the Postgres extension directory. Real
--     outbound HTTP is never needed for RLS/business-logic testing,
--     and both notify_push()/notify_slack() already short-circuit
--     before calling them when _push_config/slack_config are empty,
--     which they are in a fresh harness).
--   - storage schema: buckets/objects tables, enough for the storage
--     RLS policies and bucket inserts in 15/24/25 to apply cleanly.
--   - anon / authenticated / service_role / supabase_auth_admin roles
--     + the baseline grants a real Supabase project ships with, via
--     ALTER DEFAULT PRIVILEGES so every table schema.sql/the
--     migrations create from here on picks them up automatically.
--
-- Run this FIRST, before schema.sql, against a brand-new database.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin noinherit createrole login password 'harness';
  end if;
end $$;

grant anon to postgres;
grant authenticated to postgres;
grant service_role to postgres;

-- ---------------------------------------------------------------------
-- auth schema
-- ---------------------------------------------------------------------
create schema if not exists auth;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  encrypted_password  text not null default '',
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  email_confirmed_at  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '');
$$;

-- ---------------------------------------------------------------------
-- extensions schema (pg_net / http control files are pre-installed as
-- dummy stub extensions — see run_all.sh for how the harness sets that
-- up before this script runs).
-- ---------------------------------------------------------------------
create schema if not exists extensions;
grant usage on schema extensions to public;

-- Supabase pre-creates this publication for Realtime; migration 09
-- just adds tables to it.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- storage schema
-- ---------------------------------------------------------------------
create schema if not exists storage;

create table if not exists storage.buckets (
  id          text primary key,
  name        text not null,
  public      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text references storage.buckets(id),
  name        text,
  owner       uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  metadata    jsonb default '{}'::jsonb
);

alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;

drop policy if exists storage_buckets_read_all on storage.buckets;
create policy storage_buckets_read_all on storage.buckets for select using (true);

-- Real Supabase storage helper — splits an object name on '/' and
-- drops the last segment (the filename), leaving the folder path
-- parts. Used by this project's storage RLS policies as
-- `(storage.foldername(name))[1] = <user id>` to scope uploads to a
-- per-user folder (e.g. avatars/<user_id>/pic.png).
create or replace function storage.foldername(name text)
returns text[]
language sql immutable as $$
  select case
    when position('/' in name) = 0 then '{}'::text[]
    else (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
  end;
$$;

-- ---------------------------------------------------------------------
-- Baseline grants (mirrors what a real Supabase project ships with —
-- RLS is the real gate, these grants just get callers past the "no
-- privilege" wall before RLS is even evaluated).
-- ---------------------------------------------------------------------
grant usage on schema public to postgres, anon, authenticated, service_role, supabase_auth_admin;
grant usage on schema auth to postgres, anon, authenticated, service_role, supabase_auth_admin;
grant usage on schema storage to postgres, anon, authenticated, service_role;
grant usage on schema extensions to postgres, anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema storage to authenticated, service_role;
grant select on all tables in schema storage to anon;
grant select, insert, update, delete on auth.users to supabase_auth_admin, service_role;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to anon, authenticated, service_role;

-- Test-only session helpers (test_act_as, etc.) live in
-- 99_test_helpers.sql, run at the very end — they need public.users to
-- already exist, which it doesn't yet at this point in the chain.
