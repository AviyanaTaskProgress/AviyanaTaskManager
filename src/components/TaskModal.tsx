import React, { useState, useEffect } from 'react';
import {
  AlarmClock,
  CheckCircle2,
  Circle,
  CreditCard,
  Eye,
  EyeOff,
  Layers,
  ListChecks,
  Lock,
  MessageSquare,
  Paperclip,
  Plus,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Department, Task, TaskPriority, TaskStatus } from '../types';
import { uploadTaskFile, MAX_UPLOAD_BYTES } from '../lib/storage';
import { showToast } from '../lib/toast';
import { shouldStampCompletedDate, todayDateString } from '../lib/taskStatus';
import { ConfirmDialog } from './ConfirmDialog';
import {
  canDeleteTask as canDeleteTaskCheck,
  canRingAlarm as canRingAlarmCheck,
  canConfirmPayment as canConfirmPaymentCheck,
  isSelfLoggedTask,
  isDepartmentLockedForRole,
  isAssigneePickerHiddenForRole,
  isAssignedByRequiredForRole,
} from '../lib/taskPermissions';

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskToEdit?: Task | null;
}

// Staged file/link during CREATE mode — the real task_attachments row
// can't be inserted until the task itself has an id, so these are held
// in memory and flushed right after createTask() returns.
interface PendingAttachment {
  key: string;
  kind: 'file' | 'link';
  file?: File;
  url?: string;
  label: string;
}

// Staged checklist step during CREATE mode — flushed the same way,
// right after the task gets its id.
interface PendingSubtask {
  key: string;
  title: string;
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
    addAttachmentToTask,
    deleteAttachmentFromTask,
    addSubtaskToTask,
    setSubtaskCompletion,
    deleteSubtaskFromTask,
    confirmTaskPayment,
    ringTaskAlarm,
    triggerSlackNotification,
    discussTask,
    departments,
    notifications,
    markNotificationAsRead,
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
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [progress, setProgress] = useState<number>(0);
  const [tagsInput, setTagsInput] = useState('Core, Roadmap');
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [remarksText, setRemarksText] = useState('');
  const [requiresPayment, setRequiresPayment] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [assignedById, setAssignedById] = useState<string>('');

  // New remark state in edit mode
  const [newRemark, setNewRemark] = useState('');
  const [remarkEncrypted, setRemarkEncrypted] = useState(false);
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkLabel, setNewLinkLabel] = useState('');
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [revealedRemarks, setRevealedRemarks] = useState<Record<string, boolean>>({});
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [isAddingSubtask, setIsAddingSubtask] = useState(false);
  const [isConfirmingPayment, setIsConfirmingPayment] = useState(false);
  const [paymentConfirmNotes, setPaymentConfirmNotes] = useState('');
  const [showPaymentConfirmBox, setShowPaymentConfirmBox] = useState(false);
  const [isRingingAlarm, setIsRingingAlarm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRingConfirm, setShowRingConfirm] = useState(false);

  // Staged (not-yet-saved) attachments/subtasks — CREATE mode only.
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [pendingSubtasks, setPendingSubtasks] = useState<PendingSubtask[]>([]);

  // A self-logged task is one where the assignee is also the creator —
  // that's the only case the "who actually assigned this?" selector
  // makes sense for (see 30_assigned_by_and_completed_counter.sql).
  const isSelfLogged = isEditing && taskToEdit ? isSelfLoggedTask(taskToEdit) : assigneeId === currentUser.id;

  // Candidates for "who assigned this?" — people who could plausibly
  // have instructed the task: dept heads / chief officer / super admin
  // in the same department, excluding the person logging it themselves.
  const assignedByCandidates = users.filter(
    (u) => u.id !== currentUser.id && ['dept_head', 'chief_officer', 'super_admin'].includes(u.role) && (u.department === department || u.role !== 'dept_head')
  );

  // Role-based access review (2026-09):
  // - Staff can only ever log a task for themselves — no assignee
  //   picker, no department picker, both locked to their own values
  //   (mirrors tasks_insert RLS: 31_staff_self_log_tasks.sql only
  //   allows assignee_id = created_by_id = self for a staff row).
  // - Dept Head can only assign within their own department — the
  //   department field is locked, and the assignee list only shows
  //   people in that one department (tasks_insert RLS already only
  //   allows a dept_head to insert into their own department, so this
  //   mirrors that rather than fighting it in the UI).
  // - Super Admin / Chief Officer can pick ANY department (both now
  //   allowed cross-department by tasks_insert RLS — see
  //   32_chief_officer_cross_dept_tasks.sql) and the assignee list
  //   reactively narrows to whichever department is currently selected,
  //   instead of showing the entire company in one flat list.
  const isDepartmentLocked = isDepartmentLockedForRole(currentUser.role);
  const isAssigneePickerHidden = isAssigneePickerHiddenForRole(currentUser.role);
  const visibleAssigneeUsers =
    currentUser.role === 'staff'
      ? users.filter((u) => u.id === currentUser.id)
      : currentUser.role === 'dept_head'
      ? users.filter((u) => u.department === currentUser.department)
      : users.filter((u) => u.department === department);

  // Staff must record who actually instructed a self-logged task (it's
  // always self-logged for them) — everyone else keeps this optional.
  const assignedByRequired = isAssignedByRequiredForRole(currentUser.role);

  // "Ring Alarm" — upper-level-only (33_task_reminders_and_alarms.sql
  // enforces the same check server-side; this just avoids showing a
  // button that would predictably fail). Hidden for a task already
  // completed, and for ringing yourself.
  const canRingAlarm = canRingAlarmCheck(currentUser, isEditing ? taskToEdit : null);

  // Mirrors tasks_delete RLS exactly (34_audit_fixes_delete_policy_and_search_path.sql)
  // — previously this button showed for anyone who wasn't Staff, but
  // the table never actually had a DELETE policy at all (a pre-existing
  // bug this audit found: the delete silently matched 0 rows for every
  // role, including Super Admin, while the UI still claimed success).
  // Now that a real policy exists, the button should only appear when
  // it will actually work.
  const canDeleteTask = canDeleteTaskCheck(currentUser, isEditing ? taskToEdit : null);

  // Subtasks drive auto-progress once any exist (server-side trigger —
  // see 27_task_subtasks.sql) — the manual slider is disabled in that
  // case so the UI can't show a value that's about to be overwritten.
  const hasLiveSubtasks = isEditing && !!taskToEdit && taskToEdit.subtasks.length > 0;
  const hasPendingSubtasks = !isEditing && pendingSubtasks.length > 0;
  const progressIsAuto = hasLiveSubtasks || hasPendingSubtasks;


  useEffect(() => {
    if (taskToEdit) {
      setTitle(taskToEdit.title);
      setDescription(taskToEdit.description);
      setDepartment(taskToEdit.department);
      setAssigneeId(taskToEdit.assigneeId);
      setStartDate(taskToEdit.startDate);
      setDueDate(taskToEdit.dueDate);
      setPriority(taskToEdit.priority);
      setStatus(taskToEdit.status);
      setProgress(taskToEdit.progress || 0);
      setTagsInput(taskToEdit.tags?.join(', ') || '');
      setIsEncrypted(taskToEdit.isEncrypted || false);
      setRemarksText('');
      setRequiresPayment(taskToEdit.requiresPayment);
      setPaymentAmount(taskToEdit.paymentAmount != null ? String(taskToEdit.paymentAmount) : '');
      setAssignedById(taskToEdit.assignedById || '');
      setPendingAttachments([]);
      setPendingSubtasks([]);
      setShowPaymentConfirmBox(false);
      setPaymentConfirmNotes('');
      setShowDeleteConfirm(false);
      setShowRingConfirm(false);
    } else {
      // Create defaults
      setTitle('');
      setDescription('');
      const defaultDept = currentUser.department || 'Engineering';
      setDepartment(defaultDept);
      const defaultAssigneePool =
        currentUser.role === 'staff'
          ? [currentUser]
          : currentUser.role === 'dept_head'
          ? users.filter((u) => u.department === currentUser.department)
          : users.filter((u) => u.department === defaultDept);
      setAssigneeId(currentUser.role === 'staff' ? currentUser.id : defaultAssigneePool[0]?.id || users[0]?.id || '');
      setStartDate(new Date().toISOString().split('T')[0]);
      setDueDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
      setPriority('medium');
      setStatus('todo');
      setProgress(0);
      setTagsInput('Sprint-Q3, Core');
      setIsEncrypted(false);
      setRemarksText('');
      setRequiresPayment(false);
      setPaymentAmount('');
      setAssignedById('');
      setPendingAttachments([]);
      setPendingSubtasks([]);
    }
  }, [taskToEdit, isOpen, currentUser, users]);

  // Super Admin / Chief Officer picking a different department should
  // reactively narrow the assignee list to that department — if the
  // currently-picked assignee doesn't belong to it anymore, fall back
  // to the first person who does rather than silently keeping a
  // mismatched selection. No-op for Staff/Dept Head, whose department
  // is locked anyway.
  useEffect(() => {
    if (currentUser.role === 'staff' || currentUser.role === 'dept_head') return;
    const stillValid = users.some((u) => u.id === assigneeId && u.department === department);
    if (!stillValid) {
      const firstInDept = users.find((u) => u.department === department);
      if (firstInDept) setAssigneeId(firstInDept.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [department]);

  // Opening a task with an unacknowledged alarm addressed to the
  // current user IS the acknowledgement — see AlarmSiren.tsx / item #3
  // of the reminder plan ("turns off once they open and see the
  // task", deliberately no separate snooze/dismiss).
  useEffect(() => {
    if (!taskToEdit) return;
    const unreadAlarms = notifications.filter((n) => n.type === 'alarm' && !n.read && n.taskId === taskToEdit.id);
    unreadAlarms.forEach((n) => {
      markNotificationAsRead(n.id).catch(() => {
        // markNotificationAsRead already shows its own error toast.
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskToEdit?.id]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || isSubmitting) return;
    if (isSelfLogged && assignedByRequired && !assignedById) {
      showToast('error', 'Please select who assigned you this task.');
      return;
    }
    setIsSubmitting(true);

    try {
      const assignee = users.find((u) => u.id === assigneeId) || users[0];
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const parsedAmount = paymentAmount.trim() ? Number(paymentAmount) : undefined;

      if (isEditing && taskToEdit) {
        // Mirror TasksView's drag-to-Completed behavior: stamp completedDate
        // the moment status flips to 'completed' via this form too — this
        // was previously only set on the Kanban drag path, so a task marked
        // done from this dropdown had no completion date at all (it fell
        // back to showing the due date instead, which is misleading).
        const justCompleted = shouldStampCompletedDate(status, taskToEdit.status);
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
            priority,
            status,
            progress: Number(progress),
            tags,
            isEncrypted,
            requiresPayment,
            paymentAmount: requiresPayment ? parsedAmount : undefined,
            assignedById: isSelfLogged ? (assignedById || undefined) : undefined,
            ...(justCompleted ? { completedDate: todayDateString() } : {}),
          },
          'Updated task attributes'
        );
      } else {
        const newTaskId = await createTask({
          title,
          description,
          department,
          assigneeId: assignee.id,
          assigneeName: assignee.name,
          assigneeAvatar: assignee.avatar,
          startDate,
          dueDate,
          priority,
          status,
          progress: Number(progress),
          tags,
          remarksText,
          isEncrypted,
          requiresPayment,
          paymentAmount: requiresPayment ? parsedAmount : undefined,
          assignedById: isSelfLogged ? (assignedById || undefined) : undefined,
        });

        // Flush anything staged before the task had an id — files
        // upload first (they need the real task id for the storage
        // path), then links, then checklist steps. Best-effort: a
        // failure here doesn't roll back the task itself, since it's
        // already saved and visible; the person can just re-add from
        // the Edit view.
        for (const pending of pendingAttachments) {
          try {
            if (pending.kind === 'file' && pending.file) {
              const { url } = await uploadTaskFile(newTaskId, pending.file);
              await addAttachmentToTask(newTaskId, {
                kind: 'file',
                url,
                fileName: pending.file.name,
                fileSize: pending.file.size,
                mimeType: pending.file.type,
              });
            } else if (pending.kind === 'link' && pending.url) {
              await addAttachmentToTask(newTaskId, { kind: 'link', url: pending.url, fileName: pending.label });
            }
          } catch {
            showToast('error', `Task saved, but "${pending.label}" couldn't be attached — add it from Edit.`);
          }
        }
        for (const pending of pendingSubtasks) {
          try {
            await addSubtaskToTask(newTaskId, pending.title);
          } catch {
            showToast('error', `Task saved, but the step "${pending.title}" couldn't be added — add it from Edit.`);
          }
        }
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

  const handleFileAttach = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      showToast('error', 'File is too large (25MB max).');
      return;
    }
    if (isEditing && taskToEdit) {
      setIsUploadingFile(true);
      try {
        const { url } = await uploadTaskFile(taskToEdit.id, file);
        await addAttachmentToTask(taskToEdit.id, {
          kind: 'file',
          url,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
        });
      } catch {
        // uploadTaskFile/addAttachmentToTask already show their own error toasts.
      } finally {
        setIsUploadingFile(false);
      }
    } else {
      // No task id yet — stage it, flushed right after createTask() in handleSubmit.
      setPendingAttachments((prev) => [...prev, { key: crypto.randomUUID(), kind: 'file', file, label: file.name }]);
    }
  };

  const handleLinkAttach = async () => {
    if (!newLinkUrl.trim() || isAddingLink) return;
    if (isEditing && taskToEdit) {
      setIsAddingLink(true);
      try {
        await addAttachmentToTask(taskToEdit.id, {
          kind: 'link',
          url: newLinkUrl.trim(),
          fileName: newLinkLabel.trim() || newLinkUrl.trim(),
        });
        setNewLinkUrl('');
        setNewLinkLabel('');
      } catch {
        // addAttachmentToTask already shows its own error toast.
      } finally {
        setIsAddingLink(false);
      }
    } else {
      setPendingAttachments((prev) => [
        ...prev,
        { key: crypto.randomUUID(), kind: 'link', url: newLinkUrl.trim(), label: newLinkLabel.trim() || newLinkUrl.trim() },
      ]);
      setNewLinkUrl('');
      setNewLinkLabel('');
    }
  };

  const removePendingAttachment = (key: string) => {
    setPendingAttachments((prev) => prev.filter((p) => p.key !== key));
  };

  const handleAddSubtask = async () => {
    if (!newSubtaskTitle.trim()) return;
    if (isEditing && taskToEdit) {
      const isFirstSubtask = taskToEdit.subtasks.length === 0;
      setIsAddingSubtask(true);
      try {
        await addSubtaskToTask(taskToEdit.id, newSubtaskTitle.trim());
        setNewSubtaskTitle('');
        // The moment a task gets its first subtask, progress switches
        // from manual to auto-calculated server-side (27_task_subtasks.sql)
        // — flagged clearly here since it silently overrides whatever
        // manual value was set before, which otherwise reads like a bug.
        if (isFirstSubtask) {
          showToast('success', 'Progress now tracks your checklist automatically — the manual slider is off.');
        }
      } catch {
        // addSubtaskToTask already shows its own error toast.
      } finally {
        setIsAddingSubtask(false);
      }
    } else {
      const isFirstPending = pendingSubtasks.length === 0;
      setPendingSubtasks((prev) => [...prev, { key: crypto.randomUUID(), title: newSubtaskTitle.trim() }]);
      setNewSubtaskTitle('');
      if (isFirstPending) {
        showToast('success', 'Progress will track this checklist automatically once saved.');
      }
    }
  };

  const removePendingSubtask = (key: string) => {
    setPendingSubtasks((prev) => prev.filter((p) => p.key !== key));
  };

  const canConfirmPayment = canConfirmPaymentCheck(currentUser);

  const handleConfirmPayment = async () => {
    if (!taskToEdit || isConfirmingPayment) return;
    setIsConfirmingPayment(true);
    try {
      await confirmTaskPayment(taskToEdit.id, paymentConfirmNotes.trim() || undefined);
      setShowPaymentConfirmBox(false);
      setPaymentConfirmNotes('');
    } catch {
      // confirmTaskPayment already shows its own error toast.
    } finally {
      setIsConfirmingPayment(false);
    }
  };

  const toggleReveal = (remarkId: string) => {
    setRevealedRemarks((prev) => ({ ...prev, [remarkId]: !prev[remarkId] }));
  };

  const handleDiscussTask = async () => {
    if (!taskToEdit) return;
    await discussTask(taskToEdit);
    onClose();
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
                  {isEditing ? `Task: ${taskToEdit.taskDisplayId}` : 'Delegate New Task (Dept Head)'}
                </h2>
                {isEncrypted && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 flex items-center gap-1">
                    <Lock className="w-3 h-3" /> Confidential
                  </span>
                )}
                {isEditing && taskToEdit.requiresPayment && (
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 ${
                      taskToEdit.paymentStatus === 'paid'
                        ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                        : 'bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300'
                    }`}
                  >
                    <CreditCard className="w-3 h-3" />
                    {taskToEdit.paymentStatus === 'paid' ? 'Paid' : 'Payment Pending'}
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

          <div className="flex items-center gap-1.5">
            {isEditing && taskToEdit && taskToEdit.assigneeId !== currentUser.id && (
              <button
                id="discuss-task-btn"
                type="button"
                onClick={handleDiscussTask}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 hover:bg-blue-100 transition-colors"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Discuss this task
              </button>
            )}
            <button
              id="close-task-modal-btn"
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
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
              {isDepartmentLocked ? (
                <div className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 text-sm">
                  {department}
                  <span className="block text-[10px] text-slate-400 font-normal mt-0.5">
                    {currentUser.role === 'dept_head' ? 'Locked to your department' : 'Locked to your own work'}
                  </span>
                </div>
              ) : (
                <select
                  id="task-department-select"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value as Department)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Assignee (Employee / Team Member)
              </label>
              {isAssigneePickerHidden ? (
                <div className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 text-sm">
                  {currentUser.name} (You)
                </div>
              ) : (
                <select
                  id="task-assignee-select"
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  {visibleAssigneeUsers.length === 0 && <option value="">No one in this department yet</option>}
                  {visibleAssigneeUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.title} - {u.department})
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Logging a task for yourself — record who actually instructed it */}
          {isSelfLogged && (
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Who assigned this to you?{assignedByRequired ? ' *' : ' (optional)'}
              </label>
              <select
                id="task-assigned-by-select"
                value={assignedById}
                required={assignedByRequired}
                onChange={(e) => setAssignedById(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              >
                <option value="" disabled={assignedByRequired}>
                  {assignedByRequired ? '— Select who assigned you this —' : '— Logging this myself, no one instructed it —'}
                </option>
                {assignedByCandidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.title})
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-slate-400 mt-1">
                {assignedByRequired
                  ? 'Required — record who told you to do this (a Dept Head or manager), so the audit trail stays complete.'
                  : "You're both the assignee and creator on this task — use this if a Dept Head or manager told you to do it verbally and it should be on record."}
              </p>
            </div>
          )}

          {/* Row: Start Date, Due Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <option value="pending_payment">Pending Payment</option>
                <option value="completed">Completed</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                Progress: {progress}%{progressIsAuto && <span className="normal-case font-medium text-slate-400"> (auto, from checklist below)</span>}
              </label>
              <input
                id="task-progress-slider"
                type="range"
                min={0}
                max={100}
                step={5}
                value={progress}
                disabled={progressIsAuto}
                onChange={(e) => setProgress(Number(e.target.value))}
                className="w-full accent-blue-600 mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
                    Hides this remark behind a "Reveal" click in the UI — not encrypted, still readable by
                    anyone with database access
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

          {/* Payment */}
          <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                <div>
                  <p className="text-xs font-bold text-slate-900 dark:text-white">
                    This task involves a payment
                  </p>
                  <p className="text-[10px] text-slate-400">
                    After approval, it'll wait on "Pending Payment" until Super Admin / Chief Officer confirms
                    payment — only then does the task fully complete.
                  </p>
                </div>
              </div>
              <input
                id="task-requires-payment-checkbox"
                type="checkbox"
                checked={requiresPayment}
                onChange={(e) => setRequiresPayment(e.target.checked)}
                className="w-4 h-4 rounded text-orange-600 focus:ring-orange-500"
              />
            </div>

            {requiresPayment && (
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                  Amount (LKR)
                </label>
                <input
                  id="task-payment-amount-input"
                  type="number"
                  min={0}
                  step="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  placeholder="e.g. 15000.00"
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-orange-500 focus:outline-none"
                />
              </div>
            )}

            {isEditing && taskToEdit && taskToEdit.requiresPayment && (
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-2">
                {taskToEdit.paymentStatus === 'paid' ? (
                  <p className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
                    Paid by {taskToEdit.paymentConfirmedByName ?? 'someone'} on{' '}
                    {taskToEdit.paymentConfirmedAt?.slice(0, 10)}
                    {taskToEdit.paymentNotes ? ` — "${taskToEdit.paymentNotes}"` : ''}
                  </p>
                ) : canConfirmPayment ? (
                  <div className="space-y-2">
                    {!showPaymentConfirmBox ? (
                      <button
                        type="button"
                        id="confirm-payment-btn"
                        onClick={() => setShowPaymentConfirmBox(true)}
                        className="px-3 py-2 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold transition-colors"
                      >
                        Mark Payment Confirmed
                      </button>
                    ) : (
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={paymentConfirmNotes}
                          onChange={(e) => setPaymentConfirmNotes(e.target.value)}
                          placeholder="Optional note (e.g. bank ref, cheque no.)"
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-orange-500 focus:outline-none"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={isConfirmingPayment}
                            onClick={handleConfirmPayment}
                            className="px-3 py-2 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold disabled:opacity-50 transition-colors"
                          >
                            {isConfirmingPayment ? 'Confirming…' : 'Confirm Payment'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowPaymentConfirmBox(false)}
                            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-orange-700 dark:text-orange-400 font-semibold">
                    Awaiting payment confirmation from Super Admin / Chief Officer.
                  </p>
                )}
              </div>
            )}
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

          {/* Subtasks / checklist */}
          <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-3">
            <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
              <ListChecks className="w-3.5 h-3.5 text-blue-500" />
              Steps / Checklist ({isEditing && taskToEdit ? taskToEdit.subtasks.length : pendingSubtasks.length})
            </h3>

            <div className="space-y-1.5">
              {isEditing && taskToEdit && taskToEdit.subtasks.length === 0 && pendingSubtasks.length === 0 && (
                <p className="text-xs text-slate-400 italic">
                  No steps yet — break this task into a checklist and progress will track itself.
                </p>
              )}
              {!isEditing && pendingSubtasks.length === 0 && (
                <p className="text-xs text-slate-400 italic">
                  Optional — break this task into steps now, or add them later from Edit.
                </p>
              )}

              {isEditing &&
                taskToEdit &&
                taskToEdit.subtasks.map((sub) => (
                  <div
                    key={sub.id}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => setSubtaskCompletion(sub.id, !sub.isCompleted)}
                      aria-pressed={sub.isCompleted}
                      aria-label={sub.isCompleted ? `Mark "${sub.title}" as not done` : `Mark "${sub.title}" as done`}
                      className="flex items-center gap-2 text-left flex-1 min-w-0"
                    >
                      {sub.isCompleted ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : (
                        <Circle className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0" />
                      )}
                      <span className={`truncate ${sub.isCompleted ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-200'}`}>
                        {sub.title}
                      </span>
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      {sub.assigneeName && <span className="text-[10px] text-slate-400">{sub.assigneeName}</span>}
                      <button
                        type="button"
                        onClick={() => deleteSubtaskFromTask(sub.id)}
                        aria-label="Remove step"
                        className="text-slate-400 hover:text-red-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}

              {!isEditing &&
                pendingSubtasks.map((sub) => (
                  <div
                    key={sub.key}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-dashed border-slate-300 dark:border-slate-600 text-xs"
                  >
                    <span className="flex items-center gap-2 truncate text-slate-700 dark:text-slate-200">
                      <Circle className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0" />
                      {sub.title}
                      <span className="text-[9px] font-bold uppercase text-slate-400 shrink-0">Queued</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removePendingSubtask(sub.key)}
                      aria-label="Remove step"
                      className="text-slate-400 hover:text-red-500 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddSubtask();
                  }
                }}
                placeholder="e.g. Wire up the API"
                className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddSubtask}
                disabled={!newSubtaskTitle.trim() || isAddingSubtask}
                className="px-3 py-2 rounded-xl bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50 transition-colors flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Step
              </button>
            </div>
          </div>

          {/* Attachments (files + links) — works in both Create and Edit */}
          <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-3">
            <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
              <Paperclip className="w-3.5 h-3.5 text-blue-500" />
              Files & Links ({isEditing && taskToEdit ? taskToEdit.attachments.length : pendingAttachments.length})
            </h3>

            <div className="space-y-1.5">
              {isEditing && taskToEdit && taskToEdit.attachments.length === 0 && (
                <p className="text-xs text-slate-400 italic">No files or links attached yet.</p>
              )}
              {!isEditing && pendingAttachments.length === 0 && (
                <p className="text-xs text-slate-400 italic">No files or links attached yet.</p>
              )}

              {isEditing &&
                taskToEdit &&
                taskToEdit.attachments.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 text-xs"
                  >
                    <a
                      href={att.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:underline truncate"
                    >
                      <Paperclip className="w-3 h-3 shrink-0" />
                      <span className="truncate">{att.fileName || att.url}</span>
                    </a>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-slate-400">{att.uploadedByName}</span>
                      {(att.uploadedById === currentUser.id || currentUser.role === 'super_admin') && (
                        <button
                          type="button"
                          onClick={() => deleteAttachmentFromTask(att.id)}
                          aria-label="Remove attachment"
                          className="text-slate-400 hover:text-red-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}

              {!isEditing &&
                pendingAttachments.map((att) => (
                  <div
                    key={att.key}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-dashed border-slate-300 dark:border-slate-600 text-xs"
                  >
                    <span className="flex items-center gap-2 text-slate-700 dark:text-slate-200 truncate">
                      <Paperclip className="w-3 h-3 shrink-0" />
                      <span className="truncate">{att.label}</span>
                      <span className="text-[9px] font-bold uppercase text-slate-400 shrink-0">Queued</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removePendingAttachment(att.key)}
                      aria-label="Remove attachment"
                      className="text-slate-400 hover:text-red-500 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
              <input
                type="file"
                disabled={isUploadingFile}
                onChange={(e) => handleFileAttach(e.target.files?.[0])}
                className="flex-1 text-[11px] text-slate-600 dark:text-slate-300 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:text-slate-700 dark:file:text-slate-200 file:text-[11px] file:font-bold hover:file:bg-slate-200 dark:hover:file:bg-slate-700 disabled:opacity-50"
              />
              {isUploadingFile && <span className="text-[10px] text-slate-400">Uploading…</span>}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="url"
                value={newLinkUrl}
                onChange={(e) => setNewLinkUrl(e.target.value)}
                placeholder="Paste a link (https://…)"
                className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
              <input
                type="text"
                value={newLinkLabel}
                onChange={(e) => setNewLinkLabel(e.target.value)}
                placeholder="Label (optional)"
                className="w-32 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleLinkAttach}
                disabled={!newLinkUrl.trim() || isAddingLink}
                className="px-3 py-2 rounded-xl bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                Add Link
              </button>
            </div>
          </div>

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
        </div>

        {/* Footer Actions — deliberately OUTSIDE the scrolling content
            area (see the flex-col wrapper on <form>) so Save/Cancel and
            the urgent actions (Delete, Ring Alarm) are always reachable
            without scrolling through the whole form first — this was a
            real usability gap on longer tasks (subtasks + payment +
            attachments + remarks all in one scroll). */}
        <div className="shrink-0 p-4 sm:p-5 border-t border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm flex flex-wrap items-center justify-between gap-3">
            {isEditing && taskToEdit ? (
              <div className="flex items-center gap-2">
                {canDeleteTask && (
                  <button
                    type="button"
                    id="delete-task-btn"
                    onClick={() => setShowDeleteConfirm(true)}
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
                  title="Posts a deadline reminder to the team's Slack channel"
                  className="px-3 py-2 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 font-bold text-xs hover:bg-purple-100 flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Ping Slack</span>
                </button>

                {canRingAlarm && (
                  <button
                    type="button"
                    id="ring-alarm-btn"
                    disabled={isRingingAlarm}
                    onClick={() => setShowRingConfirm(true)}
                    className="px-3 py-2 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold text-xs hover:bg-rose-100 flex items-center gap-1.5 disabled:opacity-50"
                    title="Sends an urgent, hard-to-miss ping to the assignee — clears only when they open this task"
                  >
                    <AlarmClock className="w-3.5 h-3.5" />
                    <span>{isRingingAlarm ? 'Ringing…' : 'Ring Alarm'}</span>
                  </button>
                )}
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

      {/* Delete confirmation — was a bare browser confirm(), inconsistent
          with the rest of the app's styled modals and unable to explain
          what else gets deleted along with the task. */}
      {showDeleteConfirm && isEditing && taskToEdit && (
        <ConfirmDialog
          tone="danger"
          icon={<Trash2 className="w-5 h-5" />}
          title={`Delete ${taskToEdit.taskDisplayId}?`}
          description={`This permanently deletes "${taskToEdit.title}"${
            taskToEdit.subtasks.length > 0 ? `, its ${taskToEdit.subtasks.length} checklist step${taskToEdit.subtasks.length === 1 ? '' : 's'}` : ''
          }${
            taskToEdit.attachments.length > 0 ? `, and ${taskToEdit.attachments.length} attached file${taskToEdit.attachments.length === 1 ? '' : 's'}/link${taskToEdit.attachments.length === 1 ? '' : 's'}` : ''
          }. This cannot be undone.`}
          confirmLabel="Delete permanently"
          onConfirm={() => {
            setShowDeleteConfirm(false);
            deleteTask(taskToEdit.id);
            onClose();
          }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}

      {/* Ring Alarm confirmation — this is deliberately disruptive (loops
          a sound on the assignee's screen until they open the task), so
          a one-tap accidental click shouldn't be able to trigger it. */}
      {showRingConfirm && isEditing && taskToEdit && (
        <ConfirmDialog
          tone="warning"
          icon={<AlarmClock className="w-5 h-5" />}
          title={`Ring an alarm for ${taskToEdit.assigneeName}?`}
          description={`This rings continuously on their screen the moment they're back in the system, and only stops when they open this task. Use it for genuinely urgent items — not as a regular check-in.`}
          confirmLabel="Ring alarm now"
          onConfirm={async () => {
            setShowRingConfirm(false);
            setIsRingingAlarm(true);
            try {
              await ringTaskAlarm(taskToEdit.id);
            } catch {
              // ringTaskAlarm already shows its own error toast (e.g.
              // the 15-minute cooldown message).
            } finally {
              setIsRingingAlarm(false);
            }
          }}
          onCancel={() => setShowRingConfirm(false)}
        />
      )}
    </div>
  );
};
