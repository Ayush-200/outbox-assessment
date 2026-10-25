import IORedis from 'ioredis';
import { config } from './config';

// The worker gets its own connection because BullMQ workers issue blocking
// commands; everything else (API, counters, queue) can share the first one.
export const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
export const workerRedis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
