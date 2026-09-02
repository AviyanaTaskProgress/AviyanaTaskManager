export type ToastKind = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  kind: ToastKind;
  text: string;
}

type Listener = (toasts: ToastMessage[]) => void;

let toasts: ToastMessage[] = [];
let listeners: Listener[] = [];

function emit() {
  listeners.forEach((l) => l(toasts));
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.push(listener);
  listener(toasts);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function showToast(kind: ToastKind, text: string, durationMs = 6000) {
  const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  toasts = [...toasts, { id, kind, text }];
  emit();
  if (durationMs > 0) {
    setTimeout(() => dismissToast(id), durationMs);
  }
  return id;
}

export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Turns a caught error into a short, human string — never "[object Object]". */
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  const raw = err instanceof Error && err.message ? err.message : typeof err === 'string' ? err : null;
  if (!raw) return fallback;
  return translateDbError(raw);
}

// Backend engineering review (2026-09) found raw Postgres/PostgREST
// error text reaching users verbatim — e.g. an RLS rejection surfaces
// as `new row violates row-level security policy for table "tasks"`,
// which means nothing to someone who just clicked a button they
// didn't have permission for. This is a pattern-match translation
// layer, not a full error-code system (Supabase/PostgREST don't
// consistently expose machine-readable codes through the JS client
// for every failure mode), so it's deliberately conservative: only
// translates patterns confirmed to appear in this app's own errors,
// and falls back to the original message for everything else —
// including this app's own RPC-raised exceptions (decide_task_approval,
// ring_task_alarm's cooldown message, etc.), which were already
// written to be human-readable at the source and shouldn't be
// re-translated into something vaguer.
function translateDbError(raw: string): string {
  const lower = raw.toLowerCase();

  if (lower.includes('row-level security policy') || lower.includes('permission denied for table')) {
    return "You don't have permission to do that.";
  }
  if (lower.includes('duplicate key value violates unique constraint')) {
    if (lower.includes('email')) return 'That email is already in use.';
    if (lower.includes('display_id') || lower.includes('task_display_id')) {
      return 'That task ID is already taken — try again.';
    }
    return 'That already exists.';
  }
  if (lower.includes('violates foreign key constraint')) {
    return "That record couldn't be found — it may have been removed.";
  }
  if (lower.includes('violates not-null constraint')) {
    return 'Please fill in all required fields.';
  }
  if (lower.includes('violates check constraint')) {
    if (lower.includes('payment_amount')) return "Payment amount can't be negative.";
    if (lower.includes('progress')) return 'Progress must be between 0 and 100%.';
    return "That value isn't valid.";
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) {
    return "Couldn't reach the server — check your connection and try again.";
  }
  if (lower.includes('jwt expired') || lower.includes('invalid jwt')) {
    return 'Your session expired — please sign in again.';
  }

  return raw;
}
