-- =====================================================================
-- 28_task_display_id.sql
-- =====================================================================
-- Feature: human-readable task IDs like `IT-0001`, `MKT-0032` instead of
-- the raw uuid, auto-generated per department.
--
-- Departments are dynamic (17_dynamic_departments.sql) so codes can't be
-- hardcoded — this migration adds a `code` column to `departments` and
-- auto-derives one from the department name if a Super Admin doesn't
-- set one explicitly (e.g. "Product & Design" -> "PD", "Engineering"
-- -> "ENG"). Existing departments get backfilled the same way; a Super
-- Admin can always overwrite a code later with a plain UPDATE.
--
-- Run this once, after 27_task_subtasks.sql, in the Supabase SQL
-- editor.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. departments.code — auto-derived if not supplied.
-- ---------------------------------------------------------------------
alter table public.departments add column if not exists code text;

create or replace function public.derive_department_code(p_name text)
returns text language plpgsql stable as $$
declare
  v_words text[];
  v_code text;
begin
  -- Split on whitespace, drop bare connector words ("&", "and", "-").
  select array_agg(w) into v_words
  from unnest(regexp_split_to_array(trim(p_name), '\s+')) as w
  where w <> '' and lower(w) not in ('&', 'and', '-');

  if array_length(v_words, 1) is null then
    return 'GEN';
  elsif array_length(v_words, 1) = 1 then
    -- Single word: first 3 letters, e.g. "Engineering" -> "ENG".
    v_code := upper(substring(regexp_replace(v_words[1], '[^a-zA-Z]', '', 'g') from 1 for 3));
  else
    -- Multiple words: first letter of up to 3 significant words,
    -- e.g. "Product & Design" -> "PD", "Sales & Growth" -> "SG".
    select upper(string_agg(left(regexp_replace(w, '[^a-zA-Z]', '', 'g'), 1), ''))
      into v_code
      from unnest(v_words[1:3]) as w;
  end if;

  return coalesce(nullif(v_code, ''), 'GEN');
end;
$$;

-- Assigns a code on insert if the Super Admin didn't type one, and
-- resolves collisions (two dissimilar department names deriving the
-- same code) by appending 2, 3, ... until unique.
create or replace function public.trg_departments_assign_code()
returns trigger language plpgsql security definer as $$
declare
  v_base text;
  v_candidate text;
  v_suffix integer := 1;
begin
  if new.code is not null and length(trim(new.code)) > 0 then
    new.code := upper(trim(new.code));
    return new;
  end if;

  v_base := public.derive_department_code(new.name);
  v_candidate := v_base;
  while exists (select 1 from public.departments where code = v_candidate and name <> new.name) loop
    v_suffix := v_suffix + 1;
    v_candidate := v_base || v_suffix::text;
  end loop;

  new.code := v_candidate;
  return new;
end;
$$;

drop trigger if exists trg_departments_assign_code on public.departments;
create trigger trg_departments_assign_code
  before insert on public.departments
  for each row execute function public.trg_departments_assign_code();

-- Backfill existing departments that predate this migration.
update public.departments
  set code = public.derive_department_code(name)
  where code is null;

-- Resolve any collisions the backfill itself created (rare — only if
-- two existing department names happen to derive the same code).
do $$
declare
  r record;
  v_suffix integer;
  v_candidate text;
begin
  for r in
    select name, code, row_number() over (partition by code order by name) as rn
    from public.departments
  loop
    if r.rn > 1 then
      v_suffix := r.rn;
      v_candidate := r.code || v_suffix::text;
      update public.departments set code = v_candidate where name = r.name;
    end if;
  end loop;
end $$;

alter table public.departments
  add constraint departments_code_unique unique (code);

alter table public.departments
  alter column code set not null;

-- ---------------------------------------------------------------------
-- 2. Per-department running counter + tasks.task_display_id.
-- ---------------------------------------------------------------------
create table if not exists public.department_task_counters (
  department_name  text primary key references public.departments(name) on delete cascade,
  next_seq         integer not null default 1
);

alter table public.department_task_counters enable row level security;

-- Read-only-ish table, not exposed to the client directly — only ever
-- touched by the security-definer trigger below. No client-facing
-- policy needed; RLS enabled with zero policies = deny-all to normal
-- clients, exactly what we want here.

alter table public.tasks add column if not exists task_display_id text;

-- Atomically claims the next sequence number for a department in a
-- single statement (upsert + returning), safe under concurrent inserts
-- without a separate lock/select-for-update round trip.
create or replace function public.trg_tasks_generate_display_id()
returns trigger language plpgsql security definer as $$
declare
  v_code text;
  v_seq integer;
begin
  if new.task_display_id is not null then
    return new;
  end if;

  select code into v_code from public.departments where name = new.department;
  v_code := coalesce(v_code, 'GEN');

  insert into public.department_task_counters (department_name, next_seq)
  values (new.department, 2)
  on conflict (department_name) do update
    set next_seq = public.department_task_counters.next_seq + 1
  returning next_seq - 1 into v_seq;

  new.task_display_id := v_code || '-' || lpad(v_seq::text, 4, '0');
  return new;
end;
$$;

drop trigger if exists trg_tasks_generate_display_id on public.tasks;
create trigger trg_tasks_generate_display_id
  before insert on public.tasks
  for each row execute function public.trg_tasks_generate_display_id();

-- Backfill existing tasks in creation order, per department, using the
-- same counter table so newly-created tasks continue the sequence
-- without collisions.
do $$
declare
  r record;
  v_code text;
  v_seq integer;
begin
  for r in select id, department from public.tasks where task_display_id is null order by department, created_at loop
    select code into v_code from public.departments where name = r.department;
    v_code := coalesce(v_code, 'GEN');

    insert into public.department_task_counters (department_name, next_seq)
    values (r.department, 2)
    on conflict (department_name) do update
      set next_seq = public.department_task_counters.next_seq + 1
    returning next_seq - 1 into v_seq;

    update public.tasks set task_display_id = v_code || '-' || lpad(v_seq::text, 4, '0') where id = r.id;
  end loop;
end $$;

alter table public.tasks
  add constraint tasks_display_id_unique unique (task_display_id);

alter table public.tasks
  alter column task_display_id set not null;

create index if not exists idx_tasks_display_id on public.tasks(task_display_id);
