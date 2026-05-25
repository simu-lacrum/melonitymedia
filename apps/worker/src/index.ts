// ─────────────────────────────────────────────────────────────
// MelonityMedia Worker — BullMQ Job Processor
//
// This process runs inside a Docker container with:
// - Xvfb (virtual display at :99)
// - Google Chrome (real browser, not Chromium)
// - UndetectedChrome (anti-detection ChromeDriver patches)
//
// It consumes jobs from 6 BullMQ queues and dispatches them
// to the appropriate handler. Each handler gets a fresh
// BrowserAutomation instance per job.
//
// Queue → Handler mapping:
//   upload        → uploadHandler     (video upload to TikTok/YT)
//   warmup        → warmupHandler     (profile warmup via browsing)
//   cookies       → cookiesHandler    (refresh session cookies)
//   edit-profile  → editProfileHandler(update profile bio/name)
//   analytics-cron→ analyticsHandler  (scrape profile stats)
//   cleanup       → cleanupHandler    (delete videos after upload)
//
// Lifecycle: connect → consume → process → report → wait
// ─────────────────────────────────────────────────────────────

import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';

import {
  uploadHandler,
  warmupHandler,
  cookiesHandler,
  analyticsHandler,
  editProfileHandler,
  cleanupHandler,
} from './handlers/index.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

// ── Queue → Handler Mapping ─────────────────────────────────
// Each queue has a dedicated handler function and concurrency limit.
// Upload/warmup run 3 concurrent (limited by proxy count),
// cleanup runs 1 (filesystem operations, no race conditions).

interface QueueConfig {
  name: string;
  handler: (job: Job) => Promise<unknown>;
  concurrency: number;
}

const QUEUE_CONFIGS: QueueConfig[] = [
  { name: 'upload',         handler: uploadHandler as (job: Job) => Promise<unknown>,       concurrency: 3 },
  { name: 'warmup',         handler: warmupHandler as (job: Job) => Promise<unknown>,       concurrency: 3 },
  { name: 'cookies',        handler: cookiesHandler as (job: Job) => Promise<unknown>,      concurrency: 3 },
  { name: 'edit-profile',   handler: editProfileHandler as (job: Job) => Promise<unknown>,  concurrency: 3 },
  { name: 'analytics-cron', handler: analyticsHandler as (job: Job) => Promise<unknown>,    concurrency: 2 },
  { name: 'cleanup',        handler: cleanupHandler as (job: Job) => Promise<unknown>,      concurrency: 1 },
];

const workers: Worker[] = [];

for (const config of QUEUE_CONFIGS) {
  const worker = new Worker(
    config.name,
    async (job) => {
      console.log(`\n[Worker:${config.name}] ▶ Job ${job.id} started`);
      console.log(`[Worker:${config.name}] Data: userId=${job.data.userId}`);

      try {
        const result = await config.handler(job);
        console.log(`[Worker:${config.name}] ✅ Job ${job.id} completed`);
        return result;
      } catch (err) {
        console.error(`[Worker:${config.name}] ❌ Job ${job.id} failed:`, err);
        throw err;
      }
    },
    {
      connection,
      concurrency: config.concurrency,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`[Worker:${config.name}] Job ${job?.id} FAILED:`, err.message);
  });

  worker.on('completed', (job) => {
    console.log(`[Worker:${config.name}] Job ${job.id} COMPLETED`);
  });

  workers.push(worker);
}

console.log(`
╔══════════════════════════════════════════════════════╗
║     MelonityMedia Worker v2.0                        ║
║     Browser: UndetectedChrome (Selenium)             ║
║     Parser:  cheerio (bs4 equivalent)                ║
║     Queues:  ${QUEUE_CONFIGS.length} active                                  ║
║     Display: ${process.env.DISPLAY || 'N/A'}                                     ║
╚══════════════════════════════════════════════════════╝
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
