// ─────────────────────────────────────────────────────────────
// Shadowban Detector — Automated shadowban detection cron
//
// Runs every 12 hours. Checks all active accounts:
// 1. Fetches recent video views via curl-impersonate
// 2. If 3+ consecutive videos have <100 views after 24h:
//    → Mark account as SHADOWBAN_SUSPECTED
//    → Cancel all pending upload jobs
//    → Notify user via Socket.io
//
// Shadowban is TikTok's silent punishment: videos get 0 reach
// but the creator doesn't know. Early detection saves accounts.
// ─────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { impersonatedFetch } from '../core/tls/curl-impersonate-client.js';
import { loadCookiesFromEncryptedStore, type BrowserCookie } from '../core/auth/cookie-store.js';
import { SocketLogger } from '../lib/socket-logger.js';
import type { AccountFingerprint } from '../core/browser/fingerprint-manager.js';

// ── Constants ───────────────────────────────────────────────

/** Number of consecutive low-view videos to trigger shadowban alert */
const CONSECUTIVE_LOW_VIEWS = 3;

/** View threshold — below this after 24h = suspicious */
const LOW_VIEW_THRESHOLD = 100;

// ── Types ───────────────────────────────────────────────────

interface ShadowbanCheckData {
  userId: string;
  accountId: string;
  fingerprint: AccountFingerprint;
  proxyUrl?: string;
  cookiesDir?: string;
  secUid?: string;
  nickname?: string;
}

export interface ShadowbanResult {
  accountId: string;
  isShadowbanned: boolean;
  consecutiveLowViewVideos: number;
  recentVideoViews: number[];
  checkedAt: Date;
}

// ── Main ────────────────────────────────────────────────────

export async function shadowbanDetectorHandler(
  job: Job<ShadowbanCheckData>,
): Promise<ShadowbanResult> {
  const data = job.data;
  const logger = new SocketLogger(data.userId);

  try {
    logger.info(`🔍 Проверка shadowban для ${data.accountId}...`);

    const cookies = await loadCookiesFromEncryptedStore(data.accountId, data.cookiesDir);
    if (cookies.length === 0) {
      logger.warn('Нет cookies — пропуск проверки shadowban');
      return _emptyResult(data.accountId);
    }

    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Fetch recent video list via TikTok API
    const videosUrl = data.secUid
      ? `https://www.tiktok.com/api/post/item_list/?secUid=${data.secUid}&count=10&aid=1988`
      : 'https://www.tiktok.com/api/post/item_list/?count=10&aid=1988';

    const resp = await impersonatedFetch({
      url: videosUrl,
      impersonate: 'chrome116',
      cookies: cookieHeader,
      proxy: data.proxyUrl,
      headers: {
        'User-Agent': data.fingerprint.userAgent,
        'Accept': 'application/json',
        'Accept-Language': `${data.fingerprint.locale},en;q=0.9`,
        'Referer': data.nickname
          ? `https://www.tiktok.com/@${data.nickname}`
          : 'https://www.tiktok.com/',
      },
      timeoutMs: 15_000,
    });

    if (resp.status !== 200) {
      logger.warn(`TikTok API вернул ${resp.status} — пропуск проверки`);
      return _emptyResult(data.accountId);
    }

    const body = JSON.parse(resp.body);
    const items = body.itemList ?? [];

    if (items.length === 0) {
      logger.info('Нет видео для проверки — пропуск');
      return _emptyResult(data.accountId);
    }

    // Analyze views: count consecutive videos with <100 views after 24h
    const now = Date.now() / 1000; // seconds
    let consecutiveLow = 0;
    const recentViews: number[] = [];

    for (const item of items) {
      const createTime = item.createTime ?? 0;
      const ageSeconds = now - createTime;

      // Only check videos older than 24 hours
      if (ageSeconds < 86400) continue;

      const views = item.stats?.playCount ?? 0;
      recentViews.push(views);

      if (views < LOW_VIEW_THRESHOLD) {
        consecutiveLow++;
      } else {
        break; // Streak broken
      }
    }

    const isShadowbanned = consecutiveLow >= CONSECUTIVE_LOW_VIEWS;

    if (isShadowbanned) {
      logger.warn(
        `⚠️ SHADOWBAN DETECTED: ${data.accountId} — ` +
        `${consecutiveLow} видео подряд с <${LOW_VIEW_THRESHOLD} просмотрами`,
      );

      // Notify user via Socket.io
      logger.error(
        `🚨 Обнаружен shadowban на аккаунте! ` +
        `${consecutiveLow} видео подряд без охвата. ` +
        `Рекомендация: прекратить загрузку на 48-72 часа.`,
      );
    } else {
      logger.info(
        `✅ Shadowban не обнаружен (${consecutiveLow}/${CONSECUTIVE_LOW_VIEWS} подозрительных)`,
      );
    }

    await job.updateProgress(100);

    return {
      accountId: data.accountId,
      isShadowbanned,
      consecutiveLowViewVideos: consecutiveLow,
      recentVideoViews: recentViews,
      checkedAt: new Date(),
    };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`❌ Ошибка проверки shadowban: ${message}`);
    throw err;
  } finally {
    logger.disconnect();
  }
}

// ── Utility ─────────────────────────────────────────────────

function _emptyResult(accountId: string): ShadowbanResult {
  return {
    accountId,
    isShadowbanned: false,
    consecutiveLowViewVideos: 0,
    recentVideoViews: [],
    checkedAt: new Date(),
  };
}

// ── DB-backed shadowban detection (v3.1) ────────────────────
//
// Alternative to the curl-impersonate approach above.
// Uses stored video data from the analytics cron instead of
// making live TikTok API calls. Safer, faster, no cookies needed.

import { prisma } from '../lib/prisma.js';
import { SocketLogger as socketLoggerModule } from '../lib/socket-logger.js';

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
    (v) => v.views < SHADOWBAN_VIEW_THRESHOLD,
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

  const socketLogger = new socketLoggerModule(account.userId);
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
    matchedVideos: candidates.map((v) => v.id),
  };
}
