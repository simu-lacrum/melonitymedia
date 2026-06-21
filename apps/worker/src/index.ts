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
import { Worker, Job, Queue } from 'bullmq';
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
import { prisma } from './lib/prisma.js';

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
  { name: 'analytics-cron',  handler: analyticsHandler,            concurrency: 1 },
  { name: 'cleanup',         handler: cleanupHandler,              concurrency: 1 },
  { name: 'shadowban-check', handler: shadowbanDetectorHandler,    concurrency: 2 },
  { name: 'login',           handler: loginHandler,                concurrency: 3 },
];

const TASK_QUEUE_BY_TYPE: Record<string, WorkerQueueName> = {
  UPLOAD: 'upload',
  WARMUP: 'warmup',
  COOKIES: 'cookies',
  EDIT_PROFILE: 'edit-profile',
  ANALYTICS_CRON: 'analytics-cron',
  SHADOWBAN_CHECK: 'shadowban-check',
  LOGIN: 'login',
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getTaskId(job: Job<any>): string | null {
  const taskId = asRecord(job.data).taskId;
  return typeof taskId === 'string' && taskId.length > 0 ? taskId : null;
}

function getJobAccountId(job: Job<any>): string | null {
  const accountId = asRecord(job.data).accountId;
  return typeof accountId === 'string' && accountId.length > 0 ? accountId : null;
}

function collectTaskJobIds(task: { bullmqJobId: string | null; config: unknown }, fallbackJobId?: string): string[] {
  const jobIds = new Set<string>();
  if (task.bullmqJobId) jobIds.add(task.bullmqJobId);
  if (fallbackJobId) jobIds.add(fallbackJobId);

  const dispatchedJobs = asRecord(task.config).dispatchedJobs;
  if (Array.isArray(dispatchedJobs)) {
    for (const item of dispatchedJobs) {
      const jobId = asRecord(item).jobId;
      if (typeof jobId === 'string' && jobId.length > 0) {
        jobIds.add(jobId);
      }
    }
  }

  return [...jobIds];
}

function collectTaskAccountIds(task: { accountId?: string | null; config: unknown }): string[] {
  const accountIds = new Set<string>();
  if (task.accountId) accountIds.add(task.accountId);

  const configuredIds = asRecord(task.config).accountIds;
  if (Array.isArray(configuredIds)) {
    for (const id of configuredIds) {
      if (typeof id === 'string' && id.length > 0) {
        accountIds.add(id);
      }
    }
  }

  return [...accountIds];
}

const taskQueueClients = new Map<WorkerQueueName, Queue>();
for (const config of QUEUE_CONFIGS) {
  taskQueueClients.set(config.name, new Queue(config.name, { connection }));
}

async function markTaskRunningIfNeeded(job: Job<any>) {
  const taskId = getTaskId(job);
  if (!taskId) return true;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { status: true },
  });

  if (task?.status === 'CANCELLED') {
    console.log(`[Worker:${job.queueName}] Job ${job.id} skipped: parent task ${taskId} was cancelled`);
    return false;
  }

  await prisma.task.updateMany({
    where: { id: taskId, status: 'PENDING' },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  return true;
}

async function refreshTaskAfterTerminalJob(job: Job<any>, error?: string) {
  const taskId = getTaskId(job);
  if (!taskId) return;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      type: true,
      status: true,
      config: true,
      bullmqJobId: true,
      error: true,
      accountId: true,
    },
  });

  if (!task || task.status === 'CANCELLED') return;

  const queueName = TASK_QUEUE_BY_TYPE[task.type] ?? (job.queueName as WorkerQueueName);
  const queue = taskQueueClients.get(queueName);
  if (!queue) return;

  const states = await Promise.all(
    collectTaskJobIds(task, job.id).map(async (jobId) => {
      const trackedJob = await queue.getJob(jobId);
      if (!trackedJob) return 'missing';
      return trackedJob.getState();
    }),
  );

  const isStillInFlight = states.some(state =>
    ['active', 'waiting', 'waiting-children', 'delayed', 'prioritized', 'paused'].includes(state),
  );
  const hasFailed = states.some(state => state === 'failed');

  if (isStillInFlight) {
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'RUNNING',
        ...(error ? { error } : {}),
      },
    });
    return;
  }

  if (task.type === 'WARMUP') {
    const accountIds = collectTaskAccountIds(task);

    if (hasFailed) {
      const failedAccountId = getJobAccountId(job);
      if (failedAccountId) {
        await prisma.socialAccount.updateMany({
          where: {
            id: failedAccountId,
            status: 'WARMING_UP',
            warmupCompletedAt: null,
          },
          data: {
            status: 'ALIVE',
            lastError: error ?? 'Warmup job failed',
          },
        });
      }
    }

    const warmingAccounts = accountIds.length === 0
      ? 0
      : await prisma.socialAccount.count({
          where: {
            id: { in: accountIds },
            status: 'WARMING_UP',
            warmupCompletedAt: null,
          },
        });

    if (warmingAccounts > 0) {
      await prisma.task.update({
        where: { id: task.id },
        data: {
          status: 'RUNNING',
          ...(error ? { error } : {}),
        },
      });
      return;
    }
  }

  await prisma.task.update({
    where: { id: task.id },
    data: {
      status: hasFailed ? 'FAILED' : 'COMPLETED',
      progress: hasFailed ? undefined : 100,
      error: hasFailed ? (error ?? task.error ?? 'One or more jobs failed') : null,
      completedAt: new Date(),
    },
  });
}

const workers: Worker[] = [];

for (const config of QUEUE_CONFIGS) {
  const worker = new Worker(
    config.name,
    async (job) => {
      console.log(`\n[Worker:${config.name}] ▶ Job ${job.id} started`);
      console.log(`[Worker:${config.name}] Data: userId=${job.data.userId}`);

      try {
        const shouldRun = await markTaskRunningIfNeeded(job);
        if (!shouldRun) {
          return { skipped: true, reason: 'TASK_CANCELLED' };
        }

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
    if (!job) return;
    const maxAttempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
    if (job.attemptsMade >= maxAttempts) {
      refreshTaskAfterTerminalJob(job, err.message)
        .catch(trackErr => console.error(`[Worker:${config.name}] Task status update failed:`, trackErr));
    }
  });

  worker.on('completed', (job) => {
    console.log(`[Worker:${config.name}] Job ${job.id} COMPLETED`);
    refreshTaskAfterTerminalJob(job)
      .catch(err => console.error(`[Worker:${config.name}] Task status update failed:`, err));
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

    await Promise.all([...taskQueueClients.values()].map(q => q.close()));
    console.log('[Worker] Queue clients closed');

    await prisma.$disconnect();
    console.log('[Worker] Prisma disconnected');

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
