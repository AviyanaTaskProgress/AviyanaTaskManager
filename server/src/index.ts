import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';

import { usersRouter } from './routes/users.js';
import { tasksRouter } from './routes/tasks.js';
import { approvalsRouter } from './routes/approvals.js';
import { auditLogsRouter } from './routes/auditLogs.js';
import { slackRouter } from './routes/slack.js';
import { timeSessionsRouter } from './routes/timeSessions.js';
import { notificationsRouter } from './routes/notifications.js';
import { reportsRouter } from './routes/reports.js';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(','),
    credentials: true,
  })
);
app.use(express.json());
app.use(morgan('tiny'));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'aviyana-api' }));

app.use('/api/users', usersRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/approvals', approvalsRouter);
app.use('/api/audit-logs', auditLogsRouter);
app.use('/api/slack', slackRouter);
app.use('/api/time-sessions', timeSessionsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/reports', reportsRouter);

// Fallback error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => {
  console.log(`Aviyana Staff API listening on http://localhost:${PORT}`);
});
