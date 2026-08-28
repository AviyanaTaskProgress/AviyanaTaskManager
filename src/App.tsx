import React, { Suspense, lazy, useEffect, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  Grid,
  Layers,
  Lock,
  MessageSquare,
  Plus,
  Radio,
  Send,
  Shield,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react';
import { Session } from '@supabase/supabase-js';
import { isTabVisible } from './lib/navigation';
import { ApprovalsView } from './components/ApprovalsView';
import { AuditLogsView } from './components/AuditLogsView';
import { AuthScreen } from './components/AuthScreen';
import { BackupRestoreView } from './components/BackupRestoreView';
import { Navbar } from './components/Navbar';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { TaskModal } from './components/TaskModal';
import { TasksView } from './components/TasksView';
import { TeamManagementView } from './components/TeamManagementView';
import { AppProvider, useApp } from './context/AppContext';
import { Toaster } from './components/Toaster';
import { ResetPasswordScreen } from './components/ResetPasswordScreen';
import { ErrorBoundary } from './components/ErrorBoundary';
import { isSupabaseConfigured, supabase } from './lib/supabaseClient';
import { Task } from './types';

// Lazily loaded: these pull in recharts / jsPDF, which are heavy and only
// needed once someone actually opens Dashboard, Productivity, or Reports.
const DashboardView = lazy(() => import('./components/DashboardView').then((m) => ({ default: m.DashboardView })));
const ReportsView = lazy(() => import('./components/ReportsView').then((m) => ({ default: m.ReportsView })));
// Chat is also lazy-loaded — most sessions won't open it every visit,
// and it pulls in its own Realtime subscription machinery.
const ChatView = lazy(() => import('./components/ChatView').then((m) => ({ default: m.ChatView })));
// The read-only Executive Dashboard is its own lazy chunk too — it's the
// *only* screen a 'viewer' role ever sees (see the viewer branch below).
const ExecutiveDashboardView = lazy(() =>
  import('./components/ExecutiveDashboardView').then((m) => ({ default: m.ExecutiveDashboardView }))
);

const ViewLoadingFallback: React.FC = () => (
  <div className="flex items-center justify-center py-24 text-slate-400 text-sm gap-2">
    <div className="w-4 h-4 border-2 border-slate-300 dark:border-slate-700 border-t-transparent rounded-full animate-spin" />
    Loading…
  </div>
);

const MainLayout: React.FC = () => {
  const { activeTab, setActiveTab, currentUser, tasks, conversations } = useApp();

  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(undefined);
  // Derived from the live `tasks` array (not a disconnected snapshot) so
  // the modal always reflects the latest server state — e.g. a remark
  // added while the modal is open shows up immediately instead of only
  // after closing and reopening it.
  const selectedTask = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) : undefined;

  const handleOpenTaskModal = (task?: Task) => {
    setSelectedTaskId(task?.id);
    setIsTaskModalOpen(true);
  };

  const handleCloseTaskModal = () => {
    setIsTaskModalOpen(false);
    setSelectedTaskId(undefined);
  };

  const pendingApprovalsCount = tasks.filter(
    (t) => t.status === 'pending_approval' || t.approvalStatus === 'pending'
  ).length;
  const unreadChatCount = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  // A 'viewer' gets a single read-only screen and nothing else — no
  // sidebar, no bottom nav, no task modal reachable. See
  // ExecutiveDashboardView.tsx and 18_viewer_role_and_dashboard.sql.
  if (currentUser.role === 'viewer') {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors">
        <Navbar />
        <div className="flex-1 w-full px-3 sm:px-6 lg:px-10 xl:px-14 py-4 sm:py-6">
          <Suspense fallback={<ViewLoadingFallback />}>
            <ExecutiveDashboardView />
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors">
      {/* Top Fixed / Sticky Navigation Bar */}
      <Navbar />

      {/* Main Body with Sidebar + Content */}
      <div className="flex-1 flex w-full px-3 sm:px-6 lg:px-10 xl:px-14 py-4 sm:py-6 gap-6">
        {/* Left Sidebar */}
        <Sidebar />

        {/* Dynamic Center Stage Content View */}
        <main className="flex-1 min-w-0 pb-16 lg:pb-0">
          <Suspense fallback={<ViewLoadingFallback />}>
            {activeTab === 'dashboard' && (
              <DashboardView onOpenTaskModal={(task) => handleOpenTaskModal(task)} />
            )}

            {activeTab === 'tasks' && (
              <TasksView onOpenTaskModal={(task) => handleOpenTaskModal(task)} />
            )}

            {activeTab === 'approvals' && (
              <ApprovalsView onOpenTaskModal={(task) => handleOpenTaskModal(task)} />
            )}

            {activeTab === 'team' && <TeamManagementView />}

            {activeTab === 'chat' && <ChatView onOpenTaskModal={(task) => handleOpenTaskModal(task)} />}

            {activeTab === 'reports' && <ReportsView />}

            {activeTab === 'audit' && <AuditLogsView />}

            {activeTab === 'settings' && <SettingsView />}

            {activeTab === 'backups' && <BackupRestoreView />}
          </Suspense>
        </main>
      </div>

      {/* Mobile Bottom Navigation — role-aware (same visibility rules as
          the Sidebar, via lib/navigation.ts), capped at a small, evenly
          spaced set of icons so it doesn't overflow on small screens. */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 py-2 px-3 flex items-center justify-around shadow-lg">
        {isTabVisible('dashboard', currentUser.role) && (
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`flex flex-col items-center gap-0.5 text-[10px] font-bold ${
              activeTab === 'dashboard' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <BarChart3 className="w-5 h-5" />
            <span>Dashboard</span>
          </button>
        )}

        {isTabVisible('tasks', currentUser.role) && (
          <button
            onClick={() => setActiveTab('tasks')}
            className={`flex flex-col items-center gap-0.5 text-[10px] font-bold ${
              activeTab === 'tasks' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Grid className="w-5 h-5" />
            <span>Tasks</span>
          </button>
        )}

        {currentUser.role !== 'staff' && (
          <button
            onClick={() => handleOpenTaskModal()}
            className="w-11 h-11 -mt-5 rounded-full bg-blue-600 text-white shadow-lg shadow-blue-500/30 flex items-center justify-center font-bold"
          >
            <Plus className="w-6 h-6" />
          </button>
        )}

        {isTabVisible('chat', currentUser.role) && (
          <button
            onClick={() => setActiveTab('chat')}
            className={`relative flex flex-col items-center gap-0.5 text-[10px] font-bold ${
              activeTab === 'chat' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <MessageSquare className="w-5 h-5" />
            <span>Chat</span>
            {unreadChatCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-blue-500 text-white text-[9px] font-extrabold flex items-center justify-center">
                {unreadChatCount}
              </span>
            )}
          </button>
        )}

        {isTabVisible('approvals', currentUser.role) && (
          <button
            onClick={() => setActiveTab('approvals')}
            className={`relative flex flex-col items-center gap-0.5 text-[10px] font-bold ${
              activeTab === 'approvals' ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <ShieldCheck className="w-5 h-5" />
            <span>Approvals</span>
            {pendingApprovalsCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-500 text-white text-[9px] font-extrabold flex items-center justify-center">
                {pendingApprovalsCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Task Creation & Edit Modal */}
      <TaskModal
        isOpen={isTaskModalOpen}
        onClose={handleCloseTaskModal}
        taskToEdit={selectedTask}
      />
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}

function AppInner() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (isPasswordRecovery) {
    return (
      <>
        <ResetPasswordScreen onDone={() => setIsPasswordRecovery(false)} />
        <Toaster />
      </>
    );
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0b1a33] text-white px-6">
        <div className="max-w-lg w-full bg-[#101f3d] border border-white/10 rounded-2xl p-6 space-y-3">
          <h1 className="text-lg font-bold">Aviyana isn't configured yet</h1>
          <p className="text-sm text-slate-300">
            <code className="bg-black/30 px-1 rounded">VITE_SUPABASE_URL</code> and{' '}
            <code className="bg-black/30 px-1 rounded">VITE_SUPABASE_ANON_KEY</code> are missing.
          </p>
          <ol className="text-sm text-slate-300 list-decimal list-inside space-y-1">
            <li>Copy <code className="bg-black/30 px-1 rounded">.env.example</code> to <code className="bg-black/30 px-1 rounded">.env.local</code> in the project root</li>
            <li>Fill in your Supabase project URL and anon key (Project Settings → API)</li>
            <li>Restart <code className="bg-black/30 px-1 rounded">npm run dev</code></li>
          </ol>
        </div>
      </div>
    );
  }

  // undefined = still checking for an existing session
  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0b1a33] text-white text-sm gap-3">
        <div className="w-5 h-5 border-2 border-[#f4c115] border-t-transparent rounded-full animate-spin" />
        Checking session…
      </div>
    );
  }

  if (!session) {
    return (
      <>
        <AuthScreen />
        <Toaster />
      </>
    );
  }

  return (
    <AppProvider>
      <MainLayout />
      <Toaster />
    </AppProvider>
  );
}
