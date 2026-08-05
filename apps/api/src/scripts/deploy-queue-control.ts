import {
  analyticsCronQueue,
  cleanupQueue,
  cookiesQueue,
  editProfileQueue,
  loginQueue,
  shadowbanCheckQueue,
  uploadQueue,
  warmupQueue,
} from '../lib/bullmq.js';
import { redis } from '../lib/redis.js';

async function main() {
  const action = process.argv[2];
  if (action !== 'pause' && action !== 'resume') {
    throw new Error('Usage: deploy-queue-control <pause|resume>');
  }

  const queues = [
    uploadQueue,
    warmupQueue,
    cookiesQueue,
    editProfileQueue,
    loginQueue,
    analyticsCronQueue,
    shadowbanCheckQueue,
    cleanupQueue,
  ];

  try {
    await Promise.all(queues.map((queue) => action === 'pause' ? queue.pause() : queue.resume()));
    console.log(`[Deploy] Worker queues ${action === 'pause' ? 'paused' : 'resumed'}: ${queues.map(q => q.name).join(', ')}`);
  } finally {
    await Promise.allSettled(queues.map((queue) => queue.close()));
    await redis.quit().catch(() => {});
  }
}

void main().catch((error) => {
  console.error(`[Deploy] Queue control failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
