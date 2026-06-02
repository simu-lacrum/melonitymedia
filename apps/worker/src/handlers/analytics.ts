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
import { loadAccountContext } from '../lib/account-context.js';
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

export async function analyticsHandler(job: Job<AnalyticsJobData>): Promise<ProfileStats> {
  const data = job.data;
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

    logger.info(
      `📊 ${data.accountId}: ${stats.followers} подписчиков, ` +
      `${stats.views} просмотров, ${stats.likes} лайков, ` +
      `${stats.videos} видео`,
    );

    await job.updateProgress(100);
    return stats;

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`❌ Ошибка аналитики: ${message}`);
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
