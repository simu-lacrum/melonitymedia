// ─────────────────────────────────────────────────────────────
// Analytics Handler v3 — Browser-based stats collection
//
// WHY BROWSER instead of API:
// 1. We don't have API keys — only cookies from login flow
// 2. TikTok /api/user/detail/ requires secUid (never extracted)
// 3. YouTube Studio API has deeply nested responses (unreliable)
// 4. Browser reads real rendered DOM — always accurate
//
// The handler opens the user's own profile page in Patchright
// (which is already authenticated via saved cookies) and
// scrapes follower count, views, likes, video count from
// the rendered page elements.
//
// Runs every 6 hours via BullMQ cron dispatcher.
// ─────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { launchStealthContext, closeBrowser } from '../core/browser/patchright-launcher.js';
import { SocketLogger } from '../lib/socket-logger.js';
import { emitWorkerError } from '../lib/error-classifier.js';
import { loadAccountContext } from '../lib/account-context.js';
import { prisma } from '../lib/prisma.js';
import { acquireAccountLock, releaseAccountLock } from '../lib/account-lock.js';
import type { Browser } from 'patchright';

// ── Types ───────────────────────────────────────────────────

interface AnalyticsJobData {
  userId: string;
  accountId: string;
  cookiesDir?: string;
  secUid?: string;
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

// ── Main ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function analyticsHandler(job: Job<any>): Promise<ProfileStats | { dispatched: number }> {
  const data = job.data;

  // ── Cron Dispatch Mode ──────────────────────────────────
  if (data._cron) {
    // Safety net: unstick stale VERIFYING accounts
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

    const { addJob } = await import('../lib/bullmq.js');

    // Cursor-based batching
    const BATCH_SIZE = 500;
    let cursor: string | undefined = undefined;
    let dispatched = 0;
    let hasMore = true;

    while (hasMore) {
      const accounts: { id: string; userId: string; nickname: string | null }[] = await prisma.socialAccount.findMany({
        where: { status: 'ALIVE' },
        select: { id: true, userId: true, nickname: true },
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
          nickname: acc.nickname,
        }, {
          delay: dispatched * 10_000, // 10s stagger (browser is heavier than curl)
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
  let browser: Browser | null = null;
  let lockAcquired = false;

  try {
    const ctxAcc = await loadAccountContext(data.accountId);
    const { platform, fingerprint, proxyUrl } = ctxAcc;

    logger.info(`📊 Сбор аналитики для ${data.accountId} (${platform})...`);

    // ── Per-account lock: skip if warmup/upload/login is running ──
    // Two browser sessions for the same account = different IPs/fingerprint
    // collisions = instant ban.
    const holder = await acquireAccountLock(data.accountId, 'analytics');
    if (holder) {
      logger.info(`⏭️ Пропускаю аналитику — для аккаунта уже запущен: ${holder}`);
      return _emptyStats();
    }
    lockAcquired = true;

    // Launch browser with SAME LaunchOptions as login/warmup/upload
    // This ensures identical fingerprint, proxy, and cookie injection
    const stealth = await launchStealthContext({
      accountId: data.accountId,
      proxyUrl,
      cookiesPath: data.cookiesDir ?? '/data/cookies',
      fingerprint,
    });
    browser = stealth.browser;
    const page = stealth.page;

    let stats: ProfileStats;

    if (platform === 'TIKTOK') {
      stats = await _scrapeTikTokProfile(page, data, logger);
    } else {
      stats = await _scrapeYouTubeProfile(page, data, logger);
    }

    // Persist to DB
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
    if (lockAcquired) await releaseAccountLock(data.accountId, 'analytics');
    if (browser) await closeBrowser(browser);
    logger.disconnect();
  }
}

// ── TikTok Profile Scraping ─────────────────────────────────

async function _scrapeTikTokProfile(
  page: any,
  data: AnalyticsJobData,
  logger: SocketLogger,
): Promise<ProfileStats> {
  // Navigate to own profile
  const profileUrl = data.nickname
    ? `https://www.tiktok.com/@${data.nickname}`
    : 'https://www.tiktok.com/@me';

  logger.info(`📊 Открываю профиль: ${profileUrl}`);
  await page.goto(profileUrl, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForTimeout(2000 + Math.random() * 1500);

  // If /@me, it redirects to /@actual_handle — extract and save nickname
  const currentUrl = page.url();
  const handleMatch = currentUrl.match(/@([^/?]+)/);
  if (handleMatch && handleMatch[1] !== 'me') {
    const nickname = handleMatch[1];
    try {
      await prisma.socialAccount.update({
        where: { id: data.accountId },
        data: { nickname },
      });
    } catch { /* non-critical */ }
  }

  const stats: ProfileStats = {
    followers: 0,
    following: 0,
    views: 0,
    likes: 0,
    videos: 0,
    snapshotAt: new Date(),
  };

  try {
    // Method 1: data-e2e selectors (most reliable for TikTok)
    const followingEl = page.locator('[data-e2e="following-count"]').first();
    const followersEl = page.locator('[data-e2e="followers-count"]').first();
    const likesEl = page.locator('[data-e2e="likes-count"]').first();

    if (await followersEl.count() > 0) {
      stats.followers = parseShortNumber(await followersEl.textContent() || '0');
    }
    if (await followingEl.count() > 0) {
      stats.following = parseShortNumber(await followingEl.textContent() || '0');
    }
    if (await likesEl.count() > 0) {
      stats.likes = parseShortNumber(await likesEl.textContent() || '0');
    }

    // Count videos on profile page
    const videoItems = page.locator('[data-e2e="user-post-item"], [class*="DivItemContainer"]');
    stats.videos = await videoItems.count();

    // TikTok doesn't show total views on profile — use likes as engagement proxy
    stats.views = stats.likes;

    logger.info(`📊 TikTok: ${stats.followers} подписчиков, ${stats.likes} лайков`);
  } catch (err) {
    logger.warn(`⚠️ Не удалось извлечь статистику TikTok (method 1): ${err instanceof Error ? err.message : err}`);

    // Method 2: parse page text as fallback
    try {
      const bodyText = await page.locator('body').textContent();
      if (bodyText) {
        const followersMatch = bodyText.match(/(\d[\d.,KkMmBbтысмлн]*)\s*(?:Followers|подписчик|Подписчики)/i);
        const likesMatch = bodyText.match(/(\d[\d.,KkMmBbтысмлн]*)\s*(?:Likes|лайк)/i);
        if (followersMatch) stats.followers = parseShortNumber(followersMatch[1]);
        if (likesMatch) stats.likes = parseShortNumber(likesMatch[1]);
        stats.views = stats.likes;
      }
    } catch { /* last resort failed */ }
  }

  return stats;
}

// ── YouTube Profile Scraping ────────────────────────────────

async function _scrapeYouTubeProfile(
  page: any,
  data: AnalyticsJobData,
  logger: SocketLogger,
): Promise<ProfileStats> {
  const stats: ProfileStats = {
    followers: 0,
    following: 0,
    views: 0,
    likes: 0,
    videos: 0,
    snapshotAt: new Date(),
  };

  // Try YouTube Studio dashboard first (has real analytics)
  logger.info('📊 Открываю YouTube Studio...');
  try {
    await page.goto('https://studio.youtube.com/', { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(3000 + Math.random() * 2000);

    const currentUrl = page.url();

    // Check if redirected to login (cookies expired)
    if (currentUrl.includes('accounts.google.com')) {
      logger.warn('⚠️ YouTube cookies истекли — перенаправлен на страницу входа');
      await prisma.socialAccount.update({
        where: { id: data.accountId },
        data: { status: 'AUTH_NEEDED', lastError: 'Cookies истекли, нужен повторный вход' },
      });
      return stats;
    }

    // Studio dashboard subscriber count
    const subscriberEl = page.locator(
      '#subscriber-count, ' +
      'ytcp-channel-dashboard-header-count, ' +
      '.subscriber-count, ' +
      '[class*="subscriber"]'
    ).first();

    if (await subscriberEl.count() > 0) {
      stats.followers = parseShortNumber(await subscriberEl.textContent() || '0');
    }

    // Total views from analytics card
    const viewsEl = page.locator(
      '[class*="analytics"] [class*="metric-value"], ' +
      '#analytics-summary-card .metric-value, ' +
      '.analytics-card .ytcp-animated-number'
    ).first();

    if (await viewsEl.count() > 0) {
      stats.views = parseShortNumber(await viewsEl.textContent() || '0');
    }

    logger.info(`📊 YouTube Studio: ${stats.followers} подписчиков, ${stats.views} просмотров`);
  } catch (err) {
    logger.warn(`⚠️ Studio парсинг не удался: ${err instanceof Error ? err.message : err}`);
  }

  // Fallback: YouTube channel page
  if (stats.followers === 0) {
    try {
      await page.goto('https://www.youtube.com/@me', { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(2000);

      const subEl = page.locator('#subscriber-count, yt-formatted-string#subscriber-count').first();
      if (await subEl.count() > 0) {
        stats.followers = parseShortNumber(await subEl.textContent() || '0');
      }

      const videoEls = page.locator('ytd-rich-item-renderer, ytd-grid-video-renderer');
      stats.videos = await videoEls.count();

      logger.info(`📊 YouTube Channel: ${stats.followers} подписчиков, ${stats.videos} видео`);
    } catch {
      logger.warn('⚠️ YouTube Channel page парсинг не удался');
    }
  }

  return stats;
}

// ── Utility ─────────────────────────────────────────────────

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
 * Updates SocialAccount (followers, views) and daily snapshot.
 */
async function _persistStats(
  accountId: string,
  stats: ProfileStats,
  logger: SocketLogger,
): Promise<void> {
  try {
    const account = await prisma.socialAccount.update({
      where: { id: accountId },
      data: {
        views: stats.views,
        followers: stats.followers,
      },
      select: { userId: true },
    });

    // Upsert daily snapshot for real time-series charts
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
  }
}

/**
 * Parse short numbers: "12.5K" → 12500, "1.2M" → 1200000
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
