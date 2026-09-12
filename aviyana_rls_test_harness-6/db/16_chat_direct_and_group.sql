-- =====================================================================
-- 16_chat_direct_and_group.sql
-- =====================================================================
-- Adds Direct Messages + Group Chat (see AVIYANA_NEXT_STEPS.md §2).
--
-- Decisions baked into this migration:
--   - Who can start a GROUP chat: dept_head, chief_officer, super_admin
--     only. Any authenticated user can start a DIRECT (1:1) chat with
--     anyone, including up their reporting chain (a Staff member can DM
--     a Dept Head/Chief Officer/Super Admin directly).
--   - Confidential messages reuse the exact same pattern as task remarks
--     (`is_encrypted` — masked client-side until "Reveal" is clicked; it
--     is NOT real encryption, matching task_remarks.is_encrypted today).
--   - `related_task_id` lets a task's "Discuss this task" action jump
--     straight into (or create) a DM with the task's assignee, with the
--     conversation carrying context back to that task.
--
-- Run this once, after 15_storage_avatars_and_attachments.sql, in the
-- Supabase SQL editor.
-- =====================================================================

do $$
begin
  create type conversation_type as enum ('direct', 'group');
exception when duplicate_object then
  null;
end $$;

-- ---------------------------------------------------------------------
-- CONVERSATIONS
-- ---------------------------------------------------------------------
create table if not exists public.conversations (
  id                uuid primary key default gen_random_uuid(),
  type              conversation_type not null,
  name              text,
  created_by        uuid not null references public.users(id) on delete restrict,
  related_task_id   uuid references public.tasks(id) on delete set null,
  created_at        timestamptz not null default now(),
  last_message_at   timestamptz not null default now(),
  constraint group_conversations_require_a_name
    check (type = 'direct' or (name is not null and length(trim(name)) > 0))
);

create index if not exists idx_conversations_last_message on public.conversations(last_message_at desc);

-- ---------------------------------------------------------------------
-- CONVERSATION MEMBERS
-- ---------------------------------------------------------------------
create table if not exists public.conversation_members (
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  user_id          uuid not null references public.users(id) on delete cascade,
  joined_at        timestamptz not null default now(),
  last_read_at     timestamptz,
  primary key (conversation_id, user_id)
);

create index if not exists idx_conversation_members_user on public.conversation_members(user_id);

-- Defense-in-depth: a 'direct' conversation can never end up with more
-- than 2 members, even if something inserts extra rows later.
create or replace function public.enforce_direct_conversation_member_limit()
returns trigger language plpgsql as $$
declare
  v_type  conversation_type;
  v_count integer;
begin
  select type into v_type from public.conversations where id = new.conversation_id;
  if v_type = 'direct' then
    select count(*) into v_count from public.conversation_members where conversation_id = new.conversation_id;
    if v_count > 2 then
      raise exception 'Direct conversations can only have 2 members';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_direct_member_limit on public.conversation_members;
create trigger trg_enforce_direct_member_limit
  after insert on public.conversation_members
  for each row execute function public.enforce_direct_conversation_member_limit();

-- ---------------------------------------------------------------------
-- MESSAGES
-- ---------------------------------------------------------------------
create table if not exists public.messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.conversations(id) on delete cascade,
  sender_id         uuid not null references public.users(id) on delete restrict,
  text              text not null,
  is_encrypted      boolean not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists idx_messages_conversation on public.messages(conversation_id, created_at);

-- Keep conversations.last_message_at current so the conversation list
-- can sort "most recent first" with a plain ORDER BY, no join required.
create or replace function public.touch_conversation_last_message()
returns trigger language plpgsql as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_messages_touch_conversation on public.messages;
create trigger trg_messages_touch_conversation
  after insert on public.messages
  for each row execute function public.touch_conversation_last_message();

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

-- Helper: is the caller a member of this conversation?
create or replace function public.is_conversation_member(p_conversation_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation_id
      and user_id = (public.current_app_user()).id
  );
$$;

-- CONVERSATIONS: only visible to members. Creating a 'group' requires
-- dept_head/chief_officer/super_admin; 'direct' is open to anyone.
drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations
  for select using (public.is_conversation_member(id));

drop policy if exists conversations_insert on public.conversations;
create policy conversations_insert on public.conversations
  for insert with check (
    created_by = (public.current_app_user()).id
    and (
      type = 'direct'
      or (type = 'group' and public.current_app_role() in ('dept_head', 'chief_officer', 'super_admin'))
    )
  );

-- CONVERSATION MEMBERS: only visible to fellow members. Only the
-- conversation's creator can add member rows (done once, at creation
-- time, in the same client-side transaction as the conversations
-- insert above). Each member can update only their own row (used for
-- `last_read_at`, which powers the unread badge).
drop policy if exists conversation_members_select on public.conversation_members;
create policy conversation_members_select on public.conversation_members
  for select using (public.is_conversation_member(conversation_id));

drop policy if exists conversation_members_insert on public.conversation_members;
create policy conversation_members_insert on public.conversation_members
  for insert with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_members.conversation_id
        and c.created_by = (public.current_app_user()).id
    )
  );

drop policy if exists conversation_members_update_own on public.conversation_members;
create policy conversation_members_update_own on public.conversation_members
  for update using (user_id = (public.current_app_user()).id)
  with check (user_id = (public.current_app_user()).id);

-- MESSAGES: only visible to conversation members; only postable by the
-- sender, and only into a conversation they're a member of.
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select using (public.is_conversation_member(conversation_id));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert with check (
    sender_id = (public.current_app_user()).id
    and public.is_conversation_member(conversation_id)
  );

-- ---------------------------------------------------------------------
-- RPC: list the caller's conversations with a last-message preview and
-- unread count in a single round trip (avoids N+1 queries from the
-- client). security definer so it can read across conversations/
-- messages/members, but it only ever returns rows the caller is a
-- member of — the join against conversation_members does that filtering.
-- ---------------------------------------------------------------------
create or replace function public.list_my_conversations()
returns table (
  id                       uuid,
  type                     conversation_type,
  name                     text,
  created_by               uuid,
  related_task_id          uuid,
  created_at               timestamptz,
  last_message_at          timestamptz,
  last_message_text        text,
  last_message_sender_id   uuid,
  last_message_is_encrypted boolean,
  last_read_at             timestamptz,
  unread_count             integer,
  member_ids               uuid[]
)
language sql stable security definer as $$
  select
    c.id, c.type, c.name, c.created_by, c.related_task_id, c.created_at, c.last_message_at,
    lm.text, lm.sender_id, lm.is_encrypted,
    my_membership.last_read_at,
    (
      select count(*)::int from public.messages m2
      where m2.conversation_id = c.id
        and m2.sender_id <> (public.current_app_user()).id
        and m2.created_at > coalesce(my_membership.last_read_at, 'epoch'::timestamptz)
    ) as unread_count,
    (
      select array_agg(cm2.user_id) from public.conversation_members cm2
      where cm2.conversation_id = c.id
    ) as member_ids
  from public.conversations c
  join public.conversation_members my_membership
    on my_membership.conversation_id = c.id
   and my_membership.user_id = (public.current_app_user()).id
  left join lateral (
    select m.text, m.sender_id, m.is_encrypted
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) lm on true
  order by c.last_message_at desc, c.created_at desc;
$$;

grant execute on function public.list_my_conversations() to authenticated;

-- ---------------------------------------------------------------------
-- REALTIME — same pattern as 09_enable_realtime.sql. Wrapped in DO
-- blocks because ALTER PUBLICATION ... ADD TABLE has no IF NOT EXISTS.
-- ---------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.conversations;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.conversation_members;
exception when duplicate_object then
  null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then
  null;
end $$;
