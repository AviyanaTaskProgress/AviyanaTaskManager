import React, { useMemo, useState } from 'react';
import { Landmark, Layers } from 'lucide-react';
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApp } from '../context/AppContext';

const STATUS_COLORS: Record<string, string> = {
  todo: '#94a3b8',
  in_progress: '#3b82f6',
  in_review: '#8b5cf6',
  pending_approval: '#f59e0b',
  pending_payment: '#fb923c',
  completed: '#10b981',
  blocked: '#ef4444',
};

const STATUS_LABEL: Record<string, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  pending_approval: 'Pending Approval',
  pending_payment: 'Pending Payment',
  completed: 'Completed',
  blocked: 'Blocked',
};

/**
 * Strictly read-only — the *entire* app experience for a 'chairman' role
 * user (see App.tsx's chairman branch), and deliberately narrower than
 * ExecutiveDashboardView (the 'viewer' role's screen).
 *
 * ONLY shows: task status, department, title, and due date — no
 * description, remarks, attachments, or payment figures anywhere on
 * this screen (42_ceo_and_chairman_roles.sql's RLS grants full-row
 * SELECT access at the database level, same as chief_officer, since
 * Postgres RLS can only filter rows, not columns, for a role that
 * connects through the shared 'authenticated' Postgres role like every
 * other role in this app — this component is the actual place that
 * restriction is enforced, by simply never reading or rendering those
 * fields even though they're present on the fetched objects).
 */
export const ChairmanDashboardView: React.FC = () => {
  const { tasks } = useApp();
  const [groupBy, setGroupBy] = useState<'department' | 'status'>('department');

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const overdueTasks = tasks.filter((t) => t.status !== 'completed' && new Date(t.dueDate) < new Date()).length;

  const statusBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    tasks.forEach((t) => (counts[t.status] = (counts[t.status] || 0) + 1));
    return Object.entries(counts).map(([status, value]) => ({
      name: STATUS_LABEL[status] ?? status,
      value,
      color: STATUS_COLORS[status] ?? '#94a3b8',
    }));
  }, [tasks]);

  const departmentBreakdown = useMemo(() => {
    const counts: Record<string, { total: number; completed: number }> = {};
    tasks.forEach((t) => {
      counts[t.department] ??= { total: 0, completed: 0 };
      counts[t.department].total += 1;
      if (t.status === 'completed') counts[t.department].completed += 1;
    });
    return Object.entries(counts).map(([department, v]) => ({
      department,
      total: v.total,
      completed: v.completed,
      open: v.total - v.completed,
    }));
  }, [tasks]);

  const rows = groupBy === 'department'
    ? [...tasks].sort((a, b) => a.department.localeCompare(b.department))
    : [...tasks].sort((a, b) => a.status.localeCompare(b.status));

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white p-5 sm:p-6 rounded-2xl shadow-lg flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-white/10">
          <Landmark className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-lg sm:text-xl font-bold">Task Status Overview</h1>
          <p className="text-xs text-slate-300 mt-0.5">
            Read-only — status by department. No task detail, remarks, or payment figures are shown here.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <p className="text-xl font-bold text-slate-900 dark:text-white">{totalTasks}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Total Tasks</p>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{completedTasks}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Completed</p>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <p className="text-xl font-bold text-red-600 dark:text-red-400">{overdueTasks}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Overdue</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-3">Status Breakdown</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={statusBreakdown} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80}>
                {statusBreakdown.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider mb-3">By Department</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={departmentBreakdown}>
              <XAxis dataKey="department" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              <Bar dataKey="completed" stackId="a" fill="#10b981" name="Completed" />
              <Bar dataKey="open" stackId="a" fill="#94a3b8" name="Open" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-4">
          <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-blue-500" />
            All Tasks — Status Only
          </h3>
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
            {(['department', 'status'] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGroupBy(g)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide transition-colors ${
                  groupBy === g
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400 border-t border-slate-100 dark:border-slate-800">
                <th className="px-4 py-2 font-bold">Task</th>
                <th className="px-4 py-2 font-bold">Department</th>
                <th className="px-4 py-2 font-bold">Status</th>
                <th className="px-4 py-2 font-bold">Due Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-200 truncate max-w-[220px]">{t.title}</td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{t.department}</td>
                  <td className="px-4 py-2">
                    <span
                      className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white"
                      style={{ backgroundColor: STATUS_COLORS[t.status] ?? '#94a3b8' }}
                    >
                      {STATUS_LABEL[t.status] ?? t.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-500 dark:text-slate-400">{t.dueDate}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400 italic">
                    No tasks yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
