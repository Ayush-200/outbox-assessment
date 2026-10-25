import { Job, Worker } from 'bullmq';
import { config } from './config';
import { query } from './db';
import { indexEmails } from './es';
import { sendEmail, Sender } from './mailer';
import { EMAIL_QUEUE, SendJob } from './queue';
import { redis, workerRedis } from './redis';
import { notifyRateLimited } from './slack';
import { EmailRow } from './types';

const HOUR = 3_600_000;

// Thrown when the sender already used its hourly budget; BullMQ retries the
// job in the next hour window (see backoffStrategy below).
class HourlyLimitError extends Error {}

const msUntilNextWindow = () => HOUR - (Date.now() % HOUR);

// Hourly counter keyed by sender + hour window in Redis, so the limit holds no
// matter how many workers/instances are running. The increment is rolled back
// when we end up not sending.
async function takeSendSlot(senderId: number, limit: number): Promise<boolean> {
  const key = `rate:${senderId}:${Math.floor(Date.now() / HOUR)}`;
  const used = await redis.incr(key);
  if (used === 1) await redis.expire(key, 2 * HOUR);
  if (used <= limit) return true;
  await redis.decr(key);
  return false;
}

type EmailWithEmailer = EmailRow & Sender;

async function processEmail(job: Job<SendJob>) {
  const { emailId } = job.data;

  const { rows } = await query(
    `SELECT e.*, s.email, s.hourly_limit, s.smtp_host, s.smtp_port, s.smtp_user, s.smtp_pass
       FROM emails e
       JOIN senders s ON s.id = e.sender_id
      WHERE e.id = $1`,
    [emailId],
  );
  const email = rows[0] as EmailWithEmailer | undefined;
  if (!email) return;

  if (email.status === 'sending') {
    // An earlier attempt died mid-send: mark it instead of leaving it stuck.
    await query(`UPDATE emails SET status = 'failed', error = 'interrupted while sending' WHERE id = $1`, [emailId]);
    return;
  }
  if (email.status !== 'scheduled') return; // already handled → idempotent

  // Claim the row so only one worker can move it scheduled → sending.
  const claimed = await query(
    `UPDATE emails SET status = 'sending', error = NULL WHERE id = $1 AND status = 'scheduled'`,
    [emailId],
  );
  if (!claimed.rowCount) return;

  try {
    if (!(await takeSendSlot(email.sender_id, email.hourly_limit))) {
      await notifyRateLimited(email.user_id, email.sender_id, email.hourly_limit);
      throw new HourlyLimitError('hourly limit reached, will retry next hour');
    }
    await sendEmail(email, email.recipient, email.subject, email.body);
  } catch (err) {
    // Put the row back in "scheduled" so the retry can claim it again — jobs
    // are never dropped, whether they failed or were rate-limited.
    const message = err instanceof Error ? err.message : String(err);
    await query(`UPDATE emails SET status = 'scheduled', error = $2 WHERE id = $1`, [
      emailId,
      message,
    ]);
    throw err;
  }

  await query(`UPDATE emails SET status = 'sent', sent_at = now(), error = NULL WHERE id = $1`, [emailId]);
  await indexEmails([{ ...email, status: 'sent', sent_at: new Date().toISOString() }]);
}

export function startWorker() {
  const worker = new Worker<SendJob>(EMAIL_QUEUE, processEmail, {
    connection: workerRedis,
    concurrency: config.concurrency,
    // Minimum gap between individual sends, enforced by BullMQ in Redis, so it
    // applies across every worker instance.
    limiter: config.sendDelayMs > 0 ? { max: 1, duration: config.sendDelayMs } : undefined,
    settings: {
      backoffStrategy: (_attemptsMade, _type, err) =>
        err instanceof HourlyLimitError ? msUntilNextWindow() : 5000,
    },
  });

  // When a job has used all its attempts, surface it as failed on the dashboard.
  worker.on('failed', (job, err) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      query(`UPDATE emails SET status = 'failed', error = $2 WHERE id = $1`, [
        job.data.emailId,
        err.message,
      ]);
    }
  });
  worker.on('error', (err) => console.error('[worker]', err));

  return worker;
}
