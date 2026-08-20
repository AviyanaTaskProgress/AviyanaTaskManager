export type UserRole = 'super_admin' | 'chief_officer' | 'dept_head' | 'staff';

/** Access a Chief Officer has for one department. No entry = 'full'. */
export type ChiefOfficerAccessLevel = 'full' | 'limited';

export interface ChiefOfficerDepartmentAccess {
  id: string;
  chiefOfficerId: string;
  department: Department;
  accessLevel: ChiefOfficerAccessLevel;
}

export type Department =
  | 'Engineering'
  | 'Product & Design'
  | 'Marketing'
  | 'Operations'
  | 'Human Resources'
  | 'Sales & Growth';

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export type TaskStatus =
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'pending_approval'
  | 'completed'
  | 'blocked';

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
  estimatedHours: number;
  loggedHours: number;
  priority: TaskPriority;
  autoPriorityScore?: number; // 0 - 100 calculated by automated engine
  priorityReason?: string;
  status: TaskStatus;
  progress: number; // 0 - 100%
  remarks: TaskRemark[];
  tags: string[];
  approvedBy?: string;
  approvedByName?: string;
  approvalDate?: string;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  encryptedNote?: string;
  isEncrypted?: boolean;
  slackSynced?: boolean;
  slackLastNotified?: string;
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
  type: 'deadline' | 'approval' | 'assignment' | 'slack' | 'system';
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

export interface TimeSession {
  id: string;
  userId: string;
  userName: string;
  taskId?: string;
  taskTitle?: string;
  startTime: string;
  endTime?: string;
  durationMinutes: number;
  type: 'focus_work' | 'code_review' | 'planning' | 'collaboration' | 'break';
  efficiencyScore: number; // 0 - 100
  notes?: string;
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
