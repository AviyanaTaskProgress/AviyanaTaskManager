import React, { useMemo, useState } from 'react';
import { Building2, CheckCircle2, Clock, CreditCard, Layers, TrendingUp, Users } from 'lucide-react';
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
import { ROLE_BADGE_CLASSES_SOFT, ROLE_LABEL } from '../lib/roles';

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
 * Strictly read-only. This is the *entire* app experience for a `viewer`
 * role user — see App.tsx's viewer branch. No task/user/chat write paths
 * are reachable from here, by design (see AVIYANA_NEXT_STEPS.md follow-up
 * about read-only Chairman/exec access).
 */
export const ExecutiveDashboardView: React.FC = () => {
  const { tasks, users } = useApp();
  const [groupBy, setGroupBy] = useState<'department' | 'person' | 'type'>('department');

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const overdueTasks = tasks.filter((t) => t.status !== 'completed' && new Date(t.dueDate) < new Date()).length;
  const avgProgress = totalTasks > 0 ? Math.round(tasks.reduce((sum, t) => sum + t.progress, 0) / totalTasks) : 0;
  const pendingPaymentTotal = tasks
    .filter((t) => t.requiresPayment && t.paymentStatus === 'pending')
    .reduce((sum, t) => sum + (t.paymentAmount || 0), 0);

  const statusBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    tasks.forEach((t) => (counts[t.status] = (counts[t.status] || 0) + 1));
    return Object.entries(counts).map(([status, value]) => ({
      name: STATUS_LABEL[status] ?? status,
      value,
      color: STATUS_COLORS[status] ?? '#94a3b8',
    }));
  }, [tasks]);

  // Department-wise
  const byDepartment = useMemo(() => {
    const map: Record<string, { total: number; completed: number; progressSum: number }> = {};
    tasks.forEach((t) => {
      if (!map[t.department]) map[t.department] = { total: 0, completed: 0, progressSum: 0 };
      map[t.department].total += 1;
      map[t.department].progressSum += t.progress;
      if (t.status === 'completed') map[t.department].completed += 1;
    });
    return Object.entries(map)
      .map(([department, v]) => ({
        department,
        total: v.total,
        completed: v.completed,
        avgProgress: v.total > 0 ? Math.round(v.progressSum / v.total) : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [tasks]);

  // Person-wise
  const byPerson = useMemo(() => {
    const map: Record<string, { total: number; completed: number; inProgress: number; progressSum: number }> = {};
    tasks.forEach((t) => {
      if (!map[t.assigneeId]) map[t.assigneeId] = { total: 0, completed: 0, inProgress: 0, progressSum: 0 };
      map[t.assigneeId].total += 1;
      map[t.assigneeId].progressSum += t.progress;
      if (t.status === 'completed') map[t.assigneeId].completed += 1;
      if (t.status === 'in_progress') map[t.assigneeId].inProgress += 1;
    });
    return Object.entries(map)
      .map(([userId, v]) => {
        const user = users.find((u) => u.id === userId);
        return {
          userId,
          name: user?.name ?? 'Unknown',
          avatar: user?.avatar,
          department: user?.department ?? '—',
          role: user?.role,
          total: v.total,
          completed: v.completed,
          inProgress: v.inProgress,
          avgProgress: v.total > 0 ? Math.round(v.progressSum / v.total) : 0,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [tasks, users]);

  // Task-type-wise (using tags as the closest analog to "task type" — the
  // data model doesn't have a separate type field, only free-form tags)
  const byType = useMemo(() => {
    const map: Record<string, { total: number; completed: number; progressSum: number }> = {};
    tasks.forEach((t) => {
      const tags = t.tags.length > 0 ? t.tags : ['Untagged'];
      tags.forEach((tag) => {
        if (!map[tag]) map[tag] = { total: 0, completed: 0, progressSum: 0 };
        map[tag].total += 1;
        map[tag].progressSum += t.progress;
        if (t.status === 'completed') map[tag].completed += 1;
      });
    });
    return Object.entries(map)
      .map(([type, v]) => ({
        type,
        total: v.total,
        completed: v.completed,
        avgProgress: v.total > 0 ? Math.round(v.progressSum / v.total) : 0,
      }))
      .sort((a, b) => b.total - a.total);
  }, [tasks]);

  const barData =
    groupBy === 'department'
      ? byDepartment.map((d) => ({ label: d.department, total: d.total, completed: d.completed }))
      : groupBy === 'type'
      ? byType.map((d) => ({ label: d.type, total: d.total, completed: d.completed }))
      : byPerson.slice(0, 12).map((d) => ({ label: d.name, total: d.total, completed: d.completed }));

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">Executive Overview</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Read-only summary of everything assigned across the organization — no editing here.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: 'Total Tasks', value: totalTasks, icon: Layers, color: 'text-blue-600 dark:text-blue-400' },
          { label: 'Completed', value: completedTasks, icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Overdue', value: overdueTasks, icon: Clock, color: 'text-rose-600 dark:text-rose-400' },
          { label: 'Avg Progress', value: `${avgProgress}%`, icon: TrendingUp, color: 'text-indigo-600 dark:text-indigo-400' },
          {
            label: 'Pending Payments',
            value: `Rs. ${pendingPaymentTotal.toLocaleString('en-LK', { maximumFractionDigits: 0 })}`,
            icon: CreditCard,
            color: 'text-orange-600 dark:text-orange-400',
          },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs"
          >
            <kpi.icon className={`w-4 h-4 mb-2 ${kpi.color}`} />
            <p className="text-xl font-bold text-slate-900 dark:text-white">{kpi.value}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{kpi.label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Status pie */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Status Breakdown</h2>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={statusBreakdown} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                {statusBreakdown.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Breakdown bar chart, switchable */}
        <div className="lg:col-span-3 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Progress By</h2>
            <div className="flex gap-1">
              {(['department', 'person', 'type'] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setGroupBy(g)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold capitalize transition-colors ${
                    groupBy === g
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData}>
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="#94a3b8" interval={0} angle={-20} textAnchor="end" height={50} />
              <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" allowDecimals={false} />
              <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="total" name="Total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="completed" name="Completed" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Department table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-blue-500" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">By Department</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-2 font-semibold">Department</th>
                <th className="px-4 py-2 font-semibold">Total Tasks</th>
                <th className="px-4 py-2 font-semibold">Completed</th>
                <th className="px-4 py-2 font-semibold">Avg Progress</th>
              </tr>
            </thead>
            <tbody>
              {byDepartment.map((d) => (
                <tr key={d.department} className="border-b border-slate-50 dark:border-slate-800/60">
                  <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-white">{d.department}</td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{d.total}</td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{d.completed}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 max-w-[80px] h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${d.avgProgress}%` }} />
                      </div>
                      <span className="text-slate-500">{d.avgProgress}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Person table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <Users className="w-4 h-4 text-indigo-500" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">By Person</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-2 font-semibold">Person</th>
                <th className="px-4 py-2 font-semibold">Department</th>
                <th className="px-4 py-2 font-semibold">Total</th>
                <th className="px-4 py-2 font-semibold">In Progress</th>
                <th className="px-4 py-2 font-semibold">Completed</th>
                <th className="px-4 py-2 font-semibold">Avg Progress</th>
              </tr>
            </thead>
            <tbody>
              {byPerson.map((p) => (
                <tr key={p.userId} className="border-b border-slate-50 dark:border-slate-800/60">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {p.avatar && <img src={p.avatar} alt={p.name} className="w-6 h-6 rounded-full object-cover" />}
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">{p.name}</p>
                        {p.role && (
                          <span className={`inline-block px-1 rounded text-[9px] font-bold ${ROLE_BADGE_CLASSES_SOFT[p.role]}`}>
                            {ROLE_LABEL[p.role]}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{p.department}</td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{p.total}</td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{p.inProgress}</td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{p.completed}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 max-w-[80px] h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div className="h-full bg-indigo-500" style={{ width: `${p.avgProgress}%` }} />
                      </div>
                      <span className="text-slate-500">{p.avgProgress}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Task type table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <Layers className="w-4 h-4 text-purple-500" />
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">By Task Type (tags)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-2 font-semibold">Type</th>
                <th className="px-4 py-2 font-semibold">Total</th>
                <th className="px-4 py-2 font-semibold">Completed</th>
                <th className="px-4 py-2 font-semibold">Avg Progress</th>
              </tr>
            </thead>
            <tbody>
              {byType.map((t) => (
                <tr key={t.type} className="border-b border-slate-50 dark:border-slate-800/60">
                  <td className="px-4 py-2.5 font-semibold text-slate-900 dark:text-white">{t.type}</td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{t.total}</td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-300">{t.completed}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 max-w-[80px] h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div className="h-full bg-purple-500" style={{ width: `${t.avgProgress}%` }} />
                      </div>
                      <span className="text-slate-500">{t.avgProgress}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
