// supabase/functions/send-push/index.ts
//
// Receives { user_ids: string[], title: string, body: string, url?: string }
// from public.notify_push() (see server/db/20_push_notifications.sql),
// looks up each user's push subscriptions, and sends a real Web Push
// notification to each one using VAPID keys.
//
// Deploy with:
//   supabase functions deploy send-push
//
// Required secrets (set once, see PUSH_NOTIFICATIONS_SETUP.md):
//   supabase secrets set VAPID_PUBLIC_KEY=...
//   supabase secrets set VAPID_PRIVATE_KEY=...
//   supabase secrets set VAPID_SUBJECT=mailto:you@aviyanaceylon.com
//   supabase secrets set PUSH_TRIGGER_SECRET=...   (must match the value
//     you inserted into public._push_config in 20_push_notifications.sql)
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are already available
// automatically inside every Edge Function — no need to set those.

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const PUSH_TRIGGER_SECRET = Deno.env.get('PUSH_TRIGGER_SECRET') ?? '';
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

interface RequestBody {
  user_ids: string[];
  title: string;
  body: string;
  url?: string;
}

Deno.serve(async (req) => {
  try {
    if (req.headers.get('x-push-secret') !== PUSH_TRIGGER_SECRET || !PUSH_TRIGGER_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    const { user_ids, title, body, url }: RequestBody = await req.json();
    if (!user_ids?.length) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
    }

    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('user_id', user_ids);

    if (error) throw error;
    if (!subs?.length) {
      return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
    }

    const payload = JSON.stringify({
      title: title.slice(0, 120),
      body: (body || '').slice(0, 200),
      url: url || '/',
    });

    let sent = 0;
    const staleIds: string[] = [];

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );
          sent++;
        } catch (err) {
          // 404/410 = the browser unsubscribed or the subscription expired.
          const status = (err as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) {
            staleIds.push(sub.id);
          }
        }
      })
    );

    if (staleIds.length > 0) {
      await supabase.from('push_subscriptions').delete().in('id', staleIds);
    }

    return new Response(JSON.stringify({ sent, staleRemoved: staleIds.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('send-push error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
