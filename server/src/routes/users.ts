import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { writeAuditLog } from '../lib/auditLog.js';

export const usersRouter = Router();
usersRouter.use(requireAuth);

/** GET /api/users — directory (all authenticated users can list) */
usersRouter.get('/', async (req, res) => {
  const { department } = req.query;
  let query = supabase.from('users').select(
    'id, name, email, role, department, title, avatar, status, productivity_score, tasks_completed, tasks_in_progress, hours_logged_this_month, joined_date'
  );
  if (department) query = query.eq('department', department as string);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/** GET /api/users/me — the authenticated caller's own profile */
usersRouter.get('/me', async (req, res) => {
  res.json(req.appUser);
});

/** POST /api/users — invite/create a user (requires canManageUsers) */
usersRouter.post('/', requirePermission('canManageUsers'), async (req, res) => {
  const body = req.body;
  const { data, error } = await supabase
    .from('users')
    .insert({
      name: body.name,
      email: body.email,
      role: body.role ?? 'employee',
      department: body.department,
      title: body.title ?? '',
      avatar: body.avatar ?? null,
      permissions: body.permissions ?? undefined,
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await writeAuditLog({
    actor: req.appUser!,
    action: 'user.created',
    category: 'user',
    target: data.id,
    details: `Created user ${data.email} (${data.role})`,
  });

  res.status(201).json(data);
});

/** PATCH /api/users/:id/permissions — requires canManageUsers */
usersRouter.patch('/:id/permissions', requirePermission('canManageUsers'), async (req, res) => {
  const { data: current, error: fetchErr } = await supabase
    .from('users')
    .select('permissions')
    .eq('id', req.params.id)
    .single();

  if (fetchErr || !current) return res.status(404).json({ error: 'User not found' });

  const merged = { ...current.permissions, ...req.body };
  const { data, error } = await supabase
    .from('users')
    .update({ permissions: merged })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await writeAuditLog({
    actor: req.appUser!,
    action: 'user.permissions_updated',
    category: 'security',
    target: req.params.id,
    details: `Permissions changed: ${Object.keys(req.body).join(', ')}`,
    status: 'warning',
  });

  res.json(data);
});

/** PATCH /api/users/:id/status — a user updates their own presence status */
usersRouter.patch('/:id/status', async (req, res) => {
  if (req.params.id !== req.appUser!.id) {
    return res.status(403).json({ error: 'Can only update your own status' });
  }
  const { data, error } = await supabase
    .from('users')
    .update({ status: req.body.status })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});
