// ─────────────────────────────────────────────────────────────
// Cron Scheduler — Repeatable BullMQ jobs for background tasks
//
// Runs on API startup. Uses BullMQ's built-in repeatable jobs
// (Redis-backed, survives restarts). Schedules:
//   1. analytics-cron: Collect stats for connected accounts once per day
//   2. shadowban-check: Check for shadowbans every 12 hours
//
// Idempotent: BullMQ deduplicates repeatables by (name + pattern),
// so calling this on every startup is safe.
// ─────────────────────────────────────────────────────────────

import { analyticsCronQueue, cookiesQueue, shadowbanCheckQueue } from './bullmq.js';
import { prisma } from './prisma.js';

export const ANALYTICS_CRON_PATTERN = '15 3 * * *';

function analyticsCollectionKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Register all repeatable cron jobs.
 * Call once on server startup.
 */
export async function registerCronJobs(): Promise<void> {
  // BullMQ identifies repeatables by name + pattern. Remove obsolete analytics
  // patterns explicitly so a previous six-hour schedule cannot survive deploy.
  const analyticsRepeatables = await analyticsCronQueue.getRepeatableJobs();
  for (const repeatable of analyticsRepeatables) {
    if (repeatable.name === 'analytics-dispatch' && repeatable.pattern !== ANALYTICS_CRON_PATTERN) {
      await analyticsCronQueue.removeRepeatableByKey(repeatable.key);
    }
  }

  // ── Analytics Cron (daily at 03:15 UTC) ────────────────────
  // Enqueues one job per connected account to collect stats.
  // Uses a BullMQ repeatable to trigger a dispatcher that fans out.
  await analyticsCronQueue.add(
    'analytics-dispatch',
    { _cron: true },
    {
      repeat: {
        pattern: ANALYTICS_CRON_PATTERN,
        tz: 'UTC',
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

  // Check every six hours, but only open accounts whose stored cookies have
  // not been refreshed for at least SESSION_REFRESH_MAX_AGE_HOURS (72 by default).
  await cookiesQueue.add(
    'session-maintenance-dispatch',
    { userId: 'system', _maintenanceDispatch: true },
    {
      repeat: {
        pattern: '35 */6 * * *',
      },
      jobId: 'session-maintenance-dispatch-cron',
    },
  );

  console.log('[Cron] Registered repeatable jobs: analytics (daily 03:15 UTC), shadowban (12h), session maintenance (6h)');
}

/**
 * Fan out analytics jobs for all connected accounts.
 * Called by the analytics-cron worker when the repeatable fires.
 * Can also be triggered manually from an admin endpoint.
 */
export async function fanOutAnalyticsJobs(): Promise<number> {
  const accounts = await prisma.socialAccount.findMany({
    where: {
      status: { in: ['ALIVE', 'WARMING_UP'] },
      cookiesEncrypted: { not: null },
      pinnedProxy: { is: { status: 'ACTIVE' } },
    },
    select: { id: true, userId: true, secUid: true, nickname: true },
  });

  let dispatched = 0;

  const collectionKey = analyticsCollectionKey();
  for (const acc of accounts) {
    await analyticsCronQueue.add(
      `analytics-${acc.id}`,
      {
        userId: acc.userId,
        accountId: acc.id,
        secUid: acc.secUid,
        nickname: acc.nickname,
        collectionKey,
        coordinationAttempt: 0,
      },
      {
        // Stagger jobs by 5 seconds to avoid rate-limiting
        delay: dispatched * 5_000,
        jobId: `analytics-${acc.id}-${collectionKey}`,
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
