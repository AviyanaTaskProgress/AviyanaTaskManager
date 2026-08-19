import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { writeAuditLog } from '../lib/auditLog.js';

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

/** GET /api/tasks?department=&status=&assigneeId= */
tasksRouter.get('/', async (req, res) => {
  const { department, status, assigneeId } = req.query;
  let query = supabase
    .from('tasks')
    .select('*, remarks:task_remarks(*)')
    .order('due_date', { ascending: true });

  // Non-admins only see their own or team tasks (defense in depth; RLS covers the rest)
  if (department) query = query.eq('department', department as string);
  if (status) query = query.eq('status', status as string);
  if (assigneeId) query = query.eq('assignee_id', assigneeId as string);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

tasksRouter.get('/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('tasks')
    .select('*, remarks:task_remarks(*)')
    .eq('id', req.params.id)
    .single();
  if (error) return res.status(404).json({ error: 'Task not found' });
  res.json(data);
});

/** POST /api/tasks — create task (requires canCreateTasks) */
tasksRouter.post('/', requirePermission('canCreateTasks'), async (req, res) => {
  const body = req.body;
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      title: body.title,
      description: body.description ?? '',
      department: body.department,
      assignee_id: body.assigneeId,
      created_by_id: req.appUser!.id,
      start_date: body.startDate,
      due_date: body.dueDate,
      estimated_hours: body.estimatedHours ?? 0,
      priority: body.priority ?? 'medium',
      status: body.status ?? 'todo',
      progress: body.progress ?? 0,
      tags: body.tags ?? [],
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await writeAuditLog({
    actor: req.appUser!,
    action: 'task.created',
    category: 'task',
    target: data.id,
    details: `Created task "${data.title}" assigned to ${body.assigneeId}`,
  });

  res.status(201).json(data);
});

/** PATCH /api/tasks/:id — update (own task, or canEditAllTasks) */
tasksRouter.patch('/:id', async (req, res) => {
  const { data: existing } = await supabase
    .from('tasks')
    .select('assignee_id')
    .eq('id', req.params.id)
    .single();

  if (!existing) return res.status(404).json({ error: 'Task not found' });

  const isOwner = existing.assignee_id === req.appUser!.id;
  const canEditAll = req.appUser!.permissions?.canEditAllTasks === true;
  if (!isOwner && !canEditAll) {
    return res.status(403).json({ error: 'Not allowed to edit this task' });
  }

  const updates: Record<string, unknown> = {};
  const allowed = [
    'title', 'description', 'status', 'progress', 'priority', 'dueDate',
    'startDate', 'estimatedHours', 'loggedHours', 'tags', 'completedDate',
  ];
  for (const key of allowed) {
    if (key in req.body) {
      const dbKey = key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
      updates[dbKey] = req.body[key];
    }
  }

  const { data, error } = await supabase
    .from('tasks')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await writeAuditLog({
    actor: req.appUser!,
    action: 'task.updated',
    category: 'task',
    target: req.params.id,
    details: `Fields changed: ${Object.keys(updates).join(', ')}`,
  });

  res.json(data);
});

/** DELETE /api/tasks/:id — requires canEditAllTasks */
tasksRouter.delete('/:id', requirePermission('canEditAllTasks'), async (req, res) => {
  const { error } = await supabase.from('tasks').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });

  await writeAuditLog({
    actor: req.appUser!,
    action: 'task.deleted',
    category: 'task',
    target: req.params.id,
    status: 'warning',
  });

  res.status(204).send();
});

/** POST /api/tasks/:id/remarks — add a comment/remark to a task */
tasksRouter.post('/:id/remarks', async (req, res) => {
  const { text, isEncrypted, type } = req.body;
  const { data, error } = await supabase
    .from('task_remarks')
    .insert({
      task_id: req.params.id,
      author_id: req.appUser!.id,
      text,
      is_encrypted: isEncrypted ?? false,
      type: type ?? 'general',
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});
