import { describe, expect, it, vi } from 'vitest';
import { dismissToast, errorMessage, showToast, subscribeToasts } from './toast';

describe('toast pub-sub', () => {
  it('notifies subscribers when a toast is shown, and again when dismissed', () => {
    const seen: number[] = [];
    const unsubscribe = subscribeToasts((toasts) => seen.push(toasts.length));

    const id = showToast('success', 'Saved.', 0); // durationMs 0 = no auto-dismiss
    expect(seen[seen.length - 1]).toBe(1);

    dismissToast(id);
    expect(seen[seen.length - 1]).toBe(0);

    unsubscribe();
  });

  it('stops notifying after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToasts(listener);
    const callsBeforeUnsub = listener.mock.calls.length;
    unsubscribe();
    showToast('info', 'Should not be observed', 0);
    expect(listener.mock.calls.length).toBe(callsBeforeUnsub);
  });
});

describe('errorMessage', () => {
  it('extracts the message from an Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('passes through a plain string', () => {
    expect(errorMessage('plain string')).toBe('plain string');
  });

  it('falls back for unrecognized shapes instead of printing "[object Object]"', () => {
    expect(errorMessage({ weird: true })).toBe('Something went wrong');
    expect(errorMessage(undefined)).toBe('Something went wrong');
  });

  it('uses a custom fallback when provided', () => {
    expect(errorMessage(null, 'custom fallback')).toBe('custom fallback');
  });
});
