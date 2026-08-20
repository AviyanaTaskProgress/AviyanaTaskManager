import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { db } from '../lib/db';
import { UserRow } from '../lib/api';
import { mapAuditLog, mapNotification, mapSlackConfig, mapTask, mapTimeSession, mapUser } from '../lib/mappers';
import { supabase } from '../lib/supabaseClient';
import {
  AuditLog,
  Department,
  NotificationItem,
  SlackConfig,
  Task,
  TaskRemark,
  TimeSession,
  User,
} from '../types';
import { calculateTaskPriority } from '../utils/prioritization';

interface AppContextType {
  currentUser: User;
  users: User[];
  tasks: Task[];
  auditLogs: AuditLog[];
  notifications: NotificationItem[];
  slackConfig: SlackConfig;
  timeSessions: TimeSession[];
  activeSession: {
    isRunning: boolean;
    taskId?: string;
    taskTitle?: string;
    startTime?: number;
    elapsedSeconds: number;
    sessionType: TimeSession['type'];
  };
  darkMode: boolean;
  setDarkMode: (val: boolean | ((prev: boolean) => boolean)) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
  isDataEncrypted: boolean;
  setIsDataEncrypted: (val: boolean) => void;
  // Actions
  createTask: (newTask: Omit<Task, 'id' | 'createdById' | 'createdByName' | 'createdByRole' | 'remarks' | 'loggedHours' | 'autoPriorityScore' | 'priorityReason'> & { remarksText?: string; isEncrypted?: boolean }) => Promise<void>;
  updateTask: (taskId: string, updates: Partial<Task>, changeReason?: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  addRemarkToTask: (taskId: string, text: string, isEncrypted?: boolean, type?: TaskRemark['type']) => Promise<void>;
  approveOrRejectTask: (taskId: string, decision: 'approved' | 'rejected', comment?: string) => Promise<void>;
  submitTaskForApproval: (taskId: string, note?: string) => Promise<void>;
  logWorkTime: (taskId: string, hours: number, note?: string) => Promise<void>;
  updateUserPermissions: (userId: string, permissions: Partial<User['permissions']>) => Promise<void>;
  setChiefOfficerAccess: (chiefOfficerId: string, department: Department, level: 'full' | 'limited') => Promise<void>;
  addUser: (user: Omit<User, 'id' | 'tasksCompleted' | 'tasksInProgress' | 'hoursLoggedThisMonth' | 'joinedDate'> & { email: string }) => Promise<void>;
  markNotificationAsRead: (id?: string) => Promise<void>;
  saveSlackConfig: (config: Partial<SlackConfig>) => Promise<void>;
  testSlackIntegration: () => Promise<boolean>;
  triggerSlackNotification: (event: 'assigned' | 'deadline_alert' | 'approval_request' | 'completed', task: Task) => Promise<void>;
  startTimer: (taskId?: string, taskTitle?: string, type?: TimeSession['type']) => void;
  pauseTimer: () => void;
  stopAndSaveTimer: (notes?: string) => void;
  syncDeadlinesNow: () => void;
  signOut: () => Promise<void>;
  refreshAll: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userRows, setUserRows] = useState<UserRow[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [slackConfig, setSlackConfig] = useState<SlackConfig>(mapSlackConfig(null));
  const [timeSessions, setTimeSessions] = useState<TimeSession[]>([]);

  const [darkMode, setDarkMode] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState<boolean>(false);
  const [isDataEncrypted, setIsDataEncrypted] = useState<boolean>(true);

  const [activeSession, setActiveSession] = useState<{
    isRunning: boolean;
    taskId?: string;
    taskTitle?: string;
    startTime?: number;
    elapsedSeconds: number;
    sessionType: TimeSession['type'];
  }>({ isRunning: false, elapsedSeconds: 0, sessionType: 'focus_work' });

  const users = useMemo(() => userRows.map(mapUser), [userRows]);
  const tasksById = useMemo(() => {
    const map: Record<string, Task> = {};
    tasks.forEach((t) => (map[t.id] = t));
    return map;
  }, [tasks]);

  // Dark mode class toggle (kept as a pure UI preference, not persisted server-side)
  useEffect(() => {
    if (darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [darkMode]);

  // ---- Initial load: pull everything from the Aviyana API ----
  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const me = await db.me();
      setCurrentUser(mapUser(me));

      const [usersRes, tasksRes, notifsRes, slackRes, sessionsRes] = await Promise.all([
        db.listUsers(),
        db.listTasks(),
        db.listNotifications(),
        me.permissions?.canConfigureSlack ? db.getSlackConfig().catch(() => null) : Promise.resolve(null),
        db.listTimeSessions(),
      ]);

      setUserRows(usersRes);
      const localUsersById: Record<string, UserRow> = {};
      usersRes.forEach((u) => (localUsersById[u.id] = u));

      const mappedTasks = tasksRes.map((t) => mapTask(t, localUsersById));
      setTasks(mappedTasks);
      const localTasksById: Record<string, Task> = {};
      mappedTasks.forEach((t) => (localTasksById[t.id] = t));

      setNotifications(notifsRes.map(mapNotification));
      setSlackConfig(mapSlackConfig(slackRes));
      setTimeSessions(sessionsRes.map((s) => mapTimeSession(s, localUsersById, localTasksById)));

      if (me.permissions?.canViewAuditLogs) {
        const logsRes = await db.listAuditLogs({ limit: 200 }).catch(() => []);
        setAuditLogs(logsRes.map(mapAuditLog));
      } else {
        setAuditLogs([]);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Active Timer Tick
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (activeSession.isRunning) {
      interval = setInterval(() => {
        setActiveSession((prev) => ({ ...prev, elapsedSeconds: prev.elapsedSeconds + 1 }));
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeSession.isRunning]);

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

  const createTask: AppContextType['createTask'] = async (newTaskData) => {
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
  };

  const updateTask: AppContextType['updateTask'] = async (taskId, updates) => {
    await db.updateTask(taskId, updates);
    await db.logAuditEvent('task.updated', 'task', taskId, `Fields changed: ${Object.keys(updates).join(', ')}`);
    await loadAll();
  };

  const deleteTask: AppContextType['deleteTask'] = async (taskId) => {
    await db.deleteTask(taskId);
    await db.logAuditEvent('task.deleted', 'task', taskId, '', 'warning');
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  };

  const addRemarkToTask: AppContextType['addRemarkToTask'] = async (taskId, text, isEncrypted = false, type = 'general') => {
    await db.addRemark(taskId, { text, isEncrypted, type });
    await loadAll();
  };

  const submitTaskForApproval: AppContextType['submitTaskForApproval'] = async (taskId, note) => {
    await db.submitForApproval(taskId, note);
    await loadAll();
  };

  const approveOrRejectTask: AppContextType['approveOrRejectTask'] = async (taskId, decision, comment) => {
    await db.decideApproval(taskId, decision, comment);
    await loadAll();
  };

  const logWorkTime: AppContextType['logWorkTime'] = async (taskId, hours, note) => {
    await db.createTimeSession({
      taskId,
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      durationMinutes: Math.round(hours * 60),
      type: 'focus_work',
      efficiencyScore: 90,
      notes: note,
    });
    await loadAll();
  };

  const updateUserPermissions: AppContextType['updateUserPermissions'] = async (userId, permissions) => {
    await db.updatePermissions(userId, permissions as Record<string, boolean>);
    await db.logAuditEvent('user.permissions_updated', 'security', userId, `Permissions changed: ${Object.keys(permissions).join(', ')}`, 'warning');
    await loadAll();
  };

  const addUser: AppContextType['addUser'] = async (userData) => {
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
  };

  const setChiefOfficerAccess: AppContextType['setChiefOfficerAccess'] = async (chiefOfficerId, department, level) => {
    await db.setChiefOfficerAccess(chiefOfficerId, department, level);
    await db.logAuditEvent(
      'user.chief_officer_access_updated',
      'security',
      chiefOfficerId,
      `Set ${department} access to '${level}'`,
      'warning'
    );
  };

  const markNotificationAsRead: AppContextType['markNotificationAsRead'] = async (id) => {
    if (id) {
      await db.markNotificationRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    } else {
      await db.markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    }
  };

  const saveSlackConfig: AppContextType['saveSlackConfig'] = async (config) => {
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
  };

  const testSlackIntegration: AppContextType['testSlackIntegration'] = async () => {
    const res = await db.testSlack();
    const refreshed = await db.getSlackConfig().catch(() => null);
    setSlackConfig(mapSlackConfig(refreshed));
    return res.success;
  };

  const triggerSlackNotification: AppContextType['triggerSlackNotification'] = async () => {
    // Server-side notifySlack() fires automatically on assign/approve/submit/complete
    // via the approvals & tasks routes; nothing to do client-side.
  };

  const startTimer: AppContextType['startTimer'] = (taskId, taskTitle, type = 'focus_work') => {
    setActiveSession({
      isRunning: true,
      taskId,
      taskTitle: taskTitle || (taskId ? tasksById[taskId]?.title : 'General Focus Work'),
      startTime: Date.now(),
      elapsedSeconds: 0,
      sessionType: type,
    });
  };

  const pauseTimer: AppContextType['pauseTimer'] = () => {
    setActiveSession((prev) => ({ ...prev, isRunning: !prev.isRunning }));
  };

  const stopAndSaveTimer: AppContextType['stopAndSaveTimer'] = (notes) => {
    if (activeSession.elapsedSeconds <= 10) {
      setActiveSession({ isRunning: false, elapsedSeconds: 0, sessionType: 'focus_work' });
      return;
    }
    const durationMinutes = Math.max(1, Math.round(activeSession.elapsedSeconds / 60));

    db
      .createTimeSession({
        taskId: activeSession.taskId,
        startTime: new Date(Date.now() - activeSession.elapsedSeconds * 1000).toISOString(),
        endTime: new Date().toISOString(),
        durationMinutes,
        type: activeSession.sessionType,
        efficiencyScore: Math.floor(Math.random() * 10 + 90),
        notes: notes || 'Logged via Live Focus Tracker',
      })
      .then(() => loadAll())
      .catch(() => undefined);

    setActiveSession({ isRunning: false, elapsedSeconds: 0, sessionType: 'focus_work' });
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
        timeSessions,
        activeSession,
        darkMode,
        setDarkMode,
        activeTab,
        setActiveTab,
        isMobileMenuOpen,
        setIsMobileMenuOpen,
        isDataEncrypted,
        setIsDataEncrypted,
        createTask,
        updateTask,
        deleteTask,
        addRemarkToTask,
        approveOrRejectTask,
        submitTaskForApproval,
        logWorkTime,
        updateUserPermissions,
        setChiefOfficerAccess,
        addUser,
        markNotificationAsRead,
        saveSlackConfig,
        testSlackIntegration,
        triggerSlackNotification,
        startTimer,
        pauseTimer,
        stopAndSaveTimer,
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
