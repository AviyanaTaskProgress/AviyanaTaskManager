import React, { useEffect, useState } from 'react';
import { Bell, BellOff, BellRing } from 'lucide-react';
import { getPushSubscriptionStatus, subscribeToPush, unsubscribeFromPush } from '../lib/push';
import { showToast, errorMessage } from '../lib/toast';

/**
 * Lives in the Navbar so every role can reach it — including Staff, who
 * don't have a Settings tab. Push notifications cover: task assigned,
 * new remark, task approved/rejected, and new chat message (see
 * server/db/20_push_notifications.sql).
 */
export const PushNotificationToggle: React.FC = () => {
  const [status, setStatus] = useState<'unsupported' | 'subscribed' | 'unsubscribed' | 'loading'>('loading');

  useEffect(() => {
    getPushSubscriptionStatus().then(setStatus);
  }, []);

  if (status === 'unsupported') return null;

  const handleClick = async () => {
    const wasSubscribed = status === 'subscribed';
    setStatus('loading');
    try {
      if (wasSubscribed) {
        await unsubscribeFromPush();
        setStatus('unsubscribed');
        showToast('success', 'Push notifications turned off.');
      } else {
        await subscribeToPush();
        setStatus('subscribed');
        showToast('success', "Push notifications turned on — you'll get alerts even when the app is closed.");
      }
    } catch (err) {
      setStatus(wasSubscribed ? 'subscribed' : 'unsubscribed');
      showToast('error', errorMessage(err));
    }
  };

  return (
    <button
      id="push-notification-toggle-btn"
      onClick={handleClick}
      disabled={status === 'loading'}
      className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
      aria-label={status === 'subscribed' ? 'Turn off push notifications' : 'Turn on push notifications'}
      title={status === 'subscribed' ? 'Push notifications are on — click to turn off' : 'Turn on push notifications'}
    >
      {status === 'subscribed' ? (
        <BellRing className="w-5 h-5 text-blue-500" />
      ) : status === 'loading' ? (
        <Bell className="w-5 h-5 opacity-40" />
      ) : (
        <BellOff className="w-5 h-5" />
      )}
    </button>
  );
};
