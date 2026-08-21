import React, { useState, useEffect } from 'react';
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Eye,
  EyeOff,
  Flame,
  HelpCircle,
  Key,
  Layers,
  Lock,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
  Shield,
  Sparkles,
  Tag,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Department, Task, TaskPriority, TaskStatus } from '../types';
import { calculateTaskPriority } from '../utils/prioritization';

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskToEdit?: Task | null;
}

export const TaskModal: React.FC<TaskModalProps> = ({
  isOpen,
  onClose,
  taskToEdit,
}) => {
  const {
    users,
    currentUser,
    createTask,
    updateTask,
    deleteTask,
    addRemarkToTask,
    submitTaskForApproval,
    approveOrRejectTask,
    triggerSlackNotification,
  } = useApp();

  const isEditing = !!taskToEdit;

  // Form states
  const [title, setTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [description, setDescription] = useState('');
  const [department, setDepartment] = useState<Department>('Engineering');
  const [assigneeId, setAssigneeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [estimatedHours, setEstimatedHours] = useState<number>(16);
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [progress, setProgress] = useState<number>(0);
  const [tagsInput, setTagsInput] = useState('Core, Roadmap');
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [remarksText, setRemarksText] = useState('');

  // New remark state in edit mode
  const [newRemark, setNewRemark] = useState('');
  const [remarkEncrypted, setRemarkEncrypted] = useState(false);
  const [revealedRemarks, setRevealedRemarks] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (taskToEdit) {
      setTitle(taskToEdit.title);
      setDescription(taskToEdit.description);
      setDepartment(taskToEdit.department);
      setAssigneeId(taskToEdit.assigneeId);
      setStartDate(taskToEdit.startDate);
      setDueDate(taskToEdit.dueDate);
      setEstimatedHours(taskToEdit.estimatedHours || 10);
      setPriority(taskToEdit.priority);
      setStatus(taskToEdit.status);
      setProgress(taskToEdit.progress || 0);
      setTagsInput(taskToEdit.tags?.join(', ') || '');
      setIsEncrypted(taskToEdit.isEncrypted || false);
      setRemarksText('');
    } else {
      // Create defaults
      setTitle('');
      setDescription('');
      setDepartment(currentUser.department || 'Engineering');
      setAssigneeId(users[0]?.id || '');
      setStartDate(new Date().toISOString().split('T')[0]);
      setDueDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
      setEstimatedHours(16);
      setPriority('medium');
      setStatus('todo');
      setProgress(0);
      setTagsInput('Sprint-Q3, Core');
      setIsEncrypted(false);
      setRemarksText('');
    }
  }, [taskToEdit, isOpen, currentUser, users]);

  if (!isOpen) return null;

  // Real-time calculated priority score preview
  const priorityPreview = calculateTaskPriority(
    {
      dueDate,
      estimatedHours,
      loggedHours: taskToEdit?.loggedHours || 0,
      progress,
      status,
      priority,
    },
    new Date()
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || isSubmitting) return;
    setIsSubmitting(true);

    try {
      const assignee = users.find((u) => u.id === assigneeId) || users[0];
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      if (isEditing && taskToEdit) {
        await updateTask(
          taskToEdit.id,
          {
            title,
            description,
            department,
            assigneeId: assignee.id,
            assigneeName: assignee.name,
            assigneeAvatar: assignee.avatar,
            startDate,
            dueDate,
            estimatedHours: Number(estimatedHours),
            priority,
            status,
            progress: Number(progress),
            tags,
            isEncrypted,
          },
          'Updated task attributes'
        );
      } else {
        await createTask({
          title,
          description,
          department,
          assigneeId: assignee.id,
          assigneeName: assignee.name,
          assigneeAvatar: assignee.avatar,
          startDate,
          dueDate,
          estimatedHours: Number(estimatedHours),
          priority,
          status,
          progress: Number(progress),
          tags,
          remarksText,
          isEncrypted,
        });
      }

      onClose();
    } catch {
      // updateTask/createTask already showed an error toast — just keep
      // the modal open with isSubmitting reset so the user can retry.
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddRemark = async () => {
    if (!newRemark.trim() || !taskToEdit) return;
    await addRemarkToTask(taskToEdit.id, newRemark.trim(), remarkEncrypted);
    setNewRemark('');
  };

  const toggleReveal = (remarkId: string) => {
    setRevealedRemarks((prev) => ({ ...prev, [remarkId]: !prev[remarkId] }));
  };

  return (
    <div
      id="task-modal-backdrop"
      className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="task-modal-card"
        className="w-full max-w-3xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden my-6 animate-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-600 text-white shadow-xs">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                  {isEditing ? `Task: ${taskToEdit.id}` : 'Delegate New Task (Dept Head)'}
                </h2>
                {isEncrypted && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 flex items-center gap-1">
                    <Lock className="w-3 h-3" /> Confidential
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isEditing
                  ? `Assigned by ${taskToEdit.createdByName}`
                  : 'Automated urgency score & Slack broadcast on delegation'}
              </p>
            </div>
          </div>

          <button
            id="close-task-modal-btn"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
          {/* Automated Prioritization Alert Strip */}
          <div className="p-3.5 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/40 dark:to-indigo-950/30 border border-blue-200 dark:border-blue-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-blue-600 text-white">
                <Flame className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    Auto-Prioritization Engine:
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-extrabold uppercase bg-blue-600 text-white">
                    {priorityPreview.recommendedPriority} ({priorityPreview.score}/100)
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300">
                  {priorityPreview.reason}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setPriority(priorityPreview.recommendedPriority)}
              className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 text-[11px] font-bold text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700 hover:bg-blue-50 transition-colors whitespace-nowrap shadow-2xs"
            >
              Apply Recommended
            </button>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Task Title *
            </label>
            <input
              id="task-title-input"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Implement Distributed Tracing & OpenTelemetry"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
              Detailed Deliverables & Scope
            </label>
            <textarea
              id="task-description-input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide exact milestones, test criteria, and department expectations..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          {/* Row: Department & Assignee */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Department
              </label>
              <select
                id="task-department-select"
                value={department}
                onChange={(e) => setDepartment(e.target.value as Department)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value="Engineering">Engineering</option>
                <option value="Product & Design">Product & Design</option>
                <option value="Marketing">Marketing</option>
                <option value="Operations">Operations</option>
                <option value="Human Resources">Human Resources</option>
                <option value="Sales & Growth">Sales & Growth</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Assignee (Employee / Team Member)
              </label>
              <select
                id="task-assignee-select"
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.title} - {u.department})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row: Start Date, Due Date, Est. Hours */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Start Date
              </label>
              <input
                id="task-start-date-input"
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Due Date (Deadline) *
              </label>
              <input
                id="task-due-date-input"
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Est. Hours
              </label>
              <input
                id="task-estimated-hours-input"
                type="number"
                min={1}
                max={200}
                value={estimatedHours}
                onChange={(e) => setEstimatedHours(Number(e.target.value))}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Row: Priority & Status & Progress */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Priority Tier
              </label>
              <select
                id="task-priority-select"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none font-semibold"
              >
                <option value="low">Low (Standard)</option>
                <option value="medium">Medium</option>
                <option value="high">High (Elevated)</option>
                <option value="critical">Critical (P0 Escalation)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Status
              </label>
              <select
                id="task-status-select"
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none font-semibold"
              >
                <option value="todo">To Do / Backlog</option>
                <option value="in_progress">In Progress</option>
                <option value="in_review">In Review</option>
                <option value="pending_approval">Pending Approval</option>
                <option value="completed">Completed</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Progress: {progress}%
              </label>
              <input
                id="task-progress-slider"
                type="range"
                min={0}
                max={100}
                step={5}
                value={progress}
                onChange={(e) => setProgress(Number(e.target.value))}
                className="w-full accent-blue-600 mt-2"
              />
            </div>
          </div>

          {/* Tags & Security switch */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Tags (Comma separated)
              </label>
              <input
                id="task-tags-input"
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="e.g. SOC2, Security, API"
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="text-xs font-bold text-slate-900 dark:text-white">
                    Mark as Confidential
                  </p>
                  <p className="text-[10px] text-slate-400">
                    Masks this remark in the UI until someone clicks Reveal
                  </p>
                </div>
              </div>
              <input
                id="task-encryption-checkbox"
                type="checkbox"
                checked={isEncrypted}
                onChange={(e) => setIsEncrypted(e.target.checked)}
                className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* If creating new task: initial remarks */}
          {!isEditing && (
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Initial Dept Head Remarks / Instructions
              </label>
              <textarea
                id="task-initial-remarks-input"
                rows={2}
                value={remarksText}
                onChange={(e) => setRemarksText(e.target.value)}
                placeholder="Add confidential or general operational remarks..."
                className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            </div>
          )}

          {/* Remarks Thread in Edit Mode */}
          {isEditing && taskToEdit && (
            <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-blue-500" />
                  Audit & Remarks Trail ({taskToEdit.remarks?.length || 0})
                </h3>
                <span className="text-[10px] text-slate-400">
                  Signed Audit Log
                </span>
              </div>

              <div className="space-y-2 max-h-44 overflow-y-auto">
                {(!taskToEdit.remarks || taskToEdit.remarks.length === 0) && (
                  <p className="text-xs text-slate-400 italic">No remarks appended yet.</p>
                )}
                {taskToEdit.remarks?.map((rem) => {
                  const isConfidential = rem.isEncrypted;
                  const isRevealed = revealedRemarks[rem.id];
                  const displayedText = rem.text;

                  return (
                    <div
                      key={rem.id}
                      className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <img
                            src={rem.authorAvatar}
                            alt={rem.authorName}
                            className="w-4 h-4 rounded-full object-cover"
                          />
                          <span className="font-bold text-slate-900 dark:text-white">
                            {rem.authorName}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            ({rem.authorRole.toUpperCase()})
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {isConfidential && (
                            <button
                              type="button"
                              onClick={() => toggleReveal(rem.id)}
                              className="text-[10px] font-bold text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1"
                            >
                              {isRevealed ? (
                                <>
                                  <EyeOff className="w-3 h-3" /> Hide
                                </>
                              ) : (
                                <>
                                  <Eye className="w-3 h-3" /> Reveal
                                </>
                              )}
                            </button>
                          )}
                          <span className="text-[10px] text-slate-400">{rem.timestamp}</span>
                        </div>
                      </div>

                      <p className="text-slate-700 dark:text-slate-300 font-mono text-[11px]">
                        {isConfidential && !isRevealed
                          ? '•••• Confidential remark — click Reveal to view ••••'
                          : displayedText}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Add New Remark Box */}
              <div className="flex items-center gap-2 pt-2">
                <input
                  id="add-remark-input"
                  type="text"
                  value={newRemark}
                  onChange={(e) => setNewRemark(e.target.value)}
                  placeholder="Append progress update or operational remark..."
                  className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />

                <label
                  className="flex items-center gap-1 text-[11px] font-medium text-slate-500 cursor-pointer select-none"
                  title="Mark as confidential (masked until revealed)"
                >
                  <input
                    type="checkbox"
                    checked={remarkEncrypted}
                    onChange={(e) => setRemarkEncrypted(e.target.checked)}
                    className="rounded text-emerald-600"
                  />
                  <Lock className="w-3 h-3 text-emerald-500" />
                </label>

                <button
                  type="button"
                  id="submit-remark-btn"
                  onClick={handleAddRemark}
                  disabled={!newRemark.trim()}
                  className="px-3 py-2 rounded-xl bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  Post
                </button>
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            {isEditing && taskToEdit ? (
              <div className="flex items-center gap-2">
                {currentUser.role !== 'staff' && (
                  <button
                    type="button"
                    id="delete-task-btn"
                    onClick={() => {
                      if (confirm(`Delete task ${taskToEdit.id}?`)) {
                        deleteTask(taskToEdit.id);
                        onClose();
                      }
                    }}
                    className="p-2 rounded-xl text-red-600 hover:bg-red-50 dark:hover:bg-red-950/50 text-xs font-semibold flex items-center gap-1 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Delete</span>
                  </button>
                )}

                <button
                  type="button"
                  id="modal-slack-ping-btn"
                  onClick={() => triggerSlackNotification('deadline_alert', taskToEdit)}
                  className="px-3 py-2 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 font-bold text-xs hover:bg-purple-100 flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Ping Slack</span>
                </button>
              </div>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                id="cancel-modal-btn"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="submit"
                id="save-task-modal-btn"
                disabled={isSubmitting}
                className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-500/25 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting ? 'Saving…' : isEditing ? 'Save Changes' : 'Delegate & Broadcast Task'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
