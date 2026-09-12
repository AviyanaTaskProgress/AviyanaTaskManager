import React, { Suspense, lazy, useEffect, useState } from 'react';
import {
  BarChart3,
  Grid,
  MessageSquare,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { Session } from '@supabase/supabase-js';
import { isTabVisible } from './lib/navigation';
import { AuthScreen } from './components/AuthScreen';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { AlarmSiren } from './components/AlarmSiren';
import { WhatsNewBanner } from './components/WhatsNewBanner';
import { AppProvider, useApp } from './context/AppContext';
import { Toaster } from './components/Toaster';
import { ResetPasswordScreen } from './components/ResetPasswordScreen';
import { ErrorBoundary } from './components/ErrorBoundary';
import { isSupabaseConfigured, supabase } from './lib/supabaseClient';
import { installGlobalErrorReporting } from './lib/errorReporting';
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
// Chairman's screen is its own component (deliberately narrower than
// ExecutiveDashboardView — status only, no payment/detail data) — see
// 42_ceo_and_chairman_roles.sql and ChairmanDashboardView.tsx.
const ChairmanDashboardView = lazy(() =>
  import('./components/ChairmanDashboardView').then((m) => ({ default: m.ChairmanDashboardView }))
);

// Backend/frontend engineering review (2026-09): these were all eagerly
// bundled into the main chunk despite not being needed on first paint
// (default tab is 'dashboard' — see AppContext's activeTab initial
// state). TaskModal in particular is now 1300+ lines (subtasks,
// payment workflow, attachments, remarks, all in one component) and
// was one of the largest pieces of the main bundle; it's only actually
// needed the moment someone opens the create/edit modal, not before.
const TasksView = lazy(() => import('./components/TasksView').then((m) => ({ default: m.TasksView })));
const ApprovalsView = lazy(() => import('./components/ApprovalsView').then((m) => ({ default: m.ApprovalsView })));
const TeamManagementView = lazy(() =>
  import('./components/TeamManagementView').then((m) => ({ default: m.TeamManagementView }))
);
const AuditLogsView = lazy(() => import('./components/AuditLogsView').then((m) => ({ default: m.AuditLogsView })));
const BackupRestoreView = lazy(() =>
  import('./components/BackupRestoreView').then((m) => ({ default: m.BackupRestoreView }))
);
const SettingsView = lazy(() => import('./components/SettingsView').then((m) => ({ default: m.SettingsView })));
const TaskModal = lazy(() => import('./components/TaskModal').then((m) => ({ default: m.TaskModal })));

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

  // 'chairman' — same single-screen treatment as 'viewer', but its own
  // narrower component (status only, no payment/detail data). See
  // ChairmanDashboardView.tsx and 42_ceo_and_chairman_roles.sql.
  if (currentUser.role === 'chairman') {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors">
        <Navbar />
        <div className="flex-1 w-full px-3 sm:px-6 lg:px-10 xl:px-14 py-4 sm:py-6">
          <Suspense fallback={<ViewLoadingFallback />}>
            <ChairmanDashboardView />
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors">
      <AlarmSiren onOpenTask={(task) => handleOpenTaskModal(task)} />
      {/* Top Fixed / Sticky Navigation Bar */}
      <Navbar />

      {/* Main Body with Sidebar + Content */}
      <div className="flex-1 flex w-full px-3 sm:px-6 lg:px-10 xl:px-14 py-4 sm:py-6 gap-6">
        {/* Left Sidebar */}
        <Sidebar />

        {/* Dynamic Center Stage Content View */}
        <main className="flex-1 min-w-0 pb-16 lg:pb-0">
          <WhatsNewBanner />
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

      {/* Task Creation & Edit Modal — lazy-loaded (see the lazy() block
          above), only fetched the moment isTaskModalOpen actually flips
          true, so Suspense has to wrap it here too since it's outside
          the tab-content Suspense boundary above. No visible fallback
          needed for the brief chunk-load flash — the modal appearing a
          beat after the click is unremarkable, an empty flash of a
          loading spinner between click and modal would be worse. */}
      <Suspense fallback={null}>
        <TaskModal
          isOpen={isTaskModalOpen}
          onClose={handleCloseTaskModal}
          taskToEdit={selectedTask}
        />
      </Suspense>
    </div>
  );
};

installGlobalErrorReporting();

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

  // Mobile browsers (and this is a PWA, service-worker registered —
  // see public/sw.js) restore the page from the back-forward cache
  // (bfcache) on browser Back instead of re-running React, which was
  // showing stale unsaved form state (e.g. a half-typed TaskModal) on
  // the next visit. `persisted === true` means this load came from
  // bfcache — force a real reload so the SPA boots fresh, same as a
  // normal navigation would.
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        window.location.reload();
      }
    };
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  // Root cause of the "task creation randomly goes back / the page
  // refreshes" bug report: TaskModal has many icon-only buttons
  // (remove attachment, delete subtask, etc.) — clicking one moves
  // keyboard focus onto that <button> (or, once it's removed, back to
  // <body>). Most browsers treat Backspace as "navigate back in
  // history" whenever focus ISN'T on an editable field — so someone
  // deleting a subtask/attachment and then hitting Backspace to fix a
  // typo a moment later triggers a real browser Back navigation, which
  // in turn triggers the bfcache pageshow handler above and looks like
  // the whole page randomly reloaded. This is what actually needed
  // fixing, not the reload itself (which is correct behavior for a
  // *genuine* back navigation). Standard fix: only let Backspace do
  // its normal "delete a character" job when focus is on something
  // that's actually editable; swallow it everywhere else so it can
  // never fall through to the browser's history navigation.
  useEffect(() => {
    const handleBackspaceNav = (event: KeyboardEvent) => {
      if (event.key !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable =
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        !!target?.isContentEditable;
      if (!isEditable) {
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', handleBackspaceNav);
    return () => window.removeEventListener('keydown', handleBackspaceNav);
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
