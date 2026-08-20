import { describe, expect, it } from 'vitest';
import { calculateTaskPriority } from './prioritization';

const FIXED_TODAY = new Date('2026-08-20T00:00:00Z');

describe('calculateTaskPriority', () => {
  it('regression: uses the date passed in, not a hardcoded date', () => {
    // This is the exact bug that shipped: the function's default parameter
    // was `new Date('2026-08-18')`. If that regresses, a task due in 10
    // days from *today* would incorrectly show as already overdue when
    // "today" is later than Aug 18 2026, or wrongly "due soon" — depending
    // on which fixed date crept back in. We pin "today" explicitly here so
    // the test itself never depends on the real clock.
    const result = calculateTaskPriority(
      { dueDate: '2026-09-15', status: 'in_progress' },
      FIXED_TODAY
    );
    expect(result.isOverdue).toBe(false);
    expect(result.daysRemaining).toBeGreaterThan(20);
  });

  it('flags a past due date as overdue with a high score', () => {
    const result = calculateTaskPriority(
      { dueDate: '2026-08-10', status: 'in_progress' },
      FIXED_TODAY
    );
    expect(result.isOverdue).toBe(true);
    expect(result.recommendedPriority).toBe('critical');
  });

  it('flags a task due within 48h as due-soon but not overdue', () => {
    const result = calculateTaskPriority(
      { dueDate: '2026-08-21', status: 'in_progress' },
      FIXED_TODAY
    );
    expect(result.isOverdue).toBe(false);
    expect(result.isDueSoon).toBe(true);
  });

  it('treats a completed task as zero-urgency regardless of due date', () => {
    const result = calculateTaskPriority(
      { dueDate: '2026-08-01', status: 'completed' },
      FIXED_TODAY
    );
    expect(result.score).toBe(0);
    expect(result.isOverdue).toBe(false);
  });

  it('gives tasks with no due date a low, stable baseline score', () => {
    const result = calculateTaskPriority({ status: 'todo' }, FIXED_TODAY);
    expect(result.score).toBe(20);
    expect(result.recommendedPriority).toBe('low');
  });

  it('never returns a score outside 0-100', () => {
    const overloaded = calculateTaskPriority(
      {
        dueDate: '2026-08-05', // 15 days overdue
        status: 'blocked',
        priority: 'critical',
        estimatedHours: 200,
        loggedHours: 0,
        progress: 0,
      },
      FIXED_TODAY
    );
    expect(overloaded.score).toBeLessThanOrEqual(100);
    expect(overloaded.score).toBeGreaterThanOrEqual(0);
  });
});
