import { Queue } from 'bullmq';
import { redis } from './redis';

export const EMAIL_QUEUE = 'emails';

export type SendJob = { emailId: string };

// Delayed jobs live in Redis, so scheduled emails survive a server restart.
export const queue = new Queue<SendJob>(EMAIL_QUEUE, { connection: redis });
