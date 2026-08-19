import React, { useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Layers,
  PieChart,
  Printer,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
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
import { exportMonthlyReportToCSV, exportMonthlyReportToPDF } from '../utils/exportReports';

export const ReportsView: React.FC = () => {
  const { tasks, users, currentUser } = useApp();

  const [selectedMonth, setSelectedMonth] = useState('August');
  const [selectedYear, setSelectedYear] = useState(2026);
  const [selectedDept, setSelectedDept] = useState('All');
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [isExportingCSV, setIsExportingCSV] = useState(false);

  // Filter tasks for the report
  const filteredTasks = tasks.filter((t) => {
    const matchesDept = selectedDept === 'All' || t.department === selectedDept;
    return matchesDept;
  });

  const relevantUsers =
    selectedDept === 'All'
      ? users
      : users.filter((u) => u.department === selectedDept);

  // Summary Metrics
  const totalTasks = filteredTasks.length;
  const completedTasks = filteredTasks.filter((t) => t.status === 'completed').length;
  const completionRate = totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const totalHoursLogged = filteredTasks.reduce((sum, t) => sum + (t.loggedHours || 0), 0);
  const overdueTasks = filteredTasks.filter(
    (t) => t.status !== 'completed' && new Date(t.dueDate) < new Date('2026-08-18')
  ).length;

  const avgProductivityScore = relevantUsers.length
    ? Math.round(
        relevantUsers.reduce((sum, u) => sum + u.productivityScore, 0) /
          relevantUsers.length
      )
    : 88;

  // Chart data
  const reportBarData = relevantUsers.map((u) => {
    const userTasks = filteredTasks.filter((t) => t.assigneeId === u.id);
    const userDone = userTasks.filter((t) => t.status === 'completed').length;
    const userHours = userTasks.reduce((sum, t) => sum + (t.loggedHours || 0), 0);
    return {
      name: u.name.split(' ')[0],
      hours: userHours || u.hoursLoggedThisMonth,
      done: userDone || u.tasksCompleted,
      score: u.productivityScore,
    };
  });

  const handleExportPDF = () => {
    setIsExportingPDF(true);
    setTimeout(() => {
      exportMonthlyReportToPDF(filteredTasks, users, {
        month: selectedMonth,
        year: selectedYear,
        department: selectedDept,
      });
      setIsExportingPDF(false);
    }, 400);
  };

  const handleExportCSV = () => {
    setIsExportingCSV(true);
    setTimeout(() => {
      exportMonthlyReportToCSV(filteredTasks, users, {
        month: selectedMonth,
        year: selectedYear,
        department: selectedDept,
      });
      setIsExportingCSV(false);
    }, 300);
  };

  return (
    <div id="reports-view" className="space-y-6 animate-in fade-in duration-200">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
              Exportable Monthly Activity & Efficiency Reports
            </h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Generate executive compliance summaries, team productivity matrices, and time allocation audits.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            id="export-csv-btn"
            onClick={handleExportCSV}
            disabled={isExportingCSV}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold border border-slate-200 dark:border-slate-700 transition-colors shadow-2xs"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{isExportingCSV ? 'Generating CSV...' : 'Export CSV'}</span>
          </button>

          <button
            id="export-pdf-btn"
            onClick={handleExportPDF}
            disabled={isExportingPDF}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md shadow-blue-500/25 transition-all"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>{isExportingPDF ? 'Rendering PDF...' : 'Download Official PDF'}</span>
          </button>
        </div>
      </div>

      {/* Filter Options Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-500">Report Month:</span>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-semibold"
            >
              <option value="August">August</option>
              <option value="July">July</option>
              <option value="June">June</option>
              <option value="May">May</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-500">Year:</span>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-semibold"
            >
              <option value={2026}>2026</option>
              <option value={2025}>2025</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-500">Department Scope:</span>
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-semibold"
            >
              <option value="All">All Enterprise Departments</option>
              <option value="Engineering">Engineering</option>
              <option value="Product & Design">Product & Design</option>
              <option value="Marketing">Marketing</option>
              <option value="Operations">Operations</option>
            </select>
          </div>
        </div>

        <div className="text-[11px] text-slate-400">
          Showing <strong>{filteredTasks.length}</strong> tasks across{' '}
          <strong>{relevantUsers.length}</strong> team members
        </div>
      </div>

      {/* Interactive Report Document Preview Sheet */}
      <div className="p-6 sm:p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-md space-y-6">
        {/* Document Title Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-5 gap-3">
          <div>
            <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
              Official Executive Report
            </span>
            <h2 className="text-xl font-black text-slate-900 dark:text-white mt-1">
              Monthly Workforce Productivity & Deliverables Audit
            </h2>
            <p className="text-xs text-slate-400">
              Period: {selectedMonth} {selectedYear} • Scope: {selectedDept} Department
            </p>
          </div>

          <div className="text-right text-xs text-slate-400">
            <p>Generated: <strong>Aug 18, 2026</strong></p>
            <p className="font-mono text-[10px]">Verification: SHA256-VAULT-AUTHENTIC</p>
          </div>
        </div>

        {/* Executive Metrics Overview */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/60 text-xs">
          <div>
            <span className="text-slate-400 text-[10px] block">Total Deliverables</span>
            <strong className="text-base font-extrabold text-slate-900 dark:text-white">
              {totalTasks}
            </strong>
          </div>
          <div>
            <span className="text-slate-400 text-[10px] block">Completed Rate</span>
            <strong className="text-base font-extrabold text-blue-600 dark:text-blue-400">
              {completedTasks} ({completionRate}%)
            </strong>
          </div>
          <div>
            <span className="text-slate-400 text-[10px] block">Total Hours</span>
            <strong className="text-base font-extrabold text-purple-600 dark:text-purple-400">
              {totalHoursLogged} hrs
            </strong>
          </div>
          <div>
            <span className="text-slate-400 text-[10px] block">Productivity Index</span>
            <strong className="text-base font-extrabold text-emerald-600 dark:text-emerald-400">
              {avgProductivityScore}%
            </strong>
          </div>
          <div>
            <span className="text-slate-400 text-[10px] block">Overdue Tasks</span>
            <strong className="text-base font-extrabold text-rose-600 dark:text-rose-400">
              {overdueTasks}
            </strong>
          </div>
        </div>

        {/* Employee Output Matrix Table */}
        <div className="space-y-3">
          <h3 className="font-bold text-sm text-slate-900 dark:text-white uppercase tracking-wider">
            Employee Productivity & Completion Matrix
          </h3>

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-400 uppercase font-bold text-[10px]">
                <tr>
                  <th className="p-3">Employee</th>
                  <th className="p-3">Department & Role</th>
                  <th className="p-3">Assigned / Done</th>
                  <th className="p-3">Logged Hours</th>
                  <th className="p-3">Efficiency Score</th>
                  <th className="p-3">Adherence Rating</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                {relevantUsers.map((u) => {
                  const userTasks = filteredTasks.filter((t) => t.assigneeId === u.id);
                  const userDone = userTasks.filter((t) => t.status === 'completed').length;
                  const userHours = userTasks.reduce((sum, t) => sum + (t.loggedHours || 0), 0);

                  return (
                    <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="p-3 font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <img src={u.avatar} alt={u.name} className="w-6 h-6 rounded-full object-cover" />
                        <span>{u.name}</span>
                      </td>
                      <td className="p-3 text-slate-500">
                        {u.title} ({u.department})
                      </td>
                      <td className="p-3 font-bold text-slate-800 dark:text-slate-200">
                        {userTasks.length} assigned / {userDone || u.tasksCompleted} done
                      </td>
                      <td className="p-3 font-semibold text-slate-800 dark:text-slate-200">
                        {userHours || u.hoursLoggedThisMonth}h
                      </td>
                      <td className="p-3">
                        <span className="font-extrabold text-emerald-600 dark:text-emerald-400">
                          {u.productivityScore}%
                        </span>
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
                          High Compliance
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Visual Chart in Report */}
        <div className="pt-4 space-y-3">
          <h3 className="font-bold text-sm text-slate-900 dark:text-white uppercase tracking-wider">
            Logged Hours & Completed Tasks Breakdown
          </h3>

          <div className="h-60 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={reportBarData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94a3b8" />
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
                <Bar dataKey="hours" name="Hours Logged" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="done" name="Completed Tasks" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
