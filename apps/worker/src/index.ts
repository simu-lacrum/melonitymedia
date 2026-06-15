// ─────────────────────────────────────────────────────────────
// MelonityMedia Worker v3.0 — Patchright Job Processor
//
// This process runs inside a Docker container with:
// - Xvfb (virtual display at :99)
// - Google Chrome (real browser, not Chromium)
// - Patchright (CDP-based anti-detection patches)
// - curl-impersonate (TLS fingerprint impersonation binary)
// - ffmpeg (video uniquification pipeline)
//
// It consumes jobs from 8 BullMQ queues and dispatches them
// to the appropriate handler. All browser tasks use Patchright
// with per-account fingerprints and cookie-only auth.
//
// Queue → Handler mapping:
//   upload         → uploadHandler          (video upload with uniquification)
//   warmup         → warmupHandler          (10-day progressive curriculum)
//   cookies        → cookiesHandler         (export/refresh session cookies)
//   edit-profile   → editProfileHandler     (update profile bio/name)
//   analytics-cron → analyticsHandler       (curl-impersonate JSON API stats)
//   cleanup        → cleanupHandler         (delete videos after upload)
//   shadowban-check→ shadowbanDetectorHandler (12h cron shadowban detection)
//
// FORBIDDEN imports: puppeteer, selenium, undetected-chromedriver
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
  shadowbanDetectorHandler,
  loginHandler,
} from './handlers/index.js';

// ── Master Key Validation ───────────────────────────────────
// Fail fast if MASTER_KEY is missing/invalid — don't process any jobs
if (!process.env.MASTER_KEY) {
  console.error(
    '\n╔══════════════════════════════════════════════════════════════╗\n' +
    '║  FATAL: MASTER_KEY is required for cookie encryption        ║\n' +
    '║  Generate: node -e "console.log(require(\'crypto\')         ║\n' +
    '║    .randomBytes(32).toString(\'base64\'))"                   ║\n' +
    '╚══════════════════════════════════════════════════════════════╝\n',
  );
  process.exit(1);
}
const masterKey = Buffer.from(process.env.MASTER_KEY, 'base64');
if (masterKey.length !== 32) {
  console.error(
    '\n╔══════════════════════════════════════════════════════════════╗\n' +
    '║  FATAL: MASTER_KEY must be 32 bytes (base64 encoded)       ║\n' +
    '║  Generate: node -e "console.log(require(\'crypto\')         ║\n' +
    '║    .randomBytes(32).toString(\'base64\'))"                   ║\n' +
    '╚══════════════════════════════════════════════════════════════╝\n',
  );
  process.exit(1);
}

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const connection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

// ── Queue → Handler Mapping ─────────────────────────────────
// Each queue has a dedicated handler function and concurrency limit.
// Upload/warmup run 3 concurrent (limited by proxy count),
// analytics uses 2 (lightweight curl-impersonate, no browser),
// cleanup runs 1 (filesystem operations, no race conditions).

type WorkerQueueName =
  | 'upload'
  | 'warmup'
  | 'cookies'
  | 'edit-profile'
  | 'analytics-cron'
  | 'cleanup'
  | 'shadowban-check'
  | 'login';

interface QueueConfig {
  name: WorkerQueueName;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each handler defines its own typed JobData internally
  handler: (job: Job<any>) => Promise<any>;
  concurrency: number;
}

const QUEUE_CONFIGS: QueueConfig[] = [
  { name: 'upload',          handler: uploadHandler,               concurrency: 3 },
  { name: 'warmup',          handler: warmupHandler,               concurrency: 3 },
  { name: 'cookies',         handler: cookiesHandler,              concurrency: 3 },
  { name: 'edit-profile',    handler: editProfileHandler,          concurrency: 3 },
  { name: 'analytics-cron',  handler: analyticsHandler,            concurrency: 2 },
  { name: 'cleanup',         handler: cleanupHandler,              concurrency: 1 },
  { name: 'shadowban-check', handler: shadowbanDetectorHandler,    concurrency: 2 },
  { name: 'login',           handler: loginHandler,                concurrency: 3 },
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
╔══════════════════════════════════════════════════════════════╗
║     MelonityMedia Worker v3.0                                ║
║     Browser: Patchright (patched Playwright)                 ║
║     Scraper: curl-impersonate (TLS impersonation)            ║
║     Video:   ffmpeg (uniquification pipeline)                ║
║     Auth:    cookie-only (AES-256-GCM encrypted)             ║
║     Queues:  ${QUEUE_CONFIGS.length} active                                          ║
║     Display: ${process.env.DISPLAY || 'N/A'}                                             ║
╚══════════════════════════════════════════════════════════════╝
`);

// ── Graceful Shutdown ───────────────────────────────────────
// On SIGTERM (docker stop / CI/CD deploy):
// 1. Stop accepting NEW jobs
// 2. Wait for CURRENT jobs to finish (upload can take 5-10 min)
// 3. Close Redis connection
// Docker stop_grace_period is set to 10m in docker-compose.yml
// Hard timeout here is 9.5m as safety before Docker SIGKILL
const HARD_TIMEOUT_MS = 9.5 * 60 * 1000; // 9.5 minutes

let isShuttingDown = false;

const shutdown = async (signal: string) => {
  if (isShuttingDown) return; // prevent double-shutdown
  isShuttingDown = true;

  console.log(`\n[Worker] ⚠️  Received ${signal}. Starting graceful shutdown...`);
  console.log(`[Worker] Waiting for active jobs to complete (timeout: 9.5min)...`);

  // Hard timeout — if jobs hang, force exit before Docker SIGKILL
  const hardTimer = setTimeout(() => {
    console.error('[Worker] ⛔ Hard timeout reached. Force exiting.');
    process.exit(1);
  }, HARD_TIMEOUT_MS);
  hardTimer.unref(); // don't keep process alive just for this timer

  try {
    // Worker.close() waits for running jobs to finish, then stops polling
    await Promise.all(workers.map(w => w.close()));
    console.log('[Worker] ✅ All workers closed gracefully');

    await connection.quit();
    console.log('[Worker] ✅ Redis disconnected');
  } catch (err) {
    console.error('[Worker] Error during shutdown:', err);
  }

  clearTimeout(hardTimer);
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
