// ─────────────────────────────────────────────────────────────
// Cron Scheduler — Repeatable BullMQ jobs for background tasks
//
// Runs on API startup. Uses BullMQ's built-in repeatable jobs
// (Redis-backed, survives restarts). Schedules:
//   1. analytics-cron: Collect stats for ALL user accounts every 6 hours
//   2. shadowban-check: Check for shadowbans every 12 hours
//
// Idempotent: BullMQ deduplicates repeatables by (name + pattern),
// so calling this on every startup is safe.
// ─────────────────────────────────────────────────────────────

import { analyticsCronQueue, shadowbanCheckQueue } from './bullmq.js';
import { prisma } from './prisma.js';

/**
 * Register all repeatable cron jobs.
 * Call once on server startup.
 */
export async function registerCronJobs(): Promise<void> {
  // ── Analytics Cron (every 6 hours) ─────────────────────────
  // Enqueues one job per active account to collect stats.
  // Uses a BullMQ repeatable to trigger a dispatcher that fans out.
  await analyticsCronQueue.add(
    'analytics-dispatch',
    { _cron: true },
    {
      repeat: {
        pattern: '0 */6 * * *', // every 6 hours: 00:00, 06:00, 12:00, 18:00
      },
      jobId: 'analytics-dispatch-cron', // fixed ID for deduplication
    },
  );

  // ── Shadowban Check (every 12 hours) ──────────────────────
  await shadowbanCheckQueue.add(
    'shadowban-dispatch',
    { _cron: true },
    {
      repeat: {
        pattern: '0 */12 * * *', // every 12 hours: 00:00, 12:00
      },
      jobId: 'shadowban-dispatch-cron',
    },
  );

  console.log('[Cron] Registered repeatable jobs: analytics (6h), shadowban (12h)');
}

/**
 * Fan out analytics jobs for all active accounts.
 * Called by the analytics-cron worker when the repeatable fires.
 * Can also be triggered manually from an admin endpoint.
 */
export async function fanOutAnalyticsJobs(): Promise<number> {
  const accounts = await prisma.socialAccount.findMany({
    where: { status: 'ALIVE' },
    select: { id: true, userId: true, secUid: true, nickname: true },
  });

  let dispatched = 0;

  for (const acc of accounts) {
    await analyticsCronQueue.add(
      `analytics-${acc.id}`,
      {
        userId: acc.userId,
        accountId: acc.id,
        secUid: acc.secUid,
        nickname: acc.nickname,
      },
      {
        // Stagger jobs by 5 seconds to avoid rate-limiting
        delay: dispatched * 5_000,
      },
    );
    dispatched++;
  }

  console.log(`[Cron] Dispatched ${dispatched} analytics jobs`);
  return dispatched;
}

/**
 * Fan out shadowban check jobs for all eligible accounts.
 */
export async function fanOutShadowbanJobs(): Promise<number> {
  const accounts = await prisma.socialAccount.findMany({
    where: {
      status: 'ALIVE',
      warmupCompletedAt: { not: null },
    },
    select: { id: true, userId: true },
  });

  let dispatched = 0;

  for (const acc of accounts) {
    await shadowbanCheckQueue.add(
      `shadowban-${acc.id}`,
      {
        userId: acc.userId,
        accountId: acc.id,
      },
      {
        delay: dispatched * 3_000,
      },
    );
    dispatched++;
  }

  console.log(`[Cron] Dispatched ${dispatched} shadowban check jobs`);
  return dispatched;
}
