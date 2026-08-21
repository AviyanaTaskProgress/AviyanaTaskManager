// ---- Raw DB row shapes (snake_case, as returned by Postgres/Supabase) ----
// The app talks to Supabase directly (see lib/db.ts) — there is no
// separate REST API. These interfaces exist purely to type the rows
// Supabase returns before lib/mappers.ts converts them to the
// camelCase shapes the UI uses.

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: 'super_admin' | 'chief_officer' | 'dept_head' | 'staff';
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

export interface ChiefOfficerAccessRow {
  id: string;
  chief_officer_id: string;
  department: string;
  access_level: 'full' | 'limited';
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

export interface TaskAttachmentRow {
  id: string;
  task_id: string;
  uploaded_by: string;
  kind: 'file' | 'link';
  url: string;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
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
  attachments: TaskAttachmentRow[];
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
