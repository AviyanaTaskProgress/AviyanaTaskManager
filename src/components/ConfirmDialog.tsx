import React from 'react';
import { X } from 'lucide-react';

interface ConfirmDialogProps {
  tone: 'danger' | 'warning';
  icon: React.ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// Shared styled confirmation modal — used anywhere the app previously
// fell back to the browser's bare `confirm()` (jarring next to a fully
// custom-styled UI, and can't explain consequences beyond one line).
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  tone,
  icon,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) => {
  const toneClasses =
    tone === 'danger'
      ? {
          iconWrap: 'bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400',
          confirmBtn: 'bg-red-600 hover:bg-red-500 shadow-red-500/25',
        }
      : {
          iconWrap: 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400',
          confirmBtn: 'bg-rose-600 hover:bg-rose-500 shadow-rose-500/25',
        };

  return (
    <div
      className="fixed inset-0 z-[110] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-5 animate-in zoom-in-95 duration-150">
        <div className="flex items-start justify-between gap-3">
          <div className={`p-2.5 rounded-xl shrink-0 ${toneClasses.iconWrap}`}>{icon}</div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <h3 id="confirm-dialog-title" className="text-sm font-bold text-slate-900 dark:text-white mt-3">
          {title}
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">{description}</p>

        <div className="flex items-center justify-end gap-2.5 mt-5">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 rounded-xl text-white font-bold text-xs shadow-md transition-all ${toneClasses.confirmBtn}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
