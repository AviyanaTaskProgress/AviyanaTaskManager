# Push Notifications — Setup Guide

This feature is fully coded, but three things need to happen on your
side that I can't do from here: generating your own VAPID keys,
deploying the Edge Function to your Supabase project, and telling the
database where to send its trigger calls. None of this touches your
existing data — it's purely additive.

## What you're setting up

```
Task assigned / remark added / approved / new chat message
        │  (Postgres trigger, in 20_push_notifications.sql)
        ▼
public.notify_push()  →  pg_net async HTTP POST
        ▼
Edge Function: send-push  (supabase/functions/send-push/index.ts)
        │  looks up subscriptions, sends via Web Push + VAPID
        ▼
Browser service worker (public/sw.js)  →  shows the notification
```

## 1. Run the database migration

`server/db/20_push_notifications.sql` — same as 16 through 19, paste
into the Supabase SQL editor and run. **Don't run the last commented-out
block yet** (the `insert into public._push_config ...` at the bottom) —
that comes in step 4, once you have real values for it.

## 2. Generate a VAPID key pair

VAPID keys are what let the browser trust that pushes are really coming
from your server. Run this once, anywhere with Node installed:

```bash
npx web-push generate-vapid-keys
```

It prints something like:

```
Public Key:
BN4Gv...(long string)...

Private Key:
xY3po...(shorter string)...
```

Keep both — you'll use each one in a different place below. **Never
put the Private Key in the frontend, `.env`, or anywhere committed to
git.**

## 3. Deploy the Edge Function

You need the [Supabase CLI](https://supabase.com/docs/guides/cli) installed and logged in
(`supabase login`), then from the project root:

```bash
supabase link --project-ref wncxxfnnapytvldbxzae

supabase secrets set VAPID_PUBLIC_KEY="paste the Public Key from step 2"
supabase secrets set VAPID_PRIVATE_KEY="paste the Private Key from step 2"
supabase secrets set VAPID_SUBJECT="mailto:youremail@aviyanaceylon.com"
supabase secrets set PUSH_TRIGGER_SECRET="$(openssl rand -hex 32)"

supabase functions deploy send-push
```

That last `openssl rand -hex 32` generates a long random secret — this
is a shared password between your database and the Edge Function so
random people on the internet can't call it and spam your users. Copy
whatever it prints; you need the exact same value in the next step.
If you don't have `openssl`, any long random string works — generate
one at [1password.com/password-generator](https://1password.com/password-generator/) or similar.

## 4. Tell the database where to send its calls

Back in the Supabase SQL editor, run this (now filled in with your real
values):

```sql
insert into public._push_config (key, value) values
  ('edge_function_url', 'https://wncxxfnnapytvldbxzae.supabase.co/functions/v1/send-push'),
  ('trigger_secret', 'PASTE_THE_EXACT_SAME_SECRET_FROM_STEP_3_HERE')
on conflict (key) do update set value = excluded.value;
```

## 5. Add the public key to your frontend build

In your `.env.local` (or wherever you set `VITE_SUPABASE_URL` etc. for
this project):

```
VITE_VAPID_PUBLIC_KEY="paste the Public Key from step 2"
```

Rebuild/redeploy the frontend (Netlify will need this env var set in
its dashboard too: **Site configuration → Environment variables**).

## 6. Test it

1. Open the app, log in as anyone.
2. Click the bell icon in the top navbar (next to dark mode) — it'll
   ask for notification permission. Allow it.
3. From another account, assign that person a task, add a remark, or
   send them a chat message.
4. A real OS-level notification should appear within a few seconds —
   even if the browser tab isn't focused (though the tab does need to
   still be open in the background; fully closing the browser stops it,
   which is normal for web push, not native app push).

## Troubleshooting

- **No notification arrives, no errors anywhere:** almost always means
  step 4 wasn't run, or the secret in step 4 doesn't exactly match the
  one from step 3. Check with:
  ```sql
  select * from public._push_config;
  ```
- **Edge Function logs:** `supabase functions logs send-push` shows
  every call it received and any errors sending to a specific browser.
- **"Push notifications are not configured yet" toast in the app:**
  means `VITE_VAPID_PUBLIC_KEY` wasn't set when the frontend was built —
  check step 5, then rebuild.
- **Icon looks generic:** the service worker (`public/sw.js`) references
  `/icon-192.png`, which doesn't exist in this project yet. Notifications
  still work without it (browsers just show a default icon) — drop a
  192×192 PNG at `public/icon-192.png` whenever you want to add one.
