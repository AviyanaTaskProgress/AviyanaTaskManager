# Aviyana Task Manager — Go-Live Checklist

**Written:** end of the 2026-09 feature/audit session (subtasks, payments, task IDs,
reminders/alarms, role-based access fixes, full security audit, full UX audit, full
backend/frontend engineering audit, and a final "what's still missing" pass).

Everything in this session is **code and schema** — implemented, tested (58-assertion
local Postgres harness, rebuilt from scratch, 0 failures; `tsc`/vitest/`vite build` all
clean). The items in Section 3 are **data/config**, not code — nothing in this repo can
set them for you.

---

## 1. Database migrations — run in this exact order

If `21_audit_followups.sql` and earlier were already confirmed run (per
`SESSION_HANDOFF.md`), everything from here is new this session:

```
27_task_subtasks.sql
28_task_display_id.sql
29_task_payment_workflow.sql          -- ⚠️ see note below
30_assigned_by_and_completed_counter.sql
31_staff_self_log_tasks.sql
32_chief_officer_cross_dept_tasks.sql
33_task_reminders_and_alarms.sql      -- ⚠️ see note below
34_audit_fixes_delete_policy_and_search_path.sql
35_missing_indexes.sql
36_backup_restore_covers_new_tables.sql
37_urgent_push_notifications.sql
```

**⚠️ `29_task_payment_workflow.sql`** — its first statement (`alter type task_status add
value 'pending_payment'`) can hit "unsafe use of new value of enum type" if your SQL
editor wraps the whole pasted file in one transaction. If that happens: run just that one
line by itself, run it again, then run the rest of the file — everything below it is
idempotent.

**⚠️ `37_urgent_push_notifications.sql`** — after running it, redeploy the Edge Function
so it reads the new field:
```
supabase functions deploy send-push
```

Optional automated runner (tracks what's applied, skips duplicates, stops on first
failure) instead of pasting files one at a time:
```
DATABASE_URL="postgres://postgres:PASSWORD@HOST:5432/postgres" ./deploy_migrations.sh
```

---

## 2. Verify after running the migrations

Run these in the SQL editor after the migration chain finishes — every one should
return an empty/zero result:

```sql
-- Every department got a code assigned
select name from departments where code is null;

-- No orphaned or duplicate task display IDs
select task_display_id, count(*) from tasks group by task_display_id having count(*) > 1;

-- pg_cron is actually scheduled (needs the extension enabled — see 3.4 below)
select * from cron.job where jobname = 'send-deadline-reminders';
```

---

## 3. Operational checklist — data/config only, not code

None of these can be verified or set from this repo — they're account/dashboard-level
settings on your actual Supabase project.

- [ ] **3.1 — `pg_cron` extension enabled.** Supabase Dashboard → Database → Extensions
      → enable `pg_cron`. Without this, automatic 3-day/1-day deadline reminders are
      silently never scheduled (migration 33 catches this and logs a warning instead of
      failing the migration, but the feature won't run until it's on).
- [ ] **3.2 — Push notifications (VAPID keys).** See `PUSH_NOTIFICATIONS_SETUP.md` in
      `server/db/`. Needs `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, and
      `PUSH_TRIGGER_SECRET` set as Edge Function secrets, matching the value inserted into
      `public._push_config`. Without these, in-app notifications/alarms still work
      (AlarmSiren rings while the tab is open) but nothing reaches a closed browser/phone.
- [ ] **3.3 — Slack integration**, if wanted: a Super Admin/Dept Head configures the
      webhook from Settings → Slack in the app itself (`SettingsView.tsx` /
      `slack_config` table) — this is a real in-app admin flow, not something to set via
      SQL.
- [ ] **3.4 — Danushka's account migration** (from `SESSION_HANDOFF.md`, still open as of
      that doc) — confirm whether this was completed; if not, the steps are still in that
      file.
- [ ] **3.5 — Ishan's dual-account split** (from `SESSION_HANDOFF.md`) — recommended,
      still not executed as of that doc.
- [ ] **3.6 — Real logo.** `public/icon-192.png`, `icon-512.png`, `icon-512-maskable.png`,
      `apple-touch-icon.png` are placeholder "A" monograms in the brand colors — swap
      these four files for the real Aviyana logo at the same sizes/filenames whenever
      it's available. `manifest.json`/`index.html` already reference them correctly.

---

## 4. What was tested vs. what genuinely wasn't

**Tested** (58-assertion Postgres harness, rebuilt from a blank database every run):
subtasks + auto-progress, task ID generation, payment approval workflow, role-based
access (Staff self-log, Dept Head department-locking, Chief Officer cross-department),
deadline reminders, Ring Alarm (role/department/cooldown), every security fix (RLS
delete gap, function execute lockdown, notification tamper-proofing, negative-amount
constraint), backup/restore round-trip (subtasks, counters, completed-count all survive).

**Still genuinely NOT covered by any automated test** (same honest caveat as the
original `SESSION_HANDOFF.md` carried forward): real push/Slack HTTP delivery (both are
stubbed in the harness — pg_net/http don't exist outside Supabase Cloud), actual mobile
device testing (only responsive CSS review), a live staging deploy with a real
multi-person click-through, and concurrent/race-condition scenarios under real load.

---

## 5. Session totals, for the record

- Migrations: `27` → `37` (11 new)
- Automated tests: 30 → 55 (vitest) + 58 assertions (SQL harness)
- Main JS bundle: 627KB → 273KB
- Critical bugs found and fixed that never shipped: `tasks` table missing a DELETE
  policy entirely, an RLS-bypassable internal function anyone could call directly,
  backup/restore silently destroying all subtasks + corrupting task ID sequences on
  every restore, a function-overload bug that would have broken every push notification
  trigger on deploy.
