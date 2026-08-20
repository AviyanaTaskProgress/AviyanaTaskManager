import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { dismissToast, subscribeToasts, ToastMessage } from '../lib/toast';

const STYLES: Record<ToastMessage['kind'], string> = {
  success: 'bg-emerald-600 text-white',
  error: 'bg-rose-600 text-white',
  info: 'bg-slate-800 text-white',
};

const ICONS: Record<ToastMessage['kind'], React.ElementType> = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

export const Toaster: React.FC = () => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => subscribeToasts(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            role="alert"
            className={`pointer-events-auto flex items-start gap-2.5 px-4 py-3 rounded-xl shadow-lg text-xs font-semibold animate-in fade-in slide-in-from-bottom-2 duration-200 ${STYLES[t.kind]}`}
          >
            <Icon className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1 leading-snug">{t.text}</span>
            <button
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss notification"
              className="shrink-0 opacity-80 hover:opacity-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
