-- Run this once if 16_chat_direct_and_group.sql failed partway through
-- (e.g. "type conversation_type already exists"). It only touches the
-- chat objects from that migration — safe to run even if some of them
-- don't exist yet.

drop table if exists public.messages cascade;
drop table if exists public.conversation_members cascade;
drop table if exists public.conversations cascade;
drop function if exists public.list_my_conversations() cascade;
drop function if exists public.is_conversation_member(uuid) cascade;
drop function if exists public.touch_conversation_last_message() cascade;
drop function if exists public.enforce_direct_conversation_member_limit() cascade;
drop type if exists conversation_type cascade;
