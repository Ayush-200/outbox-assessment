import { config } from './config';
import { query } from './db';
import { redis } from './redis';
import { signState, verifyState } from './auth';

const HOUR = 3_600_000;

// "Connect Slack" URL. The signed state carries the user id through the
// OAuth redirect, so the callback needs no session store.
export function installUrl(userId: string) {
  const params = new URLSearchParams({
    client_id: config.slackClientId,
    scope: 'chat:write,incoming_webhook',
    redirect_uri: config.slackRedirectUri,
    state: signState(userId),
  });
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

// Exchanges the OAuth code for a bot token + incoming webhook and stores them.
export async function handleCallback(code: string, state: string): Promise<string> {
  const userId = verifyState(state);

  const response = await fetch('https://slack.com/oauth.v2/access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.slackClientId,
      client_secret: config.slackClientSecret,
      redirect_uri: config.slackRedirectUri,
    }),
  });
  const data = (await response.json()) as {
    ok?: boolean;
    error?: string;
    team?: { name?: string };
    access_token?: string;
    incoming_webhook?: { url?: string };
  };

  const webhook = data.incoming_webhook?.url;
  if (!data.ok || !webhook) {
    throw new Error(`Slack authorization failed: ${data.error ?? 'no webhook returned'}`);
  }

  await query(
    `INSERT INTO slack_connections (user_id, team, webhook_url, token) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET team = $2, webhook_url = $3, token = $4, updated_at = now()`,
    [userId, data.team?.name ?? '', webhook, data.access_token ?? ''],
  );
  return userId;
}

export async function slackStatus(userId: string) {
  const { rows } = await query(`SELECT team FROM slack_connections WHERE user_id = $1`, [userId]);
  return { connected: rows.length > 0, team: rows[0]?.team ?? null };
}

// Called the moment a sender's hourly limit is hit. Notifies at most once per
// sender per hour, and silently does nothing if Slack was never connected.
export async function notifyRateLimited(userId: string, senderId: number, limit: number) {
  const { rows } = await query(`SELECT webhook_url FROM slack_connections WHERE user_id = $1`, [
    userId,
  ]);
  const webhook = rows[0]?.webhook_url;
  if (!webhook) return;

  const window = Math.floor(Date.now() / HOUR);
  const first = await redis.set(`slack:notified:${senderId}:${window}:${userId}`, '1', 'EX', HOUR, 'NX');
  if (first !== 'OK') return;

  await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `:warning: Hourly email limit reached (${limit}/hour). Remaining emails for this sender are rescheduled to the next hour window.`,
    }),
  });
}
