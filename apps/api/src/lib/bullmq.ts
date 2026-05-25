// ─────────────────────────────────────────────────────────────
// BullMQ Queue Definitions
//
// Architecture: API adds jobs to queues. Workers consume them.
// This separation means the API server never runs browser
// automation — it just dispatches work.
//
// Queue naming convention: lowercase, kebab-case.
// Each queue maps to exactly one handler in apps/worker.
// ─────────────────────────────────────────────────────────────

import { Queue, type JobsOptions } from 'bullmq';
import { redis } from './redis.js';

// Default job options — keep recent history but don't fill Redis
const DEFAULT_JOB_OPTIONS: JobsOptions = {
  removeOnComplete: { count: 100 }, // keep last 100 completed
  removeOnFail: { count: 50 },     // keep last 50 failed
  attempts: 2,                      // retry once on failure
  backoff: {
    type: 'exponential',
    delay: 5000,                    // 5s, 10s between retries
  },
};

// ── Queue Definitions ───────────────────────────────────────

/** Upload videos to TikTok/YouTube */
export const uploadQueue = new Queue('upload', {
  connection: redis,
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

/** Warm up accounts: scroll, like, comment */
export const warmupQueue = new Queue('warmup', {
  connection: redis,
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

/** Farm cookies on donor websites */
export const cookiesQueue = new Queue('cookies', {
  connection: redis,
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

/** Edit account profiles (avatar, banner, bio) */
export const editProfileQueue = new Queue('edit-profile', {
  connection: redis,
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

/** Nightly analytics cron — collect stats from accounts */
export const analyticsCronQueue = new Queue('analytics-cron', {
  connection: redis,
  defaultJobOptions: {
    ...DEFAULT_JOB_OPTIONS,
    attempts: 3, // analytics can retry more aggressively
  },
});

/** Cleanup uploaded videos from disk to save space */
export const cleanupQueue = new Queue('cleanup', {
  connection: redis,
  defaultJobOptions: {
    ...DEFAULT_JOB_OPTIONS,
    removeOnComplete: { count: 10 },
  },
});

// ── Typed Job Dispatch ──────────────────────────────────────

export type QueueName = 'upload' | 'warmup' | 'cookies' | 'edit-profile' | 'analytics-cron' | 'cleanup';

const QUEUES: Record<QueueName, Queue> = {
  upload: uploadQueue,
  warmup: warmupQueue,
  cookies: cookiesQueue,
  'edit-profile': editProfileQueue,
  'analytics-cron': analyticsCronQueue,
  cleanup: cleanupQueue,
};

/**
 * Add a job to a named queue with typed data.
 * Returns the BullMQ job ID for tracking.
 */
export async function addJob(
  queueName: QueueName,
  data: Record<string, unknown>,
  options?: Partial<JobsOptions>,
) {
  const queue = QUEUES[queueName];
  const job = await queue.add(queueName, data, options);
  return job.id;
}
