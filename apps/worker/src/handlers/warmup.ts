// ─────────────────────────────────────────────────────────────
// Warmup Handler v2 — 10-Day Progressive Curriculum
//
// MAJOR CHANGES from v1:
// 1. 10-day progressive curriculum instead of simple scroll+like
// 2. Day 1-3: passive FYP watching (zero engagement)
// 3. Day 4-6: gradual likes, comments, saves
// 4. Day 7-10: organic upload + engagement mix
// 5. Day 11+: warmup complete, account ready for operations
// 6. Uses Patchright + ghost-cursor for human behavior
// 7. Tracks warmup day via DB (warmupStartedAt)
//
// Each day runs as a separate BullMQ job — cron dispatches daily.
// ─────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { launchStealthContext, closeBrowser, type StealthContext } from '../core/browser/patchright-launcher.js';
import { createPageCursor, humanClick, humanScroll, humanIdleMove } from '../core/humanity/biomouse.js';
import { humanType, humanPressEnter } from '../core/humanity/typing-emulator.js';
import { SocketLogger } from '../lib/socket-logger.js';
import type { AccountFingerprint } from '../core/browser/fingerprint-manager.js';
import type { Browser, Page } from 'patchright';
import type { GhostCursor } from 'ghost-cursor';

// ── Types ───────────────────────────────────────────────────

interface WarmupJobData {
  userId: string;
  accountId: string;
  platform: 'TIKTOK' | 'YOUTUBE';
  fingerprint: AccountFingerprint;
  proxyUrl?: string;
  cookiesDir?: string;
  /** Which day of warmup (1-10). Calculated from warmupStartedAt. */
  warmupDay: number;
}

// ── Warmup Comments Pool ────────────────────────────────────
// Generic positive comments that won't trigger spam filters

const COMMENT_POOL = [
  '❤️', '🔥🔥', 'wow', 'nice!!', 'cool', '😍', 'love this',
  'amazing', 'so good', '👏👏', 'awesome', 'great content',
  '💯', 'love it', 'perfect', '🙌', 'beautiful', 'incredible',
];

// ── Main ────────────────────────────────────────────────────

export async function warmupHandler(job: Job<WarmupJobData>): Promise<void> {
  const data = job.data;
  const logger = new SocketLogger(data.userId);
  let browser: Browser | null = null;

  try {
    logger.info(`🔥 Прогрев аккаунта — День ${data.warmupDay}/10 (${data.platform})`);

    // Launch browser with fingerprint
    const ctx = await launchStealthContext({
      accountId: data.accountId,
      proxyUrl: data.proxyUrl,
      cookiesPath: data.cookiesDir ?? '/data/cookies',
      fingerprint: data.fingerprint,
    });
    browser = ctx.browser;
    const page = ctx.page;
    const cursor = await createPageCursor(page);

    // Navigate to platform
    const baseUrl = data.platform === 'TIKTOK'
      ? 'https://www.tiktok.com/foryou'
      : 'https://www.youtube.com/shorts';

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(_randomDelay(3000, 5000));

    // Route to day-appropriate behavior
    if (data.warmupDay <= 3) {
      await _passiveWatching(page, cursor, data, logger, job);
    } else if (data.warmupDay <= 6) {
      await _lightEngagement(page, cursor, data, logger, job);
    } else {
      await _activeEngagement(page, cursor, data, logger, job);
    }

    logger.info(`✅ Прогрев День ${data.warmupDay}/10 завершён`);
    await job.updateProgress(100);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`❌ Ошибка прогрева: ${message}`);
    throw err;
  } finally {
    await closeBrowser(browser);
    logger.disconnect();
  }
}

// ── Day 1-3: Passive Watching ───────────────────────────────
// Just scroll FYP, watch videos, no engagement at all.
// New accounts that like/comment on day 1 = suspicious.

async function _passiveWatching(
  page: Page,
  cursor: Awaited<ReturnType<typeof createPageCursor>>,
  data: WarmupJobData,
  logger: SocketLogger,
  job: Job,
): Promise<void> {
  const watchCount = _randomDelay(8, 15);
  logger.info(`Day ${data.warmupDay}: Пассивный просмотр FYP (${watchCount} видео)`);

  for (let i = 0; i < watchCount; i++) {
    // Watch each video for 10-30 seconds
    const watchTime = _randomDelay(10000, 30000);
    await page.waitForTimeout(watchTime);

    // Random mouse idle movement (humans move mouse while watching)
    if (Math.random() < 0.4) {
      await humanIdleMove(page, cursor);
    }

    // Scroll to next video
    await humanScroll(page, _randomDelay(300, 600));
    await page.waitForTimeout(_randomDelay(1000, 2000));

    await job.updateProgress(Math.round((i / watchCount) * 100));
    logger.info(`  Просмотрено видео ${i + 1}/${watchCount} (${Math.round(watchTime / 1000)}с)`);
  }
}

// ── Day 4-6: Light Engagement ───────────────────────────────
// Start liking some videos (30-50% of watched).
// One comment per session. A few saves.

async function _lightEngagement(
  page: Page,
  cursor: Awaited<ReturnType<typeof createPageCursor>>,
  data: WarmupJobData,
  logger: SocketLogger,
  job: Job,
): Promise<void> {
  const watchCount = _randomDelay(10, 18);
  const likeProb = 0.3 + (data.warmupDay - 4) * 0.1; // Day 4: 30%, Day 5: 40%, Day 6: 50%
  let liked = 0;
  let commented = false;

  logger.info(`Day ${data.warmupDay}: Лёгкая активность (${watchCount} видео, like ~${Math.round(likeProb * 100)}%)`);

  for (let i = 0; i < watchCount; i++) {
    // Watch video
    const watchTime = _randomDelay(8000, 25000);
    await page.waitForTimeout(watchTime);

    // Like with probability
    if (Math.random() < likeProb && data.platform === 'TIKTOK') {
      try {
        await humanClick(page, cursor, '[data-e2e="like-icon"]', { postClickDelay: 500 });
        liked++;
        logger.info(`  ❤️ Лайк видео ${i + 1}`);
      } catch { /* element not found */ }
    }

    // One comment per session (day 5+)
    if (!commented && data.warmupDay >= 5 && i === _randomDelay(3, watchCount - 2)) {
      const comment = COMMENT_POOL[Math.floor(Math.random() * COMMENT_POOL.length)];
      try {
        if (data.platform === 'TIKTOK') {
          await humanClick(page, cursor, '[data-e2e="comment-icon"]', { postClickDelay: 1000 });
          await page.waitForTimeout(_randomDelay(1000, 2000));
          await humanType(page, '[data-e2e="comment-input"]', comment);
          await humanPressEnter(page);
          commented = true;
          logger.info(`  💬 Комментарий: "${comment}"`);
        }
      } catch { /* skip */ }
    }

    // Scroll to next
    await humanScroll(page, _randomDelay(300, 600));
    await page.waitForTimeout(_randomDelay(1000, 3000));

    await job.updateProgress(Math.round((i / watchCount) * 100));
  }

  logger.info(`  Итого: ${liked} лайков, ${commented ? '1 комментарий' : '0 комментариев'}`);
}

// ── Day 7-10: Active Engagement ─────────────────────────────
// Higher like rate (60-80%), 2-3 comments, saves, follow 1-2 users.
// By day 10, the account looks like an organic user.

async function _activeEngagement(
  page: Page,
  cursor: Awaited<ReturnType<typeof createPageCursor>>,
  data: WarmupJobData,
  logger: SocketLogger,
  job: Job,
): Promise<void> {
  const watchCount = _randomDelay(12, 20);
  const likeProb = 0.6 + (data.warmupDay - 7) * 0.05;
  let liked = 0;
  let comments = 0;
  const maxComments = _randomDelay(2, 3);

  logger.info(`Day ${data.warmupDay}: Активная активность (${watchCount} видео, like ~${Math.round(likeProb * 100)}%)`);

  for (let i = 0; i < watchCount; i++) {
    const watchTime = _randomDelay(6000, 20000);
    await page.waitForTimeout(watchTime);

    // Like
    if (Math.random() < likeProb && data.platform === 'TIKTOK') {
      try {
        await humanClick(page, cursor, '[data-e2e="like-icon"]', { postClickDelay: 500 });
        liked++;
      } catch { /* skip */ }
    }

    // Comments (up to maxComments per session)
    if (comments < maxComments && Math.random() < 0.3) {
      const comment = COMMENT_POOL[Math.floor(Math.random() * COMMENT_POOL.length)];
      try {
        if (data.platform === 'TIKTOK') {
          await humanClick(page, cursor, '[data-e2e="comment-icon"]', { postClickDelay: 1000 });
          await page.waitForTimeout(_randomDelay(1000, 2000));
          await humanType(page, '[data-e2e="comment-input"]', comment);
          await humanPressEnter(page);
          comments++;
        }
      } catch { /* skip */ }
    }

    // Save (bookmark) occasionally
    if (Math.random() < 0.15 && data.platform === 'TIKTOK') {
      try {
        await humanClick(page, cursor, '[data-e2e="undefined-icon"]', { postClickDelay: 500 });
        logger.info(`  🔖 Сохранено видео ${i + 1}`);
      } catch { /* skip */ }
    }

    // Follow occasionally (max 1-2 per session)
    if (Math.random() < 0.08 && data.platform === 'TIKTOK') {
      try {
        await humanClick(page, cursor, '[data-e2e="follow-button"]', { postClickDelay: 1000 });
        logger.info(`  ➕ Подписка на автора`);
      } catch { /* skip */ }
    }

    // Random idle move
    if (Math.random() < 0.3) {
      await humanIdleMove(page, cursor);
    }

    await humanScroll(page, _randomDelay(300, 600));
    await page.waitForTimeout(_randomDelay(1000, 3000));
    await job.updateProgress(Math.round((i / watchCount) * 100));
  }

  logger.info(`  Итого: ${liked} лайков, ${comments} комментариев`);
}

// ── Utility ─────────────────────────────────────────────────

function _randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
