-- =====================================================================
-- 20_push_notifications.sql
-- =====================================================================
-- Web Push notifications for: task assigned, new remark, task
-- approved/rejected, and new chat message.
--
-- How it works end to end:
--   1. The browser subscribes to push (src/lib/push.ts) and saves the
--      subscription in push_subscriptions below.
--   2. A trigger on the relevant table calls public.notify_push(...),
--      which uses the pg_net extension to fire an async HTTP POST to a
--      Supabase Edge Function (supabase/functions/send-push).
--   3. That Edge Function looks up the target users' subscriptions and
--      sends the actual Web Push messages using VAPID keys.
--
-- This migration ONLY sets up the database side. You still need to,
-- after running this file:
--   1. Generate a VAPID key pair                 → see PUSH_NOTIFICATIONS_SETUP.md
--   2. Deploy the Edge Function                   → see PUSH_NOTIFICATIONS_SETUP.md
--   3. Run the one-line SQL at the very bottom of this file, filling in
--      your real Edge Function URL + a secret you choose (both are
--      referenced by every trigger below via public.notify_push()).
--
-- Run this once, after 19_viewer_hardening.sql, in the Supabase SQL
-- editor. Everything in this file is safe to re-run.
-- =====================================================================

create extension if not exists pg_net;
-- No `with schema` clause — pg_net always exposes its functions under a
-- schema named `net` (see 03_go_backendless.sql, which installs it the
-- same way). An earlier draft of this file added `with schema extensions`,
-- which would have installed it somewhere `net.http_post()` below
-- couldn't find it, on any database where 03 hadn't already run first.

-- ---------------------------------------------------------------------
-- SUBSCRIPTIONS
-- ---------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select using (user_id = (public.current_app_user()).id);

drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert with check (user_id = (public.current_app_user()).id);

drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete using (user_id = (public.current_app_user()).id);

-- ---------------------------------------------------------------------
-- Config: where to send the trigger HTTP calls, and the shared secret
-- the Edge Function checks so randos can't spam it. Stored in a table
-- (not a GUC) so it survives connection pooling / restarts cleanly.
-- Nobody can read this via the API — no RLS policies means "select"
-- is denied to everyone except the table owner (used only from
-- SECURITY DEFINER functions below).
-- ---------------------------------------------------------------------
create table if not exists public._push_config (
  key    text primary key,
  value  text not null
);
alter table public._push_config enable row level security;
-- Intentionally NO policies — RLS with zero policies means "nobody via
-- the API", which is exactly what we want for a secret. Only functions
-- running as the table owner (security definer, see below) can read it.

-- ---------------------------------------------------------------------
-- The one function every trigger below calls. Fire-and-forget: uses
-- pg_net's async http POST so a slow/broken push never blocks the
-- actual task/message/remark insert that triggered it.
-- ---------------------------------------------------------------------
create or replace function public.notify_push(p_user_ids uuid[], p_title text, p_body text, p_url text default '/')
returns void
language plpgsql
security definer
as $$
declare
  v_url    text;
  v_secret text;
begin
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return;
  end if;

  select value into v_url    from public._push_config where key = 'edge_function_url';
  select value into v_secret from public._push_config where key = 'trigger_secret';

  if v_url is null or v_secret is null then
    -- Not configured yet — see PUSH_NOTIFICATIONS_SETUP.md. Silently
    -- no-op rather than breaking the task/message insert that called this.
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := jsonb_build_object('user_ids', to_jsonb(p_user_ids), 'title', p_title, 'body', p_body, 'url', p_url)
  );
exception when others then
  -- This function only ever runs as a side-effect of a trigger on
  -- tasks/task_remarks/messages. The comment above says a broken push
  -- "never blocks" the real insert — but until this handler existed,
  -- that was only true for the "not configured yet" case. Any OTHER
  -- error in here (a future bug, a config row with an unexpected
  -- shape, pg_net misbehaving) would propagate straight up through the
  -- AFTER trigger and abort the entire task/message/remark write.
  -- Swallow it here instead — logged via RAISE WARNING so it's still
  -- visible in Postgres logs, but never able to break core app writes.
  raise warning 'notify_push failed (swallowed to protect the caller): %', sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. Task assigned — fires whenever a task is created, or an existing
--    task's assignee changes.
-- ---------------------------------------------------------------------
create or replace function public.trg_notify_task_assigned()
returns trigger language plpgsql security definer as $$
begin
  if (tg_op = 'INSERT') or (tg_op = 'UPDATE' and new.assignee_id is distinct from old.assignee_id) then
    perform public.notify_push(
      array[new.assignee_id],
      'New task assigned',
      new.title,
      '/'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_notify_assigned on public.tasks;
create trigger trg_tasks_notify_assigned
  after insert or update on public.tasks
  for each row execute function public.trg_notify_task_assigned();

-- ---------------------------------------------------------------------
-- 2. Task approved / rejected — fires when approval_status changes.
--    Notifies the assignee (the person who submitted it for approval).
-- ---------------------------------------------------------------------
create or replace function public.trg_notify_task_approval()
returns trigger language plpgsql security definer as $$
begin
  if new.approval_status is distinct from old.approval_status
     and new.approval_status in ('approved', 'rejected') then
    perform public.notify_push(
      array[new.assignee_id],
      case when new.approval_status = 'approved' then 'Task approved' else 'Task sent back' end,
      new.title,
      '/'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tasks_notify_approval on public.tasks;
create trigger trg_tasks_notify_approval
  after update on public.tasks
  for each row execute function public.trg_notify_task_approval();

-- ---------------------------------------------------------------------
-- 3. New remark — notifies the task's assignee and creator, excluding
--    whoever just wrote the remark.
-- ---------------------------------------------------------------------
create or replace function public.trg_notify_new_remark()
returns trigger language plpgsql security definer as $$
declare
  v_task public.tasks;
  v_recipients uuid[];
begin
  select * into v_task from public.tasks where id = new.task_id;
  if v_task.id is null then
    return new;
  end if;

  select array_agg(distinct uid) into v_recipients
  from unnest(array[v_task.assignee_id, v_task.created_by_id]) as uid
  where uid <> new.author_id;

  perform public.notify_push(
    v_recipients,
    'New remark',
    coalesce(v_task.title, 'A task you''re on'),
    '/'
  );
  return new;
end;
$$;

drop trigger if exists trg_remarks_notify on public.task_remarks;
create trigger trg_remarks_notify
  after insert on public.task_remarks
  for each row execute function public.trg_notify_new_remark();

-- ---------------------------------------------------------------------
-- 4. New chat message — notifies every other member of the conversation.
-- ---------------------------------------------------------------------
create or replace function public.trg_notify_new_message()
returns trigger language plpgsql security definer as $$
declare
  v_recipients uuid[];
  v_sender_name text;
begin
  select array_agg(user_id) into v_recipients
  from public.conversation_members
  where conversation_id = new.conversation_id
    and user_id <> new.sender_id;

  select name into v_sender_name from public.users where id = new.sender_id;

  perform public.notify_push(
    v_recipients,
    coalesce(v_sender_name, 'New message'),
    case when new.is_encrypted then 'Sent a confidential message' else new.text end,
    '/'
  );
  return new;
end;
$$;

drop trigger if exists trg_messages_notify on public.messages;
create trigger trg_messages_notify
  after insert on public.messages
  for each row execute function public.trg_notify_new_message();

-- =====================================================================
-- LAST STEP — run this yourself with your real values (see
-- PUSH_NOTIFICATIONS_SETUP.md for where these come from):
-- =====================================================================
-- insert into public._push_config (key, value) values
--   ('edge_function_url', 'https://wncxxfnnapytvldbxzae.supabase.co/functions/v1/send-push'),
--   ('trigger_secret', 'PASTE_A_LONG_RANDOM_SECRET_HERE')
-- on conflict (key) do update set value = excluded.value;
