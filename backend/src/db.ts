import { Pool } from 'pg';
import { config } from './config';

export const pool = new Pool({ connectionString: config.databaseUrl });

export const query = (text: string, params: unknown[] = []) =>
  pool.query(text, params);

const SCHEMA = [
  `CREATE EXTENSION IF NOT EXISTS pgcrypto`,
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     email TEXT NOT NULL,
     avatar TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE TABLE IF NOT EXISTS senders (
     id SERIAL PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id),
     email TEXT NOT NULL,
     hourly_limit INTEGER NOT NULL,
     smtp_host TEXT NOT NULL,
     smtp_port INTEGER NOT NULL,
     smtp_user TEXT NOT NULL,
     smtp_pass TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (user_id, email)
   )`,
  `CREATE TABLE IF NOT EXISTS slack_connections (
     user_id TEXT PRIMARY KEY REFERENCES users(id),
     team TEXT NOT NULL,
     webhook_url TEXT NOT NULL,
     token TEXT NOT NULL,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS emails (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     batch_id UUID NOT NULL,
     user_id TEXT NOT NULL REFERENCES users(id),
     sender_id INTEGER NOT NULL REFERENCES senders(id),
     recipient TEXT NOT NULL,
     subject TEXT NOT NULL,
     body TEXT NOT NULL,
     scheduled_at TIMESTAMPTZ NOT NULL,
     status TEXT NOT NULL DEFAULT 'scheduled',
     sent_at TIMESTAMPTZ,
     error TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (batch_id, recipient)
   )`,
  `CREATE INDEX IF NOT EXISTS emails_status_schedule
     ON emails (status, scheduled_at)`,
];

export async function initDb() {
  for (const sql of SCHEMA) await query(sql);
}
