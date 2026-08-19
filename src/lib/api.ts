import { supabase } from './supabaseClient';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {}
): Promise<T> {
  const headers = await authHeaders();
  let url = `${API_BASE}${path}`;
  if (options.query) {
    const params = new URLSearchParams();
    Object.entries(options.query).forEach(([k, v]) => {
      if (v !== undefined) params.set(k, v);
    });
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error ?? message;
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  // Users
  me: () => request<UserRow>('/api/users/me'),
  listUsers: (department?: string) => request<UserRow[]>('/api/users', { query: { department } }),
  createUser: (body: Record<string, unknown>) => request<UserRow>('/api/users', { method: 'POST', body }),
  updatePermissions: (userId: string, permissions: Record<string, boolean>) =>
    request<UserRow>(`/api/users/${userId}/permissions`, { method: 'PATCH', body: permissions }),
  updateStatus: (userId: string, status: string) =>
    request<UserRow>(`/api/users/${userId}/status`, { method: 'PATCH', body: { status } }),

  // Tasks
  listTasks: () => request<TaskRow[]>('/api/tasks'),
  getTask: (id: string) => request<TaskRow>(`/api/tasks/${id}`),
  createTask: (body: Record<string, unknown>) => request<TaskRow>('/api/tasks', { method: 'POST', body }),
  updateTask: (id: string, body: Record<string, unknown>) =>
    request<TaskRow>(`/api/tasks/${id}`, { method: 'PATCH', body }),
  deleteTask: (id: string) => request<void>(`/api/tasks/${id}`, { method: 'DELETE' }),
  addRemark: (taskId: string, body: Record<string, unknown>) =>
    request<TaskRemarkRow>(`/api/tasks/${taskId}/remarks`, { method: 'POST', body }),

  // Approvals
  listPendingApprovals: () => request<TaskRow[]>('/api/approvals'),
  submitForApproval: (taskId: string, note?: string) =>
    request<TaskRow>(`/api/approvals/${taskId}/submit`, { method: 'POST', body: { note } }),
  decideApproval: (taskId: string, decision: 'approved' | 'rejected', comment?: string) =>
    request<TaskRow>(`/api/approvals/${taskId}/decision`, { method: 'POST', body: { decision, comment } }),

  // Audit logs
  listAuditLogs: (params?: { category?: string; status?: string; limit?: number }) =>
    request<AuditLogRow[]>('/api/audit-logs', {
      query: { category: params?.category, status: params?.status, limit: params?.limit?.toString() },
    }),

  // Slack
  getSlackConfig: () => request<SlackConfigRow | null>('/api/slack/config'),
  saveSlackConfig: (body: Record<string, unknown>) =>
    request<SlackConfigRow>('/api/slack/config', { method: 'PUT', body }),
  testSlack: () => request<{ success: boolean; message: string }>('/api/slack/test', { method: 'POST' }),

  // Time sessions
  listTimeSessions: () => request<TimeSessionRow[]>('/api/time-sessions'),
  createTimeSession: (body: Record<string, unknown>) =>
    request<TimeSessionRow>('/api/time-sessions', { method: 'POST', body }),

  // Notifications
  listNotifications: () => request<NotificationRow[]>('/api/notifications'),
  markNotificationRead: (id: string) =>
    request<NotificationRow>(`/api/notifications/${id}/read`, { method: 'PATCH' }),
  markAllNotificationsRead: () => request<void>('/api/notifications/read-all', { method: 'PATCH' }),

  // Reports
  monthlyReport: (month: string, department?: string) =>
    request<Record<string, unknown>>('/api/reports/monthly', { query: { month, department } }),
};

// ---- Raw DB row shapes (snake_case, as returned by Postgres/Supabase) ----

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: 'dept_head' | 'manager' | 'employee';
  department: string;
  title: string;
  avatar: string | null;
  status: string;
  productivity_score: number;
  tasks_completed: number;
  tasks_in_progress: number;
  hours_logged_this_month: number;
  permissions: Record<string, boolean>;
  joined_date: string;
  auth_user_id: string | null;
}

export interface TaskRemarkRow {
  id: string;
  task_id: string;
  author_id: string;
  text: string;
  is_encrypted: boolean;
  type: string;
  created_at: string;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string;
  department: string;
  assignee_id: string;
  created_by_id: string;
  start_date: string;
  due_date: string;
  completed_date: string | null;
  estimated_hours: number;
  logged_hours: number;
  priority: string;
  auto_priority_score: number | null;
  priority_reason: string | null;
  status: string;
  progress: number;
  tags: string[];
  approved_by: string | null;
  approval_date: string | null;
  approval_status: string | null;
  encrypted_note: string | null;
  is_encrypted: boolean;
  slack_synced: boolean;
  slack_last_notified: string | null;
  remarks: TaskRemarkRow[];
}

export interface AuditLogRow {
  id: string;
  actor_id: string | null;
  actor: { name: string; role: string } | null;
  action: string;
  category: string;
  target: string;
  details: string;
  ip_hash: string | null;
  encrypted_signature: string;
  status: string;
  created_at: string;
}

export interface SlackConfigRow {
  id: string;
  webhook_url: string | null;
  channel: string | null;
  bot_name: string | null;
  notify_on_task_assigned: boolean;
  notify_on_deadline_alert: boolean;
  notify_on_approval_requested: boolean;
  notify_on_task_completed: boolean;
  notify_on_daily_summary: boolean;
  is_connected: boolean;
  last_tested_at: string | null;
  log?: Array<{
    id: string;
    type: string;
    channel: string;
    summary: string;
    status: 'delivered' | 'failed';
    created_at: string;
  }>;
}

export interface TimeSessionRow {
  id: string;
  user_id: string;
  task_id: string | null;
  start_time: string;
  end_time: string | null;
  duration_minutes: number;
  type: string;
  efficiency_score: number;
  notes: string | null;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  task_id: string | null;
  urgency: string;
  created_at: string;
}
