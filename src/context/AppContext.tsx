import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { db } from '../lib/db';
import { UserRow } from '../lib/api';
import { mapAuditLog, mapConversationSummary, mapNotification, mapSlackConfig, mapTask, mapUser } from '../lib/mappers';
import { supabase } from '../lib/supabaseClient';
import {
  AuditLog,
  ConversationSummary,
  Department,
  NotificationItem,
  SlackConfig,
  Task,
  TaskRemark,
  User,
} from '../types';
import { showToast, errorMessage } from '../lib/toast';

interface AppContextType {
  currentUser: User;
  users: User[];
  tasks: Task[];
  auditLogs: AuditLog[];
  notifications: NotificationItem[];
  slackConfig: SlackConfig;
  conversations: ConversationSummary[];
  chatDeepLinkConversationId: string | null;
  clearChatDeepLink: () => void;
  canStartGroupChat: boolean;
  departments: string[];
  addDepartment: (name: string) => Promise<void>;
  darkMode: boolean;
  setDarkMode: (val: boolean | ((prev: boolean) => boolean)) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
  // Actions
  createTask: (newTask: Omit<Task, 'id' | 'createdById' | 'createdByName' | 'createdByRole' | 'remarks' | 'attachments' | 'subtasks' | 'loggedHours' | 'taskDisplayId' | 'paymentStatus' | 'paymentConfirmedById' | 'paymentConfirmedByName' | 'paymentConfirmedAt' | 'assignedByName'> & { remarksText?: string; isEncrypted?: boolean }) => Promise<string>;
  updateTask: (taskId: string, updates: Partial<Task>, changeReason?: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  addRemarkToTask: (taskId: string, text: string, isEncrypted?: boolean, type?: TaskRemark['type']) => Promise<void>;
  addAttachmentToTask: (taskId: string, body: { kind: 'file' | 'link'; url: string; fileName?: string; fileSize?: number; mimeType?: string; subtaskId?: string }) => Promise<void>;
  deleteAttachmentFromTask: (attachmentId: string) => Promise<void>;
  addSubtaskToTask: (taskId: string, title: string, assigneeId?: string | null) => Promise<void>;
  setSubtaskCompletion: (subtaskId: string, isCompleted: boolean) => Promise<void>;
  deleteSubtaskFromTask: (subtaskId: string) => Promise<void>;
  confirmTaskPayment: (taskId: string, notes?: string) => Promise<void>;
  approveOrRejectTask: (taskId: string, decision: 'approved' | 'rejected', comment?: string) => Promise<void>;
  submitTaskForApproval: (taskId: string, note?: string) => Promise<void>;
  ringTaskAlarm: (taskId: string) => Promise<void>;
  updateUserPermissions: (userId: string, permissions: Partial<User['permissions']>) => Promise<void>;
  updateUserProfile: (userId: string, updates: { name?: string; title?: string; avatar?: string; department?: Department; role?: User['role'] }) => Promise<void>;
  setChiefOfficerAccess: (chiefOfficerId: string, department: Department, level: 'full' | 'limited') => Promise<void>;
  addUser: (user: Omit<User, 'id' | 'tasksCompleted' | 'tasksInProgress' | 'hoursLoggedThisMonth' | 'joinedDate' | 'accountActivated'> & { email: string }) => Promise<void>;
  markNotificationAsRead: (id?: string) => Promise<void>;
  startDirectConversation: (otherUserId: string, relatedTaskId?: string) => Promise<string>;
  startGroupConversation: (name: string, memberIds: string[]) => Promise<string>;
  markConversationRead: (conversationId: string) => Promise<void>;
  discussTask: (task: Task) => Promise<void>;
  refreshConversations: () => Promise<void>;
  saveSlackConfig: (config: Partial<SlackConfig>) => Promise<void>;
  testSlackIntegration: () => Promise<{ success: boolean; message: string }>;
  triggerSlackNotification: (event: 'assigned' | 'deadline_alert' | 'approval_request' | 'completed', task: Task) => Promise<void>;
  checkOverdueDeadlines: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshAll: () => Promise<void>;
  isRefreshing: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  // Distinct from `loading` (which only ever gates the very first paint —
  // see loadAll below). Every load, initial or background, flips this so
  // components like MyTasksDashboard can tell "still fetching" apart from
  // "genuinely zero tasks" instead of showing an empty-state message that
  // looks identical either way.
  const [isRefreshing, setIsRefreshing] = useState(true);
  const hasLoadedRef = useRef(false);
  const lastLoadedAtRef = useRef(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userRows, setUserRows] = useState<UserRow[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [slackConfig, setSlackConfig] = useState<SlackConfig>(mapSlackConfig(null));
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [chatDeepLinkConversationId, setChatDeepLinkConversationId] = useState<string | null>(null);
  const [departments, setDepartments] = useState<string[]>([]);

  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);

  const users = useMemo(() => userRows.map(mapUser), [userRows]);
  const usersById = useMemo(() => {
    const map: Record<string, User> = {};
    users.forEach((u) => (map[u.id] = u));
    return map;
  }, [users]);
  // Raw-row lookup (not the mapped User shape) — mapTask() needs the
  // UserRow shape (see mappers.ts's UsersById type), used when
  // reconciling a single task after a targeted mutation.
  const userRowsById = useMemo(() => {
    const map: Record<string, UserRow> = {};
    userRows.forEach((u) => (map[u.id] = u));
    return map;
  }, [userRows]);
  const canStartGroupChat = currentUser
    ? currentUser.role === 'dept_head' || currentUser.role === 'chief_officer' || currentUser.role === 'super_admin'
    : false;

  // Dark mode class toggle (kept as a pure UI preference, not persisted server-side)
  useEffect(() => {
    if (darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [darkMode]);

  // ---- Initial load: pull everything from the Aviyana API ----
  // `loading` drives the full-screen blocking spinner (see the render
  // gate below) — it should only ever be true for the very first load,
  // before we have a currentUser yet. Every subsequent refresh (after a
  // save, or a Realtime-triggered background sync) must update data
  // quietly without flashing the whole app back to a loading screen.
  const loadAll = useCallback(async () => {
    const isInitialLoad = !hasLoadedRef.current;
    if (isInitialLoad) setLoading(true);
    setIsRefreshing(true);
    setLoadError(null);
    lastLoadedAtRef.current = Date.now();
    try {
      const me = await db.me();
      setCurrentUser(mapUser(me));

      const [usersRes, tasksRes, notifsRes, slackRes, conversationsRes, departmentsRes] = await Promise.all([
        db.listUsers(),
        db.listTasks(),
        // Notifications failing to load shouldn't block the whole app —
        // matches the existing degrade-gracefully pattern already used
        // for slack/conversations/departments below. Users/tasks stay
        // hard requirements: without those, there's genuinely nothing
        // meaningful to render.
        db.listNotifications().catch(() => []),
        me.permissions?.canConfigureSlack ? db.getSlackConfig().catch(() => null) : Promise.resolve(null),
        db.listConversations().catch(() => []),
        db.listDepartments().catch(() => []),
      ]);

      setDepartments(departmentsRes.map((d) => d.name));

      setUserRows(usersRes);
      const localUsersById: Record<string, UserRow> = {};
      usersRes.forEach((u) => (localUsersById[u.id] = u));
      const mappedUsersById: Record<string, User> = {};
      usersRes.forEach((u) => (mappedUsersById[u.id] = mapUser(u)));

      const mappedTasks = tasksRes.map((t) => mapTask(t, localUsersById));
      setTasks(mappedTasks);

      const taskTitleById: Record<string, string> = {};
      mappedTasks.forEach((t) => (taskTitleById[t.id] = t.title));
      setConversations(
        conversationsRes.map((c) => mapConversationSummary(c, mapUser(me).id, mappedUsersById, taskTitleById))
      );

      setNotifications(notifsRes.map(mapNotification));
      setSlackConfig(mapSlackConfig(slackRes));

      if (me.permissions?.canViewAuditLogs) {
        const logsRes = await db.listAuditLogs({ limit: 200 }).catch(() => []);
        setAuditLogs(logsRes.map(mapAuditLog));
      } else {
        setAuditLogs([]);
      }
      hasLoadedRef.current = true;
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      if (isInitialLoad) setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Lightweight refresh used by the chat realtime subscription — re-pulls
  // just the conversation list (names/previews/unread counts) instead of
  // the full loadAll(), so a new chat message doesn't also re-fetch and
  // re-render every task and user in the app.
  const refreshConversations = useCallback(async () => {
    if (!currentUser) return;
    try {
      const rows = await db.listConversations();
      const taskTitleById: Record<string, string> = {};
      tasks.forEach((t) => (taskTitleById[t.id] = t.title));
      setConversations(rows.map((c) => mapConversationSummary(c, currentUser.id, usersById, taskTitleById)));
    } catch {
      // Silent — the conversation list simply stays stale until the next successful refresh.
    }
  }, [currentUser, tasks, usersById]);

  // ---- Realtime: refresh tasks/notifications when they change on the
  // server (another user's assignment, approval, etc.), not just after
  // our own mutations. Debounced so a burst of changes doesn't trigger a
  // reload per-row, AND skipped entirely if we ourselves just did a
  // loadAll() in the last few seconds — every action already reloads
  // after its own write, so without this guard, every save was
  // triggering a second, fully redundant full-data reload ~800ms later
  // when Realtime heard the echo of our own change. Requires
  // 09_enable_realtime.sql to have been run — if it hasn't, this
  // subscription simply never fires and the app still works exactly as
  // before (manual/mutation-triggered refresh only).
  useEffect(() => {
    if (!currentUser) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (Date.now() - lastLoadedAtRef.current < 3000) return; // likely our own echo
        loadAll();
      }, 800);
    };

    const channel = supabase
      .channel('aviyana-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, scheduleReload)
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [currentUser?.id, loadAll]);

  // Realtime: same debounce/echo-guard shape as above, but scoped to chat —
  // refreshes just the conversation list (previews/unread badges) so a new
  // message from a teammate shows up live without reloading tasks/users.
  const lastConversationsLoadedAtRef = useRef(0);
  useEffect(() => {
    if (!currentUser) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (Date.now() - lastConversationsLoadedAtRef.current < 1500) return; // likely our own echo
        lastConversationsLoadedAtRef.current = Date.now();
        refreshConversations();
      }, 500);
    };

    const channel = supabase
      .channel('aviyana-chat-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, scheduleReload)
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [currentUser?.id, refreshConversations]);

  // Deadline reminders — the auto-prioritization engine (which used to
  // re-score and silently overwrite each task's priority every 60s) has
  // been removed. Priority is now purely what the person who created/
  // edited the task chose. This just raises a notification; it never
  // mutates task data.
  //
  // These are persisted to the `notifications` table (via
  // db.createNotification) rather than kept as local-only React state.
  // Previously they were local-only ('notif_local_...' ids), so the dedup
  // check below only ever looked at the current in-memory list — which
  // resets on every reload, so refreshing the page while a task was
  // overdue would keep appending fresh "Task Overdue" notifications
  // forever. Persisting means the dedup check sees prior notifications
  // (loaded via listNotifications on refresh) even after a reload.
  // Client-side safety net for genuinely OVERDUE tasks (day 0+ past
  // due) — the day-3/day-1 "coming up" reminders are handled properly
  // server-side now (see 33_task_reminders_and_alarms.sql's
  // send_deadline_reminders(), on a daily pg_cron schedule, correctly
  // targeting the real assignee even if they're not logged in).
  //
  // IMPORTANT — this used to loop over ALL of `tasks` (which for a
  // Dept Head/Chief Officer/Super Admin includes everyone else's
  // tasks, not just their own) and call db.createNotification(), which
  // always creates the notification for `db.me()` — i.e. whoever's
  // browser happens to be running this check, NOT the task's actual
  // assignee. A Dept Head with the app open would get "Task Overdue"
  // notices addressed to themselves for tasks assigned to their Staff,
  // while the Staff member (if not logged in) never got notified at
  // all. Scoped down to self-assigned tasks only so a notification
  // this creates is always correctly about the viewer's own work.
  const checkOverdueDeadlines = useCallback(async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const task of tasks) {
      if (task.assigneeId !== currentUser?.id) continue;
      if (task.status === 'completed') continue;
      const due = new Date(task.dueDate);
      due.setHours(0, 0, 0, 0);
      const daysRemaining = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const isOverdue = daysRemaining < 0;

      try {
        if (isOverdue) {
          const exists = notifications.some((n) => n.taskId === task.id && n.title.includes('Overdue'));
          if (!exists) {
            const row = await db.createNotification({
              type: 'deadline',
              title: `Task Overdue: ${task.title}`,
              message: `This task passed its deadline of ${task.dueDate}.`,
              taskId: task.id,
              urgency: 'critical',
            });
            setNotifications((prev) => [mapNotification(row), ...prev]);
          }
        }
      } catch (err) {
        // Non-critical background check — don't surface a toast for a
        // failed reminder, just skip it and try again next interval.
        console.error('checkOverdueDeadlines: failed to persist notification', err);
      }
    }
  }, [tasks, notifications, currentUser]);

  useEffect(() => {
    if (loading) return;
    checkOverdueDeadlines();
    const interval = setInterval(checkOverdueDeadlines, 60000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // ---- Actions (each hits the API, then reconciles local state) ----
  // Every action reports failures via a toast AND re-throws, so the
  // calling form/button can still choose not to close/reset on error
  // (existing call sites that `await` these already skip their
  // post-await lines correctly when this throws).

  const createTask: AppContextType['createTask'] = async (newTaskData) => {
    try {
      const { remarksText, isEncrypted, ...rest } = newTaskData;
      const created = await db.createTask({
        title: rest.title,
        description: rest.description,
        department: rest.department,
        assigneeId: rest.assigneeId,
        assignedById: rest.assignedById ?? null,
        startDate: rest.startDate,
        dueDate: rest.dueDate,
        priority: rest.priority,
        status: rest.status,
        progress: rest.progress ?? 0,
        tags: rest.tags,
        requiresPayment: rest.requiresPayment ?? false,
        paymentAmount: rest.paymentAmount ?? null,
      });
      if (remarksText) {
        await db.addRemark(created.id, { text: remarksText, isEncrypted, type: 'general' });
      }
      await db.logAuditEvent('task.created', 'task', created.id, `Created task "${created.title}"`);
      await loadAll();
      showToast('success', `Task "${created.title}" created.`);
      return created.id;
    } catch (err) {
      showToast('error', `Couldn't create the task: ${errorMessage(err)}`);
      throw err;
    }
  };

  const updateTask: AppContextType['updateTask'] = async (taskId, updates) => {
    try {
      await db.updateTask(taskId, updates);
      await db.logAuditEvent('task.updated', 'task', taskId, `Fields changed: ${Object.keys(updates).join(', ')}`);
      await loadAll();
      showToast('success', 'Task saved.');
    } catch (err) {
      showToast('error', `Couldn't save changes: ${errorMessage(err)}`);
      throw err;
    }
  };

  const deleteTask: AppContextType['deleteTask'] = async (taskId) => {
    try {
      await db.deleteTask(taskId);
      await db.logAuditEvent('task.deleted', 'task', taskId, '', 'warning');
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      showToast('success', 'Task deleted.');
    } catch (err) {
      showToast('error', `Couldn't delete the task: ${errorMessage(err)}`);
      throw err;
    }
  };

  const addRemarkToTask: AppContextType['addRemarkToTask'] = async (taskId, text, isEncrypted = false, type = 'general') => {
    try {
      await db.addRemark(taskId, { text, isEncrypted, type });
      await loadAll();
      showToast('success', 'Remark added.');
    } catch (err) {
      showToast('error', `Couldn't add the remark: ${errorMessage(err)}`);
      throw err;
    }
  };

  // Refetches just the one task (not the whole company's data) and
  // splices it back into local `tasks` state — used after lightweight
  // mutations (attachments, subtasks) so the UI updates instantly
  // without a full loadAll() round trip, while staying authoritative
  // for server-computed fields like auto-progress
  // (27_task_subtasks.sql) that shouldn't be recalculated client-side.
  const refreshSingleTask = async (taskId: string) => {
    try {
      const row = await db.getTask(taskId);
      const mapped = mapTask(row, userRowsById);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? mapped : t)));
    } catch {
      // Best-effort reconciliation — if this fails, the optimistic
      // local update (already applied by the caller) just stays as
      // the visible state until the next natural loadAll().
    }
  };

  const addAttachmentToTask: AppContextType['addAttachmentToTask'] = async (taskId, body) => {
    try {
      await db.addAttachment(taskId, body);
      await db.logAuditEvent('task.attachment_added', 'task', taskId, body.fileName ?? body.url);
      await refreshSingleTask(taskId);
      showToast('success', body.kind === 'file' ? 'File attached.' : 'Link attached.');
    } catch (err) {
      showToast('error', `Couldn't attach that: ${errorMessage(err)}`);
      throw err;
    }
  };

  const deleteAttachmentFromTask: AppContextType['deleteAttachmentFromTask'] = async (attachmentId) => {
    // Optimistic removal — this attachment could belong to a task or a
    // specific subtask's attachment list, so patch both shapes.
    let ownerTaskId: string | undefined;
    setTasks((prev) =>
      prev.map((t) => {
        const inTask = t.attachments.some((a) => a.id === attachmentId);
        const inSubtask = t.subtasks.some((s) => s.attachments.some((a) => a.id === attachmentId));
        if (!inTask && !inSubtask) return t;
        ownerTaskId = t.id;
        return {
          ...t,
          attachments: t.attachments.filter((a) => a.id !== attachmentId),
          subtasks: t.subtasks.map((s) => ({ ...s, attachments: s.attachments.filter((a) => a.id !== attachmentId) })),
        };
      })
    );
    try {
      await db.deleteAttachment(attachmentId);
      if (ownerTaskId) await refreshSingleTask(ownerTaskId);
      showToast('success', 'Attachment removed.');
    } catch (err) {
      if (ownerTaskId) await refreshSingleTask(ownerTaskId); // restore on failure
      showToast('error', `Couldn't remove the attachment: ${errorMessage(err)}`);
      throw err;
    }
  };

  const addSubtaskToTask: AppContextType['addSubtaskToTask'] = async (taskId, title, assigneeId) => {
    try {
      await db.addSubtask(taskId, title, assigneeId ?? null);
      await refreshSingleTask(taskId);
    } catch (err) {
      showToast('error', `Couldn't add that step: ${errorMessage(err)}`);
      throw err;
    }
  };

  const setSubtaskCompletion: AppContextType['setSubtaskCompletion'] = async (subtaskId, isCompleted) => {
    // Optimistic: flip the checkbox immediately across whichever task
    // contains it, before the network round trip — this is the exact
    // interaction (a single checkbox click) the "everything full-
    // reloads" review flagged as feeling slow.
    let ownerTaskId: string | undefined;
    setTasks((prev) =>
      prev.map((t) => {
        if (!t.subtasks.some((s) => s.id === subtaskId)) return t;
        ownerTaskId = t.id;
        return { ...t, subtasks: t.subtasks.map((s) => (s.id === subtaskId ? { ...s, isCompleted } : s)) };
      })
    );
    try {
      await db.setSubtaskCompleted(subtaskId, isCompleted);
      if (ownerTaskId) await refreshSingleTask(ownerTaskId);
    } catch (err) {
      if (ownerTaskId) await refreshSingleTask(ownerTaskId); // revert the optimistic flip
      showToast('error', `Couldn't update that step: ${errorMessage(err)}`);
      throw err;
    }
  };

  const deleteSubtaskFromTask: AppContextType['deleteSubtaskFromTask'] = async (subtaskId) => {
    let ownerTaskId: string | undefined;
    setTasks((prev) =>
      prev.map((t) => {
        if (!t.subtasks.some((s) => s.id === subtaskId)) return t;
        ownerTaskId = t.id;
        return { ...t, subtasks: t.subtasks.filter((s) => s.id !== subtaskId) };
      })
    );
    try {
      await db.deleteSubtask(subtaskId);
      if (ownerTaskId) await refreshSingleTask(ownerTaskId);
      showToast('success', 'Step removed.');
    } catch (err) {
      if (ownerTaskId) await refreshSingleTask(ownerTaskId); // restore on failure
      showToast('error', `Couldn't remove that step: ${errorMessage(err)}`);
      throw err;
    }
  };

  const confirmTaskPayment: AppContextType['confirmTaskPayment'] = async (taskId, notes) => {
    try {
      await db.confirmTaskPayment(taskId, notes);
      await db.logAuditEvent('task.payment_confirmed', 'approval', taskId, notes ?? '');
      await loadAll();
      showToast('success', 'Payment confirmed — task marked complete.');
    } catch (err) {
      showToast('error', `Couldn't confirm payment: ${errorMessage(err)}`);
      throw err;
    }
  };

  const submitTaskForApproval: AppContextType['submitTaskForApproval'] = async (taskId, note) => {
    try {
      await db.submitForApproval(taskId, note);
      await loadAll();
      showToast('success', 'Submitted for approval.');
    } catch (err) {
      showToast('error', `Couldn't submit for approval: ${errorMessage(err)}`);
      throw err;
    }
  };

  const approveOrRejectTask: AppContextType['approveOrRejectTask'] = async (taskId, decision, comment) => {
    try {
      await db.decideApproval(taskId, decision, comment);
      await loadAll();
      showToast('success', decision === 'approved' ? 'Task approved.' : 'Task sent back.');
    } catch (err) {
      showToast('error', `Couldn't record the decision: ${errorMessage(err)}`);
      throw err;
    }
  };

  const ringTaskAlarm: AppContextType['ringTaskAlarm'] = async (taskId) => {
    try {
      await db.ringTaskAlarm(taskId);
      showToast('success', 'Alarm sent — they\'ll see it the moment they\'re back in the system.');
    } catch (err) {
      showToast('error', `Couldn't ring the alarm: ${errorMessage(err)}`);
      throw err;
    }
  };

  const updateUserPermissions: AppContextType['updateUserPermissions'] = async (userId, permissions) => {
    try {
      await db.updatePermissions(userId, permissions as Record<string, boolean>);
      await db.logAuditEvent('user.permissions_updated', 'security', userId, `Permissions changed: ${Object.keys(permissions).join(', ')}`, 'warning');
      await loadAll();
      showToast('success', 'Permissions updated.');
    } catch (err) {
      showToast('error', `Couldn't update permissions: ${errorMessage(err)}`);
      throw err;
    }
  };

  const updateUserProfile: AppContextType['updateUserProfile'] = async (userId, updates) => {
    try {
      await db.updateUserProfile(userId, updates);
      await db.logAuditEvent('user.profile_updated', 'security', userId, `Fields changed: ${Object.keys(updates).join(', ')}`, 'warning');
      await loadAll();
      showToast('success', 'Profile updated.');
    } catch (err) {
      showToast('error', `Couldn't update profile: ${errorMessage(err)}`);
      throw err;
    }
  };

  const addUser: AppContextType['addUser'] = async (userData) => {
    try {
      const created = await db.createUser({
        name: userData.name,
        email: userData.email,
        role: userData.role,
        department: userData.department,
        title: userData.title,
        avatar: userData.avatar,
        permissions: userData.permissions,
      });
      await db.logAuditEvent('user.created', 'user', created.id, `Created user ${created.email} (${created.role})`);
      await loadAll();
    } catch (err) {
      showToast('error', `Couldn't add ${userData.name}: ${errorMessage(err)}`);
      throw err;
    }
  };

  const setChiefOfficerAccess: AppContextType['setChiefOfficerAccess'] = async (chiefOfficerId, department, level) => {
    try {
      await db.setChiefOfficerAccess(chiefOfficerId, department, level);
      await db.logAuditEvent(
        'user.chief_officer_access_updated',
        'security',
        chiefOfficerId,
        `Set ${department} access to '${level}'`,
        'warning'
      );
      showToast('success', `Access set to '${level}' for ${department}.`);
    } catch (err) {
      showToast('error', `Couldn't update department access: ${errorMessage(err)}`);
      throw err;
    }
  };

  const markNotificationAsRead: AppContextType['markNotificationAsRead'] = async (id) => {
    try {
      if (id) {
        await db.markNotificationRead(id);
        setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      } else {
        await db.markAllNotificationsRead();
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      }
    } catch (err) {
      showToast('error', `Couldn't update notifications: ${errorMessage(err)}`);
      throw err;
    }
  };

  const startDirectConversation: AppContextType['startDirectConversation'] = async (otherUserId, relatedTaskId) => {
    if (!currentUser) throw new Error('Not signed in');
    // Reuse an existing 1:1 conversation with this person instead of
    // creating a duplicate every time "Message" or "Discuss this task" is clicked.
    const existing = conversations.find(
      (c) =>
        c.type === 'direct' &&
        c.memberIds.length === 2 &&
        c.memberIds.includes(currentUser.id) &&
        c.memberIds.includes(otherUserId)
    );
    if (existing) return existing.id;

    try {
      const created = await db.createConversation({
        type: 'direct',
        memberIds: [currentUser.id, otherUserId],
        relatedTaskId,
      });
      await refreshConversations();
      return created.id;
    } catch (err) {
      showToast('error', `Couldn't start the conversation: ${errorMessage(err)}`);
      throw err;
    }
  };

  const startGroupConversation: AppContextType['startGroupConversation'] = async (name, memberIds) => {
    if (!currentUser) throw new Error('Not signed in');
    try {
      const created = await db.createConversation({
        type: 'group',
        name,
        memberIds: Array.from(new Set([currentUser.id, ...memberIds])),
      });
      await db.logAuditEvent('user.group_chat_created', 'user', created.id, `Created group "${name}"`);
      await refreshConversations();
      showToast('success', `"${name}" created.`);
      return created.id;
    } catch (err) {
      showToast('error', `Couldn't create the group: ${errorMessage(err)}`);
      throw err;
    }
  };

  const markConversationRead: AppContextType['markConversationRead'] = async (conversationId) => {
    try {
      await db.markConversationRead(conversationId);
      setConversations((prev) => prev.map((c) => (c.id === conversationId ? { ...c, unreadCount: 0 } : c)));
    } catch {
      // Non-critical — the unread badge just won't clear until the next refresh.
    }
  };

  const discussTask: AppContextType['discussTask'] = async (task) => {
    try {
      const conversationId = await startDirectConversation(task.assigneeId, task.id);
      setChatDeepLinkConversationId(conversationId);
      setActiveTab('chat');
    } catch {
      // startDirectConversation already showed an error toast.
    }
  };

  const clearChatDeepLink = () => setChatDeepLinkConversationId(null);

  const addDepartment: AppContextType['addDepartment'] = async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (departments.some((d) => d.toLowerCase() === trimmed.toLowerCase())) {
      showToast('error', `"${trimmed}" already exists.`);
      return;
    }
    try {
      await db.addDepartment(trimmed);
      setDepartments((prev) => [...prev, trimmed].sort((a, b) => a.localeCompare(b)));
      await db.logAuditEvent('department.created', 'user', trimmed, `Added department "${trimmed}"`);
      showToast('success', `"${trimmed}" added.`);
    } catch (err) {
      showToast('error', `Couldn't add that department: ${errorMessage(err)}`);
      throw err;
    }
  };

  const saveSlackConfig: AppContextType['saveSlackConfig'] = async (config) => {
    try {
      const saved = await db.saveSlackConfig({
        webhookUrl: config.webhookUrl,
        channel: config.channel,
        botName: config.botName,
        notifyOnTaskAssigned: config.notifyOnTaskAssigned,
        notifyOnDeadlineAlert: config.notifyOnDeadlineAlert,
        notifyOnApprovalRequested: config.notifyOnApprovalRequested,
        notifyOnTaskCompleted: config.notifyOnTaskCompleted,
        notifyOnDailySummary: config.notifyOnDailySummary,
      });
      await db.logAuditEvent('slack.config_updated', 'slack', saved.id);
      setSlackConfig(mapSlackConfig(saved));
      showToast('success', 'Slack configuration saved.');
    } catch (err) {
      showToast('error', `Couldn't save Slack configuration: ${errorMessage(err)}`);
      throw err;
    }
  };

  const testSlackIntegration: AppContextType['testSlackIntegration'] = async () => {
    try {
      const res = await db.testSlack();
      const refreshed = await db.getSlackConfig().catch(() => null);
      setSlackConfig(mapSlackConfig(refreshed));
      return res;
    } catch (err) {
      const message = errorMessage(err);
      showToast('error', `Slack test failed: ${message}`);
      return { success: false, message };
    }
  };

  const triggerSlackNotification: AppContextType['triggerSlackNotification'] = async () => {
    // Server-side notifySlack() fires automatically on assign/approve/submit/complete
    // via the approvals & tasks routes; nothing to do client-side.
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  if (loading || !currentUser) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0b1a33] text-white text-sm gap-3">
        <div className="w-5 h-5 border-2 border-[#f4c115] border-t-transparent rounded-full animate-spin" />
        {loadError ? `Couldn't load Aviyana: ${loadError}` : 'Loading your workspace…'}
      </div>
    );
  }

  return (
    <AppContext.Provider
      value={{
        currentUser,
        users,
        tasks,
        auditLogs,
        notifications,
        slackConfig,
        conversations,
        chatDeepLinkConversationId,
        clearChatDeepLink,
        canStartGroupChat,
        departments,
        addDepartment,
        darkMode,
        setDarkMode,
        activeTab,
        setActiveTab,
        isMobileMenuOpen,
        setIsMobileMenuOpen,
        createTask,
        updateTask,
        deleteTask,
        addRemarkToTask,
        addAttachmentToTask,
        deleteAttachmentFromTask,
        addSubtaskToTask,
        setSubtaskCompletion,
        deleteSubtaskFromTask,
        confirmTaskPayment,
        approveOrRejectTask,
        submitTaskForApproval,
        ringTaskAlarm,
        updateUserPermissions,
        updateUserProfile,
        setChiefOfficerAccess,
        addUser,
        markNotificationAsRead,
        startDirectConversation,
        startGroupConversation,
        markConversationRead,
        discussTask,
        refreshConversations,
        saveSlackConfig,
        testSlackIntegration,
        triggerSlackNotification,
        checkOverdueDeadlines,
        signOut,
        refreshAll: loadAll,
        isRefreshing,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
