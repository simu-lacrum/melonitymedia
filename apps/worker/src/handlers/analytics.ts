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
// Runs once per day via BullMQ cron dispatcher.
// ─────────────────────────────────────────────────────────────

import { Job, UnrecoverableError } from 'bullmq';
import { launchStealthContext, closeBrowser } from '../core/browser/patchright-launcher.js';
import { SocketLogger } from '../lib/socket-logger.js';
import { emitWorkerError } from '../lib/error-classifier.js';
import { loadAccountContext } from '../lib/account-context.js';
import { prisma } from '../lib/prisma.js';
import { acquireAccountLock, releaseAccountLock } from '../lib/account-lock.js';
import { addJob } from '../lib/bullmq.js';
import {
  extractTikTokViewCounts,
  extractYouTubeStudioViewCounts,
  parseShortNumber,
  sumViewCounts,
  type ViewsSource,
} from '../lib/view-stats.js';
import type { Browser } from 'patchright';

export { parseShortNumber } from '../lib/view-stats.js';

// ── Types ───────────────────────────────────────────────────

interface AnalyticsJobData {
  userId: string;
  taskId?: string;
  accountId: string;
  cookiesDir?: string;
  secUid?: string;
  nickname?: string;
  collectionKey?: string;
  coordinationAttempt?: number;
}

export interface ProfileStats {
  followers: number;
  followersAvailable: boolean;
  following: number;
  views: number;
  viewsSource: ViewsSource;
  likes: number;
  videos: number;
  publicationViews: number[];
  snapshotAt: Date;
}

interface AnalyticsDeferredResult {
  deferred: true;
  reason: 'ACCOUNT_BUSY' | 'PROXY_BUSY' | 'TRANSIENT_PLATFORM';
  retryAt: string;
  coordinationAttempt: number;
}

const ANALYTICS_RETRY_DELAY_MS = 30 * 60 * 1000;
const MAX_COORDINATION_ATTEMPTS = 48;
const TRANSIENT_RETRY_DELAY_MS = 2 * 60 * 60 * 1000;
const MAX_TRANSIENT_ATTEMPTS = 12;

// ── Main ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function analyticsHandler(job: Job<any>): Promise<ProfileStats | AnalyticsDeferredResult | { dispatched: number }> {
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

    // Cursor-based batching
    const BATCH_SIZE = 500;
    let cursor: string | undefined = undefined;
    let dispatched = 0;
    let hasMore = true;

    while (hasMore) {
      const accounts: { id: string; userId: string; nickname: string | null }[] = await prisma.socialAccount.findMany({
        where: {
          status: { in: ['ALIVE', 'WARMING_UP'] },
          cookiesEncrypted: { not: null },
          pinnedProxy: { is: { status: 'ACTIVE' } },
        },
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

      const collectionKey = data.collectionKey ?? _analyticsCollectionKey(new Date(job.timestamp));
      for (const acc of accounts) {
        await addJob('analytics-cron', {
          userId: acc.userId,
          accountId: acc.id,
          nickname: acc.nickname,
          collectionKey,
          coordinationAttempt: 0,
        }, {
          delay: dispatched * 10_000, // 10s stagger (browser is heavier than curl)
          jobId: `analytics-${acc.id}-${collectionKey}`,
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

    // ── Per-account lock: defer if warmup/upload/login is running ──
    // Two browser sessions for the same account = different IPs/fingerprint
    // collisions = instant ban.
    const holder = await acquireAccountLock(data.accountId, 'analytics');
    if (holder) {
      logger.info(`Analytics deferred because another account job is active: ${holder}`);
      return await _deferAnalytics(job, data, 'ACCOUNT_BUSY', logger);
    }
    lockAcquired = true;

    // Launch browser with SAME LaunchOptions as login/warmup/upload
    // This ensures identical fingerprint, proxy, and cookie injection
    let stealth: Awaited<ReturnType<typeof launchStealthContext>>;
    try {
      stealth = await launchStealthContext({
        accountId: data.accountId,
        taskId: data.taskId,
        jobId: job.id,
        jobType: 'analytics',
        proxyUrl,
        proxyLockWaitMs: 0,
        cookiesPath: data.cookiesDir ?? '/data/cookies',
        fingerprint,
      });
    } catch (err) {
      if (_isProxyBusyError(err)) {
        logger.info('Analytics deferred because the pinned proxy is used by another account job.');
        return await _deferAnalytics(job, data, 'PROXY_BUSY', logger);
      }
      throw err;
    }
    browser = stealth.browser;
    const page = stealth.page;

    let stats: ProfileStats;

    try {
      if (platform === 'TIKTOK') {
        stats = await _scrapeTikTokProfile(page, data, logger);
      } else {
        stats = await _scrapeYouTubeProfile(page, data, logger);
      }
    } catch (err) {
      if (_isTransientPlatformError(err)) {
        logger.warn(`Analytics platform request failed temporarily: ${err instanceof Error ? err.message : err}`);
        return await _deferAnalytics(job, data, 'TRANSIENT_PLATFORM', logger);
      }
      throw err;
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
    followersAvailable: false,
    following: 0,
    views: 0,
    viewsSource: 'unavailable',
    likes: 0,
    videos: 0,
    publicationViews: [],
    snapshotAt: new Date(),
  };

  try {
    // Method 1: data-e2e selectors (most reliable for TikTok)
    const followingEl = page.locator('[data-e2e="following-count"]').first();
    const followersEl = page.locator('[data-e2e="followers-count"]').first();
    const likesEl = page.locator('[data-e2e="likes-count"]').first();
    const profileLoaded = await followersEl.count() > 0;

    if (profileLoaded) {
      stats.followers = parseShortNumber(await followersEl.textContent() || '0');
      stats.followersAvailable = true;
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

    stats.publicationViews = await _collectTikTokVisibleVideoViews(page, logger);
    if (stats.publicationViews.length > 0) {
      stats.views = sumViewCounts(stats.publicationViews);
      stats.viewsSource = 'video_cards';
      stats.videos = Math.max(stats.videos, stats.publicationViews.length);
    } else if (profileLoaded && stats.videos === 0) {
      // A rendered profile with no post cards is a confirmed zero, not a
      // selector failure. This keeps empty connected accounts in daily stats.
      stats.viewsSource = 'video_cards';
    }

    logger.info(`📊 TikTok: ${stats.followers} подписчиков, ${stats.likes} лайков`);
  } catch (err) {
    logger.warn(`⚠️ Не удалось извлечь статистику TikTok (method 1): ${err instanceof Error ? err.message : err}`);

    // Method 2: parse page text as fallback
    try {
      const bodyText = await page.locator('body').textContent();
      if (bodyText) {
        const followersMatch = bodyText.match(/(\d[\d.,KkMmBbтысмлн]*)\s*(?:Followers|подписчик|Подписчики)/i);
        const likesMatch = bodyText.match(/(\d[\d.,KkMmBbтысмлн]*)\s*(?:Likes|лайк)/i);
        if (followersMatch) {
          stats.followers = parseShortNumber(followersMatch[1]);
          stats.followersAvailable = true;
        }
        if (likesMatch) stats.likes = parseShortNumber(likesMatch[1]);
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
    followersAvailable: false,
    following: 0,
    views: 0,
    viewsSource: 'unavailable',
    likes: 0,
    videos: 0,
    publicationViews: [],
    snapshotAt: new Date(),
  };

  logger.info('📊 Открываю YouTube Studio и таблицу Shorts...');
  await page.goto('https://studio.youtube.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForURL(/studio\.youtube\.com\/channel\//, { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await _assertYouTubeAuthenticated(page, data.accountId);

  const channelId = await _findYouTubeChannelId(page);
  if (!channelId) {
    throw new Error(`YouTube Studio did not expose a channel ID for account ${data.accountId}`);
  }

  const contentUrl = `https://studio.youtube.com/channel/${channelId}/videos/short`;
  await page.goto(contentUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForSelector('ytcp-video-row, ytcp-video-section, ytcp-content-section', {
    timeout: 25_000,
  }).catch(() => {});
  await page.waitForTimeout(2500);
  await _assertYouTubeAuthenticated(page, data.accountId);

  const contentReady = await page.locator(
    'ytcp-video-row, ytcp-video-section, ytcp-content-section',
  ).count().catch(() => 0);
  if (contentReady === 0) {
    throw new Error('YouTube Studio Shorts table did not render');
  }

  stats.publicationViews = await _collectYouTubeStudioViews(page, logger);
  stats.views = sumViewCounts(stats.publicationViews);
  stats.viewsSource = 'studio_content';
  stats.videos = stats.publicationViews.length;

  // Subscriber count is independent from the content table. A missing public
  // counter must preserve the last known DB value rather than overwrite it.
  try {
    await page.goto(`https://www.youtube.com/channel/${channelId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(2500);
    const subEl = page.locator('#subscriber-count, yt-formatted-string#subscriber-count').first();
    if (await subEl.count() > 0) {
      stats.followers = parseShortNumber(await subEl.textContent() || '0');
      stats.followersAvailable = true;
    }
  } catch (err) {
    logger.warn(`YouTube subscriber counter was unavailable: ${err instanceof Error ? err.message : err}`);
  }

  logger.info(
    `📊 YouTube Studio: ${stats.publicationViews.length} Shorts, ${stats.views} просмотров`,
  );

  return stats;
}

// ── Utility ─────────────────────────────────────────────────

function _analyticsCollectionKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function _isProxyBusyError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('Pinned proxy is still busy');
}

function _isTransientPlatformError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return [
    'ERR_HTTP_RESPONSE_CODE_FAILURE',
    'ERR_PROXY_CONNECTION_FAILED',
    'ERR_TIMED_OUT',
    'page.goto: Timeout',
    'YouTube Studio did not expose a channel ID',
    'YouTube Studio Shorts table did not render',
  ].some(fragment => err.message.includes(fragment));
}

async function _deferAnalytics(
  job: Job<any>,
  data: AnalyticsJobData,
  reason: AnalyticsDeferredResult['reason'],
  logger: SocketLogger,
): Promise<AnalyticsDeferredResult> {
  const coordinationAttempt = (data.coordinationAttempt ?? 0) + 1;
  const isTransientPlatform = reason === 'TRANSIENT_PLATFORM';
  const maxAttempts = isTransientPlatform ? MAX_TRANSIENT_ATTEMPTS : MAX_COORDINATION_ATTEMPTS;
  const retryDelayMs = isTransientPlatform ? TRANSIENT_RETRY_DELAY_MS : ANALYTICS_RETRY_DELAY_MS;
  if (coordinationAttempt > maxAttempts) {
    throw new Error(
      `Analytics could not complete after ${maxAttempts} deferred attempts (${reason})`,
    );
  }

  const collectionKey = data.collectionKey ?? _analyticsCollectionKey(new Date(job.timestamp));
  const retryAt = new Date(Date.now() + retryDelayMs);
  await addJob('analytics-cron', {
    ...data,
    collectionKey,
    coordinationAttempt,
  }, {
    delay: retryDelayMs,
    jobId: `analytics-${data.accountId}-${collectionKey}-deferred-${coordinationAttempt}`,
  });

  logger.info(`Analytics rescheduled for ${retryAt.toISOString()} (${reason}).`);
  return {
    deferred: true,
    reason,
    retryAt: retryAt.toISOString(),
    coordinationAttempt,
  };
}

async function _assertYouTubeAuthenticated(page: any, accountId: string): Promise<void> {
  const currentUrl = page.url();
  const loginFormVisible = await page.locator(
    'input[type="email"], input[name="identifier"], form[action*="accounts.google.com"]',
  ).count().catch(() => 0);
  if (!currentUrl.includes('accounts.google.com') && loginFormVisible === 0) return;

  await prisma.socialAccount.update({
    where: { id: accountId },
    data: {
      status: 'AUTH_NEEDED',
      lastError: 'YouTube session expired. Reconnect the account.',
    },
  });
  throw new UnrecoverableError(`Auth failed: Not logged in to YOUTUBE for account ${accountId}`);
}

async function _findYouTubeChannelId(page: any): Promise<string | null> {
  const urls = [
    page.url(),
    ...await page.locator('a[href*="/channel/"]').evaluateAll(
      (anchors: HTMLAnchorElement[]) => anchors.map(anchor => anchor.href),
    ).catch(() => [] as string[]),
  ];

  for (const url of urls) {
    const match = url.match(/\/channel\/([^/?#]+)/);
    if (match) return match[1];
  }
  return null;
}

async function _collectYouTubeStudioViews(page: any, logger: SocketLogger): Promise<number[]> {
  const allRows: Array<{ title: string; viewsText: string }> = [];
  const seenPages = new Set<string>();

  for (let pageNumber = 0; pageNumber < 50; pageNumber++) {
    let bestRows: Array<{ title: string; viewsText: string }> = [];
    let previousRowCount = -1;
    let stableRounds = 0;

    for (let round = 0; round < 10; round++) {
      const rows = await page.locator('ytcp-video-row').evaluateAll((elements: Element[]) =>
        elements.map(row => ({
          title: row.querySelector('#video-title')?.textContent?.trim() ?? '',
          viewsText: row.querySelector('.tablecell-views')?.textContent?.trim() ?? '',
        })),
      ).catch(() => [] as Array<{ title: string; viewsText: string }>);

      if (rows.length > bestRows.length) bestRows = rows;
      if (rows.length === previousRowCount) stableRounds++;
      else stableRounds = 0;
      previousRowCount = rows.length;

      if (stableRounds >= 2) break;
      const lastRow = page.locator('ytcp-video-row').last();
      if (await lastRow.count() > 0) {
        await lastRow.scrollIntoViewIfNeeded().catch(() => {});
      } else {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2)).catch(() => {});
      }
      await page.waitForTimeout(1000).catch(() => {});
    }

    const pageSignature = JSON.stringify(bestRows);
    if (seenPages.has(pageSignature)) break;
    seenPages.add(pageSignature);
    allRows.push(...bestRows);

    const nextButton = page.locator('ytcp-table-footer #navigate-after').first();
    if (await nextButton.count() === 0) break;
    const nextDisabled = await nextButton.evaluate((element: Element) =>
      element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true',
    ).catch(() => true);
    if (nextDisabled) break;

    await nextButton.click();
    await page.waitForTimeout(2000);
  }

  const counts = extractYouTubeStudioViewCounts(allRows);
  logger.info(`YouTube Studio views collected: ${counts.length}/${allRows.length} published rows`);
  return counts;
}

async function _collectTikTokVisibleVideoViews(page: any, logger: SocketLogger): Promise<number[]> {
  let best: number[] = [];

  for (let i = 0; i < 5; i++) {
    const directTexts = await page.locator(
      '[data-e2e="video-views"], ' +
      '[data-e2e="user-post-item"] strong, ' +
      '[class*="DivPlayLine"] strong, ' +
      '[class*="DivVideoCardContainer"] strong',
    ).allTextContents().catch(() => [] as string[]);

    const cardTexts = directTexts.length > 0
      ? directTexts
      : await page.locator('[data-e2e="user-post-item"], [class*="DivItemContainer"]')
        .allTextContents()
        .catch(() => [] as string[]);

    const counts = extractTikTokViewCounts(cardTexts);
    if (counts.length > best.length) best = counts;

    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2)).catch(() => {});
    await page.waitForTimeout(900 + Math.random() * 500).catch(() => {});
  }

  logger.info(`TikTok visible video views collected: ${best.length} cards`);
  return best;
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
    if (stats.viewsSource === 'unavailable') {
      throw new Error('View counters were unavailable; refusing to write a false daily snapshot');
    }

    const current = await prisma.socialAccount.findUnique({
      where: { id: accountId },
      select: { userId: true, followers: true },
    });
    if (!current) throw new Error(`Account ${accountId} not found`);

    const viewsToPersist = stats.views;
    const followersToPersist = stats.followersAvailable ? stats.followers : current.followers;

    const publications = stats.publicationViews.length > 0
      ? await prisma.videoPublication.findMany({
        where: {
          accountId,
          userId: current.userId,
          status: 'UPLOADED',
          uploadedAt: { not: null },
        },
        orderBy: { uploadedAt: 'desc' },
        take: stats.publicationViews.length,
        select: { id: true },
      })
      : [];

    // Upsert daily snapshot for real time-series charts
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    await prisma.$transaction(async tx => {
      await tx.socialAccount.update({
        where: { id: accountId },
        data: {
          views: viewsToPersist,
          followers: followersToPersist,
        },
      });

      await Promise.all(publications.map((publication, index) =>
        tx.videoPublication.update({
          where: { id: publication.id },
          data: {
            views: stats.publicationViews[index],
            viewsUpdatedAt: stats.snapshotAt,
          },
        }),
      ));

      await tx.dailySnapshot.upsert({
        where: {
          accountId_date: { accountId, date: today },
        },
        create: {
          accountId,
          userId: current.userId,
          date: today,
          views: viewsToPersist,
          followers: followersToPersist,
          likes: stats.likes,
          videos: stats.videos,
        },
        update: {
          views: viewsToPersist,
          followers: followersToPersist,
          likes: stats.likes,
          videos: stats.videos,
        },
      });
    });

    logger.info(`Updated publication views for ${publications.length}/${stats.publicationViews.length} Studio rows`);
    logger.info(`Stats saved: views=${viewsToPersist}, followers=${followersToPersist}, source=${stats.viewsSource}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`⚠️ Не удалось сохранить статистику в БД: ${message}`);
    throw err;
  }
}
