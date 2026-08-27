// Web Push subscribe/unsubscribe. The VAPID public key is safe to ship
// to the browser (that's the point of the public/private key split) —
// it comes from an env var set at build time, see PUSH_NOTIFICATIONS_SETUP.md.
import { db } from './db';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && !!VAPID_PUBLIC_KEY;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function getPushSubscriptionStatus(): Promise<'unsupported' | 'subscribed' | 'unsubscribed'> {
  if (!isPushSupported()) return 'unsupported';
  const registration = await navigator.serviceWorker.getRegistration();
  const existing = await registration?.pushManager.getSubscription();
  return existing ? 'subscribed' : 'unsubscribed';
}

export async function subscribeToPush(): Promise<void> {
  if (!isPushSupported()) throw new Error('Push notifications are not supported in this browser.');
  if (!VAPID_PUBLIC_KEY) throw new Error('Push notifications are not configured yet.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    }));

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('Browser returned an incomplete push subscription.');
  }

  await db.savePushSubscription({
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  });
}

export async function unsubscribeFromPush(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await db.deletePushSubscription(endpoint);
}
