import { TaskStatus } from '../types';

/**
 * Whether a status change should stamp `completedDate` with today's date.
 *
 * Used by TaskModal.tsx's submit handler (and mirrors TasksView.tsx's
 * drag-to-Completed behavior) so every path that can mark a task
 * "completed" stamps a real completion date instead of leaving
 * `completedDate` null — see AVIYANA_FULL_SYSTEM_AUDIT.md §1, "Missing
 * completedDate when a task is marked complete from the Edit Task form".
 *
 * Only fires on the transition *into* 'completed' — re-saving an
 * already-completed task (e.g. just editing its title) must not keep
 * bumping completedDate to today.
 */
export function shouldStampCompletedDate(newStatus: TaskStatus, previousStatus: TaskStatus): boolean {
  return newStatus === 'completed' && previousStatus !== 'completed';
}

/** Today's date as `YYYY-MM-DD`, matching the format used elsewhere for completedDate/dueDate. */
export function todayDateString(): string {
  return new Date().toISOString().split('T')[0];
}
