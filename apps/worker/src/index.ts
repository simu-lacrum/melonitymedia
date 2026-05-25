// ─────────────────────────────────────────────────────────────
// MelonityMedia Worker — BullMQ Job Processor
//
// This process runs inside a Docker container with:
// - Xvfb (virtual display at :99)
// - Google Chrome (real browser, not Chromium)
// - Stealth plugin (anti-detection)
//
// It consumes jobs from 6 BullMQ queues and dispatches them
// to the appropriate handler. Each handler gets a fresh
// BrowserAutomation instance per job.
//
// Lifecycle: connect → consume → process → report → wait
// ─────────────────────────────────────────────────────────────

import 'dotenv/config';
import { Worker } from 'bullmq';
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

// ── Queue Handlers ──────────────────────────────────────────
// Each queue gets its own BullMQ Worker instance.
// Handlers are imported from the handlers/ directory.
// For now, we register placeholder handlers that log the job data.

const QUEUES = ['upload', 'warmup', 'cookies', 'edit-profile', 'analytics-cron', 'cleanup'] as const;

const workers: Worker[] = [];

for (const queueName of QUEUES) {
  const worker = new Worker(
    queueName,
    async (job) => {
      console.log(`[Worker:${queueName}] Processing job ${job.id}`);
      console.log(`[Worker:${queueName}] Data:`, JSON.stringify(job.data, null, 2));

      // TODO: Import and call actual handlers
      // Example for upload queue:
      // if (queueName === 'upload') await uploadHandler(job);

      // Simulate work for now
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log(`[Worker:${queueName}] Job ${job.id} completed`);
    },
    {
      connection,
      concurrency: queueName === 'cleanup' ? 1 : 3,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[Worker:${queueName}] Job ${job?.id} failed:`, err.message);
  });

  worker.on('completed', (job) => {
    console.log(`[Worker:${queueName}] Job ${job.id} completed successfully`);
  });

  workers.push(worker);
}

console.log(`
╔══════════════════════════════════════════════╗
║     MelonityMedia Worker                     ║
║     Listening on ${QUEUES.length} queues                     ║
║     Display: ${process.env.DISPLAY || 'N/A'}                           ║
╚══════════════════════════════════════════════╝
`);

// ── Graceful Shutdown ───────────────────────────────────────
const shutdown = async (signal: string) => {
  console.log(`\n[Worker] Received ${signal}. Closing workers...`);
  await Promise.all(workers.map(w => w.close()));
  await connection.quit();
  console.log('[Worker] All workers closed');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
