import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { writeAuditLog } from '../lib/auditLog.js';

export const approvalsRouter = Router();
approvalsRouter.use(requireAuth);

/** GET /api/approvals — tasks pending approval (requires canApproveTasks) */
approvalsRouter.get('/', requirePermission('canApproveTasks'), async (req, res) => {
  const { data, error } = await supabase
    .from('tasks')
    .select('*, remarks:task_remarks(*)')
    .eq('approval_status', 'pending')
    .order('due_date', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/** POST /api/tasks/:id/submit — assignee submits a task for approval */
approvalsRouter.post('/:id/submit', async (req, res) => {
  const { note } = req.body;
  const { data: task, error: fetchErr } = await supabase
    .from('tasks')
    .select('assignee_id')
    .eq('id', req.params.id)
    .single();

  if (fetchErr || !task) return res.status(404).json({ error: 'Task not found' });
  if (task.assignee_id !== req.appUser!.id) {
    return res.status(403).json({ error: 'Only the assignee can submit this task' });
  }

  const { data, error } = await supabase
    .from('tasks')
    .update({ status: 'pending_approval', approval_status: 'pending' })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  if (note) {
    await supabase.from('task_remarks').insert({
      task_id: req.params.id,
      author_id: req.appUser!.id,
      text: note,
      type: 'approval_request',
    });
  }

  await writeAuditLog({
    actor: req.appUser!,
    action: 'task.submitted_for_approval',
    category: 'approval',
    target: req.params.id,
  });

  res.json(data);
});

/** POST /api/tasks/:id/decision — dept_head/manager approves or rejects */
approvalsRouter.post('/:id/decision', requirePermission('canApproveTasks'), async (req, res) => {
  const { decision, comment } = req.body as { decision: 'approved' | 'rejected'; comment?: string };
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be "approved" or "rejected"' });
  }

  const updates: Record<string, unknown> = {
    approval_status: decision,
    approved_by: req.appUser!.id,
    approval_date: new Date().toISOString(),
    status: decision === 'approved' ? 'completed' : 'in_progress',
  };
  if (decision === 'approved') updates.completed_date = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('tasks')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  if (comment) {
    await supabase.from('task_remarks').insert({
      task_id: req.params.id,
      author_id: req.appUser!.id,
      text: comment,
      type: 'approval_action',
    });
  }

  await writeAuditLog({
    actor: req.appUser!,
    action: `task.${decision}`,
    category: 'approval',
    target: req.params.id,
    status: decision === 'rejected' ? 'warning' : 'success',
  });

  res.json(data);
});
