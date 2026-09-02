import { TaskStatus } from '../types';

// Plain-language explanation for each status — surfaced as a tooltip
// on status badges. 'pending_payment' in particular reads as "why
// isn't my finished work marked done?" without this — see the UX
// audit that flagged status meaning wasn't self-explanatory once a
// task can be in_review/approved/pending_payment/completed depending
// on whether it's payment-linked.
export const STATUS_DESCRIPTION: Record<TaskStatus, string> = {
  todo: 'Not started yet.',
  in_progress: 'Currently being worked on.',
  in_review: 'Submitted and waiting for a reviewer to look at it.',
  pending_approval: 'Reviewed — waiting on final sign-off from a Dept Head, Chief Officer, or Super Admin.',
  pending_payment:
    'Approved — the work itself is done, but this task involves a payment that Super Admin/Chief Officer still needs to confirm before it closes.',
  completed: 'Done — no further action needed.',
  blocked: 'Stuck on something outside your control — flag it if it needs attention.',
};
