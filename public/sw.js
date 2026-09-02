// public/sw.js
// Minimal service worker — its only job is to show a notification when
// a push arrives, and focus/open the app when the user taps it.
// Registered from src/lib/push.ts.

self.addEventListener('push', (event) => {
  let data = { title: 'Aviyana', body: '', url: '/', urgent: false };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Non-JSON payload — fall back to defaults above.
  }

  // Urgent (Ring Alarm — see 37_urgent_push_notifications.sql) pushes
  // stay on screen until the person deals with them instead of
  // auto-dismissing after a few seconds like a routine reminder, and
  // vibrate distinctly on devices that support it — this is the
  // background/OS-level counterpart to AlarmSiren.tsx's in-app ringing
  // banner for whenever the app isn't already open in the foreground.
  const options = data.urgent
    ? {
        body: data.body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url: data.url || '/' },
        requireInteraction: true,
        vibrate: [200, 100, 200, 100, 200],
        tag: 'aviyana-alarm',
        renotify: true,
      }
    : {
        body: data.body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url: data.url || '/' },
      };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
