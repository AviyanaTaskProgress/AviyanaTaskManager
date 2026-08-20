import { Task, TaskPriority } from '../types';

export interface PrioritizationResult {
  score: number; // 0 to 100
  recommendedPriority: TaskPriority;
  reason: string;
  daysRemaining: number;
  urgencyLevel: 'low' | 'moderate' | 'high' | 'critical';
  isOverdue: boolean;
  isDueSoon: boolean; // within 48h
}

export function calculateTaskPriority(
  task: Partial<Task>,
  currentDate = new Date()
): PrioritizationResult {
  if (!task.dueDate) {
    return {
      score: 20,
      recommendedPriority: 'low',
      reason: 'No fixed deadline specified',
      daysRemaining: 99,
      urgencyLevel: 'low',
      isOverdue: false,
      isDueSoon: false,
    };
  }

  const due = new Date(task.dueDate);
  const now = new Date(currentDate);
  // Strip time for clean day diff
  due.setHours(23, 59, 59, 999);
  now.setHours(0, 0, 0, 0);

  const diffTime = due.getTime() - now.getTime();
  const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const isOverdue = daysRemaining < 0;
  const isDueSoon = daysRemaining >= 0 && daysRemaining <= 2;

  let score = 0;
  let reasons: string[] = [];

  // 1. Deadline proximity weighting (Up to 50 pts)
  if (isOverdue) {
    const overdueDays = Math.abs(daysRemaining);
    score += 55 + Math.min(overdueDays * 10, 30);
    reasons.push(`Overdue by ${overdueDays} day${overdueDays > 1 ? 's' : ''}`);
  } else if (daysRemaining === 0) {
    score += 48;
    reasons.push('Due today');
  } else if (daysRemaining === 1) {
    score += 40;
    reasons.push('Due tomorrow');
  } else if (daysRemaining <= 3) {
    score += 32;
    reasons.push(`Due in ${daysRemaining} days`);
  } else if (daysRemaining <= 7) {
    score += 20;
    reasons.push('Due this week');
  } else {
    score += Math.max(5, 15 - Math.floor(daysRemaining / 5));
    reasons.push(`Due in ${daysRemaining} days`);
  }

  // 2. Status modifier
  if (task.status === 'blocked') {
    score += 25;
    reasons.push('Blocked dependency requires unblocking');
  } else if (task.status === 'pending_approval') {
    score += 20;
    reasons.push('Awaiting manager/dept head sign-off');
  } else if (task.status === 'in_review') {
    score += 15;
  } else if (task.status === 'completed') {
    return {
      score: 0,
      recommendedPriority: 'low',
      reason: 'Task completed',
      daysRemaining,
      urgencyLevel: 'low',
      isOverdue: false,
      isDueSoon: false,
    };
  }

  // 3. Workload Density modifier (Estimated hours vs remaining days)
  const estHours = task.estimatedHours || 4;
  const loggedHours = task.loggedHours || 0;
  const remainingHours = Math.max(0, estHours - loggedHours);
  const progress = task.progress || 0;

  if (daysRemaining > 0 && remainingHours > 0) {
    const hoursPerDayNeeded = remainingHours / Math.max(1, daysRemaining);
    if (hoursPerDayNeeded > 6) {
      score += 20;
      reasons.push(`High load: ~${hoursPerDayNeeded.toFixed(1)}h/day required`);
    } else if (hoursPerDayNeeded > 3) {
      score += 10;
    }
  }

  // 4. Low progress alert on near-term tasks
  if (daysRemaining <= 2 && progress < 40 && !isOverdue) {
    score += 12;
    reasons.push(`Low progress (${progress}%) near deadline`);
  }

  // Base priority requested by Dept Head
  if (task.priority === 'critical') score += 15;
  else if (task.priority === 'high') score += 8;

  // Clamp 0 to 100
  score = Math.min(100, Math.max(0, Math.round(score)));

  let recommendedPriority: TaskPriority = 'low';
  let urgencyLevel: 'low' | 'moderate' | 'high' | 'critical' = 'low';

  if (score >= 80) {
    recommendedPriority = 'critical';
    urgencyLevel = 'critical';
  } else if (score >= 60) {
    recommendedPriority = 'high';
    urgencyLevel = 'high';
  } else if (score >= 35) {
    recommendedPriority = 'medium';
    urgencyLevel = 'moderate';
  } else {
    recommendedPriority = 'low';
    urgencyLevel = 'low';
  }

  return {
    score,
    recommendedPriority,
    reason: reasons.join(' • ') || 'Standard scheduling queue',
    daysRemaining,
    urgencyLevel,
    isOverdue,
    isDueSoon,
  };
}
