import {
  AuditLog,
  NotificationItem,
  SlackConfig,
  Task,
  TaskRemark,
  User,
  UserRole,
} from '../types';
import {
  AuditLogRow,
  NotificationRow,
  SlackConfigRow,
  TaskRow,
  UserRow,
} from './api';
import { ROLE_LABEL } from './roles';

export type UsersById = Record<string, UserRow>;

function fallbackAvatar(name: string): string {
  return `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundColor=f4c115`;
}

export function mapUser(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    department: row.department as User['department'],
    title: row.title,
    avatar: row.avatar || fallbackAvatar(row.name),
    status: row.status as User['status'],
    productivityScore: Number(row.productivity_score),
    tasksCompleted: row.tasks_completed,
    tasksInProgress: row.tasks_in_progress,
    hoursLoggedThisMonth: Number(row.hours_logged_this_month),
    permissions: row.permissions as unknown as User['permissions'],
    joinedDate: row.joined_date,
    accountActivated: !!row.auth_user_id,
  };
}

function roleLabel(role: UserRole): string {
  return ROLE_LABEL[role] ?? 'Staff';
}

export function mapTask(row: TaskRow, usersById: UsersById): Task {
  const assignee = usersById[row.assignee_id];
  const creator = usersById[row.created_by_id];
  const approver = row.approved_by ? usersById[row.approved_by] : undefined;

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    department: row.department as Task['department'],
    assigneeId: row.assignee_id,
    assigneeName: assignee?.name ?? 'Unknown',
    assigneeAvatar: assignee?.avatar || fallbackAvatar(assignee?.name ?? 'U'),
    createdById: row.created_by_id,
    createdByName: creator ? `${creator.name} (${roleLabel(creator.role)})` : 'Unknown',
    createdByRole: creator?.role ?? 'staff',
    startDate: row.start_date,
    dueDate: row.due_date,
    completedDate: row.completed_date ?? undefined,
    estimatedHours: Number(row.estimated_hours),
    loggedHours: Number(row.logged_hours),
    priority: row.priority as Task['priority'],
    autoPriorityScore: row.auto_priority_score ?? undefined,
    priorityReason: row.priority_reason ?? undefined,
    status: row.status as Task['status'],
    progress: row.progress,
    remarks: row.remarks.map((r) => mapRemark(r, usersById)),
    tags: row.tags ?? [],
    approvedBy: row.approved_by ?? undefined,
    approvedByName: approver?.name,
    approvalDate: row.approval_date ?? undefined,
    approvalStatus: (row.approval_status as Task['approvalStatus']) ?? undefined,
    encryptedNote: row.encrypted_note ?? undefined,
    isEncrypted: row.is_encrypted,
    slackSynced: row.slack_synced,
    slackLastNotified: row.slack_last_notified ?? undefined,
  };
}

function mapRemark(row: TaskRow['remarks'][number], usersById: UsersById): TaskRemark {
  const author = usersById[row.author_id];
  return {
    id: row.id,
    authorId: row.author_id,
    authorName: author?.name ?? 'Unknown',
    authorAvatar: author?.avatar || fallbackAvatar(author?.name ?? 'U'),
    authorRole: author?.role ?? 'staff',
    text: row.text,
    timestamp: row.created_at.replace('T', ' ').substring(0, 16),
    isEncrypted: row.is_encrypted,
    type: row.type as TaskRemark['type'],
  };
}

export function mapAuditLog(row: AuditLogRow): AuditLog {
  return {
    id: row.id,
    timestamp: row.created_at.replace('T', ' ').substring(0, 19),
    actorId: row.actor_id ?? '',
    actorName: row.actor?.name ?? 'System',
    actorRole: (row.actor?.role as UserRole) ?? 'staff',
    action: row.action,
    category: row.category as AuditLog['category'],
    target: row.target,
    details: row.details,
    ipHash: row.ip_hash ?? '',
    encryptedSignature: row.encrypted_signature,
    status: row.status as AuditLog['status'],
  };
}

export function mapNotification(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    timestamp: row.created_at.replace('T', ' ').substring(0, 16),
    type: row.type as NotificationItem['type'],
    title: row.title,
    message: row.message,
    read: row.read,
    taskId: row.task_id ?? undefined,
    urgency: row.urgency as NotificationItem['urgency'],
  };
}

export function mapSlackConfig(row: SlackConfigRow | null): SlackConfig {
  if (!row) {
    return {
      webhookUrl: '',
      channel: '#work-tracker-alerts',
      botName: 'Aviyana Staff Bot',
      notifyOnTaskAssigned: true,
      notifyOnDeadlineAlert: true,
      notifyOnApprovalRequested: true,
      notifyOnTaskCompleted: true,
      notifyOnDailySummary: false,
      isConnected: false,
      notificationLog: [],
    };
  }
  return {
    webhookUrl: row.webhook_url ?? '',
    channel: row.channel ?? '#work-tracker-alerts',
    botName: row.bot_name ?? 'Aviyana Staff Bot',
    notifyOnTaskAssigned: row.notify_on_task_assigned,
    notifyOnDeadlineAlert: row.notify_on_deadline_alert,
    notifyOnApprovalRequested: row.notify_on_approval_requested,
    notifyOnTaskCompleted: row.notify_on_task_completed,
    notifyOnDailySummary: row.notify_on_daily_summary,
    isConnected: row.is_connected,
    lastTestedAt: row.last_tested_at ?? undefined,
    notificationLog: (row.log ?? []).map((l) => ({
      id: l.id,
      timestamp: l.created_at.replace('T', ' ').substring(0, 16),
      type: l.type,
      channel: l.channel,
      summary: l.summary,
      status: l.status,
    })),
  };
}
