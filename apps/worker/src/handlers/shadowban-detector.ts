// ─────────────────────────────────────────────────────────────
// Shadowban Detector — DB-backed shadowban detection handler
//
// Queue: "shadowban-check" (BullMQ cron, every 12 hours)
//
// Strategy: DB-backed analytics (v3.1, default)
//   - Uses stored video data from the analytics cron
//   - No live TikTok API calls, no cookies needed
//   - Checks if N consecutive videos (each >=24h old)
//     have <100 views → SHADOWBAN_SUSPECTED
//
// The legacy curl-impersonate approach (liveTikTokShadowbanCheck)
// is preserved for manual debugging but is NOT wired as the
// BullMQ handler. It leaks anti-fraud signals to TikTok's
// rate-limiter and should only be used as a last-resort fallback.
// ─────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { addJob } from '../lib/bullmq.js';
import { SocketLogger } from '../lib/socket-logger.js';
import { emitWorkerError } from '../lib/error-classifier.js';

// ── Constants ───────────────────────────────────────────────

/**
 * Shadowban detection thresholds.
 *
 * The 24-hour gate is critical: fresh videos with low view counts are
 * statistically normal (TikTok ramps distribution over hours, not minutes).
 * Without this gate, a 30-min-old video with 50 views would falsely flag
 * the account and block its entire upload queue.
 */
const SHADOWBAN_MIN_VIDEO_AGE_HOURS = 24;
const SHADOWBAN_VIEW_THRESHOLD = 100;
const SHADOWBAN_CONSECUTIVE_VIDEOS = 3;
const SHADOWBAN_LOOKBACK_DAYS = 14;

// ── Types ───────────────────────────────────────────────────

interface ShadowbanCheckJobData {
  userId: string;
  accountId: string;
}

export interface ShadowbanResult {
  accountId: string;
  flagged: boolean;
  reason?: string;
  matchedVideos?: string[];
  checkedAt: Date;
}

// ── BullMQ Handler (DB-backed, default) ─────────────────────

export async function shadowbanDetectorHandler(
  job: Job<ShadowbanCheckJobData>,
): Promise<ShadowbanResult> {
  // ── Cron dispatch: fan out to individual account jobs ──
  // The repeatable cron fires with { _cron: true } — no accountId.
  // We need to find all eligible accounts and enqueue individual checks.
  if ((job.data as any)._cron && !job.data.accountId) {
    const accounts = await prisma.socialAccount.findMany({
      where: {
        status: 'ALIVE',
        warmupCompletedAt: { not: null },
      },
      select: { id: true, userId: true },
    });

    console.log(`[Shadowban] Cron dispatch: found ${accounts.length} eligible accounts`);

    let dispatched = 0;
    for (const acc of accounts) {
      await addJob(
        'shadowban-check',
        { userId: acc.userId, accountId: acc.id },
        { delay: dispatched * 3_000, jobId: `shadowban-${acc.id}` },
      );
      dispatched++;
    }

    console.log(`[Shadowban] Dispatched ${dispatched} individual checks`);

    return {
      accountId: 'cron-dispatch',
      flagged: false,
      reason: `Dispatched ${dispatched} checks`,
      checkedAt: new Date(),
    };
  }

  const { accountId, userId } = job.data;
  const logger = new SocketLogger(userId);

  try {
    logger.info(`🔍 Проверка shadowban для ${accountId} (DB-backed)...`);

    const result = await detectShadowbanForAccount(accountId);

    if (result.flagged) {
      logger.warn(
        `⚠️ SHADOWBAN DETECTED: ${accountId} — ${result.reason}`,
      );
    } else {
      logger.info(`✅ Shadowban не обнаружен для ${accountId}`);
    }

    await job.updateProgress(100);

    return {
      accountId,
      flagged: result.flagged,
      reason: result.reason,
      matchedVideos: result.matchedVideos,
      checkedAt: new Date(),
    };

  } catch (err: unknown) {
    emitWorkerError(logger, accountId, 'shadowban', err);
    throw err;
  } finally {
    logger.disconnect();
  }
}

// ── Core Detection Logic ────────────────────────────────────

export async function detectShadowbanForAccount(accountId: string): Promise<{
  flagged: boolean;
  reason?: string;
  matchedVideos?: string[];
}> {
  const account = await prisma.socialAccount.findUniqueOrThrow({
    where: { id: accountId },
    select: {
      id: true,
      userId: true,
      nickname: true,
      status: true,
      warmupCompletedAt: true,
    },
  });

  // Only flag warmed-up accounts in a normal state.
  if (account.status !== "ALIVE") return { flagged: false };
  if (!account.warmupCompletedAt) return { flagged: false };

  const ageGateThreshold = new Date(
    Date.now() - SHADOWBAN_MIN_VIDEO_AGE_HOURS * 3_600_000,
  );
  const lookbackThreshold = new Date(
    Date.now() - SHADOWBAN_LOOKBACK_DAYS * 86_400_000,
  );

  // Fetch only videos that:
  //  1. Are at least 24h old (give TikTok time to ramp distribution).
  //  2. Are within the 14-day lookback window (older videos aren't representative).
  // Ordered newest-first so we evaluate the most recent N consecutive ones.
  const candidates = await prisma.video.findMany({
    where: {
      accountId,
      userId: account.userId, // BUG-L3 fix: userId scope for consistency
      uploadedAt: {
        lte: ageGateThreshold,   // CRITICAL: video must be >= 24h old
        gte: lookbackThreshold,
      },
    },
    orderBy: { uploadedAt: "desc" },
    take: SHADOWBAN_CONSECUTIVE_VIDEOS,
    select: { id: true, views: true, uploadedAt: true },
  });

  if (candidates.length < SHADOWBAN_CONSECUTIVE_VIDEOS) {
    // Not enough aged data — explicitly do nothing. Account stays ALIVE.
    return { flagged: false };
  }

  const allLowView = candidates.every(
    (v: { id: string; views: number; uploadedAt: Date | null }) => v.views < SHADOWBAN_VIEW_THRESHOLD,
  );

  if (!allLowView) return { flagged: false };

  // Flag it.
  await prisma.socialAccount.update({
    where: { id: accountId },
    data: { status: "SHADOWBAN_SUSPECTED" },
  });

  // Cancel any pending upload jobs for this account.
  await prisma.task.updateMany({
    where: { accountId, status: "PENDING", type: "UPLOAD" },
    data: { status: "CANCELLED", cancelReason: "SHADOWBAN_SUSPECTED" },
  });

  const socketLogger = new SocketLogger(account.userId);
  socketLogger.warn(
    `[Shadowban] Account ${account.nickname} flagged: ` +
    `${candidates.length} consecutive videos (>=24h old) with <${SHADOWBAN_VIEW_THRESHOLD} views. ` +
    `Pending uploads cancelled. Recommend manual organic post from mobile after 7-day cooldown.`,
  );
  socketLogger.disconnect();

  return {
    flagged: true,
    reason:
      `${candidates.length} consecutive videos (each >=24h old) under ${SHADOWBAN_VIEW_THRESHOLD} views`,
    matchedVideos: candidates.map((v: { id: string }) => v.id),
  };
}

