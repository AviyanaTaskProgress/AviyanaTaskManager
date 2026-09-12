create schema if not exists cron;

create table if not exists cron.job (
  jobid bigint generated always as identity primary key,
  jobname text unique,
  schedule text,
  command text
);

create or replace function cron.schedule(job_name text, schedule text, command text)
returns bigint
language plpgsql as $$
declare
  v_id bigint;
begin
  insert into cron.job (jobname, schedule, command)
  values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid into v_id;
  raise notice 'cron.schedule stub (harness, never actually fires): % -> %', job_name, schedule;
  return v_id;
end;
$$;

create or replace function cron.unschedule(job_name text)
returns boolean
language plpgsql as $$
begin
  delete from cron.job where jobname = job_name;
  return found;
end;
$$;
