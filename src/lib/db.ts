import { supabase } from './supabaseClient';
import type {
  AuditLogRow,
  NotificationRow,
  SlackConfigRow,
  TaskRow,
  TimeSessionRow,
  UserRow,
} from './api';

export class DbError extends Error {}

function check<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new DbError(error.message);
  return data as T;
}

const TASK_SELECT = '*, remarks:task_remarks(*)';

export const db = {
  // Users
  async me(): Promise<UserRow> {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) throw new DbError('Not signed in');
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('auth_user_id', authData.user.id)
      .single();
    return check(data as UserRow, error);
  },

  async listUsers(): Promise<UserRow[]> {
    const { data, error } = await supabase.from('users').select('*');
    return check(data as UserRow[], error);
  },

  async createUser(body: Record<string, unknown>): Promise<UserRow> {
    const { data, error } = await supabase
      .from('users')
      .insert({
        name: body.name,
        email: body.email,
        role: body.role ?? 'employee',
        department: body.department,
        title: body.title ?? '',
        avatar: body.avatar ?? null,
        permissions: body.permissions,
      })
      .select()
      .single();
    return check(data as UserRow, error);
  },

  async updatePermissions(userId: string, permissions: Record<string, boolean>): Promise<UserRow> {
    const { data: current, error: fetchErr } = await supabase
      .from('users')
      .select('permissions')
      .eq('id', userId)
      .single();
    check(current, fetchErr);
    const merged = { ...(current as { permissions: Record<string, boolean> }).permissions, ...permissions };
    const { data, error } = await supabase
      .from('users')
      .update({ permissions: merged })
      .eq('id', userId)
      .select()
      .single();
    return check(data as UserRow, error);
  },

  async updateStatus(userId: string, status: string): Promise<UserRow> {
    const { data, error } = await supabase
      .from('users')
      .update({ status })
      .eq('id', userId)
      .select()
      .single();
    return check(data as UserRow, error);
  },

  // Tasks
  async listTasks(): Promise<TaskRow[]> {
    const { data, error } = await supabase.from('tasks').select(TASK_SELECT).order('due_date');
    return check(data as unknown as TaskRow[], error);
  },

  async getTask(id: string): Promise<TaskRow> {
    const { data, error } = await supabase.from('tasks').select(TASK_SELECT).eq('id', id).single();
    return check(data as unknown as TaskRow, error);
  },

  async createTask(body: Record<string, unknown>): Promise<TaskRow> {
    const me = await db.me();
    const { data, error } = await supabase
      .from('tasks')
      .insert({
        title: body.title,
        description: body.description ?? '',
        department: body.department,
        assignee_id: body.assigneeId,
        created_by_id: me.id,
        start_date: body.startDate,
        due_date: body.dueDate,
        estimated_hours: body.estimatedHours ?? 0,
        priority: body.priority ?? 'medium',
        status: body.status ?? 'todo',
        progress: body.progress ?? 0,
        tags: body.tags ?? [],
      })
      .select(TASK_SELECT)
      .single();
    return check(data as unknown as TaskRow, error);
  },

  async updateTask(id: string, body: Record<string, unknown>): Promise<TaskRow> {
    const updates: Record<string, unknown> = {};
    const allowed = [
      'title', 'description', 'status', 'progress', 'priority', 'dueDate',
      'startDate', 'estimatedHours', 'loggedHours', 'tags', 'completedDate',
    ];
    for (const key of allowed) {
      if (key in body) {
        const dbKey = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
        updates[dbKey] = body[key];
      }
    }
    const { data, error } = await supabase
      .from('tasks')
      .update(updates)
      .eq('id', id)
      .select(TASK_SELECT)
      .single();
    return check(data as unknown as TaskRow, error);
  },

  async deleteTask(id: string): Promise<void> {
    const { error } = await supabase.from('tasks').delete().eq('id', id);
    check(null, error);
  },

  async addRemark(taskId: string, body: Record<string, unknown>) {
    const me = await db.me();
    const { data, error } = await supabase
      .from('task_remarks')
      .insert({
        task_id: taskId,
        author_id: me.id,
        text: body.text,
        is_encrypted: body.isEncrypted ?? false,
        type: body.type ?? 'general',
      })
      .select()
      .single();
    return check(data, error);
  },

  // Approvals (via RPCs — see server/db/03_go_backendless.sql)
  async listPendingApprovals(): Promise<TaskRow[]> {
    const { data, error } = await supabase
      .from('tasks')
      .select(TASK_SELECT)
      .eq('approval_status', 'pending')
      .order('due_date');
    return check(data as unknown as TaskRow[], error);
  },

  async submitForApproval(taskId: string, note?: string): Promise<TaskRow> {
    const { data, error } = await supabase.rpc('submit_task_for_approval', {
      p_task_id: taskId,
      p_note: note ?? null,
    });
    return check(data as TaskRow, error);
  },

  async decideApproval(taskId: string, decision: 'approved' | 'rejected', comment?: string): Promise<TaskRow> {
    const { data, error } = await supabase.rpc('decide_task_approval', {
      p_task_id: taskId,
      p_decision: decision,
      p_comment: comment ?? null,
    });
    return check(data as TaskRow, error);
  },

  // Audit logs
  async listAuditLogs(params?: { category?: string; status?: string; limit?: number }): Promise<AuditLogRow[]> {
    let query = supabase
      .from('audit_logs')
      .select('*, actor:users(name, role)')
      .order('created_at', { ascending: false })
      .limit(params?.limit ?? 100);
    if (params?.category) query = query.eq('category', params.category);
    if (params?.status) query = query.eq('status', params.status);
    const { data, error } = await query;
    return check(data as unknown as AuditLogRow[], error);
  },

  async logAuditEvent(action: string, category: string, target: string, details = '', status = 'success') {
    const { error } = await supabase.rpc('log_audit_event', {
      p_action: action,
      p_category: category,
      p_target: target,
      p_details: details,
      p_status: status,
    });
    if (error) console.error('Audit log failed:', error.message);
  },

  // Slack (via RPCs)
  async getSlackConfig(): Promise<SlackConfigRow | null> {
    const { data, error } = await supabase
      .from('slack_config')
      .select('*, log:slack_notification_log(*)')
      .is('department', null)
      .maybeSingle();
    if (error) return null;
    return data as unknown as SlackConfigRow | null;
  },

  async saveSlackConfig(body: Record<string, unknown>): Promise<SlackConfigRow> {
    const { data, error } = await supabase
      .from('slack_config')
      .upsert(
        {
          department: null,
          webhook_url: body.webhookUrl,
          channel: body.channel,
          bot_name: body.botName,
          notify_on_task_assigned: body.notifyOnTaskAssigned,
          notify_on_deadline_alert: body.notifyOnDeadlineAlert,
          notify_on_approval_requested: body.notifyOnApprovalRequested,
          notify_on_task_completed: body.notifyOnTaskCompleted,
          notify_on_daily_summary: body.notifyOnDailySummary,
        },
        { onConflict: 'department' }
      )
      .select()
      .single();
    return check(data as SlackConfigRow, error);
  },

  async testSlack(): Promise<{ success: boolean; message: string }> {
    const { data, error } = await supabase.rpc('test_slack_connection');
    if (error) return { success: false, message: error.message };
    const result = data as { success: boolean };
    return { success: result.success, message: result.success ? 'Delivered' : 'Failed' };
  },

  // Time sessions
  async listTimeSessions(): Promise<TimeSessionRow[]> {
    const { data, error } = await supabase.from('time_sessions').select('*').order('start_time', { ascending: false });
    return check(data as TimeSessionRow[], error);
  },

  async createTimeSession(body: Record<string, unknown>): Promise<TimeSessionRow> {
    const me = await db.me();
    const { data, error } = await supabase
      .from('time_sessions')
      .insert({
        user_id: me.id,
        task_id: body.taskId ?? null,
        start_time: body.startTime,
        end_time: body.endTime ?? new Date().toISOString(),
        duration_minutes: body.durationMinutes,
        type: body.type ?? 'focus_work',
        efficiency_score: body.efficiencyScore ?? 0,
        notes: body.notes ?? null,
      })
      .select()
      .single();
    const row = check(data as TimeSessionRow, error);
    if (body.taskId) {
      await supabase.rpc('increment_task_logged_hours', {
        p_task_id: body.taskId,
        p_hours: (body.durationMinutes as number) / 60,
      });
    }
    return row;
  },

  // Notifications
  async listNotifications(): Promise<NotificationRow[]> {
    const me = await db.me();
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', me.id)
      .order('created_at', { ascending: false })
      .limit(100);
    return check(data as NotificationRow[], error);
  },

  async markNotificationRead(id: string): Promise<void> {
    const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id);
    check(null, error);
  },

  async markAllNotificationsRead(): Promise<void> {
    const me = await db.me();
    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', me.id)
      .eq('read', false);
    check(null, error);
  },

  // Reports (computed client-side from tasks — no backend needed)
  async monthlyReport(month: string, department?: string) {
    const start = `${month}-01`;
    const end = new Date(new Date(start).getFullYear(), new Date(start).getMonth() + 1, 1)
      .toISOString()
      .slice(0, 10);
    let query = supabase.from('tasks').select('*').gte('due_date', start).lt('due_date', end);
    if (department) query = query.eq('department', department);
    const { data, error } = await query;
    const tasks = check(data as TaskRow[], error);

    const completed = tasks.filter((t) => t.status === 'completed');
    const overdue = tasks.filter((t) => t.status !== 'completed' && new Date(t.due_date) < new Date());
    const totalHours = tasks.reduce((sum, t) => sum + Number(t.logged_hours ?? 0), 0);

    return {
      month,
      department: department ?? 'ALL',
      totalTasks: tasks.length,
      completedTasks: completed.length,
      completionRate: tasks.length ? Math.round((completed.length / tasks.length) * 100) : 0,
      totalHoursLogged: totalHours,
      tasksOverdue: overdue.length,
    };
  },
};
