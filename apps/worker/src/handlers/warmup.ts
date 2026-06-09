// ─────────────────────────────────────────────────────────────
// Warmup Handler v3 — Configurable Progressive Curriculum
//
// MAJOR CHANGES from v2:
// 1. User-configurable warmup duration (3–21 days, default 10)
// 2. Phase boundaries scale proportionally:
//    - Phase 1 (passive): days 1 → 30% of total
//    - Phase 2 (light):   next 30%
//    - Phase 3 (active):  remaining 40%
// 3. Day counter derived from warmupStartedAt (DB, not payload)
// 4. Uses Patchright + ghost-cursor for human behavior
// 5. Tracks warmup day via DB (warmupStartedAt + warmupDays)
//
// Each day runs as a separate BullMQ job — cron dispatches daily.
// ─────────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { launchStealthContext, closeBrowser } from '../core/browser/patchright-launcher.js';
import { persistCookies } from '../core/auth/cookie-store.js';
import { createPageCursor, humanClick, humanScroll, humanIdleMove } from '../core/humanity/biomouse.js';
import { humanType, humanPressEnter } from '../core/humanity/typing-emulator.js';
import { SocketLogger } from '../lib/socket-logger.js';
import { emitWorkerError } from '../lib/error-classifier.js';
import { prisma } from '../lib/prisma.js';
import { loadAccountContext } from '../lib/account-context.js';
import type { Browser, Page } from 'patchright';
import type { GhostCursor } from 'ghost-cursor';

// ── Types ───────────────────────────────────────────────────

interface WarmupJobData {
  userId: string;
  accountId: string;          // only field needed; the rest comes from the DB
  cookiesDir?: string;
  /** Optional override of warmupDay for replays; normally derived from warmupStartedAt */
  warmupDay?: number;
  /** Hashtags to use for warmup (e.g. ['dota2', 'gaming']) */
  hashtags?: string[];
}

/** Inline context shim passed to phase helpers (replaces WarmupJobData). */
interface WarmupPhaseContext {
  warmupDay: number;
  warmupDays: number;
  platform: 'TIKTOK' | 'YOUTUBE';
  hashtags: string[];
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
    const ctxAcc = await loadAccountContext(data.accountId);

    if (!ctxAcc.warmupStartedAt) {
      throw new Error(
        `Account ${data.accountId} warmup never started. ` +
        `Call POST /api/accounts/warmup first.`,
      );
    }

    const totalDays = ctxAcc.warmupDays;

    // BUG-M7 fix: use sequential day progression instead of calendar-based.
    // If the worker was offline for 3 days, we should NOT skip phases 3→6.
    // Instead, we increment from the last completed warmup day + 1.
    // data.warmupDay override is still supported for admin re-runs.
    let warmupDay: number;
    if (data.warmupDay !== undefined) {
      warmupDay = data.warmupDay;
    } else {
      const acc = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: data.accountId },
        select: { lastWarmupDay: true },
      });
      warmupDay = Math.min((acc.lastWarmupDay ?? 0) + 1, totalDays);
    }

    logger.info(
      `🔥 Прогрев аккаунта — День ${warmupDay}/${totalDays} (${ctxAcc.platform})`,
    );

    const ctx = await launchStealthContext({
      accountId: data.accountId,
      proxyUrl: ctxAcc.proxyUrl,
      cookiesPath: data.cookiesDir ?? '/data/cookies',
      fingerprint: ctxAcc.fingerprint,
    });
    browser = ctx.browser;
    const page = ctx.page;
    const cursor = await createPageCursor(page);

    const baseUrl =
      ctxAcc.platform === 'TIKTOK'
        ? 'https://www.tiktok.com/foryou'
        : 'https://www.youtube.com/shorts';

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(_randomDelay(3000, 5000));

    // Phase boundaries (proportional to total warmup days)
    const passiveEnd = Math.max(1, Math.ceil(totalDays * 0.3));
    const lightEnd = Math.max(passiveEnd + 1, Math.ceil(totalDays * 0.6));

    // Use user-provided hashtags for warmup — no hardcoded defaults
    // Warmup browsing should match the account's actual content niche
    // to train TikTok's recommendation model correctly (BUG-M3 fix)
    const mergedHashtags = Array.isArray(data.hashtags) && data.hashtags.length > 0
      ? [...new Set(data.hashtags)]
      : [];  // No hashtags = pure FYP browsing, which is also valid

    const phaseCtx: WarmupPhaseContext = {
      warmupDay,
      warmupDays: totalDays,
      platform: ctxAcc.platform,
      hashtags: mergedHashtags,
    };

    if (warmupDay <= passiveEnd) {
      await _passiveWatching(page, cursor, phaseCtx, logger, job);
    } else if (warmupDay <= lightEnd) {
      await _lightEngagement(page, cursor, phaseCtx, logger, job);
    } else {
      await _activeEngagement(page, cursor, phaseCtx, logger, job);
    }

    logger.info(`✅ Прогрев День ${warmupDay}/${totalDays} завершён`);

    // Save the completed warmup day for sequential tracking (BUG-M7 fix)
    if (warmupDay >= totalDays) {
      await prisma.socialAccount.update({
        where: { id: data.accountId },
        data: { warmupCompletedAt: new Date(), status: 'ALIVE', lastWarmupDay: warmupDay },
      });
      logger.info(`🎉 Прогрев завершён! Аккаунт ${data.accountId} готов к загрузкам.`);
    } else {
      // Save progress for intermediate days
      await prisma.socialAccount.update({
        where: { id: data.accountId },
        data: { lastWarmupDay: warmupDay },
      });

      // ── Self-reschedule next day's warmup ──────────────────
      // Delay 20-28 hours (randomized to avoid pattern detection)
      const nextDayDelay = _randomDelay(20 * 3600_000, 28 * 3600_000);
      // H-6 FIX: Use shared bullmq addJob instead of creating a new Queue each time
      const { addJob } = await import('../lib/bullmq.js');

      await addJob('warmup' as any, {
        userId: data.userId,
        accountId: data.accountId,
        hashtags: data.hashtags,
        cookiesDir: data.cookiesDir,
      }, {
        delay: nextDayDelay,
        jobId: `warmup-${data.accountId}-day${warmupDay + 1}`,
      });
      const nextHours = Math.round(nextDayDelay / 3600_000);
      logger.info(`⏰ Следующий день прогрева (${warmupDay + 1}/${totalDays}) запланирован через ~${nextHours}ч`);
    }

    await job.updateProgress(100);

  } catch (err: unknown) {
    emitWorkerError(logger, data.accountId, 'warmup', err);
    throw err;
  } finally {
    // Persist cookies to BOTH disk AND DB before closing browser (BUG-C5 fix)
    if (browser) {
      try {
        const contexts = browser.contexts();
        if (contexts.length > 0) {
          const freshCookies = await contexts[0].cookies();
          const browserCookies = freshCookies.map(c => ({
            name: c.name, value: c.value, domain: c.domain, path: c.path,
            expires: c.expires, httpOnly: c.httpOnly, secure: c.secure,
            sameSite: c.sameSite === 'Strict' ? 'Strict' as const : c.sameSite === 'None' ? 'None' as const : 'Lax' as const,
          }));
          await persistCookies(data.accountId, browserCookies, data.cookiesDir ?? '/data/cookies');
          logger.info('Cookies сохранены (disk + DB) после прогрева');
        }
      } catch (cookieErr) {
        logger.warn(`Не удалось сохранить cookies: ${cookieErr}`);
      }
    }
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
  data: WarmupPhaseContext,
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
  data: WarmupPhaseContext,
  logger: SocketLogger,
  job: Job,
): Promise<void> {
  const watchCount = _randomDelay(10, 18);
  // M-3 FIX: Use proportional phase calculation instead of hardcoded Day 4 offset
  const passiveEnd = Math.max(1, Math.ceil(data.warmupDays * 0.3));
  const lightStart = passiveEnd + 1;
  const lightEnd = Math.max(passiveEnd + 1, Math.ceil(data.warmupDays * 0.6));
  const lightSpan = Math.max(1, lightEnd - lightStart + 1);
  const dayInPhase = data.warmupDay - lightStart;
  const likeProb = 0.3 + (dayInPhase / lightSpan) * 0.2; // 30% → 50% across the phase
  let liked = 0;
  let commented = false;

  logger.info(`Day ${data.warmupDay}: Лёгкая активность (${watchCount} видео, like ~${Math.round(likeProb * 100)}%)`);

  // BUG-H4 fix: compute comment target index ONCE before the loop
  // Previously _randomDelay was called on every iteration inside the loop,
  // making comment placement non-deterministic per iteration.
  const commentAtIndex = data.warmupDay >= 5 ? _randomDelay(3, Math.max(3, watchCount - 2)) : -1;

  for (let i = 0; i < watchCount; i++) {
    // Occasionally go to a hashtag page to watch videos related to the topic
    if (data.platform === 'TIKTOK' && Math.random() < 0.2 && data.hashtags.length > 0) {
      const randomTag = data.hashtags[Math.floor(Math.random() * data.hashtags.length)];
      logger.info(`  🔍 Переход по хештегу #${randomTag}`);
      try {
        await page.goto(`https://www.tiktok.com/tag/${randomTag}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(_randomDelay(2000, 4000));
        // Click on the first video in the tag page
        await humanClick(page, cursor, '[data-e2e="challenge-item"] a', { postClickDelay: 2000 });
      } catch { /* fallback to fyp if failed */ }
    }

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
    if (!commented && i === commentAtIndex) {
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
  data: WarmupPhaseContext,
  logger: SocketLogger,
  job: Job,
): Promise<void> {
  const watchCount = _randomDelay(12, 20);
  // M-3 FIX: Use proportional phase calculation instead of hardcoded Day 7 offset
  const lightEnd = Math.max(2, Math.ceil(data.warmupDays * 0.6));
  const activeStart = lightEnd + 1;
  const activeSpan = Math.max(1, data.warmupDays - activeStart + 1);
  const dayInPhase = data.warmupDay - activeStart;
  const likeProb = 0.6 + (dayInPhase / activeSpan) * 0.2; // 60% → 80% across the phase
  let liked = 0;
  let comments = 0;
  const maxComments = _randomDelay(2, 3);

  logger.info(`Day ${data.warmupDay}: Активная активность (${watchCount} видео, like ~${Math.round(likeProb * 100)}%)`);

  for (let i = 0; i < watchCount; i++) {
    // Navigating to hashtag pages more frequently during active engagement
    if (data.platform === 'TIKTOK' && Math.random() < 0.3 && data.hashtags.length > 0) {
      const randomTag = data.hashtags[Math.floor(Math.random() * data.hashtags.length)];
      logger.info(`  🔍 Поиск и переход по хештегу #${randomTag}`);
      try {
        await page.goto(`https://www.tiktok.com/tag/${randomTag}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(_randomDelay(2000, 4000));
        await humanClick(page, cursor, '[data-e2e="challenge-item"] a', { postClickDelay: 2000 });
      } catch { /* fallback to fyp if failed */ }
    }

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
        await humanClick(page, cursor, '[data-e2e="browse-icon"]', { postClickDelay: 500 });
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
