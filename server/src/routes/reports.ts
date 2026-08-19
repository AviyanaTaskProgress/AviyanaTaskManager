import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { writeAuditLog } from '../lib/auditLog.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requirePermission('canExportReports'));

/** GET /api/reports/monthly?department=&month=2026-08 */
reportsRouter.get('/monthly', async (req, res) => {
  const { department, month } = req.query as { department?: string; month?: string };
  if (!month) return res.status(400).json({ error: 'month=YYYY-MM is required' });

  const start = `${month}-01`;
  const end = new Date(new Date(start).getFullYear(), new Date(start).getMonth() + 1, 1)
    .toISOString()
    .slice(0, 10);

  let query = supabase
    .from('tasks')
    .select('*')
    .gte('due_date', start)
    .lt('due_date', end);
  if (department) query = query.eq('department', department);

  const { data: tasks, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const totalTasks = tasks.length;
  const completed = tasks.filter((t) => t.status === 'completed');
  const overdue = tasks.filter((t) => t.status !== 'completed' && new Date(t.due_date) < new Date());
  const totalHours = tasks.reduce((sum, t) => sum + Number(t.logged_hours ?? 0), 0);

  await writeAuditLog({
    actor: req.appUser!,
    action: 'report.generated',
    category: 'report',
    target: `${department ?? 'ALL'}:${month}`,
  });

  res.json({
    month,
    department: department ?? 'ALL',
    totalTasks,
    completedTasks: completed.length,
    completionRate: totalTasks ? Math.round((completed.length / totalTasks) * 100) : 0,
    totalHoursLogged: totalHours,
    tasksOverdue: overdue.length,
  });
});
