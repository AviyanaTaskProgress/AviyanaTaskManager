import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { writeAuditLog } from '../lib/auditLog.js';

export const slackRouter = Router();
slackRouter.use(requireAuth);

/** GET /api/slack/config */
slackRouter.get('/config', requirePermission('canConfigureSlack'), async (req, res) => {
  const { data, error } = await supabase
    .from('slack_config')
    .select('*, log:slack_notification_log(*)')
    .is('department', null)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data ?? null);
});

/** PUT /api/slack/config */
slackRouter.put('/config', requirePermission('canConfigureSlack'), async (req, res) => {
  const body = req.body;
  const { data, error } = await supabase
    .from('slack_config')
    .upsert(
      {
        department: null,
        webhook_url: body.webhookUrl,
        channel: body.channel,
        bot_name: body.botName,
        notify_on_task_assigned: body.notifyOnTaskAssigned,
        notify_on_deadline_alert: body.notifyOnDeadlineAlert,
        notify_on_approval_requested: body.notifyOnApprovalRequested,
        notify_on_task_completed: body.notifyOnTaskCompleted,
        notify_on_daily_summary: body.notifyOnDailySummary,
      },
      { onConflict: 'department' }
    )
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await writeAuditLog({
    actor: req.appUser!,
    action: 'slack.config_updated',
    category: 'slack',
    target: data.id,
  });

  res.json(data);
});

/** POST /api/slack/test — sends a real ping to the configured webhook */
slackRouter.post('/test', requirePermission('canConfigureSlack'), async (req, res) => {
  const { data: config } = await supabase
    .from('slack_config')
    .select('*')
    .is('department', null)
    .maybeSingle();

  if (!config?.webhook_url) {
    return res.status(400).json({ error: 'No webhook URL configured' });
  }

  const result = await dispatchSlackMessage(config.webhook_url, {
    text: `:satellite: Aviyana test ping from ${req.appUser!.name}`,
  });

  await supabase.from('slack_notification_log').insert({
    config_id: config.id,
    type: 'test',
    channel: config.channel,
    summary: 'Test connection ping',
    status: result.ok ? 'delivered' : 'failed',
  });

  await supabase
    .from('slack_config')
    .update({ is_connected: result.ok, last_tested_at: new Date().toISOString() })
    .eq('id', config.id);

  res.json({ success: result.ok, message: result.ok ? 'Delivered' : result.error });
});

/** Internal helper other routes call to fire task-related Slack alerts. */
export async function notifySlack(
  event: 'assigned' | 'deadline_alert' | 'approval_request' | 'completed',
  task: { id: string; title: string; assignee_id: string; department: string; priority: string }
) {
  const { data: config } = await supabase
    .from('slack_config')
    .select('*')
    .is('department', null)
    .maybeSingle();

  if (!config?.webhook_url || !config.is_connected) return;

  const flagMap: Record<typeof event, keyof typeof config> = {
    assigned: 'notify_on_task_assigned',
    deadline_alert: 'notify_on_deadline_alert',
    approval_request: 'notify_on_approval_requested',
    completed: 'notify_on_task_completed',
  } as const;
  if (!config[flagMap[event]]) return;

  const emoji = task.priority === 'critical' ? '🚨' : task.priority === 'high' ? '⚠️' : '📌';
  const text = `${emoji} *${event.replace('_', ' ')}*: "${task.title}" (${task.department})`;

  const result = await dispatchSlackMessage(config.webhook_url, { text });

  await supabase.from('slack_notification_log').insert({
    config_id: config.id,
    type: event,
    channel: config.channel,
    summary: text,
    status: result.ok ? 'delivered' : 'failed',
  });
}

async function dispatchSlackMessage(
  webhookUrl: string,
  message: { text: string }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    return { ok: resp.ok, error: resp.ok ? undefined : `HTTP ${resp.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
