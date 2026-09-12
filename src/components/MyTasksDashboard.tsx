import React from 'react';
import { CheckCircle2, Clock, ListTodo, MessageSquare, TrendingUp } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Task } from '../types';
import { STATUS_DESCRIPTION } from '../lib/statusInfo';

const STATUS_LABEL: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  pending_approval: 'Pending Approval',
  pending_payment: 'Pending Payment',
  completed: 'Completed',
  blocked: 'Blocked',
};

const STATUS_BADGE: Record<string, string> = {
  todo: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  in_review: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  pending_approval: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  pending_payment: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  blocked: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
};

/**
 * The entire "Dashboard" tab a Staff user sees — deliberately just their
 * own tasks, at a glance. No charts, no company-wide analytics, no
 * auto-priority scoring. Management still gets the full DashboardView;
 * this is a separate, much simpler component so the two don't get
 * tangled together (see DashboardView.tsx's role branch).
 */
export const MyTasksDashboard: React.FC<{ onOpenTaskModal: (task?: Task) => void }> = ({ onOpenTaskModal }) => {
  const { tasks, currentUser, setActiveTab, isRefreshing } = useApp();

  // `tasks` here is already scoped to just this person's own work by the
  // database (RLS only returns tasks where they're the assignee or creator).
  const activeTasks = tasks
    .filter((t) => t.status !== 'completed')
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  const completedTasks = tasks
    .filter((t) => t.status === 'completed')
    .sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime());

  const overallProgress =
    activeTasks.length > 0
      ? Math.round(activeTasks.reduce((sum, t) => sum + t.progress, 0) / activeTasks.length)
      : 100;

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white p-5 sm:p-6 rounded-2xl shadow-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-lg sm:text-xl font-bold">Welcome back, {currentUser.name.split(' ')[0]}</h1>
          <p className="text-xs text-slate-300 mt-1">Here's what's on your plate right now.</p>
        </div>
        <button
          id="my-tasks-log-task-btn"
          onClick={() => onOpenTaskModal()}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#f4c115] hover:bg-[#e0b010] text-slate-900 font-bold text-xs shadow-md transition-all shrink-0"
        >
          <ListTodo className="w-4 h-4" />
          <span>Log New Task</span>
        </button>
      </div>

      {/* Simple KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <ListTodo className="w-4 h-4 text-blue-600 dark:text-blue-400 mb-2" />
          <p className="text-xl font-bold text-slate-900 dark:text-white">{activeTasks.length}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Current Tasks</p>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mb-2" />
          <p className="text-xl font-bold text-slate-900 dark:text-white">{completedTasks.length}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Completed</p>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <TrendingUp className="w-4 h-4 text-indigo-600 dark:text-indigo-400 mb-2" />
          <p className="text-xl font-bold text-slate-900 dark:text-white">{overallProgress}%</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Overall Progress</p>
        </div>
      </div>

      {/* Current tasks */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">My Current Tasks</h2>
        </div>
        {activeTasks.length === 0 ? (
          isRefreshing ? (
            <div className="p-4 space-y-3 animate-pulse" role="status" aria-label="Loading your tasks">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 rounded-xl bg-slate-100 dark:bg-slate-800" />
              ))}
            </div>
          ) : (
            <p className="p-6 text-xs text-slate-400 italic text-center">
              Nothing on your plate right now — check back later.
            </p>
          )
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {activeTasks.map((task) => (
              <button
                key={task.id}
                onClick={() => onOpenTaskModal(task)}
                className="w-full text-left p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors flex items-center gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-bold text-slate-900 dark:text-white truncate">{task.title}</p>
                    <span
                      title={STATUS_DESCRIPTION[task.status] ?? undefined}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase cursor-help ${STATUS_BADGE[task.status]}`}
                    >
                      {STATUS_LABEL[task.status] ?? task.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 text-[11px] text-slate-400">
                    <Clock className="w-3 h-3" />
                    <span>Due {task.dueDate}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex-1 max-w-[140px] h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div className="h-full bg-blue-500" style={{ width: `${task.progress}%` }} />
                    </div>
                    <span className="text-[10px] font-bold text-slate-500">{task.progress}%</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Recently completed */}
      {completedTasks.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Recently Completed</h2>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {completedTasks.slice(0, 5).map((task) => (
              <button
                key={task.id}
                onClick={() => onOpenTaskModal(task)}
                className="w-full text-left p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors flex items-center gap-3"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                <p className="text-xs font-medium text-slate-600 dark:text-slate-300 truncate flex-1">{task.title}</p>
                <span className="text-[10px] text-slate-400 flex-shrink-0">{task.completedDate ?? task.dueDate}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={() => setActiveTab('chat')}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
      >
        <MessageSquare className="w-4 h-4" />
        Need to ask something? Go to Chat
      </button>
    </div>
  );
};
