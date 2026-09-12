-- =====================================================================
-- 22_fix_conversations_returning_gap.sql
-- =====================================================================
-- Real bug: starting ANY new conversation (direct or group) failed
-- with "new row violates row-level security policy for table
-- conversations" — for every account, every role, no exceptions.
--
-- Root cause: `db.ts`'s createConversation() does
--   INSERT INTO conversations (...) RETURNING *
-- and only AFTERWARDS adds the creator to conversation_members in a
-- separate query. Postgres enforces the table's SELECT policy on a
-- RETURNING row exactly like it would a plain SELECT — and at the
-- moment of the INSERT, the creator isn't a conversation_members row
-- yet, so conversations_select's `is_conversation_member(id)` check
-- fails. The INSERT itself (WITH CHECK) was always fine; the row just
-- couldn't be read back to return it, which surfaces as this same RLS
-- error, not a distinct "0 rows" result.
--
-- This was found and root-caused via extensive live debugging against
-- production (JWT decode, pg_policies inspection, testing with
-- `with check (true)`, and finally reproducing the exact failure with
-- a table-select-policy-free scratch table) — see chat history. The
-- fix was applied directly via the Supabase SQL editor at the time but
-- never saved back into a migration file until now, which meant a
-- fresh/rebuilt database would still ship with the broken behavior.
--
-- Fix: let the creator see a conversation they just created, in
-- addition to actual members — closes the timing gap without loosening
-- security (created_by is always the authenticated user's own id,
-- enforced by conversations_insert's WITH CHECK).
--
-- Run this once, after 21_audit_followups.sql, in the Supabase SQL
-- editor.
-- =====================================================================

drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations
  for select using (
    created_by = (public.current_app_user()).id
    or public.is_conversation_member(id)
  );
