# Aviyana Task Manager — Full System Audit (Frontend / Backend / UI-UX / QA)

**Scope:** Entire codebase as of this session — including everything added recently (Chat, dynamic departments, Viewer role, Staff simplification, push notifications) — not just the new work in isolation.
**Method:** Full read-through of `src/`, `server/db/*.sql`, `supabase/functions/`, config files, plus a real `tsc --noEmit`, `vitest run`, and `vite build`. This is a static/code-level audit, not a manual click-through on a live staging deploy — see "What this can't verify" at the bottom.
**Result at time of writing:** `tsc` clean, 11/11 unit tests pass, production build succeeds. The 3 defects below were found and fixed in this same pass.

This builds on, and doesn't repeat, `AVIYANA_HONEST_AUDIT.md` and `AVIYANA_QA_AUDIT.md` from earlier sessions — those are still accurate for the areas they covered. This report focuses on what's new or was missed.

---

## 1. Defects found in this pass — STATUS: FIXED

### ✅ Fixed — `pg_net` extension installed into the wrong schema
`20_push_notifications.sql` had `create extension if not exists pg_net with schema extensions;`, but every trigger function in the same file calls `net.http_post(...)` — i.e. it assumes the extension lives in a schema called `net`, not `extensions`. On a database where `pg_net` wasn't already installed by `03_go_backendless.sql` (which does it correctly, no schema clause), this would have made every push-notification trigger fail with "function net.http_post does not exist." Fixed to match `03`'s pattern.

### ✅ Fixed — `completedDate` silently missing when a task is marked complete from the Edit Task form
There were three separate code paths that can set a task to "completed," and only two of them stamped `completedDate`:
- Kanban drag-to-Completed column (`TasksView.tsx`) — ✅ set it
- Approval flow (`decide_task_approval()` RPC) — ✅ set it (server-side)
- **Changing the status dropdown to "Completed" inside the Edit Task modal — ❌ did not set it**

This silently produced tasks with `status: 'completed'` but `completedDate: null`. The impact was concrete and current: `MyTasksDashboard.tsx`'s "Recently Completed" list falls back to showing the **due date** when `completedDate` is missing — so a task completed via this path would display a misleading date, indistinguishable from its deadline. Fixed by stamping `completedDate` in `TaskModal.tsx`'s submit handler whenever status transitions into `'completed'` from something else, mirroring the Kanban path.

### ✅ Fixed — "Edit Profile" role dropdown missing the `viewer` option (and not role-scoped)
`TeamManagementView.tsx`'s edit-existing-user form had a **separate, hardcoded** 4-option role `<select>` (`staff` / `dept_head` / `chief_officer` / `super_admin`) that predates the `viewer` role added this session. Opening the edit form for `chairmen@aviyana.lk` or `danushka@aviyana.lk` (if their role is `viewer`) would show a `<select>` whose current value doesn't match any rendered `<option>` — most browsers show nothing visibly selected in that state, which risks an admin accidentally changing the role while just trying to fix a name or avatar. It also let a Chief Officer or Dept Head see "Super Admin" as a pickable option, even though the underlying RLS policies would reject that write server-side (not a real privilege-escalation hole, but confusing UX that fails silently or with a raw database error). Fixed by deriving the dropdown's options from the same `assignableRoles` logic already used for the "New User" form, always including the edited user's current role so the `<select>` never has an orphaned value.

---

## 2. Frontend

### 🟡 Medium — Accessibility: near-zero `aria-label` coverage on icon-only controls
`grep -c "aria-label"` returns **0** for `Sidebar.tsx` and `TasksView.tsx`, and only 4 for `ChatView.tsx` despite each having many icon-driven interactive elements (view-mode toggles, sort toggles, close/back buttons, reveal/hide toggles). Sidebar's nav links do have visible text labels next to their icons, so those are fine for screen readers — but genuinely icon-only buttons elsewhere (modal close `X` buttons, message reveal/hide toggles in some spots) rely on their icon alone. Recommend a dedicated accessibility pass adding `aria-label` to every button whose only content is an `<Icon />`.

### 🟡 Low — `MyTasksDashboard`'s "Recently Completed" list can still show a due date instead of a completion date for tasks completed *before* this session's fix
The fix in §1 only prevents *new* completions via the modal from missing `completedDate` going forward — any task that was already marked complete through that path before this fix still has `completedDate: null` in the database. Not urgent (cosmetic, and self-heals as old tasks age out of the "recent" list), but worth knowing if a staff member points out a completed task showing what looks like its original deadline instead of when they actually finished it.

### 🟡 Low — Wide tables still require horizontal scroll on mobile
`TasksView.tsx`'s list view wraps its `<table>` in `overflow-x-auto`, which is the correct mechanism (it won't break the page layout), but a 9-column table on a phone screen still means a lot of side-scrolling to see status/progress/priority together. This wasn't rebuilt as part of this session's mobile-nav fixes since it's a separate concern (page content vs. navigation chrome). Worth a follow-up: either a dedicated mobile card layout for the list view, or defaulting phones to Kanban/Timeline view instead of the table.

### 🟢 Info — Bundle size still has one >500KB chunk
`ReportsView` (406 KB) and the main `index` chunk (591 KB, ~157 KB gzipped) are the two largest. This was flagged in the prior `AVIYANA_HONEST_AUDIT.md` and hasn't regressed further, but also hasn't been addressed — `jspdf` + `html2canvas` (used only by PDF export in Reports) are the likely bulk. Not urgent for a small internal tool on office wifi.

---

## 3. Backend / Database

### 🟡 Medium — Department name uniqueness is case-sensitive at the database level, case-insensitive only in the UI
`TeamManagementView.tsx`'s `addDepartment` action checks for a case-insensitive duplicate against the already-loaded `departments` list before inserting — but `departments.name` is a plain `text primary key` in Postgres, which compares case-*sensitively*. Two Super Admins adding "Engineering" and "ENGINEERING" in quick succession (a race the client-side check can't catch) would produce two separate department rows that a person would reasonably expect to be the same one. Low likelihood (single small admin team), but a `citext` primary key or a `unique index on lower(name)` would close this properly if it's worth the migration.

### 🟢 Info — `remarks_insert` policy predates this session and has a broader gap than anything found here
While reviewing task-related RLS for consistency, `task_remarks`'s insert policy (`for insert with check (author_id = (public.current_app_user()).id)`, from the original `schema.sql`) doesn't check that the author can actually *see* the task they're commenting on — only that they're commenting as themselves. This means any authenticated user could technically insert a remark on any task ID via a direct API call, regardless of visibility. This is pre-existing (not introduced by anything in this session) and out of scope to fix without a decision on intended behavior, but flagging it here since it came up during the RLS consistency review for the newer tables.

### 🟢 Info — `push_subscriptions.endpoint` unique constraint means a shared/reused browser can't silently switch owners
`src/lib/db.ts`'s `savePushSubscription` deliberately does delete-then-insert (scoped to the *current* user's own rows) rather than an upsert, specifically so one account can't overwrite another's subscription row via a broad UPDATE policy. The tradeoff: if the exact same browser subscription endpoint is already claimed by a different account (e.g., two people sharing one browser profile, both enabling notifications), the second person's `subscribeToPush()` call will fail with a database uniqueness error surfaced as a generic toast. This is an intentional, documented tradeoff (see the comment in `db.ts`), not a bug — just worth knowing if it comes up in testing.

---

## 4. UI/UX

### 🟢 Confirmed working well
- Staff now see a clean 3-tab surface (Dashboard/Tasks/Chat) on both desktop and mobile — this was verified end-to-end via `lib/navigation.ts`, which both `Sidebar.tsx` and `App.tsx`'s mobile bottom nav now consume from a single source of truth.
- Group chat creation correctly requires at least one other member and a non-empty name before the "Create group" button enables.
- The Viewer role's entire app experience is a single dedicated screen (`ExecutiveDashboardView.tsx`) — confirmed there's no code path back into the normal Sidebar/TaskModal/Chat UI for that role.

### 🟡 Low — No empty/loading state distinction in a couple of spots
`MyTasksDashboard.tsx` shows "Nothing on your plate right now" when `activeTasks.length === 0` — but this renders identically whether the person genuinely has zero tasks *or* the initial data load simply hasn't finished yet (a brief flash is possible on slow connections, since `AppContext`'s `loading` state isn't threaded into this component). Minor, but worth a loading skeleton if it's noticed in practice.

---

## 5. QA — Test coverage gaps

The two `.test.ts` files (`roles.test.ts`, `toast.test.ts`) cover pure utility functions well, but there is **no test coverage at all** for:
- The new chat RLS boundaries (direct vs. group creation permissions, message visibility)
- The Viewer role's read-only guarantees
- The `checkOverdueDeadlines` notification dedup logic (which, as a reminder, is still session-local — see the still-open item below)
- Push notification subscribe/unsubscribe flow

This matches the existing gap noted in prior audits ("zero automated tests" beyond utils) — it hasn't gotten worse, but it also hasn't improved despite three major features shipping this session. Given this is a small internal tool, full E2E coverage may be overkill, but the RLS test checklist (`RLS_TEST_CHECKLIST.md`) remains the primary safety net and should actually be run manually on staging before the next production deploy — it's a checklist, not automation, so nothing enforces that it happens.

### 🟡 Still open from before this session (re-confirmed present) — Deadline notifications duplicate across reloads
`checkOverdueDeadlines` in `AppContext.tsx` generates "Task Overdue" / "Urgent Deadline" notifications as local-only React state (`notif_local_...` IDs) — they are never written to the `notifications` table. The dedup check (`notifications.some(n => n.taskId === task.id && ...)`) only looks at the *current* in-memory list, which resets on every page reload. Practical effect: refreshing the page repeatedly while an overdue task exists will keep appending fresh "Task Overdue" entries to the notification bell, since the previous session's local-only ones are gone and don't count toward the dedup check anymore. This predates this session (it's inherited from the original `syncDeadlinesNow`, which this session simplified but didn't restructure this part of) — flagging it now because it's more likely to be *noticed* now that the notification bell is more central to the push-notification workflow. Proper fix would be persisting these to the `notifications` table via `db.createNotification()` so the dedup check survives reloads; not fixed in this pass since it changes write behavior for an existing feature outside what was asked for this audit.

---

## 6. Priority summary

| Priority | Item | Status |
|---|---|---|
| High | `pg_net` wrong schema — would break every push notification | ✅ Fixed |
| High | Missing `completedDate` on modal-driven completion | ✅ Fixed |
| High | Edit Profile role dropdown missing `viewer` | ✅ Fixed |
| Medium | Accessibility: `aria-label` coverage on icon-only buttons | Open |
| Medium | Department name case-sensitivity mismatch (UI vs DB) | Open |
| Medium | No test coverage for chat/viewer/push RLS boundaries | Open |
| Low | Old completed tasks missing `completedDate` (pre-fix data) | Open (self-healing) |
| Low | Deadline notifications duplicate across reloads | Open (pre-existing) |
| Low | Wide tables need horizontal scroll on mobile | Open |
| Low | No loading-vs-empty distinction in `MyTasksDashboard` | Open |
| Info | `remarks_insert` doesn't check task visibility | Open (pre-existing, out of scope) |
| Info | Bundle size (one >500KB chunk) | Open (pre-existing) |

---

## What this report can't verify

This was a static code audit plus automated checks (`tsc`, `vitest`, `vite build`) — it did **not** include manual click-through testing on a live staging deploy with real accounts per role. In particular, it can't confirm:
- Push notifications actually arrive on a real device (requires the manual VAPID/Edge Function setup in `PUSH_NOTIFICATIONS_SETUP.md` to be completed first)
- Realtime chat behavior under concurrent multi-tab usage
- Actual mobile rendering on real phone screens vs. simulated viewport widths
- Whether the `RLS_TEST_CHECKLIST.md` scenarios all still pass against the live database (it's a checklist for a human to run, not automated)

Recommend running the RLS checklist manually on staging, and doing a real click-through per role (Staff, Dept Head, Chief Officer, Super Admin, Viewer) before the next production push.
