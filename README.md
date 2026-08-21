# Aviyana — Staff Work Management System

Task assignment, approvals, progress tracking, Slack notifications, audit
logs, and role-based access control for Aviyana Ceylon Resort's internal
staff productivity system.

## Architecture

There is **no separate backend server**. The frontend (React + Vite +
TypeScript) talks directly to Supabase (Postgres + Auth) using the public
anon key. Authorization is enforced by Postgres Row Level Security — see
`server/db/` for the full schema and every migration, in order.

```
Frontend (React + Vite, hosted on Netlify)
        │
        ▼
Supabase (Postgres database + Auth + Row Level Security + Postgres functions)
```

## Run locally

**Prerequisites:** Node.js 18+

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local` and fill in your Supabase project's
   URL and anon key (Project Settings → API)
3. Run the app: `npm run dev`

## Database setup

Run every file in `server/db/` **in numeric order** in the Supabase SQL
Editor, starting with `schema.sql`. Each file's header comment explains
what it does and when to run it.

## Type checking & tests

```
npm run lint   # tsc --noEmit
npm run test   # vitest
```

## Deploying

Netlify, build command `npm run build`, publish directory `dist`. Set
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Netlify's environment
variables (Netlify does not read `.env.local`).

## Known limitation: Supabase email rate limit

Supabase's **built-in** email service (used for signup confirmation and
password reset) is rate-limited on the free/default tier — roughly
3-4 emails per hour. During active testing (creating several accounts
in quick succession) you will hit this limit and see an error like
"email rate limit exceeded."

**Fix:** configure a custom SMTP provider in Supabase Dashboard →
Authentication → Email Templates → SMTP Settings (e.g. Resend, SendGrid,
Postmark — all have generous free tiers). This removes the built-in
service's rate limit entirely. Do this before onboarding real staff.
