import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

export const auditLogsRouter = Router();
auditLogsRouter.use(requireAuth, requirePermission('canViewAuditLogs'));

/** GET /api/audit-logs?category=&status=&limit=50 */
auditLogsRouter.get('/', async (req, res) => {
  const { category, status, limit } = req.query;
  let query = supabase
    .from('audit_logs')
    .select('*, actor:users(name, role)')
    .order('created_at', { ascending: false })
    .limit(limit ? Number(limit) : 100);

  if (category) query = query.eq('category', category as string);
  if (status) query = query.eq('status', status as string);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
