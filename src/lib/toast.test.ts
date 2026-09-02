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

  it('translates a raw RLS rejection into a friendly permission message', () => {
    expect(errorMessage(new Error('new row violates row-level security policy for table "tasks"'))).toBe(
      "You don't have permission to do that."
    );
  });

  it('translates a duplicate email constraint violation', () => {
    expect(
      errorMessage(new Error('duplicate key value violates unique constraint "users_email_key"'))
    ).toBe('That email is already in use.');
  });

  it('translates a negative payment_amount check constraint violation', () => {
    expect(
      errorMessage(new Error('new row for relation "tasks" violates check constraint "tasks_payment_amount_nonnegative"'))
    ).toBe("Payment amount can't be negative.");
  });

  it('translates a network failure', () => {
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe(
      "Couldn't reach the server — check your connection and try again."
    );
  });

  it('leaves an already human-readable RPC message untouched', () => {
    const rpcMessage = 'This task was already rung recently — please wait a few minutes before ringing it again';
    expect(errorMessage(new Error(rpcMessage))).toBe(rpcMessage);
  });
});
