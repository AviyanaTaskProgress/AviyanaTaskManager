# Aviyana Staff API

> **⚠️ No longer required.** As of `server/db/03_go_backendless.sql`, the
> frontend talks directly to Supabase (RLS + Postgres RPC functions handle
> everything that needs elevated privileges — audit logging, Slack
> notifications, approval decisions). You do **not** need to deploy this
> Express server anywhere — nothing here costs money.
>
> Kept only as a reference. To deploy fresh: run `server/db/schema.sql`
> and `server/db/03_go_backendless.sql` in the Supabase SQL Editor, then
> deploy the root frontend to Netlify. That's it.

Express + TypeScript REST API backed by Supabase (PostgreSQL). Replaces the
`localStorage`-only persistence in the original frontend prototype
(`src/context/AppContext.tsx`) with a real, multi-user database.

## 1. Create the Supabase project

1. Go to https://supabase.com → New project.
2. Open **SQL Editor** → paste the contents of `db/schema.sql` → Run.
   This creates all tables, enums, triggers, the audit-log immutability
   guard, and RLS policies.
3. Go to **Authentication → Providers** and enable Email (or whichever
   sign-in method you want). Every new `auth.users` row automatically gets
   a matching `public.users` profile row (via the `trg_on_auth_user_created`
   trigger) with role `employee` — promote the first Dept Head manually:
   ```sql
   update public.users set role = 'dept_head',
     permissions = '{"canCreateTasks":true,"canApproveTasks":true,
       "canManageUsers":true,"canViewAuditLogs":true,"canExportReports":true,
       "canConfigureSlack":true,"canEditAllTasks":true,
       "canViewExecutiveAnalytics":true}'::jsonb
   where email = 'you@company.com';
   ```
4. Copy **Project Settings → API**: `Project URL`, `service_role` key, and
   `JWT Secret`.

## 2. Configure & run the API

```bash
cd server
cp .env.example .env      # fill in SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev                # http://localhost:4000
```

## 3. Auth model

- The **frontend** authenticates users directly against Supabase Auth
  (`@supabase/supabase-js` in the browser, using the public **anon** key —
  never the service role key) and gets back a JWT.
- The frontend sends that JWT as `Authorization: Bearer <token>` on every
  call to this API.
- This API verifies the JWT with `supabase.auth.getUser()`, loads the
  matching `public.users` row (role + permissions), and enforces
  authorization per-route (`requireAuth` / `requirePermission` /
  `requireRole` in `src/middleware/auth.ts`) — because it uses the
  **service role** key server-side, which bypasses Row Level Security.
- RLS policies in `db/schema.sql` are still enabled as a defense-in-depth
  layer, in case anything ever queries Supabase directly from the browser.

## 4. What's real now vs. the old prototype

| Old (AI Studio prototype)                | New                                              |
|-------------------------------------------|---------------------------------------------------|
| `localStorage` (per-browser, single-user) | Postgres via Supabase (multi-user, persistent)     |
| No auth — "switch role" button            | Supabase Auth + JWT verified server-side           |
| Fake "encryption" (`btoa` base64)         | Real `HMAC-SHA256` audit-log signatures            |
| Audit logs mutable in browser state       | `audit_logs` is DB-level append-only (trigger blocks UPDATE/DELETE) |
| Slack fire-and-forget from the browser    | Slack webhook dispatched server-side, with a real delivery log table |

## 5. Still to do (not built yet)

- Point `src/context/AppContext.tsx` at these endpoints instead of
  `localStorage` (needs an API client + Supabase Auth wired into the
  frontend — this is the next task).
- Pagination on `/api/tasks` and `/api/audit-logs` for large datasets.
- Rate limiting / request validation (e.g. zod) on write endpoints.
- Automated tests.

## Endpoints

```
GET    /health
GET    /api/users               GET  /api/users/me
POST   /api/users                     (canManageUsers)
PATCH  /api/users/:id/permissions     (canManageUsers)
PATCH  /api/users/:id/status          (self only)

GET    /api/tasks               GET  /api/tasks/:id
POST   /api/tasks                     (canCreateTasks)
PATCH  /api/tasks/:id                 (owner or canEditAllTasks)
DELETE /api/tasks/:id                 (canEditAllTasks)
POST   /api/tasks/:id/remarks

GET    /api/approvals                 (canApproveTasks)
POST   /api/approvals/:id/submit      (assignee)
POST   /api/approvals/:id/decision    (canApproveTasks)

GET    /api/audit-logs                (canViewAuditLogs)

GET    /api/slack/config              (canConfigureSlack)
PUT    /api/slack/config              (canConfigureSlack)
POST   /api/slack/test                (canConfigureSlack)

GET    /api/time-sessions
POST   /api/time-sessions

GET    /api/notifications
PATCH  /api/notifications/:id/read
PATCH  /api/notifications/read-all

GET    /api/reports/monthly           (canExportReports)
```
