import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';

export const timeSessionsRouter = Router();
timeSessionsRouter.use(requireAuth);

/** GET /api/time-sessions?userId=&taskId= */
timeSessionsRouter.get('/', async (req, res) => {
  const { userId, taskId } = req.query;
  let query = supabase.from('time_sessions').select('*').order('start_time', { ascending: false });
  if (userId) query = query.eq('user_id', userId as string);
  if (taskId) query = query.eq('task_id', taskId as string);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/** POST /api/time-sessions — save a completed timer session */
timeSessionsRouter.post('/', async (req, res) => {
  const body = req.body;
  const { data, error } = await supabase
    .from('time_sessions')
    .insert({
      user_id: req.appUser!.id,
      task_id: body.taskId ?? null,
      start_time: body.startTime,
      end_time: body.endTime ?? new Date().toISOString(),
      duration_minutes: body.durationMinutes,
      type: body.type ?? 'focus_work',
      efficiency_score: body.efficiencyScore ?? 0,
      notes: body.notes ?? null,
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Roll the logged hours up onto the task, if one was linked
  if (body.taskId) {
    await supabase.rpc('increment_task_logged_hours', {
      p_task_id: body.taskId,
      p_hours: body.durationMinutes / 60,
    });
  }

  res.status(201).json(data);
});
