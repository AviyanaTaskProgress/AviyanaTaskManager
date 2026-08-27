import { describe, expect, it } from 'vitest';
import { shouldStampCompletedDate, todayDateString } from './taskStatus';

describe('shouldStampCompletedDate', () => {
  it('stamps when transitioning into completed from another status', () => {
    expect(shouldStampCompletedDate('completed', 'in_progress')).toBe(true);
    expect(shouldStampCompletedDate('completed', 'pending_approval')).toBe(true);
    expect(shouldStampCompletedDate('completed', 'todo')).toBe(true);
  });

  it('does not re-stamp when a task was already completed', () => {
    // Regression guard: editing an already-completed task (e.g. just the
    // title) must not silently bump completedDate to today.
    expect(shouldStampCompletedDate('completed', 'completed')).toBe(false);
  });

  it('does not stamp when the new status is not completed', () => {
    expect(shouldStampCompletedDate('in_progress', 'todo')).toBe(false);
    expect(shouldStampCompletedDate('pending_approval', 'in_progress')).toBe(false);
  });

  it('does not stamp when moving out of completed', () => {
    expect(shouldStampCompletedDate('in_progress', 'completed')).toBe(false);
  });
});

describe('todayDateString', () => {
  it('returns a YYYY-MM-DD formatted date', () => {
    expect(todayDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
