import React, { useState } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Lock,
  MessageSquare,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  User,
  Users,
  XCircle,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Task } from '../types';

export const ApprovalsView: React.FC<{ onOpenTaskModal: (task: Task) => void }> = ({
  onOpenTaskModal,
}) => {
  const { tasks, currentUser, approveOrRejectTask, triggerSlackNotification } = useApp();

  const [decisionModal, setDecisionModal] = useState<{
    isOpen: boolean;
    task?: Task;
    decision?: 'approved' | 'rejected';
    comment: string;
  }>({
    isOpen: false,
    comment: '',
  });

  const pendingTasks = tasks.filter(
    (t) => t.status === 'pending_approval' || t.approvalStatus === 'pending'
  );

  const processedTasks = tasks.filter(
    (t) => t.approvalStatus === 'approved' || t.approvalStatus === 'rejected'
  );

  const handleOpenDecision = (task: Task, decision: 'approved' | 'rejected') => {
    setDecisionModal({
      isOpen: true,
      task,
      decision,
      comment: decision === 'approved' ? 'Meets all compliance benchmarks and acceptance tests.' : 'Requires revision: please check edge cases.',
    });
  };

  const handleConfirmDecision = async () => {
    if (!decisionModal.task || !decisionModal.decision) return;
    await approveOrRejectTask(
      decisionModal.task.id,
      decisionModal.decision,
      decisionModal.comment
    );
    setDecisionModal({ isOpen: false, comment: '' });
  };

  return (
    <div id="approvals-view" className="space-y-6 animate-in fade-in duration-200">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
              Dept Head & Manager Sign-off Center
            </h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300">
              {pendingTasks.length} Pending
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Review completed work, authorize production deployments, and automatically notify assignees via Slack.
          </p>
        </div>

        <div className="text-right hidden sm:block">
          <span className="text-xs font-semibold text-slate-400">Authorized Reviewer:</span>
          <p className="text-xs font-bold text-slate-900 dark:text-white">
            {currentUser.name} ({currentUser.role.replace('_', ' ').toUpperCase()})
          </p>
        </div>
      </div>

      {/* Pending Approvals Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-500" />
            Awaiting Manager / Dept Head Action
          </h2>
          <span className="text-xs text-slate-400">
            {pendingTasks.length} submissions pending
          </span>
        </div>

        {pendingTasks.length === 0 ? (
          <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-2">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">
              All Clear! No Pending Approvals
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              All deliverables submitted by contributors have been signed off.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pendingTasks.map((task) => (
              <div
                key={task.id}
                className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/60 shadow-xs flex flex-col justify-between space-y-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-slate-400">
                      {task.id}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                      Requires Sign-off
                    </span>
                  </div>

                  <h3
                    onClick={() => onOpenTaskModal(task)}
                    className="font-bold text-sm text-slate-900 dark:text-white hover:text-blue-600 cursor-pointer transition-colors"
                  >
                    {task.title}
                  </h3>

                  <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                    {task.description}
                  </p>

                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-xs space-y-1.5 border border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                      <span>Submitted By:</span>
                      <strong className="text-slate-900 dark:text-white">{task.assigneeName}</strong>
                    </div>
                    <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                      <span>Department:</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-300">{task.department}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                      <span>Progress & Hours:</span>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {task.progress}% ({task.loggedHours || 0} / {task.estimatedHours} hrs)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Decision Actions */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                  <button
                    onClick={() => onOpenTaskModal(task)}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                  >
                    Inspect Details →
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      id={`reject-btn-${task.id}`}
                      onClick={() => handleOpenDecision(task, 'rejected')}
                      className="px-3 py-1.5 rounded-xl border border-red-200 dark:border-red-800/80 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-xs font-bold transition-colors flex items-center gap-1"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>

                    <button
                      id={`approve-btn-${task.id}`}
                      onClick={() => handleOpenDecision(task, 'approved')}
                      className="px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-md shadow-emerald-500/20 transition-all flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Approve & Complete</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* History of Processed Approvals */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
          <Shield className="w-4 h-4 text-blue-500" />
          Approval Audit History ({processedTasks.length})
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-400 font-bold uppercase text-[10px]">
                <th className="pb-3">Task & Dept</th>
                <th className="pb-3">Assignee</th>
                <th className="pb-3">Decision</th>
                <th className="pb-3">Approved / Reviewed By</th>
                <th className="pb-3">Timestamp</th>
                <th className="pb-3 text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
              {processedTasks.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-3 pr-3">
                    <p className="font-bold text-slate-900 dark:text-white">{t.title}</p>
                    <p className="text-[10px] text-slate-400">{t.department} • {t.id}</p>
                  </td>

                  <td className="py-3 pr-3">{t.assigneeName}</td>

                  <td className="py-3 pr-3 whitespace-nowrap">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                        t.approvalStatus === 'approved'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                      }`}
                    >
                      {t.approvalStatus}
                    </span>
                  </td>

                  <td className="py-3 pr-3 font-semibold text-slate-800 dark:text-slate-200">
                    {t.approvedByName || 'Dr. Sarah Lin (Dept Head)'}
                  </td>

                  <td className="py-3 pr-3 text-slate-400 whitespace-nowrap">
                    {t.approvalDate || '2026-08-16 14:30'}
                  </td>

                  <td className="py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => onOpenTaskModal(t)}
                      className="p-1 text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      View →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Decision Confirmation Modal */}
      {decisionModal.isOpen && decisionModal.task && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl p-5 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-xl text-white ${
                  decisionModal.decision === 'approved' ? 'bg-emerald-600' : 'bg-red-600'
                }`}
              >
                {decisionModal.decision === 'approved' ? (
                  <CheckCircle2 className="w-5 h-5" />
                ) : (
                  <XCircle className="w-5 h-5" />
                )}
              </div>
              <div>
                <h3 className="font-bold text-base text-slate-900 dark:text-white capitalize">
                  {decisionModal.decision} Sign-off
                </h3>
                <p className="text-xs text-slate-400">{decisionModal.task.id}</p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Official Reviewer Remark & Audit Note
              </label>
              <textarea
                rows={3}
                value={decisionModal.comment}
                onChange={(e) =>
                  setDecisionModal((prev) => ({ ...prev, comment: e.target.value }))
                }
                className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setDecisionModal({ isOpen: false, comment: '' })}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDecision}
                className={`px-4 py-2 rounded-xl text-xs font-bold text-white shadow-md ${
                  decisionModal.decision === 'approved'
                    ? 'bg-emerald-600 hover:bg-emerald-500'
                    : 'bg-red-600 hover:bg-red-500'
                }`}
              >
                Confirm Decision & Broadcast
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
