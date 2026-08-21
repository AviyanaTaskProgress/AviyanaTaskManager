import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { db } from '../lib/db';
import { UserRow } from '../lib/api';
import { mapAuditLog, mapNotification, mapSlackConfig, mapTask, mapUser } from '../lib/mappers';
import { supabase } from '../lib/supabaseClient';
import {
  AuditLog,
  Department,
  NotificationItem,
  SlackConfig,
  Task,
  TaskRemark,
  User,
} from '../types';
import { calculateTaskPriority } from '../utils/prioritization';
import { showToast, errorMessage } from '../lib/toast';

interface AppContextType {
  currentUser: User;
  users: User[];
  tasks: Task[];
  auditLogs: AuditLog[];
  notifications: NotificationItem[];
  slackConfig: SlackConfig;
  darkMode: boolean;
  setDarkMode: (val: boolean | ((prev: boolean) => boolean)) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
  // Actions
  createTask: (newTask: Omit<Task, 'id' | 'createdById' | 'createdByName' | 'createdByRole' | 'remarks' | 'attachments' | 'loggedHours' | 'autoPriorityScore' | 'priorityReason'> & { remarksText?: string; isEncrypted?: boolean }) => Promise<void>;
  updateTask: (taskId: string, updates: Partial<Task>, changeReason?: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  addRemarkToTask: (taskId: string, text: string, isEncrypted?: boolean, type?: TaskRemark['type']) => Promise<void>;
  addAttachmentToTask: (taskId: string, body: { kind: 'file' | 'link'; url: string; fileName?: string; fileSize?: number; mimeType?: string }) => Promise<void>;
  deleteAttachmentFromTask: (attachmentId: string) => Promise<void>;
  approveOrRejectTask: (taskId: string, decision: 'approved' | 'rejected', comment?: string) => Promise<void>;
  submitTaskForApproval: (taskId: string, note?: string) => Promise<void>;
  updateUserPermissions: (userId: string, permissions: Partial<User['permissions']>) => Promise<void>;
  updateUserProfile: (userId: string, updates: { name?: string; title?: string; avatar?: string; department?: Department; role?: User['role'] }) => Promise<void>;
  setChiefOfficerAccess: (chiefOfficerId: string, department: Department, level: 'full' | 'limited') => Promise<void>;
  addUser: (user: Omit<User, 'id' | 'tasksCompleted' | 'tasksInProgress' | 'hoursLoggedThisMonth' | 'joinedDate' | 'accountActivated'> & { email: string }) => Promise<void>;
  markNotificationAsRead: (id?: string) => Promise<void>;
  saveSlackConfig: (config: Partial<SlackConfig>) => Promise<void>;
  testSlackIntegration: () => Promise<{ success: boolean; message: string }>;
  triggerSlackNotification: (event: 'assigned' | 'deadline_alert' | 'approval_request' | 'completed', task: Task) => Promise<void>;
  syncDeadlinesNow: () => void;
  signOut: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const hasLoadedRef = useRef(false);
  const lastLoadedAtRef = useRef(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userRows, setUserRows] = useState<UserRow[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [slackConfig, setSlackConfig] = useState<SlackConfig>(mapSlackConfig(null));

  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);

  const users = useMemo(() => userRows.map(mapUser), [userRows]);

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
    setLoadError(null);
    lastLoadedAtRef.current = Date.now();
    try {
      const me = await db.me();
      setCurrentUser(mapUser(me));

      const [usersRes, tasksRes, notifsRes, slackRes] = await Promise.all([
        db.listUsers(),
        db.listTasks(),
        db.listNotifications(),
        me.permissions?.canConfigureSlack ? db.getSlackConfig().catch(() => null) : Promise.resolve(null),
      ]);

      setUserRows(usersRes);
      const localUsersById: Record<string, UserRow> = {};
      usersRes.forEach((u) => (localUsersById[u.id] = u));

      const mappedTasks = tasksRes.map((t) => mapTask(t, localUsersById));
      setTasks(mappedTasks);

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
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

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

  // Client-side priority recalculation (visual only — the automated priority
  // engine re-scores tasks in the UI; persisting a re-score to the DB happens
  // the next time the task is edited via updateTask).
  const syncDeadlinesNow = useCallback(() => {
    const today = new Date();
    const newNotifs: NotificationItem[] = [];

    setTasks((prev) =>
      prev.map((task) => {
        const { score, recommendedPriority, reason, isOverdue, isDueSoon } = calculateTaskPriority(task, today);

        if (isOverdue && task.status !== 'completed') {
          const exists = notifications.some((n) => n.taskId === task.id && n.title.includes('Overdue'));
          if (!exists) {
            newNotifs.push({
              id: 'notif_local_' + Math.random().toString(36).substring(2, 7),
              timestamp: 'Just now',
              type: 'deadline',
              title: `Task Overdue: ${task.title}`,
              message: `Task is overdue by deadline ${task.dueDate}. Priority automatically elevated to Critical.`,
              read: false,
              taskId: task.id,
              urgency: 'critical',
            });
          }
        } else if (isDueSoon && task.status !== 'completed' && task.progress < 50) {
          const exists = notifications.some((n) => n.taskId === task.id && n.title.includes('Urgent Deadline'));
          if (!exists) {
            newNotifs.push({
              id: 'notif_local_' + Math.random().toString(36).substring(2, 7),
              timestamp: 'Just now',
              type: 'deadline',
              title: `Urgent Deadline: ${task.title}`,
              message: `Due soon (${task.dueDate}) with only ${task.progress}% completed.`,
              read: false,
              taskId: task.id,
              urgency: 'high',
            });
          }
        }

        return {
          ...task,
          autoPriorityScore: score,
          priorityReason: reason,
          priority: task.priority === 'critical' ? 'critical' : recommendedPriority,
        };
      })
    );

    if (newNotifs.length > 0) setNotifications((prev) => [...newNotifs, ...prev]);
  }, [notifications]);

  useEffect(() => {
    if (loading) return;
    syncDeadlinesNow();
    const interval = setInterval(syncDeadlinesNow, 60000);
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
        startDate: rest.startDate,
        dueDate: rest.dueDate,
        estimatedHours: rest.estimatedHours,
        priority: rest.priority,
        status: rest.status,
        progress: rest.progress ?? 0,
        tags: rest.tags,
      });
      if (remarksText) {
        await db.addRemark(created.id, { text: remarksText, isEncrypted, type: 'general' });
      }
      await db.logAuditEvent('task.created', 'task', created.id, `Created task "${created.title}"`);
      await loadAll();
      showToast('success', `Task "${created.title}" created.`);
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

  const addAttachmentToTask: AppContextType['addAttachmentToTask'] = async (taskId, body) => {
    try {
      await db.addAttachment(taskId, body);
      await db.logAuditEvent('task.attachment_added', 'task', taskId, body.fileName ?? body.url);
      await loadAll();
      showToast('success', body.kind === 'file' ? 'File attached.' : 'Link attached.');
    } catch (err) {
      showToast('error', `Couldn't attach that: ${errorMessage(err)}`);
      throw err;
    }
  };

  const deleteAttachmentFromTask: AppContextType['deleteAttachmentFromTask'] = async (attachmentId) => {
    try {
      await db.deleteAttachment(attachmentId);
      await loadAll();
      showToast('success', 'Attachment removed.');
    } catch (err) {
      showToast('error', `Couldn't remove the attachment: ${errorMessage(err)}`);
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
        approveOrRejectTask,
        submitTaskForApproval,
        updateUserPermissions,
        updateUserProfile,
        setChiefOfficerAccess,
        addUser,
        markNotificationAsRead,
        saveSlackConfig,
        testSlackIntegration,
        triggerSlackNotification,
        syncDeadlinesNow,
        signOut,
        refreshAll: loadAll,
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
