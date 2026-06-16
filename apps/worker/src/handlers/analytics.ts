// ─────────────────────────────────────────────────────────────
// Analytics Handler v2 — curl-impersonate JSON API
//
// MAJOR CHANGES from v1:
// 1. cheerio + HTML parsing → curl-impersonate + TikTok JSON API
// 2. No browser needed for stats collection
// 3. TLS fingerprint impersonation to bypass Cloudflare
// 4. Lightweight: ~200ms per profile vs ~30s with browser
//
// TikTok closed public HTML scraping in 2024. The only reliable
// method is their internal JSON API with valid cookies + TLS
// fingerprint matching a real Chrome browser.
// ─────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { impersonatedFetch } from '../core/tls/curl-impersonate-client.js';
import { loadCookiesFromEncryptedStore, type BrowserCookie } from '../core/auth/cookie-store.js';
import { SocketLogger } from '../lib/socket-logger.js';
import { emitWorkerError } from '../lib/error-classifier.js';
import { loadAccountContext } from '../lib/account-context.js';
import { prisma } from '../lib/prisma.js';
import type { AccountFingerprint } from '../core/browser/fingerprint-manager.js';

// ── Types ───────────────────────────────────────────────────

interface AnalyticsJobData {
  userId: string;
  accountId: string;
  // platform, fingerprint, proxyUrl resolved from DB via loadAccountContext()
  cookiesDir?: string;
  /** TikTok secUid for API requests */
  secUid?: string;
  /** TikTok nickname for Referer header */
  nickname?: string;
}

export interface ProfileStats {
  followers: number;
  following: number;
  views: number;
  likes: number;
  videos: number;
  snapshotAt: Date;
}

/** Internal type with DB-resolved context merged in */
type ResolvedAnalyticsData = AnalyticsJobData & {
  platform: 'TIKTOK' | 'YOUTUBE';
  fingerprint: AccountFingerprint;
  proxyUrl?: string;
};

// ── Main ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function analyticsHandler(job: Job<any>): Promise<ProfileStats | { dispatched: number }> {
  const data = job.data;

  // ── Cron Dispatch Mode ──────────────────────────────────
  // When triggered by a BullMQ repeatable (has _cron flag),
  // fan out individual analytics jobs for all ALIVE accounts.
  if (data._cron) {
    // ── Safety net: unstick stale VERIFYING accounts ─────
    // If a login dispatch silently failed (Redis blip, worker crash),
    // accounts remain in VERIFYING forever. Reset any that have been
    // stuck for more than 15 minutes so the user can see AUTH_NEEDED
    // and retry manually.
    const staleThreshold = new Date(Date.now() - 15 * 60 * 1000);
    const stale = await prisma.socialAccount.updateMany({
      where: {
        status: 'VERIFYING',
        updatedAt: { lt: staleThreshold },
      },
      data: { status: 'AUTH_NEEDED' },
    });
    if (stale.count > 0) {
      console.log(`[Analytics] Safety net: reset ${stale.count} stale VERIFYING accounts to AUTH_NEEDED`);
    }

    // H-6 FIX: Use shared bullmq addJob instead of creating a new Queue each time
    const { addJob } = await import('../lib/bullmq.js');

    // Cursor-based batching: load accounts in chunks of 500 to prevent OOM
    const BATCH_SIZE = 500;
    let cursor: string | undefined = undefined;
    let dispatched = 0;
    let hasMore = true;

    while (hasMore) {
      const accounts: { id: string; userId: string; secUid: string | null; nickname: string | null }[] = await prisma.socialAccount.findMany({
        where: { status: 'ALIVE' },
        select: { id: true, userId: true, secUid: true, nickname: true },
        take: BATCH_SIZE,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { id: 'asc' },
      });

      if (accounts.length === 0) {
        hasMore = false;
        break;
      }

      cursor = accounts[accounts.length - 1].id;

      for (const acc of accounts) {
        await addJob('analytics-cron', {
          userId: acc.userId,
          accountId: acc.id,
          secUid: acc.secUid,
          nickname: acc.nickname,
        }, {
          delay: dispatched * 5_000, // 5s stagger to avoid rate-limits
          jobId: `analytics-${acc.id}`,
        });
        dispatched++;
      }

      if (accounts.length < BATCH_SIZE) hasMore = false;
    }

    console.log(`[Analytics] Cron fan-out: dispatched ${dispatched} jobs`);
    return { dispatched };
  }

  // ── Per-Account Analytics Mode ────────────────────────────
  const logger = new SocketLogger(data.userId);

  try {
    // Resolve fresh account context from DB (not stale job payload)
    const ctxAcc = await loadAccountContext(data.accountId);
    const { platform, fingerprint, proxyUrl } = ctxAcc;

    logger.info(`📊 Сбор аналитики для ${data.accountId} (${platform})...`);

    // Merge resolved context with job-specific data
    const resolvedData = { ...data, platform, fingerprint, proxyUrl };

    let stats: ProfileStats;

    if (platform === 'TIKTOK') {
      stats = await _fetchTikTokStats(resolvedData, logger);
    } else {
      stats = await _fetchYouTubeStats(resolvedData, logger);
    }

    // ── Persist stats to DB ─────────────────────────────────
    // Without this, the dashboard summary/views-chart and shadowban
    // detector have no data to work with.
    await _persistStats(data.accountId, stats, logger);

    logger.info(
      `📊 ${data.accountId}: ${stats.followers} подписчиков, ` +
      `${stats.views} просмотров, ${stats.likes} лайков, ` +
      `${stats.videos} видео`,
    );

    await job.updateProgress(100);
    return stats;

  } catch (err: unknown) {
    emitWorkerError(logger, data.accountId, 'analytics', err);
    throw err;
  } finally {
    logger.disconnect();
  }
}

// ── TikTok Stats via JSON API ───────────────────────────────

async function _fetchTikTokStats(
  data: ResolvedAnalyticsData,
  logger: SocketLogger,
): Promise<ProfileStats> {
  const cookies = await loadCookiesFromEncryptedStore(data.accountId, data.cookiesDir);
  if (cookies.length === 0) {
    throw new Error('Нет cookies для аккаунта — невозможно получить статистику');
  }

  const cookieHeader = _formatCookies(cookies);

  // TikTok user detail API — requires valid session cookies
  const url = data.secUid
    ? `https://www.tiktok.com/api/user/detail/?secUid=${data.secUid}&aid=1988`
    : 'https://www.tiktok.com/api/user/detail/?aid=1988';

  const resp = await impersonatedFetch({
    url,
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
    throw new Error(`TikTok API вернул ${resp.status}`);
  }

  try {
    const body = JSON.parse(resp.body);

    if (!body.userInfo) {
      logger.warn('TikTok вернул пустой userInfo — cookies могут быть невалидны');
      return _emptyStats();
    }

    const s = body.userInfo.stats || {};
    return {
      followers: s.followerCount ?? 0,
      following: s.followingCount ?? 0,
      views: s.videoCount ? s.heartCount : 0, // approx total views
      likes: s.heartCount ?? 0,
      videos: s.videoCount ?? 0,
      snapshotAt: new Date(),
    };
  } catch {
    logger.warn('Не удалось распарсить ответ TikTok API');
    return _emptyStats();
  }
}

// ── YouTube Stats via curl-impersonate ──────────────────────

async function _fetchYouTubeStats(
  data: ResolvedAnalyticsData,
  logger: SocketLogger,
): Promise<ProfileStats> {
  const cookies = await loadCookiesFromEncryptedStore(data.accountId, data.cookiesDir);
  if (cookies.length === 0) {
    throw new Error('Нет cookies для YouTube аккаунта');
  }

  const cookieHeader = _formatCookies(cookies);

  // YouTube Studio analytics API
  const resp = await impersonatedFetch({
    url: 'https://studio.youtube.com/youtubei/v1/analytics_data/get_screen?alt=json',
    method: 'POST',
    impersonate: 'chrome116',
    cookies: cookieHeader,
    proxy: data.proxyUrl,
    headers: {
      'User-Agent': data.fingerprint.userAgent,
      'Content-Type': 'application/json',
      'Origin': 'https://studio.youtube.com',
    },
    body: JSON.stringify({
      context: {
        client: { clientName: 'WEB_CREATOR', clientVersion: '1.0' },
      },
    }),
    timeoutMs: 15_000,
  });

  if (resp.status !== 200) {
    logger.warn(`YouTube API вернул ${resp.status} — пробую базовый парсинг`);
    return _emptyStats();
  }

  try {
    const body = JSON.parse(resp.body);
    // YouTube Studio response is deeply nested — extract what we can
    return {
      followers: body?.subscriberCount ?? 0,
      following: 0,
      views: body?.totalViews ?? 0,
      likes: body?.totalLikes ?? 0,
      videos: body?.videoCount ?? 0,
      snapshotAt: new Date(),
    };
  } catch {
    return _emptyStats();
  }
}

// ── Utility ─────────────────────────────────────────────────

function _formatCookies(cookies: BrowserCookie[]): string {
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

function _emptyStats(): ProfileStats {
  return {
    followers: 0,
    following: 0,
    views: 0,
    likes: 0,
    videos: 0,
    snapshotAt: new Date(),
  };
}

/**
 * Persist collected stats to the database.
 * Updates SocialAccount (followers, views) and per-video views
 * so the dashboard, views-chart, and shadowban detector work.
 */
async function _persistStats(
  accountId: string,
  stats: ProfileStats,
  logger: SocketLogger,
): Promise<void> {
  try {
    // Update account-level aggregate stats
    const account = await prisma.socialAccount.update({
      where: { id: accountId },
      data: {
        views: stats.views,
        followers: stats.followers,
      },
      select: { userId: true },
    });

    // Upsert daily snapshot for real time-series charts
    // One row per account per calendar day — if analytics runs
    // multiple times per day, the latest values win.
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await prisma.dailySnapshot.upsert({
      where: {
        accountId_date: { accountId, date: today },
      },
      create: {
        accountId,
        userId: account.userId,
        date: today,
        views: stats.views,
        followers: stats.followers,
        likes: stats.likes,
        videos: stats.videos,
      },
      update: {
        views: stats.views,
        followers: stats.followers,
        likes: stats.likes,
        videos: stats.videos,
      },
    });

    logger.info(`💾 Статистика сохранена: views=${stats.views}, followers=${stats.followers}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`⚠️ Не удалось сохранить статистику в БД: ${message}`);
    // Don't throw — stats collection succeeded, only persistence failed.
    // The job should still be marked as completed.
  }
}

/**
 * Parse short numbers: "12.5K" → 12500, "1.2M" → 1200000
 * Kept for backward compatibility with any string-based stats.
 */
export function parseShortNumber(text: string): number {
  if (!text) return 0;
  const cleaned = text.trim().replace(/[, ]/g, '');

  const multipliers: Record<string, number> = {
    K: 1_000, k: 1_000,
    M: 1_000_000, m: 1_000_000,
    B: 1_000_000_000, b: 1_000_000_000,
    'тыс': 1_000, 'млн': 1_000_000,
  };

  for (const [suffix, multiplier] of Object.entries(multipliers)) {
    if (cleaned.endsWith(suffix)) {
      const num = parseFloat(cleaned.replace(suffix, ''));
      return Math.round(num * multiplier);
    }
  }

  return parseInt(cleaned, 10) || 0;
}
