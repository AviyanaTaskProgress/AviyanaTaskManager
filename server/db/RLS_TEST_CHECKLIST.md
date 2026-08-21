# RLS Security Test Checklist

Row Level Security is where most of this app's actual authorization lives
(see `server/db/05_role_based_access.sql` and `08_clamp_user_permissions.sql`).
That logic runs inside Postgres, not in the frontend, so it can't be
exercised by the vitest unit tests in `src/` — those need a live Supabase
project with real accounts. Run through this checklist by hand after any
change to `server/db/*.sql`, using the Supabase SQL Editor or the browser
console with `supabase.from(...)` calls signed in as each role.

Each row: expected result is what a correctly-configured system should do.
If the actual result differs, that's a regression.

## Self-privilege escalation

| # | As | Try to | Expected |
|---|---|---|---|
| 1 | Staff | `update users set role = 'super_admin' where id = <own id>` via the browser client | **Blocked** — `block_self_privilege_escalation` trigger raises an exception |
| 2 | Staff | `update users set permissions = '{"canManageUsers":true}' where id = <own id>` | **Blocked** — same trigger |
| 3 | Dept Head | Same as #1/#2 on their own row | **Blocked** |
| 4 | Super Admin | Update their own role/permissions | **Allowed** (trigger explicitly exempts super_admin) |

## Permission ceiling (`08_clamp_user_permissions.sql`)

| # | As | Try to | Expected |
|---|---|---|---|
| 5 | Dept Head | Insert a new `staff` row with `permissions.canManageUsers = true` set directly via the client (bypassing the UI) | Row is created, but `canManageUsers` comes back **false** — clamped by the trigger |
| 6 | Chief Officer | Insert a new `dept_head` row with `permissions.canConfigureSlack = true` | Clamped to **false** — not in the Chief Officer ceiling for that role |
| 7 | Super Admin | Insert a `chief_officer` row with the full permission ceiling | **Allowed as requested** — Super Admin is exempt from clamping |

## Department scoping

| # | As | Try to | Expected |
|---|---|---|---|
| 8 | Dept Head (Engineering) | `select * from tasks` | Only sees tasks where `department = 'Engineering'`, plus any task they're personally assigned to or created |
| 9 | Dept Head (Engineering) | Insert a task with `department = 'Marketing'` | **Blocked** by `tasks_insert` policy |
| 10 | Dept Head (Engineering) | Call `decide_task_approval()` on a Marketing task | **Blocked** — RPC explicitly checks `v_task_dept = v_dept` for dept_head |
| 11 | Chief Officer | `select * from tasks` | Sees tasks across **all** departments |
| 12 | Staff | `select * from users` | Sees the full directory (by design — needed for assigning/viewing tasks), but cannot `update`/`insert` any row but their own, and only non-privileged columns per the self-escalation trigger |

## Chief Officer department access override

| # | As | Try to | Expected |
|---|---|---|---|
| 13 | Super Admin | Set a Chief Officer's access to `'limited'` for one department via `chief_officer_department_access` | Row is created/updated |
| 14 | That Chief Officer | Try to insert a new user in the **limited** department | **Blocked** — `chief_officer_dept_level()` returns `'limited'`, `users_manage_by_chief_officer` policy fails |
| 15 | That Chief Officer | Try to insert a new user in a department **without** an override row | **Allowed** — no row means `'full'` by default |
| 16 | A different (non-Super-Admin) user | Read another Chief Officer's `chief_officer_department_access` rows | **Blocked** by `chief_access_super_admin_only` / `chief_access_self_read` — can only read their own |

## Auth linking (`04_link_invited_users.sql`)
| # | Scenario | Expected |
|---|---|---|
| 17 | Admin provisions a user via Team page, then that person signs up with the **same** email | Their `auth_user_id` links to the pre-provisioned row; role/department/permissions from provisioning are preserved, not reset to defaults |
| 18 | Someone signs up with an email that was **never** provisioned | A fresh `staff` row is created for them, department defaults to `Operations` |

## Slack

| # | Scenario | Expected |
|---|---|---|
| 19 | Valid webhook URL saved, Test Webhook Dispatch clicked | Real HTTP POST reaches Slack (via `extensions.http_post`, not `pg_net`), `is_connected` becomes `true`, message appears in the channel |
| 20 | Invalid/unreachable webhook URL, Test Webhook Dispatch clicked | UI shows the **real** failure reason (HTTP status or connection error), not a generic "simulated" message |
| 21 | Save Slack config, reload the page | Webhook URL and settings persist — don't reset to "Unconfigured" (regression test for the duplicate-row/NULL-uniqueness bug fixed in `11_fix_slack_config_singleton.sql`) |

## Realtime (`09_enable_realtime.sql`)

| # | Scenario | Expected |
|---|---|---|
| 22 | Log in as the same user in two browser tabs; approve a task in tab A | Tab B's task list updates within ~1 second without a manual reload |
| 23 | A user with no read access to a task (wrong department, no permission) | Never receives a realtime event for it — Realtime respects the same RLS SELECT policies as a normal query |

## Permission clamp regression (`08_clamp_user_permissions.sql`)

| # | Scenario | Expected |
|---|---|---|
| 24 | Edit an existing user's permissions via the Team page toggle switches as a non-Super-Admin, granting something above the role ceiling | The toggle switch snaps back to its clamped (server-truth) state after the round-trip — it no longer trusts client-side optimistic state (regression test for the stale-toggle bug fixed alongside the missing-toast fix) |

---

**How to run this:** create four test accounts (one per role) in a
non-production Supabase project, then either use the Supabase SQL Editor
with `set local role authenticated; set local request.jwt.claims = '{"sub":"<uid>"}';`
to impersonate, or simpler — log into the actual deployed app as each test
account and attempt the corresponding action through the UI, falling back
to the browser console (`window.supabase` if exposed, or the Network tab)
to attempt the ones the UI wouldn't normally let you try (rows 1, 2, 5, 6, 9, 10).
