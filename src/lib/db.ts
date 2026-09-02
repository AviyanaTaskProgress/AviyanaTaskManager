import { supabase } from './supabaseClient';
import type {
  AuditLogRow,
  BackupRow,
  BackupSettingsRow,
  ChiefOfficerAccessRow,
  ConversationSummaryRow,
  MessageRow,
  NotificationRow,
  RestoreResult,
  SlackConfigRow,
  TaskAttachmentRow,
  TaskRow,
  TaskSubtaskRow,
  UserRow,
} from './api';

export class DbError extends Error {}

function check<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new DbError(error.message);
  return data as T;
}

// Retries a READ-ONLY operation on a transient network failure (Wi-Fi
// blip, DNS hiccup) — never applied to writes, since retrying a
// mutation whose response was merely lost (not actually failed) risks
// a duplicate insert/update. Backend review (2026-09) flagged that a
// single flaky request currently just fails outright with no retry —
// most annoying on the initial loadAll() a person sees the moment they
// open the app. Two retries, short fixed backoff — this is meant to
// smooth over a one-off blip, not mask a genuinely down connection.
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message.toLowerCase() : '';
      const isTransient =
        message.includes('failed to fetch') || message.includes('networkerror') || message.includes('load failed');
      if (!isTransient || i === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

const TASK_SELECT = '*, remarks:task_remarks(*), attachments:task_attachments(*), subtasks:task_subtasks(*)';

export const db = {
  // Users
  async me(): Promise<UserRow> {
    return withRetry(async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) throw new DbError('Not signed in');
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('auth_user_id', authData.user.id)
        .single();
      return check(data as UserRow, error);
    });
  },

  async listUsers(): Promise<UserRow[]> {
    return withRetry(async () => {
      const { data, error } = await supabase.from('users').select('*');
      return check(data as UserRow[], error);
    });
  },

  async createUser(body: Record<string, unknown>): Promise<UserRow> {
    const { data, error } = await supabase
      .from('users')
      .insert({
        name: body.name,
        email: body.email,
        role: body.role ?? 'staff',
        department: body.department,
        title: body.title ?? '',
        avatar: body.avatar ?? null,
        permissions: body.permissions,
      })
      .select()
      .single();
    return check(data as UserRow, error);
  },

  // Chief Officer per-department access (super_admin only — enforced by RLS)
  async listAllChiefOfficerAccess(): Promise<ChiefOfficerAccessRow[]> {
    const { data, error } = await supabase.from('chief_officer_department_access').select('*');
    return check(data as ChiefOfficerAccessRow[], error);
  },

  async listChiefOfficerAccess(chiefOfficerId: string): Promise<ChiefOfficerAccessRow[]> {
    const { data, error } = await supabase
      .from('chief_officer_department_access')
      .select('*')
      .eq('chief_officer_id', chiefOfficerId);
    return check(data as ChiefOfficerAccessRow[], error);
  },

  async setChiefOfficerAccess(
    chiefOfficerId: string,
    department: string,
    accessLevel: 'full' | 'limited'
  ): Promise<void> {
    if (accessLevel === 'full') {
      // No row = full access; delete any override.
      const { error } = await supabase
        .from('chief_officer_department_access')
        .delete()
        .eq('chief_officer_id', chiefOfficerId)
        .eq('department', department);
      if (error) throw new DbError(error.message);
      return;
    }
    const { error } = await supabase
      .from('chief_officer_department_access')
      .upsert(
        { chief_officer_id: chiefOfficerId, department, access_level: accessLevel },
        { onConflict: 'chief_officer_id,department' }
      );
    if (error) throw new DbError(error.message);
  },

  async updateUserProfile(userId: string, updates: Record<string, unknown>): Promise<UserRow> {
    const payload: Record<string, unknown> = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.title !== undefined) payload.title = updates.title;
    if (updates.avatar !== undefined) payload.avatar = updates.avatar || null;
    if (updates.department !== undefined) payload.department = updates.department;
    if (updates.role !== undefined) payload.role = updates.role;
    const { data, error } = await supabase.from('users').update(payload).eq('id', userId).select().single();
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
  async listTasks(params?: { limit?: number }): Promise<TaskRow[]> {
    return withRetry(async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select(TASK_SELECT)
        .order('due_date')
        .limit(params?.limit ?? 500); // safety net — see AVIYANA_HONEST_AUDIT.md on pagination
      return check(data as unknown as TaskRow[], error);
    });
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
        assigned_by_id: body.assignedById ?? null,
        start_date: body.startDate,
        due_date: body.dueDate,
        priority: body.priority ?? 'medium',
        status: body.status ?? 'todo',
        progress: body.progress ?? 0,
        tags: body.tags ?? [],
        requires_payment: body.requiresPayment ?? false,
        payment_amount: body.paymentAmount ?? null,
      })
      .select(TASK_SELECT)
      .single();
    return check(data as unknown as TaskRow, error);
  },

  async updateTask(id: string, body: Record<string, unknown>): Promise<TaskRow> {
    const updates: Record<string, unknown> = {};
    const allowed = [
      'title', 'description', 'status', 'progress', 'priority', 'dueDate',
      'startDate', 'loggedHours', 'tags', 'completedDate',
      'requiresPayment', 'paymentAmount', 'assignedById',
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

  async addAttachment(taskId: string, body: Record<string, unknown>): Promise<TaskAttachmentRow> {
    const me = await db.me();
    const { data, error } = await supabase
      .from('task_attachments')
      .insert({
        task_id: taskId,
        subtask_id: body.subtaskId ?? null,
        uploaded_by: me.id,
        kind: body.kind,
        url: body.url,
        file_name: body.fileName ?? null,
        file_size: body.fileSize ?? null,
        mime_type: body.mimeType ?? null,
      })
      .select()
      .single();
    return check(data as TaskAttachmentRow, error);
  },

  async deleteAttachment(attachmentId: string): Promise<void> {
    const { error } = await supabase.from('task_attachments').delete().eq('id', attachmentId);
    if (error) throw new DbError(error.message);
  },

  // Subtasks (see server/db/27_task_subtasks.sql)
  async addSubtask(taskId: string, title: string, assigneeId?: string | null, paymentAmount?: number | null): Promise<TaskSubtaskRow> {
    const me = await db.me();
    const { data, error } = await supabase
      .from('task_subtasks')
      .insert({
        task_id: taskId,
        title,
        assignee_id: assigneeId ?? null,
        created_by_id: me.id,
        payment_amount: paymentAmount ?? null,
      })
      .select()
      .single();
    return check(data as TaskSubtaskRow, error);
  },

  async setSubtaskCompleted(subtaskId: string, isCompleted: boolean): Promise<TaskSubtaskRow> {
    const { data, error } = await supabase
      .from('task_subtasks')
      .update({ is_completed: isCompleted })
      .eq('id', subtaskId)
      .select()
      .single();
    return check(data as TaskSubtaskRow, error);
  },

  async setSubtaskPaymentAmount(subtaskId: string, paymentAmount: number | null): Promise<TaskSubtaskRow> {
    const { data, error } = await supabase
      .from('task_subtasks')
      .update({ payment_amount: paymentAmount })
      .eq('id', subtaskId)
      .select()
      .single();
    return check(data as TaskSubtaskRow, error);
  },

  async deleteSubtask(subtaskId: string): Promise<void> {
    const { error } = await supabase.from('task_subtasks').delete().eq('id', subtaskId);
    if (error) throw new DbError(error.message);
  },

  // Payment (see server/db/29_task_payment_workflow.sql — Super Admin /
  // Chief Officer only, enforced inside the RPC itself)
  async confirmTaskPayment(taskId: string, notes?: string): Promise<TaskRow> {
    const { data, error } = await supabase.rpc('confirm_task_payment', {
      p_task_id: taskId,
      p_notes: notes ?? null,
    });
    return check(data as TaskRow, error);
  },

  // Per-subtask partial payments (see server/db/38_subtask_partial_payments.sql).
  async confirmSubtaskPayment(subtaskId: string, notes?: string): Promise<TaskSubtaskRow> {
    const { data, error } = await supabase.rpc('confirm_subtask_payment', {
      p_subtask_id: subtaskId,
      p_notes: notes ?? null,
    });
    return check(data as TaskSubtaskRow, error);
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

  // Reminders & alarms (see server/db/33_task_reminders_and_alarms.sql).
  // Automatic 3-day/1-day deadline reminders run server-side on a daily
  // pg_cron schedule — nothing to call from the client for those. This
  // is only the manual "ring alarm" action.
  async ringTaskAlarm(taskId: string): Promise<void> {
    const { error } = await supabase.rpc('ring_task_alarm', { p_task_id: taskId });
    check(null, error);
  },

  // Audit logs
  async listAuditLogs(params?: {
    category?: string;
    status?: string;
    limit?: number;
    before?: string; // ISO timestamp cursor — fetches entries older than this
  }): Promise<AuditLogRow[]> {
    let query = supabase
      .from('audit_logs')
      .select('*, actor:users(name, role)')
      .order('created_at', { ascending: false })
      .limit(params?.limit ?? 100);
    if (params?.category) query = query.eq('category', params.category);
    if (params?.status) query = query.eq('status', params.status);
    if (params?.before) query = query.lt('created_at', params.before);
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
    // NOTE: department is always null here (one global config) — and a
    // plain UNIQUE constraint never matches NULL to NULL, so `.upsert()`
    // with `onConflict: 'department'` would silently create a new
    // duplicate row on every save instead of updating the existing one.
    // Select-then-update-or-insert explicitly instead.
    const existing = await supabase
      .from('slack_config')
      .select('id')
      .is('department', null)
      .maybeSingle();

    const payload = {
      department: null,
      webhook_url: body.webhookUrl,
      channel: body.channel,
      bot_name: body.botName,
      notify_on_task_assigned: body.notifyOnTaskAssigned,
      notify_on_deadline_alert: body.notifyOnDeadlineAlert,
      notify_on_approval_requested: body.notifyOnApprovalRequested,
      notify_on_task_completed: body.notifyOnTaskCompleted,
      notify_on_daily_summary: body.notifyOnDailySummary,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = existing.data?.id
      ? await supabase.from('slack_config').update(payload).eq('id', existing.data.id).select().single()
      : await supabase.from('slack_config').insert(payload).select().single();

    return check(data as SlackConfigRow, error);
  },

  async testSlack(): Promise<{ success: boolean; message: string }> {
    const { data, error } = await supabase.rpc('test_slack_connection');
    if (error) return { success: false, message: error.message };
    const result = data as { success: boolean };
    return { success: result.success, message: result.success ? 'Delivered' : 'Failed' };
  },

  // Notifications
  async listNotifications(): Promise<NotificationRow[]> {
    return withRetry(async () => {
      const me = await db.me();
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', me.id)
        .order('created_at', { ascending: false })
        .limit(100);
      return check(data as NotificationRow[], error);
    });
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

  // Persist a notification server-side rather than keeping it as local-only
  // React state. This is what lets dedup logic (e.g. checkOverdueDeadlines)
  // survive a page reload — a local-only notification disappears on refresh
  // and its dedup check can never see it again, so the same "Task Overdue"
  // notice would otherwise be re-created every time the page reloads.
  async createNotification(input: {
    type: NotificationRow['type'];
    title: string;
    message: string;
    taskId?: string;
    urgency?: NotificationRow['urgency'];
  }): Promise<NotificationRow> {
    const me = await db.me();
    const { data, error } = await supabase
      .from('notifications')
      .insert({
        user_id: me.id,
        type: input.type,
        title: input.title,
        message: input.message,
        task_id: input.taskId ?? null,
        urgency: input.urgency ?? 'low',
      })
      .select()
      .single();
    return check(data as NotificationRow, error);
  },

  // Push notifications
  async savePushSubscription(sub: { endpoint: string; p256dh: string; auth: string }): Promise<void> {
    const me = await db.me();
    // Delete-then-insert rather than upsert: RLS only grants delete on
    // your own rows, so this naturally fails safely if the endpoint is
    // somehow already claimed by a different account, instead of needing
    // a broad UPDATE policy that could let one account hijack another's
    // subscription row.
    await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint).eq('user_id', me.id);
    const { error } = await supabase
      .from('push_subscriptions')
      .insert({ user_id: me.id, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth });
    check(null, error);
  },

  async deletePushSubscription(endpoint: string): Promise<void> {
    const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    check(null, error);
  },

  // Departments — a real table now (see 17_dynamic_departments.sql), not
  // a hardcoded list, so a Super Admin can add one from the app.
  async listDepartments(): Promise<{ name: string }[]> {
    const { data, error } = await supabase.from('departments').select('name').order('name', { ascending: true });
    return check(data as { name: string }[], error);
  },

  async addDepartment(name: string): Promise<void> {
    const me = await db.me();
    const { error } = await supabase.from('departments').insert({ name, created_by: me.id });
    check(null, error);
  },

  // Chat: Direct Messages + Group Chat
  async listConversations(): Promise<ConversationSummaryRow[]> {
    const { data, error } = await supabase.rpc('list_my_conversations');
    return check(data as ConversationSummaryRow[], error);
  },

  async getMessages(conversationId: string): Promise<MessageRow[]> {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(500);
    return check(data as MessageRow[], error);
  },

  async sendMessage(
    conversationId: string,
    text: string,
    isEncrypted = false,
    attachment?: { url: string; name: string; kind: 'image' | 'file' } | null
  ): Promise<MessageRow> {
    const me = await db.me();
    const { data, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: me.id,
        text: text.trim() ? text : null,
        is_encrypted: isEncrypted,
        attachment_url: attachment?.url ?? null,
        attachment_name: attachment?.name ?? null,
        attachment_kind: attachment?.kind ?? null,
      })
      .select()
      .single();
    return check(data as MessageRow, error);
  },

  // Creates a conversation and its member rows (only the creator can add
  // members — see conversation_members_insert RLS policy). `memberIds`
  // should include the creator's own id.
  async createConversation(body: {
    type: 'direct' | 'group';
    name?: string;
    memberIds: string[];
    relatedTaskId?: string;
  }): Promise<ConversationSummaryRow> {
    const me = await db.me();
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .insert({
        type: body.type,
        name: body.type === 'group' ? body.name : null,
        created_by: me.id,
        related_task_id: body.relatedTaskId ?? null,
      })
      .select()
      .single();
    check(conv, convErr);

    const uniqueMemberIds = Array.from(new Set(body.memberIds));
    const { error: membersErr } = await supabase
      .from('conversation_members')
      .insert(uniqueMemberIds.map((userId) => ({ conversation_id: (conv as { id: string }).id, user_id: userId })));
    if (membersErr) throw new DbError(membersErr.message);

    return {
      ...(conv as Record<string, unknown>),
      last_message_text: null,
      last_message_sender_id: null,
      last_message_is_encrypted: null,
      last_read_at: null,
      unread_count: 0,
      member_ids: uniqueMemberIds,
    } as ConversationSummaryRow;
  },

  async markConversationRead(conversationId: string): Promise<void> {
    const me = await db.me();
    const { error } = await supabase
      .from('conversation_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', me.id);
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

  // Backup & Restore (Super Admin only — enforced by RLS + the RPC
  // functions themselves; see 26_backup_restore.sql)
  async listBackups(): Promise<BackupRow[]> {
    const { data, error } = await supabase
      .from('backups')
      .select('id, created_at, created_by, label, table_counts')
      .order('created_at', { ascending: false });
    return check(data as BackupRow[], error);
  },

  async createBackup(label?: string): Promise<string> {
    const { data, error } = await supabase.rpc('create_backup', { p_label: label ?? null });
    return check(data as string, error);
  },

  async restoreBackup(backupId: string): Promise<RestoreResult> {
    const { data, error } = await supabase.rpc('restore_backup', { p_backup_id: backupId });
    return check(data as RestoreResult, error);
  },

  async deleteBackup(backupId: string): Promise<void> {
    const { error } = await supabase.from('backups').delete().eq('id', backupId);
    check(null, error);
  },

  async getBackupSettings(): Promise<BackupSettingsRow> {
    const { data, error } = await supabase.from('backup_settings').select('*').single();
    return check(data as BackupSettingsRow, error);
  },

  async updateBackupFrequency(frequency: 'daily' | 'weekly' | 'monthly'): Promise<void> {
    const me = await db.me();
    const { error } = await supabase
      .from('backup_settings')
      .update({ frequency, updated_by: me.id, updated_at: new Date().toISOString() })
      .eq('id', true);
    check(null, error);
  },
};
