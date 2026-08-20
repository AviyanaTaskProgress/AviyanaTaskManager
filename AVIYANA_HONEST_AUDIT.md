# Aviyana Task Manager — Honest Engineering Audit

**Reviewed by:** Claude, acting as frontend / backend / UI-UX reviewer
**Scope:** `AviyanaTaskProgress/AviyanaTaskManager` as of this audit (post cleanup of fake-crypto/mock-data)
**Method:** Full read-through of `src/`, `server/db/*.sql`, config files, and a real `tsc --noEmit` + `vite build`. Not a live QA pass — some items are code-level judgment calls, flagged where relevant.

---

## Bottom line

This is a genuinely solid architecture for a small internal tool — backend-less, Postgres RLS as the real security boundary, sensible role model. But it's been built in layers by different tools/sessions (hand-written backend, then an AI Studio visual redesign merged on top), and that seams shows: there's dead code, some invented "enterprise security" UI that didn't do anything, a couple of state-corrupting bugs, and zero automated tests. None of it is exotic — it's all fixable in a few focused days, not a rewrite.

**Is it easy to use?** Mostly yes for the core loop (create task → assign → work → submit → approve). It gets hard exactly where admin/setup flows are involved — provisioning users, Slack setup, and recovering from errors, because those flows don't tell you what went wrong.

---

## 1. Critical bugs (fix first)

| # | Issue | Where | Impact |
|---|---|---|---|
| 1 | New "Provision User" accounts had no way to log in — admin-created rows never got an `auth.users` row, so no password could ever exist for them. | `handle_new_auth_user()` trigger (fixed in `04_link_invited_users.sql`) | New staff literally could not access the system. **Fixed.** |
| 2 | Self-signup with a pre-provisioned email would hit a `UNIQUE` constraint violation and fail outright. | Same trigger | Compounded #1. **Fixed.** |
| 3 | `test_slack_connection()` read `.status_code` off `net.http_post()`, which is Supabase's **async** extension — it never returns a response row, so every test threw a SQL error that the UI quietly reworded as "simulated." | `03_go_backendless.sql` (fixed in `07_fix_slack_sync_http.sql`) | Slack integration looked broken/fake even when correctly configured. **Fixed.** |
| 4 | Task urgency/priority was computed against a **hardcoded date, `2026-08-18`**, as the default parameter — every task's "days remaining" and auto-priority score would silently stop updating correctly. | `utils/prioritization.ts`, `TaskModal.tsx` | Silent data-quality bug, hard to notice until deadlines look wrong. **Fixed.** |
| 5 | "Mark as Confidential" on a task remark implied encryption ("AES-256" badge) but the text was written to the database as **plain text** — the encrypt step was never actually called. | `TaskModal.tsx`, old `utils/crypto.ts` | Misleading security promise on what may be sensitive HR/task notes. **Fixed** (relabeled honestly as UI-masking, not encryption). |
| 6 | Every saved focus-timer session wrote a **`Math.floor(Math.random() * 10 + 90)`** as `efficiencyScore` and displayed it as a real productivity metric. | `AppContext.tsx`, `ProductivityView.tsx` | Fabricated data feeding into a metric that could plausibly influence a performance conversation. **Fixed** (removed). |
| 7 | New users got a **random Unsplash photo URL** as their avatar (`photo-${random number}`) — most of these IDs don't correspond to a real photo, so it 404s or shows a stranger's face. | `TeamManagementView.tsx` | Cosmetic but unprofessional; also a random person's photo is a bad look for a staff directory. **Fixed** (DiceBear initials). |
| 8 | A whole client-side Slack sender (`utils/slack.ts`) existed, used `mode: 'no-cors'` fetch (which makes success/failure **unreadable** by the browser) and reported `success: true` unconditionally in its fallback branch. It was dead code — nothing imported it — but if anyone had wired it back in, it would always report success even on failure. | `utils/slack.ts` | Landmine for a future contributor. **Fixed** (deleted). |
| 9 | `users_update_self` RLS policy let any signed-in user update **any column** on their own row — including `role`, `department`, and `permissions`. A staff member could have promoted themselves to `super_admin` via a raw Supabase client call. | `schema.sql` (fixed by `05_role_based_access.sql`'s `block_self_privilege_escalation` trigger) | Privilege escalation. **Fixed**, but worth a second look — see §4. |

---

## 2. Still-open issues (not yet fixed)

### Error handling is close to nonexistent on the write path
`createTask`, `updateTask`, `deleteTask`, `addUser`, `approveOrRejectTask`, `saveSlackConfig`, etc. in `AppContext.tsx` mostly do `await db.xyz(...)` with **no try/catch**. If Supabase rejects the call (RLS denial, network blip, validation error), the promise rejects, nothing catches it, and the user sees... nothing. No toast, no inline error, the button just stops spinning. This is the single biggest "why isn't this working" support-ticket generator you'll get. `TeamManagementView`'s `handleAddUserSubmit` is a good example — if `addUser` throws, the modal doesn't close, doesn't show an error, and the admin has no idea if it worked.

**Fix shape:** a shared `try { ... } catch (err) { toast.error(friendlyMessage(err)) }` wrapper, or a small global error-toast context that every action funnels through.

### No pagination anywhere
`listTasks`, `listAuditLogs`, etc. hardcode `.limit(100)` (or `.limit(200)` for audit logs). Fine today with a handful of records; once the resort has been running this for six months, task lists and especially audit logs will silently truncate with no "load more" affordance. This was flagged in the original handoff doc as a known gap — it's still there.

### No real-time updates
Nothing subscribes to Supabase Realtime. Everything is "reload on click / reload after mutation." If two managers are looking at the same task and one approves it, the other doesn't find out until they refresh. For a small team this is tolerable; it's the first thing I'd add once the team grows past ~15-20 concurrent users, since stale approval state is exactly the kind of thing that causes duplicate work.

### No password-reset flow
Confirmed by reading `AuthScreen.tsx` — there's a sign-in form and a sign-up form, no "forgot password" link, no `resetPasswordForEmail` call anywhere. Supabase supports this in about 10 lines; right now if someone forgets their password, an admin has to intervene manually (or they're stuck).

### TypeScript isn't in strict mode
`tsconfig.json` has no `"strict": true`. That means implicit `any`, no strict null checks, etc. are all silently allowed. Given this app already juggles `Record<string, unknown>` bodies going into Supabase calls (`db.ts`), strict mode would have caught real bugs at compile time instead of runtime — it's worth turning on and fixing the fallout (probably a day of work, not a rewrite).

### Dead weight in the repo
- `server/` — a full Express backend (routes for approvals, audit logs, notifications, reports, Slack, tasks, time sessions, users) that is **not deployed and not imported anywhere in `tsconfig`'s compiled scope** (it's explicitly excluded). It's leftover from before the "go backend-less" migration. Every new contributor (including me, this session) has to spend time figuring out "wait, is this the real backend?" before realizing it's inert.
- `@google/genai` and `express`/`@types/express` are still `package.json` dependencies with zero imports in `src/`. Pure install-time weight.
- `bun.lock` **and** `package-lock.json` both committed — pick one package manager and drop the other lockfile, having both invites "works on my machine" drift.

**Recommendation:** delete `server/` entirely (the handoff doc already said this was safe), drop the unused deps, pick one lockfile.

### Bundle size
`vite build` produces a single **1.4 MB** JS chunk (408 KB gzipped) with Vite's own warning about it. `recharts`, `jspdf`, `html2canvas` are the likely heavy hitters (PDF export, charts). For a small internal tool on decent office wifi this isn't an emergency, but on a hotel's staff wifi or a phone on data, that's a slow first load. Low-effort fix: lazy-load the PDF export and Reports/Analytics views with `React.lazy()` so people who never touch reporting don't pay for `jspdf`+`html2canvas` on every page load.

### Accessibility is essentially unaddressed
`aria-*` attributes appear in exactly one file (`Navbar.tsx`, 3 uses) across the whole component tree. Icon-only buttons (there are many — permission toggles, sidebar collapse, timer controls) have no `aria-label`, so a screen-reader user gets "button" with no context. Not a blocker for an internal 20-person tool, but worth knowing if anyone on staff uses assistive tech.

---

## 3. UI/UX — what makes this harder to use than it should be

1. **Silent failures (see §2)** are the #1 usability problem. A staff app that occasionally "does nothing" when you click Save trains people to distrust it and start double-checking everything manually, which defeats the point of the tool.
2. **The Slack setup page still needs manual SQL** for a non-technical admin to fully diagnose ("why did my test fail?"). Once `07_fix_slack_sync_http.sql` is applied the message is honest, but there's no in-app guidance for the *first-time setup* — e.g. "you need to create a Slack app, enable Incoming Webhooks, and paste the URL here," the kind of thing this conversation had to walk through manually. A one-time setup checklist inside the Settings page (with a link) would save a lot of back-and-forth.
3. **The RBAC role model is powerful but not self-explanatory.** Four roles (Super Admin / Chief Officer / Dept Head / Staff) with per-department Chief Officer overrides is the right design for this org, but nothing in the UI explains *why* a given action is greyed out for a given role. A person hitting a permission wall gets no explanation — just an absent button. A simple "you need X permission for this, ask your Dept Head" tooltip would go a long way.
4. **Mobile nav is a hamburger + full-screen drawer**, which is standard and fine, but I didn't find any evidence of testing on an actual small viewport beyond the iOS auto-zoom fix noted in the original handoff doc. Given staff (not just managers) will likely use this from a phone during a shift, it's worth a deliberate mobile pass — especially the Team Management page's provisioning form and the Task modal, which are dense forms that may not compress well below ~375px.
5. **Toasts/confirmations are inconsistent.** Some actions (Add User) show a nice "here's what to do next" modal (the invite-flow instructions we built). Others (save task, approve, reject) give no visible confirmation at all beyond the modal closing. Users can't tell the difference between "it worked" and "it's still loading" without watching closely.

---

## 4. Security review (beyond the bugs already listed)

- **RLS is the real authorization boundary here (correct choice for a backend-less app)**, and the policies are reasonably thorough — department scoping on tasks, time sessions, and user management all check out on read. Good instinct using `SECURITY DEFINER` helper functions (`current_app_role()`, `current_app_user()`) instead of repeating subqueries everywhere.
- **The self-privilege-escalation trigger (`block_self_privilege_escalation`) is a good fix but only covers `UPDATE`.** Worth double-checking there's no path where a non-super-admin can `INSERT` a row for themselves with an elevated role — the `handle_new_auth_user()` trigger runs `SECURITY DEFINER` and controls this on signup, so it should be safe, but it's the kind of thing worth a dedicated test (sign up, then immediately try to self-update role via the browser console using the anon client) rather than just code review.
- **The Slack webhook URL is stored in a plain `slack_config` table, readable by anyone with `canConfigureSlack`.** That's probably fine (it's a write-only credential, not a login), but if `canConfigureSlack` is ever granted more broadly than intended, that URL leaking lets someone post arbitrary messages into your Slack channel as "Aviyana Staff Bot." Low severity, worth a mental note.
- **Chief Officer / Dept Head can both create users and set their own permissions defaults client-side** (`defaultPermissionsForRole` in `roles.ts`) — the actual enforcement is server-side via RLS role checks, which is correct, but it's worth confirming the RLS policy on `INSERT` into `users` validates the `permissions` jsonb isn't set to something more powerful than the role should allow (e.g. a Dept Head setting `canManageUsers: true` on a new "staff" row). I did not find an explicit check for this in `05_role_based_access.sql` — **worth adding** a constraint or trigger that clamps `permissions` to the role's defaults server-side, not just client-side.

---

## 5. Frontend code quality notes

- Several components are large single files (`TasksView.tsx` ~700 lines, `TaskModal.tsx` ~670 lines, `DashboardView.tsx` ~680 lines). None of it is unreadable, but splitting the Task modal's remark-thread UI and the permission-matrix UI into their own components would make future changes safer and easier to review.
- State management is plain `useState` + Context, no external library — appropriate for this app's size, no complaints there.
- Naming and file organization (`lib/db.ts`, `lib/mappers.ts`, `lib/api.ts` types, `context/AppContext.tsx`) is clean and easy to follow once you know the shape — this made the RBAC and Slack fixes straightforward to slot in.
- `mappers.ts`'s `fallbackAvatar()` (DiceBear) is a good, low-maintenance pattern — now consistently used everywhere after this cleanup.

---

## 6. Recommended priority order

**Now (before wider rollout):**
1. Add error handling + user-visible feedback on every write action (§2, error handling).
2. Apply `07_fix_slack_sync_http.sql` if not already done, confirm Slack test actually works end-to-end.
3. Add a server-side clamp so a Dept Head/Chief Officer can't grant permissions above their own role when creating a user (§4, last bullet).
4. Delete `server/`, drop unused deps, pick one lockfile — purely to stop future confusion about "which backend is real."

**Next (within the first month of real use):**
5. Pagination on tasks and audit logs.
6. Password reset flow.
7. In-app Slack setup guide (checklist + link), since this took real back-and-forth to get working manually.
8. Turn on TypeScript `strict` mode and fix what it surfaces.
9. Lazy-load Reports/Analytics (jspdf, html2canvas) to cut initial bundle size.

**Later (once the team/usage grows):**
10. Supabase Realtime subscriptions for tasks/notifications so approvals and assignments show up live.
11. Basic accessibility pass (aria-labels on icon buttons at minimum).
12. Automated tests — there are currently none. Even a handful of RLS policy tests (can a Dept Head see another department's tasks? can staff self-promote?) would catch regressions before they ship, given how much of this app's correctness lives in SQL policies rather than application code.

---

## Closing note

Nothing here is a "this was built wrong" situation — the RLS-first, backend-less design was the right call for a small org, and the RBAC model you specified (Super Admin / Chief Officer with per-department overrides / Dept Head / Staff) maps cleanly onto how the resort actually operates. The rough edges are almost all in the seams between the original hand-built backend and the later AI-Studio visual redesign, plus the normal gaps you'd expect in a project that hasn't had a dedicated QA pass yet. Fixable, not a rebuild.
