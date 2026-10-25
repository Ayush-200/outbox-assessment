import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import cors from 'cors';
import express, { NextFunction, Request, RequestHandler, Response } from 'express';
import { randomUUID } from 'crypto';
import { loginWithGoogle, requireAuth, verifyState } from './auth';
import { config } from './config';
import { initDb, query } from './db';
import { ensureIndex, indexEmails, searchEmails } from './es';
import { getOrCreateSender, Sender } from './mailer';
import { queue } from './queue';
import { handleCallback, installUrl, slackStatus } from './slack';
import { EmailRow } from './types';
import { startWorker } from './worker';

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;

// Wraps async handlers so errors reach the error middleware.
const h =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const app = express();
app.use(cors({ origin: config.frontendUrl }));
app.use(express.json({ limit: '2mb' }));

// Live BullMQ dashboard (queue, jobs, delays, failures).
const boardAdapter = new ExpressAdapter();
boardAdapter.setBasePath('/admin/queues');
createBullBoard({ queues: [new BullMQAdapter(queue)], serverAdapter: boardAdapter });
app.use('/admin/queues', boardAdapter.getRouter());

app.post(
  '/api/auth/google',
  h(async (req, res) => {
    const { credential } = req.body ?? {};
    if (typeof credential !== 'string') {
      return res.status(400).json({ error: 'Missing Google credential' });
    }
    res.json(await loginWithGoogle(credential));
  }),
);

app.get(
  '/api/senders',
  requireAuth,
  h(async (req, res) => {
    const { rows } = await query(
      `SELECT id, email, hourly_limit FROM senders WHERE user_id = $1 ORDER BY id`,
      [req.userId],
    );
    res.json(rows);
  }),
);

app.post(
  '/api/emails/schedule',
  requireAuth,
  h(async (req, res) => {
    const userId = req.userId!;
    const { subject, body, startTime, delaySeconds, hourlyLimit, senderEmail, emails } =
      req.body ?? {};

    if (typeof subject !== 'string' || !subject.trim()) {
      return res.status(400).json({ error: 'Subject is required' });
    }
    if (typeof senderEmail !== 'string' || !EMAIL_RE.test(senderEmail)) {
      return res.status(400).json({ error: 'A valid sender email is required' });
    }
    if (!Array.isArray(emails)) {
      return res.status(400).json({ error: 'emails must be an array' });
    }

    const recipients = [...new Set(emails.map(String).filter((e) => EMAIL_RE.test(e)))];
    if (recipients.length === 0) return res.status(400).json({ error: 'No valid recipients' });
    if (recipients.length > 5000) {
      return res.status(400).json({ error: 'Too many recipients (max 5000)' });
    }

    const start = Date.parse(startTime);
    if (!Number.isFinite(start)) return res.status(400).json({ error: 'Invalid start time' });
    const delayMs = Math.max(0, Number(delaySeconds) || 0) * 1000;

    const sender = await getOrCreateSender(userId, senderEmail.trim());
    if (Number(hourlyLimit) > 0 && Number(hourlyLimit) !== sender.hourly_limit) {
      await query(`UPDATE senders SET hourly_limit = $2 WHERE id = $1`, [
        sender.id,
        Number(hourlyLimit),
      ]);
      sender.hourly_limit = Number(hourlyLimit);
    }

    // Each email gets its own start time: startTime + index * delay, which is
    // how the per-batch "delay between emails" is applied.
    const batchId = randomUUID();
    const values: unknown[] = [];
    const tuples = recipients.map((recipient, i) => {
      const offset = i * 7;
      values.push(batchId, userId, sender.id, recipient, subject, body ?? '', new Date(start + i * delayMs));
      return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7})`;
    });

    // ON CONFLICT keeps retries of the same request idempotent.
    const inserted = await query(
      `INSERT INTO emails (batch_id, user_id, sender_id, recipient, subject, body, scheduled_at)
       VALUES ${tuples.join(',')}
       ON CONFLICT (batch_id, recipient) DO NOTHING
       RETURNING *`,
      values,
    );
    const rows = inserted.rows as EmailRow[];

    const now = Date.now();
    await queue.addBulk(
      rows.map((row) => ({
        name: 'send',
        data: { emailId: row.id },
        opts: {
          // jobId makes re-adding the same email a no-op → no duplicate sends.
          jobId: `email:${row.id}`,
          delay: Math.max(0, new Date(row.scheduled_at).getTime() - now),
          attempts: config.maxAttempts,
          backoff: { type: 'custom' },
        },
      })),
    );
    await indexEmails(rows);

    res.json({ scheduled: rows.length, skipped: recipients.length - rows.length });
  }),
);

app.get(
  '/api/emails',
  requireAuth,
  h(async (req, res) => {
    const sent = req.query.status === 'sent';
    const { rows } = await query(
      sent
        ? `SELECT * FROM emails WHERE user_id = $1 AND status IN ('sent','failed')
             ORDER BY sent_at DESC NULLS LAST, created_at DESC LIMIT 200`
        : `SELECT * FROM emails WHERE user_id = $1 AND status IN ('scheduled','sending')
             ORDER BY scheduled_at ASC LIMIT 200`,
      [req.userId],
    );
    res.json(rows);
  }),
);

app.get(
  '/api/emails/search',
  requireAuth,
  h(async (req, res) => {
    const statuses = req.query.status === 'sent' ? ['sent', 'failed'] : ['scheduled', 'sending'];
    res.json(await searchEmails(req.userId!, statuses, String(req.query.q ?? '').trim()));
  }),
);

app.get('/api/slack/status', requireAuth, h(async (req, res) => res.json(await slackStatus(req.userId!))));

// Frontend fetches this URL (with the auth header) and then navigates to it.
app.get('/api/slack/install', requireAuth, h(async (req, res) => res.json({ url: installUrl(req.userId!) })));

app.get(
  '/api/slack/callback',
  h(async (req, res) => {
    const { code, state } = req.query;
    try {
      await handleCallback(String(code), String(state));
      res.redirect(`${config.frontendUrl}/?slack=connected`);
    } catch (err) {
      console.error('[slack]', err);
      res.redirect(`${config.frontendUrl}/?slack=error`);
    }
  }),
);

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

async function main() {
  await initDb();
  await ensureIndex();
  startWorker();
}

// Start server only when running locally (not on Vercel serverless)
if (process.env.VERCEL !== '1') {
  main().then(() => {
    app.listen(config.port, () => {
      console.log(`API + worker listening on http://localhost:${config.port}`);
      console.log(`Queue dashboard: http://localhost:${config.port}/admin/queues`);
    });
  });
}

// Export app for Vercel serverless platforms
export default app;

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
