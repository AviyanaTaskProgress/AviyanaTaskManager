import React, { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  Filter,
  Flame,
  Grid,
  Layers,
  List,
  Lock,
  MessageSquare,
  MoveRight,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Tag,
  User,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Department, Task, TaskPriority, TaskStatus } from '../types';

interface TasksViewProps {
  onOpenTaskModal: (task?: Task) => void;
}

export const TasksView: React.FC<TasksViewProps> = ({ onOpenTaskModal }) => {
  const {
    tasks,
    users,
    currentUser,
    updateTask,
    submitTaskForApproval,
    startTimer,
    syncDeadlinesNow,
    triggerSlackNotification,
  } = useApp();

  const [viewMode, setViewMode] = useState<'kanban' | 'list' | 'timeline'>('kanban');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState<string>('All');
  const [selectedAssignee, setSelectedAssignee] = useState<string>('All');
  const [selectedPriority, setSelectedPriority] = useState<string>('All');
  const [sortByAutoPriority, setSortByAutoPriority] = useState(true);

  // Filter tasks
  const filteredTasks = tasks
    .filter((task) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        task.title.toLowerCase().includes(q) ||
        task.id.toLowerCase().includes(q) ||
        task.assigneeName.toLowerCase().includes(q) ||
        task.priority.toLowerCase().includes(q) ||
        task.department.toLowerCase().includes(q) ||
        task.description.toLowerCase().includes(q) ||
        task.status.toLowerCase().includes(q) ||
        task.tags?.some((t) => t.toLowerCase().includes(q));

      const matchesDept = selectedDept === 'All' || task.department === selectedDept;
      const matchesAssignee = selectedAssignee === 'All' || task.assigneeId === selectedAssignee;
      const matchesPriority = selectedPriority === 'All' || task.priority === selectedPriority;

      return matchesSearch && matchesDept && matchesAssignee && matchesPriority;
    })
    .sort((a, b) => {
      if (sortByAutoPriority) {
        return (b.autoPriorityScore || 0) - (a.autoPriorityScore || 0);
      }
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    });

  const columns: Array<{ id: TaskStatus; label: string; color: string }> = [
    { id: 'todo', label: 'To Do / Backlog', color: 'border-slate-400 dark:border-slate-600' },
    { id: 'in_progress', label: 'In Progress', color: 'border-blue-500' },
    { id: 'in_review', label: 'In Review', color: 'border-purple-500' },
    { id: 'pending_approval', label: 'Pending Sign-off', color: 'border-amber-500' },
    { id: 'completed', label: 'Completed', color: 'border-emerald-500' },
  ];

  const handleStatusChange = async (taskId: string, newStatus: TaskStatus) => {
    const isNowDone = newStatus === 'completed';
    await updateTask(
      taskId,
      {
        status: newStatus,
        progress: isNowDone ? 100 : undefined,
        completedDate: isNowDone ? '2026-08-18' : undefined,
      },
      `Status changed to ${newStatus.replace('_', ' ')}`
    );
  };

  return (
    <div id="tasks-view-container" className="space-y-6 animate-in fade-in duration-200">
      {/* Top Controls Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
              Dept Head Task Matrix & Automated Prioritization
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
              {filteredTasks.length} Tasks
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Automated priority scoring recalculates live as deadlines approach.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* View mode toggle */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700/60 text-xs font-medium">
            <button
              id="view-mode-kanban-btn"
              onClick={() => setViewMode('kanban')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
                viewMode === 'kanban'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
              <span>Board</span>
            </button>

            <button
              id="view-mode-list-btn"
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span>List</span>
            </button>

            <button
              id="view-mode-timeline-btn"
              onClick={() => setViewMode('timeline')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
                viewMode === 'timeline'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-bold'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Timeline</span>
            </button>
          </div>

          {/* Sync Button */}
          <button
            id="sync-deadlines-tasks-btn"
            onClick={syncDeadlinesNow}
            className="flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 text-xs font-semibold border border-slate-200 dark:border-slate-700 transition-colors"
            title="Recalculate task urgency scores"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Sync</span>
          </button>

          {/* Create Task Button */}
          {currentUser.role !== 'staff' && (
            <button
              id="tasks-create-task-btn"
              onClick={() => onOpenTaskModal()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-500/25 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>New Task</span>
            </button>
          )}
        </div>
      </div>

      {/* Global Search & Multi-Filter Bar */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Main Global Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="global-task-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Global Search: title, assignee (e.g. Alex), priority (critical, high, low), department..."
              className="w-full pl-9.5 pr-10 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            />
            {searchQuery && (
              <button
                id="clear-global-search-btn"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Department filter */}
            <select
              id="filter-dept-select"
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium focus:outline-none"
            >
              <option value="All">All Departments</option>
              <option value="Engineering">Engineering</option>
              <option value="Product & Design">Product & Design</option>
              <option value="Marketing">Marketing</option>
              <option value="Operations">Operations</option>
              <option value="Human Resources">HR</option>
            </select>

            {/* Assignee filter */}
            <select
              id="filter-assignee-select"
              value={selectedAssignee}
              onChange={(e) => setSelectedAssignee(e.target.value)}
              className="px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium focus:outline-none"
            >
              <option value="All">All Assignees</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>

            {/* Priority filter */}
            <select
              id="filter-priority-select"
              value={selectedPriority}
              onChange={(e) => setSelectedPriority(e.target.value)}
              className="px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium focus:outline-none"
            >
              <option value="All">All Priorities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>

            {/* Auto Priority Sort Toggle */}
            <button
              id="toggle-auto-sort-btn"
              onClick={() => setSortByAutoPriority(!sortByAutoPriority)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition-colors ${
                sortByAutoPriority
                  ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
                  : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              <Flame className="w-3.5 h-3.5 text-rose-500" />
              <span>Auto-Ranked</span>
            </button>
          </div>
        </div>

        {/* Quick Filter Tags & Search Match Info */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-[11px]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-slate-400 font-semibold flex items-center gap-1">
              <Filter className="w-3 h-3" /> Quick Filter:
            </span>

            <button
              onClick={() => setSelectedPriority(selectedPriority === 'critical' ? 'All' : 'critical')}
              className={`px-2 py-0.5 rounded-lg font-bold border transition-colors ${
                selectedPriority === 'critical'
                  ? 'bg-red-500 text-white border-red-500'
                  : 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900/60'
              }`}
            >
              🔥 Critical Priority
            </button>

            <button
              onClick={() => setSelectedPriority(selectedPriority === 'high' ? 'All' : 'high')}
              className={`px-2 py-0.5 rounded-lg font-bold border transition-colors ${
                selectedPriority === 'high'
                  ? 'bg-amber-500 text-white border-amber-500'
                  : 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900/60'
              }`}
            >
              ⚡ High Priority
            </button>

            <button
              onClick={() =>
                setSelectedAssignee(selectedAssignee === currentUser.id ? 'All' : currentUser.id)
              }
              className={`px-2 py-0.5 rounded-lg font-bold border transition-colors ${
                selectedAssignee === currentUser.id
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-900/60'
              }`}
            >
              👤 Assigned to Me
            </button>

            <button
              onClick={() =>
                setSelectedDept(selectedDept === 'Engineering' ? 'All' : 'Engineering')
              }
              className={`px-2 py-0.5 rounded-lg font-medium border transition-colors ${
                selectedDept === 'Engineering'
                  ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 border-transparent'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
              }`}
            >
              Engineering
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-500 dark:text-slate-400">
              Showing <strong>{filteredTasks.length}</strong> of <strong>{tasks.length}</strong> tasks
            </span>
            {(searchQuery || selectedDept !== 'All' || selectedAssignee !== 'All' || selectedPriority !== 'All') && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedDept('All');
                  setSelectedAssignee('All');
                  setSelectedPriority('All');
                }}
                className="text-blue-600 dark:text-blue-400 hover:underline font-bold"
              >
                Reset all
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Kanban Board View */}
      {viewMode === 'kanban' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          {columns.map((col) => {
            const colTasks = filteredTasks.filter((t) => t.status === col.id);
            return (
              <div
                key={col.id}
                className="bg-slate-50/80 dark:bg-slate-900/60 rounded-2xl p-3.5 border border-slate-200 dark:border-slate-800/80 flex flex-col min-h-[500px]"
              >
                {/* Column header */}
                <div
                  className={`pb-2.5 mb-3 border-b-2 ${col.color} flex items-center justify-between`}
                >
                  <span className="font-bold text-xs text-slate-900 dark:text-white uppercase tracking-wider">
                    {col.label}
                  </span>
                  <span className="w-5 h-5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 flex items-center justify-center">
                    {colTasks.length}
                  </span>
                </div>

                {/* Task Cards */}
                <div className="space-y-3 flex-1 overflow-y-auto">
                  {colTasks.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400 italic">
                      No tasks in this lane
                    </div>
                  ) : (
                    colTasks.map((task) => {
                      const isOverdue =
                        task.status !== 'completed' &&
                        new Date(task.dueDate) < new Date('2026-08-18');

                      return (
                        <div
                          key={task.id}
                          onClick={() => onOpenTaskModal(task)}
                          className="p-3.5 rounded-xl bg-white dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700/70 shadow-2xs hover:shadow-md hover:border-blue-400 dark:hover:border-blue-500/50 transition-all cursor-pointer space-y-2.5 group"
                        >
                          {/* Card Top: ID + Priority + Encryption pill */}
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[10px] font-bold text-slate-400">
                              {task.id}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {task.isEncrypted && (
                                <Lock className="w-3 h-3 text-emerald-500" title="AES-256 Encrypted" />
                              )}
                              <span
                                className={`px-1.5 py-0.2 rounded text-[10px] font-extrabold uppercase ${
                                  task.priority === 'critical'
                                    ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                                    : task.priority === 'high'
                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                                    : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                                }`}
                              >
                                {task.priority}
                              </span>
                            </div>
                          </div>

                          {/* Title */}
                          <h3 className="text-xs font-bold text-slate-900 dark:text-white line-clamp-2 leading-snug group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                            {task.title}
                          </h3>

                          {/* Auto Urgency Score Badge */}
                          <div className="flex items-center gap-1 text-[10px] text-slate-500 bg-slate-50 dark:bg-slate-900/60 p-1.5 rounded-lg">
                            <Flame className="w-3 h-3 text-rose-500 flex-shrink-0" />
                            <span className="font-bold text-slate-700 dark:text-slate-300">
                              {task.autoPriorityScore || 0}/100:
                            </span>
                            <span className="truncate">{task.priorityReason}</span>
                          </div>

                          {/* Progress Bar */}
                          <div>
                            <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                              <span>Progress</span>
                              <span className="font-bold text-slate-700 dark:text-slate-300">
                                {task.progress}%
                              </span>
                            </div>
                            <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                              <div
                                className={`h-1.5 rounded-full ${
                                  task.progress >= 80 ? 'bg-emerald-500' : 'bg-blue-600'
                                }`}
                                style={{ width: `${task.progress}%` }}
                              />
                            </div>
                          </div>

                          {/* Footer: Due date + Assignee Avatar + Action buttons */}
                          <div className="pt-2 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-[11px]">
                            <div
                              className={`flex items-center gap-1 text-[10px] font-semibold ${
                                isOverdue
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              <Calendar className="w-3 h-3" />
                              <span>{task.dueDate}</span>
                              {isOverdue && <span className="font-extrabold">(Overdue)</span>}
                            </div>

                            <div className="flex items-center gap-1.5">
                              {task.remarks && task.remarks.length > 0 && (
                                <span className="flex items-center gap-0.5 text-[10px] text-slate-400">
                                  <MessageSquare className="w-3 h-3" />
                                  {task.remarks.length}
                                </span>
                              )}
                              <img
                                src={task.assigneeAvatar}
                                alt={task.assigneeName}
                                title={task.assigneeName}
                                className="w-5 h-5 rounded-full object-cover ring-1 ring-blue-500/20"
                              />
                            </div>
                          </div>

                          {/* Quick lane mover */}
                          <div
                            className="flex items-center justify-between pt-1 gap-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => startTimer(task.id, task.title, 'focus_work')}
                              className="px-2 py-1 rounded bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold flex items-center gap-1"
                            >
                              <Play className="w-2.5 h-2.5" /> Track
                            </button>

                            {task.status !== 'pending_approval' && task.status !== 'completed' && (
                              <button
                                onClick={() => submitTaskForApproval(task.id, 'Ready for sign-off')}
                                className="px-2 py-1 rounded bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/60 dark:hover:bg-amber-900 text-amber-700 dark:text-amber-300 text-[10px] font-bold"
                              >
                                Sign-off
                              </button>
                            )}

                            <button
                              onClick={() => triggerSlackNotification('deadline_alert', task)}
                              className="p-1 rounded bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-300"
                              title="Slack Ping"
                            >
                              <Send className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List Table View */}
      {viewMode === 'list' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                  <th className="p-3.5">Task ID</th>
                  <th className="p-3.5">Title & Dept</th>
                  <th className="p-3.5">Assignee</th>
                  <th className="p-3.5">Start Date</th>
                  <th className="p-3.5">Due Date</th>
                  <th className="p-3.5">Priority</th>
                  <th className="p-3.5">Urgency Score</th>
                  <th className="p-3.5">Progress</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                {filteredTasks.map((task) => (
                  <tr
                    key={task.id}
                    onClick={() => onOpenTaskModal(task)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="p-3.5 font-mono text-[10px] font-bold text-slate-500">
                      {task.id}
                    </td>

                    <td className="p-3.5">
                      <div>
                        <p className="font-bold text-slate-900 dark:text-white">
                          {task.title}
                        </p>
                        <p className="text-[10px] text-slate-400">{task.department}</p>
                      </div>
                    </td>

                    <td className="p-3.5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <img
                          src={task.assigneeAvatar}
                          alt={task.assigneeName}
                          className="w-6 h-6 rounded-full object-cover"
                        />
                        <span className="text-slate-800 dark:text-slate-200">{task.assigneeName}</span>
                      </div>
                    </td>

                    <td className="p-3.5 text-slate-500 whitespace-nowrap">{task.startDate}</td>
                    <td className="p-3.5 font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                      {task.dueDate}
                    </td>

                    <td className="p-3.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase ${
                          task.priority === 'critical'
                            ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                            : task.priority === 'high'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                        }`}
                      >
                        {task.priority}
                      </span>
                    </td>

                    <td className="p-3.5">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {task.autoPriorityScore || 0}/100
                      </span>
                    </td>

                    <td className="p-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-blue-600 h-1.5 rounded-full"
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-bold text-slate-400">{task.progress}%</span>
                      </div>
                    </td>

                    <td className="p-3.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          task.status === 'completed'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                            : task.status === 'pending_approval'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                        }`}
                      >
                        {task.status.replace('_', ' ')}
                      </span>
                    </td>

                    <td className="p-3.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => startTimer(task.id, task.title, 'focus_work')}
                          className="p-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300"
                          title="Start focus timer"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => triggerSlackNotification('deadline_alert', task)}
                          className="p-1.5 rounded-lg bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300"
                          title="Slack Alert"
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
      )}

      {/* Gantt / Timeline View */}
      {viewMode === 'timeline' && (
        <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              Project Gantt & Deadline Milestones (August 2026)
            </h3>
            <span className="text-xs text-slate-400">Current Date Marker: Aug 18, 2026</span>
          </div>

          <div className="space-y-3">
            {filteredTasks.map((task) => {
              const startDay = parseInt(task.startDate.split('-')[2] || '1', 10);
              const dueDay = parseInt(task.dueDate.split('-')[2] || '28', 10);
              const leftPercent = Math.max(0, Math.min(90, ((startDay - 1) / 30) * 100));
              const widthPercent = Math.max(8, Math.min(100 - leftPercent, ((dueDay - startDay + 1) / 30) * 100));

              return (
                <div
                  key={task.id}
                  onClick={() => onOpenTaskModal(task)}
                  className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 cursor-pointer hover:border-blue-400 transition-colors"
                >
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] font-bold text-slate-400">{task.id}</span>
                      <span className="font-bold text-slate-900 dark:text-white">{task.title}</span>
                    </div>
                    <span className="text-[10px] text-slate-400">
                      {task.startDate} → {task.dueDate} ({task.progress}%)
                    </span>
                  </div>

                  {/* Gantt Bar */}
                  <div className="relative h-6 bg-slate-200 dark:bg-slate-700 rounded-lg overflow-hidden">
                    <div
                      className={`absolute top-0 h-full rounded-lg px-2 flex items-center text-[10px] font-bold text-white shadow-xs ${
                        task.status === 'completed'
                          ? 'bg-emerald-600'
                          : task.priority === 'critical'
                          ? 'bg-rose-600'
                          : 'bg-blue-600'
                      }`}
                      style={{
                        left: `${leftPercent}%`,
                        width: `${widthPercent}%`,
                      }}
                    >
                      <span className="truncate">{task.assigneeName}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
