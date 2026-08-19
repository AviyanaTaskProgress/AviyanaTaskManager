import { SlackConfig, Task, User } from '../types';

export interface SlackBlockMessage {
  channel?: string;
  username?: string;
  icon_emoji?: string;
  text: string;
  blocks?: Array<{
    type: string;
    text?: {
      type: string;
      text: string;
    };
    fields?: Array<{
      type: string;
      text: string;
    }>;
  }>;
}

export function buildTaskSlackMessage(
  event: 'assigned' | 'deadline_alert' | 'approval_request' | 'completed',
  task: Task,
  actor?: User
): SlackBlockMessage {
  const urgencyEmoji =
    task.priority === 'critical'
      ? '🚨'
      : task.priority === 'high'
      ? '⚠️'
      : '📌';

  let headerText = '';
  if (event === 'assigned') {
    headerText = `📢 *New Task Assigned by Dept Head*`;
  } else if (event === 'deadline_alert') {
    headerText = `⏰ *Deadline Alert: Task Escalated*`;
  } else if (event === 'approval_request') {
    headerText = `📋 *Task Submitted for Sign-off & Approval*`;
  } else if (event === 'completed') {
    headerText = `✅ *Task Milestone Completed*`;
  }

  return {
    text: `${headerText}: ${task.title}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${urgencyEmoji} ${task.title}`,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Department:*\n${task.department}`,
          },
          {
            type: 'mrkdwn',
            text: `*Assignee:*\n<@${task.assigneeName}>`,
          },
          {
            type: 'mrkdwn',
            text: `*Due Date:*\n📅 ${task.dueDate} (${task.priority.toUpperCase()} priority)`,
          },
          {
            type: 'mrkdwn',
            text: `*Current Progress:*\n${task.progress}% (${task.status.replace('_', ' ').toUpperCase()})`,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Details & Remarks:*\n${task.description || 'No additional remarks.'}`,
        },
      },
    ],
  };
}

export async function sendSlackWebhookNotification(
  config: SlackConfig,
  event: 'assigned' | 'deadline_alert' | 'approval_request' | 'completed' | 'test',
  payloadDetails: {
    task?: Task;
    actor?: User;
    customMessage?: string;
  }
): Promise<{ success: boolean; message: string; logEntry: SlackConfig['notificationLog'][0] }> {
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const logId = 'slk_' + Math.random().toString(36).substring(2, 9);

  let summary = '';
  if (event === 'test') {
    summary = `[Test Connection] Aviyana bot pinged ${config.channel || '#general'}`;
  } else if (payloadDetails.task) {
    summary = `[${event.toUpperCase()}] "${payloadDetails.task.title}" → ${payloadDetails.task.assigneeName} (${config.channel})`;
  } else {
    summary = payloadDetails.customMessage || 'Slack alert dispatched';
  }

  // If real webhook URL provided and starts with http
  if (config.webhookUrl && config.webhookUrl.startsWith('https://hooks.slack.com/')) {
    try {
      const message = payloadDetails.task
        ? buildTaskSlackMessage(event as any, payloadDetails.task, payloadDetails.actor)
        : { text: summary };

      // In browser or proxy
      await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        mode: 'no-cors', // standard webhook fire-and-forget in browser
      });

      const logEntry = {
        id: logId,
        timestamp,
        type: event,
        channel: config.channel || '#work-tracker-alerts',
        summary,
        status: 'delivered' as const,
      };

      return { success: true, message: 'Dispatched to Slack Webhook successfully', logEntry };
    } catch (err: any) {
      const logEntry = {
        id: logId,
        timestamp,
        type: event,
        channel: config.channel || '#work-tracker-alerts',
        summary: `Error delivering: ${err.message}`,
        status: 'failed' as const,
      };
      return { success: false, message: err.message, logEntry };
    }
  }

  // Live simulation mode
  const logEntry = {
    id: logId,
    timestamp,
    type: event,
    channel: config.channel || '#work-tracker-alerts',
    summary: `${summary} (Live Sim Hook)`,
    status: 'delivered' as const,
  };

  return {
    success: true,
    message: `Slack notification synced to ${config.channel}`,
    logEntry,
  };
}
