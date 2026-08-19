import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  Grid,
  Layers,
  Lock,
  Plus,
  Radio,
  Send,
  Shield,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react';
import { Session } from '@supabase/supabase-js';
import { ApprovalsView } from './components/ApprovalsView';
import { AuditLogsView } from './components/AuditLogsView';
import { AuthScreen } from './components/AuthScreen';
import { DashboardView } from './components/DashboardView';
import { Navbar } from './components/Navbar';
import { ProductivityView } from './components/ProductivityView';
import { ReportsView } from './components/ReportsView';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { TaskModal } from './components/TaskModal';
import { TasksView } from './components/TasksView';
import { TeamManagementView } from './components/TeamManagementView';
import { AppProvider, useApp } from './context/AppContext';
import { isSupabaseConfigured, supabase } from './lib/supabaseClient';
import { Task } from './types';

const MainLayout: React.FC = () => {
  const { activeTab, setActiveTab, currentUser, tasks } = useApp();

  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | undefined>(undefined);

  const handleOpenTaskModal = (task?: Task) => {
    setSelectedTask(task);
    setIsTaskModalOpen(true);
  };

  const handleCloseTaskModal = () => {
    setIsTaskModalOpen(false);
    setSelectedTask(undefined);
  };

  const pendingApprovalsCount = tasks.filter(
    (t) => t.status === 'pending_approval' || t.approvalStatus === 'pending'
  ).length;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors">
      {/* Top Fixed / Sticky Navigation Bar */}
      <Navbar onOpenTaskModal={() => handleOpenTaskModal()} />

      {/* Main Body with Sidebar + Content */}
      <div className="flex-1 flex w-full px-3 sm:px-6 lg:px-10 xl:px-14 py-4 sm:py-6 gap-6">
        {/* Left Sidebar */}
        <Sidebar onOpenTaskModal={() => handleOpenTaskModal()} />

        {/* Dynamic Center Stage Content View */}
        <main className="flex-1 min-w-0 pb-16 lg:pb-0">
          {activeTab === 'dashboard' && (
            <DashboardView
              onOpenTaskModal={(task) => handleOpenTaskModal(task)}
              onNavigateToTab={(tab) => setActiveTab(tab)}
            />
          )}

          {activeTab === 'tasks' && (
            <TasksView onOpenTaskModal={(task) => handleOpenTaskModal(task)} />
          )}

          {activeTab === 'productivity' && <ProductivityView />}

          {activeTab === 'approvals' && (
            <ApprovalsView onOpenTaskModal={(task) => handleOpenTaskModal(task)} />
          )}

          {activeTab === 'team' && <TeamManagementView />}

          {activeTab === 'reports' && <ReportsView />}

          {activeTab === 'audit' && <AuditLogsView />}

          {activeTab === 'settings' && <SettingsView />}
        </main>
      </div>

      {/* Mobile Floating Action & Quick Bottom Navigation for Remote Teams */}
      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 py-2 px-3 flex items-center justify-around shadow-lg">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex flex-col items-center gap-0.5 text-[10px] font-bold ${
            activeTab === 'dashboard'
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <BarChart3 className="w-5 h-5" />
          <span>Dashboard</span>
        </button>

        <button
          onClick={() => setActiveTab('tasks')}
          className={`flex flex-col items-center gap-0.5 text-[10px] font-bold ${
            activeTab === 'tasks'
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <Grid className="w-5 h-5" />
          <span>Tasks</span>
        </button>

        {currentUser.role !== 'employee' && (
          <button
            onClick={() => handleOpenTaskModal()}
            className="w-11 h-11 -mt-5 rounded-full bg-blue-600 text-white shadow-lg shadow-blue-500/30 flex items-center justify-center font-bold"
          >
            <Plus className="w-6 h-6" />
          </button>
        )}

        <button
          onClick={() => setActiveTab('productivity')}
          className={`flex flex-col items-center gap-0.5 text-[10px] font-bold ${
            activeTab === 'productivity'
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <Clock className="w-5 h-5" />
          <span>Focus</span>
        </button>

        <button
          onClick={() => setActiveTab('approvals')}
          className={`relative flex flex-col items-center gap-0.5 text-[10px] font-bold ${
            activeTab === 'approvals'
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-slate-500 dark:text-slate-400'
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

        <button
          onClick={() => setActiveTab('reports')}
          className={`flex flex-col items-center gap-0.5 text-[10px] font-bold ${
            activeTab === 'reports'
              ? 'text-blue-600 dark:text-blue-400'
              : 'text-slate-500 dark:text-slate-400'
          }`}
        >
          <FileSpreadsheet className="w-5 h-5" />
          <span>Reports</span>
        </button>
      </div>

      {/* Task Creation & Edit Modal */}
      <TaskModal
        isOpen={isTaskModalOpen}
        onClose={handleCloseTaskModal}
        task={selectedTask}
      />
    </div>
  );
};

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

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
    return <AuthScreen />;
  }

  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
}
