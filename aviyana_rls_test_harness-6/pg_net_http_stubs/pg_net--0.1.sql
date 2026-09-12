create schema if not exists net;

create or replace function net.http_post(
  url text,
  headers jsonb default '{}'::jsonb,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  timeout_milliseconds int default 5000
) returns bigint
language plpgsql as $$
begin
  raise notice 'net.http_post stub (harness, no real HTTP call): url=%', url;
  return 0;
end;
$$;
