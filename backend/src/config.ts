// Loads ./.env with Node's built-in loader (no dotenv needed).
try {
  process.loadEnvFile();
} catch {
  // no .env file — fall back to the defaults below
}

const num = (value: string | undefined, fallback: number) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

// Vercel serverless optimizations: connection singletons via module caching
let _redis: any;
let _workerRedis: any;

export const config = {
  port: num(process.env.PORT, 3001),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',

  databaseUrl:
    process.env.DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5432/scheduler',

  // Use Upstash Redis URL for Vercel serverless, or local Redis
  redisUrl:
    process.env.REDIS_URL ?? (process.env.VERCEL ? 'https://your-upstash-redis-url' : 'redis://localhost:6379'),

  elasticUrl: process.env.ELASTICSEARCH_URL ?? 'http://localhost:9200',

  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  jwtSecret: process.env.JWT_SECRET ?? 'change-me',

  slackClientId: process.env.SLACK_CLIENT_ID ?? '',
  slackClientSecret: process.env.SLACK_CLIENT_SECRET ?? '',
  slackRedirectUri:
    process.env.SLACK_REDIRECT_URI ?? 'http://localhost:3001/api/slack/callback',

  // Scheduler tuning (all overridable via env)
  concurrency: num(process.env.WORKER_CONCURRENCY, 5),
  sendDelayMs: num(process.env.DELAY_BETWEEN_SENDS_MS, 2000),
  hourlyLimit: num(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER, 200),
  maxAttempts: num(process.env.MAX_SEND_ATTEMPTS, 100),
};

// Redis client factory - singleton per process
export function getRedis() {
  if (!_redis) {
    const Redis = require('ioredis');
    _redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  }
  return _redis;
}

export function getWorkerRedis() {
  if (!_workerRedis) {
    const Redis = require('ioredis');
    _workerRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  }
  return _workerRedis;
}