// ─────────────────────────────────────────────────────────────
// Shared BullMQ Queue instances for worker self-scheduling
//
// H-6 FIX: Instead of creating a new Queue + Redis connection
// every time a handler needs to enqueue a follow-up job, we
// maintain a single shared instance per queue name.
// ─────────────────────────────────────────────────────────────

import { Queue } from 'bullmq';

// Parse Redis connection from REDIS_URL env var
function getRedisOpts() {
  const url = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379'),
    password: url.password || undefined,
  };
}

// Singleton map of queue instances (lazy-created)
const queues = new Map<string, Queue>();

function getQueue(name: string): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: getRedisOpts() });
    queues.set(name, q);
  }
  return q;
}

/**
 * Add a job to a named queue using a shared connection.
 * Returns the BullMQ job id.
 */
export async function addJob(
  queueName: string,
  data: Record<string, unknown>,
  opts?: { delay?: number; jobId?: string },
): Promise<string | undefined> {
  const queue = getQueue(queueName);
  const job = await queue.add(opts?.jobId ?? queueName, data, {
    delay: opts?.delay,
  });
  return job.id;
}

/**
 * Close all shared queue connections (call on graceful shutdown).
 */
export async function closeAllQueues(): Promise<void> {
  for (const [, q] of queues) {
    await q.close();
  }
  queues.clear();
}
