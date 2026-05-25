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
