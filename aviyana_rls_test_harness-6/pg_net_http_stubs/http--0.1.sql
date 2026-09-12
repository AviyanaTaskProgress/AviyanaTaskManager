create type http_response as (
  status int,
  content_type text,
  headers text[],
  content text
);

create or replace function http_post(uri text, content text, content_type text)
returns http_response
language plpgsql as $$
begin
  raise notice 'http_post stub (harness, no real HTTP call): uri=%', uri;
  return row(200, content_type, array[]::text[], '{}')::http_response;
end;
$$;
