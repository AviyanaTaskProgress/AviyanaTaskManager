export type UserRole = 'super_admin' | 'chief_officer' | 'dept_head' | 'staff' | 'viewer';

/** Access a Chief Officer has for one department. No entry = 'full'. */
export type ChiefOfficerAccessLevel = 'full' | 'limited';

export interface ChiefOfficerDepartmentAccess {
  id: string;
  chiefOfficerId: string;
  department: Department;
  accessLevel: ChiefOfficerAccessLevel;
}

/** Department names are now data, not a fixed set — see `public.departments`
 *  and AppContext's `departments` list. New ones can be added from the app. */
export type Department = string;

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export type TaskStatus =
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'pending_approval'
  | 'completed'
  | 'blocked'
  | 'pending_payment';

export type TaskPaymentStatus = 'not_applicable' | 'pending' | 'paid';


export interface UserPermissions {
  canCreateTasks: boolean;
  canApproveTasks: boolean;
  canManageUsers: boolean;
  canViewAuditLogs: boolean;
  canExportReports: boolean;
  canConfigureSlack: boolean;
  canEditAllTasks: boolean;
  canViewExecutiveAnalytics: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: Department;
  title: string;
  avatar: string;
  status: 'active' | 'in_meeting' | 'focus_mode' | 'away' | 'offline';
  productivityScore: number; // 0 - 100
  tasksCompleted: number;
  tasksInProgress: number;
  hoursLoggedThisMonth: number;
  permissions: UserPermissions;
  joinedDate: string;
  /** false = admin provisioned this profile but the person hasn't signed up (claimed) their login yet */
  accountActivated: boolean;
}

export interface TaskRemark {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  authorRole: UserRole;
  text: string;
  timestamp: string;
  isEncrypted?: boolean;
  type?: 'general' | 'status_change' | 'approval_request' | 'approval_action' | 'deadline_change';
}

export interface TaskAttachment {
  id: string;
  taskId: string;
  subtaskId?: string;
  uploadedById: string;
  uploadedByName: string;
  kind: 'file' | 'link';
  url: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  timestamp: string;
}

export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  isCompleted: boolean;
  completedAt?: string;
  completedById?: string;
  completedByName?: string;
  orderIndex: number;
  assigneeId?: string;
  assigneeName?: string;
  createdById: string;
  createdAt: string;
  attachments: TaskAttachment[];
}


export interface Task {
  id: string;
  title: string;
  description: string;
  department: Department;
  assigneeId: string;
  assigneeName: string;
  assigneeAvatar: string;
  createdById: string;
  createdByName: string;
  createdByRole: UserRole;
  startDate: string; // YYYY-MM-DD
  dueDate: string; // YYYY-MM-DD
  completedDate?: string;
  loggedHours: number;
  priority: TaskPriority;
  status: TaskStatus;
  progress: number; // 0 - 100%
  remarks: TaskRemark[];
  attachments: TaskAttachment[];
  subtasks: Subtask[];
  tags: string[];
  approvedBy?: string;
  approvedByName?: string;
  approvalDate?: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  encryptedNote?: string;
  isEncrypted?: boolean;
  slackSynced?: boolean;
  slackLastNotified?: string;
  taskDisplayId: string;
  /** Set only when assigneeId === createdById (a self-logged task) —
   *  who actually instructed it, e.g. a Dept Head who told a Staff
   *  member verbally. Purely informational. */
  assignedById?: string;
  assignedByName?: string;
  requiresPayment: boolean;
  paymentAmount?: number;
  paymentStatus: TaskPaymentStatus;
  paymentConfirmedById?: string;
  paymentConfirmedByName?: string;
  paymentConfirmedAt?: string;
  paymentNotes?: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  actorId: string;
  actorName: string;
  actorRole: UserRole;
  action: string;
  category: 'task' | 'user' | 'security' | 'slack' | 'approval' | 'report';
  target: string;
  details: string;
  ipHash: string;
  encryptedSignature: string;
  status: 'success' | 'warning' | 'critical';
}

export interface NotificationItem {
  id: string;
  timestamp: string;
  type: 'deadline' | 'approval' | 'assignment' | 'slack' | 'system' | 'alarm';
  title: string;
  message: string;
  read: boolean;
  taskId?: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
}

export interface SlackConfig {
  webhookUrl: string;
  channel: string;
  botName: string;
  notifyOnTaskAssigned: boolean;
  notifyOnDeadlineAlert: boolean;
  notifyOnApprovalRequested: boolean;
  notifyOnTaskCompleted: boolean;
  notifyOnDailySummary: boolean;
  isConnected: boolean;
  lastTestedAt?: string;
  notificationLog: Array<{
    id: string;
    timestamp: string;
    type: string;
    channel: string;
    summary: string;
    status: 'delivered' | 'failed';
  }>;
}

export type ConversationType = 'direct' | 'group';

/** A conversation as shown in the conversation list — includes a last-message
 *  preview and unread count computed server-side (see list_my_conversations RPC). */
export interface ConversationSummary {
  id: string;
  type: ConversationType;
  /** Display name. For 'direct' this is derived client-side from the other member; for 'group' it's the stored name. */
  name: string;
  createdById: string;
  relatedTaskId?: string;
  relatedTaskTitle?: string;
  createdAt: string;
  lastMessageAt: string;
  lastMessageText?: string;
  lastMessageSenderId?: string;
  lastMessageIsEncrypted?: boolean;
  unreadCount: number;
  memberIds: string[];
  /** For 'direct' conversations, the other participant (used for avatar/name). */
  otherMember?: User;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  senderRole: UserRole;
  text: string | null;
  isEncrypted?: boolean;
  timestamp: string;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentKind?: 'image' | 'file' | null;
}

export interface MonthlyReportData {
  month: string;
  year: number;
  department: string;
  totalTasks: number;
  completedTasks: number;
  completionRate: number;
  totalHoursLogged: number;
  averageProductivityScore: number;
  deadlineAdherenceRate: number;
  tasksOverdue: number;
  tasksApproved: number;
  topPerformers: Array<{
    userId: string;
    name: string;
    role: string;
    tasksDone: number;
    score: number;
    hours: number;
  }>;
}
