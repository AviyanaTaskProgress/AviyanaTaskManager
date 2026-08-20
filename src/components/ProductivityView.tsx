import React, { useState } from 'react';
import {
  Activity,
  Award,
  CheckCircle2,
  Clock,
  Coffee,
  Flame,
  LineChart,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Sparkles,
  Square,
  TrendingUp,
  UserCheck,
  Users,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApp } from '../context/AppContext';
import { TimeSession } from '../types';

export const ProductivityView: React.FC = () => {
  const {
    currentUser,
    users,
    tasks,
    timeSessions,
    activeSession,
    startTimer,
    pauseTimer,
    stopAndSaveTimer,
    logWorkTime,
  } = useApp();

  const [selectedTaskForTimer, setSelectedTaskForTimer] = useState<string>('');
  const [sessionType, setSessionType] = useState<TimeSession['type']>('focus_work');
  const [sessionNotes, setSessionNotes] = useState<string>('');
  const [manualHours, setManualHours] = useState<number>(1);
  const [manualTask, setManualTask] = useState<string>(tasks[0]?.id || '');
  const [manualNote, setManualNote] = useState<string>('');

  const formatTimer = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${hrs > 0 ? `${hrs}:` : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleStartFocus = () => {
    const taskObj = tasks.find((t) => t.id === selectedTaskForTimer);
    startTimer(selectedTaskForTimer, taskObj?.title || 'General Focus Session', sessionType);
  };

  const handleManualLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTask || manualHours <= 0) return;
    await logWorkTime(manualTask, manualHours, manualNote || 'Manual Timesheet Entry');
    setManualNote('');
    alert(`Logged ${manualHours}h for task ${manualTask} successfully!`);
  };

  // Productivity Score comparison data
  const employeeProductivityData = users.map((u) => ({
    name: u.name.split(' ')[0],
    score: u.productivityScore,
    hours: u.hoursLoggedThisMonth,
    tasksDone: u.tasksCompleted,
  }));

  // Hourly focus distribution data
  const focusDistributionData = [
    { time: '08:00', focus: 85, meetings: 10, breaks: 5 },
    { time: '10:00', focus: 95, meetings: 5, breaks: 0 },
    { time: '12:00', focus: 40, meetings: 10, breaks: 50 },
    { time: '14:00', focus: 92, meetings: 8, breaks: 0 },
    { time: '16:00', focus: 88, meetings: 12, breaks: 0 },
    { time: '18:00', focus: 75, meetings: 15, breaks: 10 },
  ];

  return (
    <div id="productivity-view" className="space-y-6 animate-in fade-in duration-200">
      {/* Top Banner / Focus Stopwatch */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Active Work Tracker & Stopwatch */}
        <div className="lg:col-span-2 p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-emerald-600 text-white">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                  Live Employee Focus & Session Logger
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Track real-time deep work, code review, and active milestone completion
                </p>
              </div>
            </div>

            {activeSession.isRunning && (
              <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                Active Recording
              </span>
            )}
          </div>

          {/* Big Stopwatch Display */}
          <div className="my-6 p-6 rounded-2xl bg-slate-900 text-white text-center flex flex-col items-center justify-center relative overflow-hidden border border-slate-800">
            <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
            
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-1">
              {activeSession.taskTitle || 'No Active Task Selected'}
            </p>

            <span className="text-4xl sm:text-6xl font-black font-mono tracking-tight text-emerald-400">
              {formatTimer(activeSession.elapsedSeconds)}
            </span>

            <p className="text-xs text-slate-400 mt-2">
              Session Mode:{' '}
              <span className="font-bold text-white capitalize">
                {activeSession.sessionType.replace('_', ' ')}
              </span>
            </p>

            {/* Controls */}
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              {!activeSession.isRunning ? (
                <button
                  id="start-focus-session-btn"
                  onClick={handleStartFocus}
                  className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-500/25 flex items-center gap-2 transition-all hover:scale-105"
                >
                  <Play className="w-4 h-4" />
                  <span>Start Focus Session</span>
                </button>
              ) : (
                <>
                  <button
                    id="pause-focus-session-btn"
                    onClick={pauseTimer}
                    className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs border border-slate-700 flex items-center gap-2 transition-colors"
                  >
                    <Pause className="w-4 h-4" />
                    <span>Pause</span>
                  </button>

                  <button
                    id="stop-save-focus-session-btn"
                    onClick={() => stopAndSaveTimer(sessionNotes)}
                    className="px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs shadow-lg shadow-red-500/25 flex items-center gap-2 transition-all"
                  >
                    <Square className="w-4 h-4" />
                    <span>Stop & Sync to Timesheet</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Quick Task Linker */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Link to Assigned Deliverable
              </label>
              <select
                id="link-task-productivity-select"
                value={selectedTaskForTimer}
                onChange={(e) => setSelectedTaskForTimer(e.target.value)}
                className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
              >
                <option value="">General Work (Unassigned)</option>
                {tasks
                  .filter((t) => t.status !== 'completed')
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.id}: {t.title} ({t.department})
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Session Focus Category
              </label>
              <select
                id="session-type-productivity-select"
                value={sessionType}
                onChange={(e) => setSessionType(e.target.value as any)}
                className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
              >
                <option value="focus_work">Deep Focus Work</option>
                <option value="code_review">Code Review & Architecture</option>
                <option value="planning">Sprint Planning</option>
                <option value="collaboration">Cross-team Collaboration</option>
                <option value="break">Strategic Rest / Break</option>
              </select>
            </div>
          </div>
        </div>

        {/* Right Col: Manual Timesheet Log & User Productivity Gauge */}
        <div className="p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-blue-600 text-white">
                <Flame className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                  Manual Timesheet Entry
                </h3>
                <p className="text-xs text-slate-400">Log completed work hours directly</p>
              </div>
            </div>

            <form onSubmit={handleManualLog} className="space-y-3 mt-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Select Task
                </label>
                <select
                  value={manualTask}
                  onChange={(e) => setManualTask(e.target.value)}
                  className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                >
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.id}: {t.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Hours to Log
                </label>
                <input
                  type="number"
                  min={0.5}
                  max={24}
                  step={0.5}
                  value={manualHours}
                  onChange={(e) => setManualHours(Number(e.target.value))}
                  className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-bold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Work Notes / Remarks
                </label>
                <input
                  type="text"
                  value={manualNote}
                  onChange={(e) => setManualNote(e.target.value)}
                  placeholder="e.g. Completed unit test suite..."
                  className="w-full p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs transition-colors shadow-xs"
              >
                Submit Timesheet Hours
              </button>
            </form>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Your Monthly Total:</span>
              <span className="font-extrabold text-blue-600 dark:text-blue-400">
                {currentUser.hoursLoggedThisMonth} Hours Logged
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Analytics Charts: Focus Distribution & Leaderboard */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Productivity Score Leaderboard */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">
                Team Productivity Score Rankings
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Calculated by on-time completions, focus time, and low rework rates
              </p>
            </div>
            <Award className="w-5 h-5 text-amber-500" />
          </div>

          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={employeeProductivityData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis domain={[60, 100]} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderRadius: '10px',
                    borderColor: '#334155',
                    color: '#fff',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="score" name="Productivity Score (%)" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Daily Deep Work Focus Curve */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">
                Hourly Focus & Deep Work Concentration
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Deep work intensity vs meeting overhead throughout the day
              </p>
            </div>
            <Activity className="w-5 h-5 text-blue-500" />
          </div>

          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={focusDistributionData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderRadius: '10px',
                    borderColor: '#334155',
                    color: '#fff',
                    fontSize: '12px',
                  }}
                />
                <Area type="monotone" dataKey="focus" name="Deep Work (%)" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
                <Area type="monotone" dataKey="meetings" name="Meetings (%)" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Historical Sessions Stream */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-sm text-slate-900 dark:text-white">
            Logged Work Sessions Stream
          </h3>
          <span className="text-xs text-slate-400">
            {timeSessions.length} total logged sessions
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 font-bold uppercase text-[10px]">
                <th className="pb-3">User & Timestamp</th>
                <th className="pb-3">Deliverable / Task</th>
                <th className="pb-3">Session Category</th>
                <th className="pb-3">Duration</th>
                <th className="pb-3">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
              {timeSessions.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-3 pr-3 whitespace-nowrap">
                    <p className="font-bold text-slate-900 dark:text-white">{s.userName}</p>
                    <p className="text-[10px] text-slate-400">{s.startTime}</p>
                  </td>
                  <td className="py-3 pr-3">
                    <p className="font-semibold text-slate-800 dark:text-slate-200 line-clamp-1">
                      {s.taskTitle || 'General Focus Session'}
                    </p>
                  </td>
                  <td className="py-3 pr-3 whitespace-nowrap">
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-bold capitalize">
                      {s.type.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="py-3 pr-3 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                    {s.durationMinutes} mins ({(s.durationMinutes / 60).toFixed(1)}h)
                  </td>
                  <td className="py-3 text-slate-500 dark:text-slate-400 text-[11px]">
                    {s.notes || '—'}
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
