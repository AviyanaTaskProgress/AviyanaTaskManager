import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Flame,
  Layers,
  Lock,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
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
import { Task } from '../types';

export const DashboardView: React.FC<{ onOpenTaskModal: () => void }> = ({ onOpenTaskModal }) => {
  const {
    tasks,
    users,
    currentUser,
    setActiveTab,
    startTimer,
    syncDeadlinesNow,
    slackConfig,
    triggerSlackNotification,
  } = useApp();

  const [timeRange, setTimeRange] = useState<'week' | 'month'>('week');

  // Key KPI metrics calculations
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const pendingApprovals = tasks.filter((t) => t.status === 'pending_approval').length;
  const overdueTasks = tasks.filter(
    (t) => t.status !== 'completed' && new Date(t.dueDate) < new Date('2026-08-18')
  ).length;

  const completionRate = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const totalHoursLogged = tasks.reduce((sum, t) => sum + (t.loggedHours || 0), 0);
  const avgProductivityScore = Math.round(
    users.reduce((sum, u) => sum + u.productivityScore, 0) / (users.length || 1)
  );

  // Velocity data for AreaChart
  const velocityData = [
    { day: 'Mon', velocity: 32, completed: 5, target: 30 },
    { day: 'Tue', velocity: 45, completed: 8, target: 35 },
    { day: 'Wed', velocity: 48, completed: 7, target: 40 },
    { day: 'Thu', velocity: 52, completed: 9, target: 45 },
    { day: 'Fri', velocity: 61, completed: 12, target: 50 },
    { day: 'Sat', velocity: 38, completed: 4, target: 30 },
    { day: 'Sun (Today)', velocity: 58, completed: 6, target: 55 },
  ];

  // Department efficiency breakdown for BarChart
  const deptStats: Record<string, { tasks: number; hours: number; score: number; count: number }> = {};
  tasks.forEach((t) => {
    if (!deptStats[t.department]) {
      deptStats[t.department] = { tasks: 0, hours: 0, score: 0, count: 0 };
    }
    deptStats[t.department].tasks += 1;
    deptStats[t.department].hours += t.loggedHours || 0;
  });

  users.forEach((u) => {
    if (deptStats[u.department]) {
      deptStats[u.department].score += u.productivityScore;
      deptStats[u.department].count += 1;
    }
  });

  const departmentBarData = Object.keys(deptStats).map((dept) => {
    const stat = deptStats[dept];
    const avgScore = stat.count > 0 ? Math.round(stat.score / stat.count) : 85;
    return {
      department: dept.replace(' & ', '\n'),
      hours: stat.hours,
      tasks: stat.tasks,
      score: avgScore,
    };
  });

  // Task Status distribution for PieChart
  const statusCounts = {
    'In Progress': tasks.filter((t) => t.status === 'in_progress').length,
    'In Review': tasks.filter((t) => t.status === 'in_review').length,
    'Pending Approval': tasks.filter((t) => t.status === 'pending_approval').length,
    'Completed': tasks.filter((t) => t.status === 'completed').length,
    'Blocked / Todo': tasks.filter((t) => t.status === 'todo' || t.status === 'blocked').length,
  };

  const statusPieData = [
    { name: 'In Progress', value: statusCounts['In Progress'], color: '#3b82f6' },
    { name: 'In Review', value: statusCounts['In Review'], color: '#8b5cf6' },
    { name: 'Pending Approval', value: statusCounts['Pending Approval'], color: '#f59e0b' },
    { name: 'Completed', value: statusCounts['Completed'], color: '#10b981' },
    { name: 'Blocked / Todo', value: statusCounts['Blocked / Todo'], color: '#ef4444' },
  ];

  // High Priority / Urgent Tasks Escalation Queue
  const urgentTasks = [...tasks]
    .filter((t) => t.status !== 'completed')
    .sort((a, b) => (b.autoPriorityScore || 0) - (a.autoPriorityScore || 0))
    .slice(0, 5);

  return (
    <div id="dashboard-view" className="space-y-6 animate-in fade-in duration-200">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white p-5 sm:p-6 rounded-2xl shadow-lg border border-slate-800 relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-full bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="space-y-1 z-10">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-500/20 text-blue-300 border border-blue-400/30 flex items-center gap-1.5">
              <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
              Automated Deadline Sync Active
            </span>
            <span className="text-xs text-slate-400">SOC2 Encrypted</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
            Workforce Productivity & Deadline Hub
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 max-w-2xl">
            Real-time telemetry, automated priority escalation, and instant Slack notifications across all departments.
          </p>
        </div>

        <div className="flex items-center gap-2.5 z-10">
          {currentUser.role !== 'employee' && (
            <button
              id="dashboard-create-task-btn"
              onClick={onOpenTaskModal}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-500/25 transition-all hover:scale-105 active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>Assign New Task</span>
            </button>
          )}

          <button
            id="dashboard-sync-deadlines-btn"
            onClick={syncDeadlinesNow}
            className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700 transition-colors"
            title="Recalculate task urgency scores"
          >
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">Sync Deadlines</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Productivity Score */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Avg Productivity Score
            </span>
            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
              {avgProductivityScore}%
            </span>
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center">
              +4.2% vs last wk
            </span>
          </div>
          <div className="mt-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-emerald-500 h-1.5 rounded-full"
              style={{ width: `${avgProductivityScore}%` }}
            />
          </div>
        </div>

        {/* Card 2: Deadline Compliance */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Deadline Completion Rate
            </span>
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
              {completionRate}%
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {completedTasks} of {totalTasks} tasks
            </span>
          </div>
          <div className="mt-3 w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-blue-600 h-1.5 rounded-full"
              style={{ width: `${completionRate}%` }}
            />
          </div>
        </div>

        {/* Card 3: Hours Logged */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Hours Logged (August)
            </span>
            <div className="p-2 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">
              {totalHoursLogged} hrs
            </span>
            <span className="text-xs text-purple-600 dark:text-purple-400 font-semibold">
              98.2% logged on target
            </span>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            Across {users.length} team members
          </p>
        </div>

        {/* Card 4: Urgent & Escalated */}
        <div className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Pending Approvals & Overdue
            </span>
            <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-extrabold text-amber-600 dark:text-amber-400">
              {pendingApprovals + overdueTasks}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              ({pendingApprovals} sign-offs, {overdueTasks} overdue)
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <button
              onClick={() => setActiveTab('approvals')}
              className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              Review approvals →
            </button>
          </div>
        </div>
      </div>

      {/* Analytics Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Chart: Velocity & Productivity Trend */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                Team Productivity Velocity & Target Index
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Rolling daily velocity vs scheduled milestones
              </p>
            </div>
            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-xs font-medium">
              <button
                onClick={() => setTimeRange('week')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  timeRange === 'week'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-bold'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                7 Days
              </button>
              <button
                onClick={() => setTimeRange('month')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  timeRange === 'month'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-bold'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Month
              </button>
            </div>
          </div>

          <div className="h-64 sm:h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={velocityData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="velocityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderRadius: '12px',
                    borderColor: '#334155',
                    color: '#fff',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="velocity"
                  name="Velocity (Pts)"
                  stroke="#3b82f6"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#velocityGrad)"
                />
                <Area
                  type="monotone"
                  dataKey="target"
                  name="Target Line"
                  stroke="#94a3b8"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  fill="none"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Task Status Distribution (Donut Chart) */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div>
            <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
              Workload Status Breakdown
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Live distribution of {totalTasks} tracked deliverables
            </p>
          </div>

          <div className="h-52 w-full my-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusPieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={75}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {statusPieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderRadius: '10px',
                    borderColor: '#334155',
                    color: '#fff',
                    fontSize: '12px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] pt-2 border-t border-slate-100 dark:border-slate-800">
            {statusPieData.map((item) => (
              <div key={item.name} className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-slate-600 dark:text-slate-400 truncate">
                  {item.name}: <strong>{item.value}</strong>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Second Row: Department Capacity & Real-Time Active Team Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Department Workload & Efficiency */}
        <div className="lg:col-span-2 p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                Departmental Output & Capacity Load
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Logged hours vs active tasks per team
              </p>
            </div>
            <button
              onClick={() => setActiveTab('reports')}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
            >
              Export reports →
            </button>
          </div>

          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={departmentBarData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="department" tick={{ fontSize: 10 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderRadius: '10px',
                    borderColor: '#334155',
                    color: '#fff',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="hours" name="Logged Hours" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="score" name="Efficiency Score" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Live Employee Remote Presence Matrix */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                Active Workforce Status
              </h2>
              <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                Live Sync
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Remote team tracking & real-time presence
            </p>
          </div>

          <div className="space-y-2.5 my-3 overflow-y-auto max-h-56">
            {users.map((u) => {
              const statusColors: Record<string, { bg: string; text: string; dot: string }> = {
                active: { bg: 'bg-emerald-50 dark:bg-emerald-950/60', text: 'text-emerald-700 dark:text-emerald-400', dot: 'bg-emerald-500' },
                focus_mode: { bg: 'bg-purple-50 dark:bg-purple-950/60', text: 'text-purple-700 dark:text-purple-400', dot: 'bg-purple-500' },
                in_meeting: { bg: 'bg-blue-50 dark:bg-blue-950/60', text: 'text-blue-700 dark:text-blue-400', dot: 'bg-blue-500' },
                away: { bg: 'bg-amber-50 dark:bg-amber-950/60', text: 'text-amber-700 dark:text-amber-400', dot: 'bg-amber-500' },
                offline: { bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-400', dot: 'bg-slate-400' },
              };
              const s = statusColors[u.status] || statusColors.active;

              return (
                <div
                  key={u.id}
                  className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative flex-shrink-0">
                      <img src={u.avatar} alt={u.name} className="w-8 h-8 rounded-full object-cover" />
                      <span
                        className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-white dark:ring-slate-900 ${s.dot}`}
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {u.name}
                      </p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {u.title}
                      </p>
                    </div>
                  </div>

                  <div className="text-right flex-shrink-0">
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold capitalize ${s.bg} ${s.text}`}>
                      {u.status.replace('_', ' ')}
                    </span>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {u.productivityScore}% Score
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={() => setActiveTab('team')}
            className="w-full py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors"
          >
            Manage Roles & Permissions →
          </button>
        </div>
      </div>

      {/* Third Row: Automated Priority Escalation Queue (Dept Head Task Matrix) */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-rose-500 animate-pulse" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Automated Task Prioritization Escalation Queue
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300">
                Algorithm-ranked
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Tasks ranked dynamically by deadline proximity, workload density, and dependency weights.
            </p>
          </div>

          <button
            onClick={() => setActiveTab('tasks')}
            className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
          >
            View all {tasks.length} tasks in board →
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                <th className="pb-3">Task & Dept</th>
                <th className="pb-3">Assignee</th>
                <th className="pb-3">Due Date</th>
                <th className="pb-3">Urgency Index</th>
                <th className="pb-3">Status</th>
                <th className="pb-3">Progress</th>
                <th className="pb-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
              {urgentTasks.map((task) => (
                <tr key={task.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="py-3.5 pr-3">
                    <div className="flex items-start gap-2">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] font-mono font-bold">
                        {task.id}
                      </span>
                      <div>
                        <p className="font-bold text-slate-900 dark:text-white line-clamp-1">
                          {task.title}
                        </p>
                        <p className="text-[10px] text-slate-400">{task.department}</p>
                      </div>
                    </div>
                  </td>

                  <td className="py-3.5 pr-3">
                    <div className="flex items-center gap-2">
                      <img
                        src={task.assigneeAvatar}
                        alt={task.assigneeName}
                        className="w-5 h-5 rounded-full object-cover"
                      />
                      <span className="text-slate-700 dark:text-slate-300">{task.assigneeName}</span>
                    </div>
                  </td>

                  <td className="py-3.5 pr-3 whitespace-nowrap">
                    <span className="text-slate-900 dark:text-white font-semibold">
                      {task.dueDate}
                    </span>
                  </td>

                  <td className="py-3.5 pr-3">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          (task.autoPriorityScore || 0) >= 80
                            ? 'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300'
                            : (task.autoPriorityScore || 0) >= 60
                            ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300'
                            : 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                        }`}
                      >
                        {task.autoPriorityScore || 0}/100
                      </span>
                      <span className="text-[10px] text-slate-400 hidden xl:inline">
                        {task.priorityReason}
                      </span>
                    </div>
                  </td>

                  <td className="py-3.5 pr-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        task.status === 'in_progress'
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                          : task.status === 'pending_approval'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                          : task.status === 'in_review'
                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {task.status.replace('_', ' ')}
                    </span>
                  </td>

                  <td className="py-3.5 pr-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-1.5 rounded-full ${
                            task.progress >= 80 ? 'bg-emerald-500' : 'bg-blue-500'
                          }`}
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-bold text-slate-500">{task.progress}%</span>
                    </div>
                  </td>

                  <td className="py-3.5 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => startTimer(task.id, task.title, 'focus_work')}
                        className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900 text-emerald-600 dark:text-emerald-300"
                        title="Start focus timer for this task"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => triggerSlackNotification('deadline_alert', task)}
                        className="p-1.5 rounded-lg bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/60 dark:hover:bg-purple-900 text-purple-600 dark:text-purple-300"
                        title="Ping Slack webhook alert"
                      >
                        <Send className="w-3.5 h-3.5" />
                      </button>
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
