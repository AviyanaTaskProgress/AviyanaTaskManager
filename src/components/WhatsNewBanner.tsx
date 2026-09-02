import React, { useState } from 'react';
import { Sparkles, X } from 'lucide-react';

// Bump this whenever a release adds enough new surface area that
// existing users need a heads-up (subtasks, payment workflow, ring
// alarm, etc. all landed in one release with zero in-app explanation
// otherwise) — flagged in the pre-launch UX audit. Storing the
// version string (not just a boolean) means the NEXT release's
// announcement will show again automatically instead of staying
// permanently dismissed.
const WHATS_NEW_VERSION = '2026-09-reminders-and-payments';
const STORAGE_KEY = 'aviyana_whats_new_dismissed_version';

const HIGHLIGHTS = [
  'Break tasks into checklist steps — progress now tracks itself',
  'Flag a task as payment-linked and track it through to Paid',
  'Task IDs are now short and readable (e.g. ENG-0001)',
  '"Ring Alarm" for genuinely urgent tasks, plus automatic deadline reminders',
];

export const WhatsNewBanner: React.FC = () => {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === WHATS_NEW_VERSION;
    } catch {
      return false;
    }
  });

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(STORAGE_KEY, WHATS_NEW_VERSION);
    } catch {
      // Private-browsing / storage disabled — worst case it shows
      // again next visit, not a functional problem either way.
    }
  };

  if (dismissed) return null;

  return (
    <div className="mb-4 sm:mb-6 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-4 sm:p-5 shadow-lg relative overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="absolute right-0 top-0 w-64 h-full bg-white/5 rounded-full blur-3xl pointer-events-none" />
      <div className="flex items-start gap-3 relative">
        <div className="p-2 rounded-xl bg-white/15 shrink-0">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-extrabold">What's new</p>
          <ul className="mt-1.5 space-y-1 text-xs text-blue-50">
            {HIGHLIGHTS.map((h) => (
              <li key={h} className="flex items-start gap-1.5">
                <span className="mt-1 w-1 h-1 rounded-full bg-blue-200 shrink-0" />
                <span>{h}</span>
              </li>
            ))}
          </ul>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="p-1.5 rounded-lg hover:bg-white/15 transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
