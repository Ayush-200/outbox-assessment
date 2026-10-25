import nodemailer from 'nodemailer';
import { config } from './config';
import { query } from './db';

export type Sender = {
  id: number;
  user_id: string;
  email: string;
  hourly_limit: number;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
};

// One Ethereal (fake SMTP) account per sender, created on first use and
// persisted so it survives restarts.
export async function getOrCreateSender(userId: string, email: string): Promise<Sender> {
  const existing = await query(`SELECT * FROM senders WHERE user_id = $1 AND email = $2`, [
    userId,
    email,
  ]);
  if (existing.rows[0]) return existing.rows[0];

  const account = await nodemailer.createTestAccount();
  const inserted = await query(
    `INSERT INTO senders (user_id, email, hourly_limit, smtp_host, smtp_port, smtp_user, smtp_pass)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (user_id, email) DO UPDATE SET email = EXCLUDED.email
     RETURNING *`,
    [
      userId,
      email,
      config.hourlyLimit,
      account.smtp.host,
      account.smtp.port,
      account.user,
      account.pass,
    ],
  );
  return inserted.rows[0];
}

export async function sendEmail(
  sender: Pick<Sender, 'email' | 'smtp_host' | 'smtp_port' | 'smtp_user' | 'smtp_pass'>,
  to: string,
  subject: string,
  text: string,
) {
  const transport = nodemailer.createTransport({
    host: sender.smtp_host,
    port: sender.smtp_port,
    auth: { user: sender.smtp_user, pass: sender.smtp_pass },
  });
  await transport.sendMail({ from: sender.email, to, subject, text });
}
