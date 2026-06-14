// ─────────────────────────────────────────────────────────────
// Warmup Handler v4 — Niche-Focused Progressive Curriculum
//
// MAJOR CHANGES from v3:
// 1. Niche-focused browsing: uses TikTok search (#hashtag) to find
//    videos in user's niche instead of random FYP
// 2. Reduced like/follow ratios to avoid bot detection
// 3. Follow cap (max 2-3 per session) with probability 5%
// 4. Longer session durations (20-30 min like real users)
// 5. Better comment pool (3-5 word phrases, not emoji spam)
// 6. Resilient selectors: aria-label/text fallbacks for all data-e2e
// 7. YouTube Shorts warmup support
// 8. Passive phase allows 1-2 likes to look human
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
// Human-like comments (3-5 words minimum). Single emoji = spam flag!

const COMMENT_POOL = [
  'this is so good 🔥', 'love this vibe ❤️', 'wait this is actually fire',
  'okay this is amazing wow', 'need more of this 🙌', 'bro this is perfect',
  'how is this so good lol', 'this made my day honestly', 'underrated content fr',
  'the editing tho 👏', 'I keep coming back to this', 'saving this for later',
  'no way this is real 😍', 'literally obsessed with this', "chef's kiss 💯",
  'this deserves way more views', "can't stop watching this lmao",
  'the talent here is insane', 'why is nobody talking about this',
  'this just made my whole week', 'the effort in this is crazy',
];

// ── Resilient Selectors ────────────────────────────────────
// TikTok rotates data-e2e attributes. We use fallback chains.

const SEL = {
  TIKTOK: {
    LIKE: '[data-e2e="like-icon"], [data-e2e="like-btn"], ' +
      'button[aria-label*="Like" i], button[aria-label*="like" i], ' +
      'span[data-e2e="like-icon"]',
    COMMENT_BTN: '[data-e2e="comment-icon"], [data-e2e="comment-btn"], ' +
      'button[aria-label*="Comment" i], button[aria-label*="comment" i]',
    COMMENT_INPUT: '[data-e2e="comment-input"], [contenteditable="true"][data-e2e*="comment"], ' +
      '[placeholder*="Add comment" i], [placeholder*="comment" i], ' +
      '[contenteditable="true"][class*="comment"]',
    FOLLOW: '[data-e2e="follow-button"], [data-e2e="follow-btn"], ' +
      'button:has-text("Follow"), button:has-text("Подписаться")',
    SAVE: '[data-e2e="browse-icon"], [data-e2e="save-icon"], [data-e2e="bookmark-icon"], ' +
      'button[aria-label*="Save" i], button[aria-label*="Сохранить" i], ' +
      'button[aria-label*="Bookmark" i]',
    SEARCH_INPUT: 'input[data-e2e="search-user-input"], input[type="search"], ' +
      'input[aria-label*="Search" i], input[placeholder*="Search" i]',
    SEARCH_BTN: 'button[data-e2e="search-icon"], button[type="submit"], ' +
      'button[aria-label*="Search" i]',
    VIDEO_CARD: '[data-e2e="challenge-item"] a, [data-e2e="search-card-desc"] a, ' +
      '[data-e2e="challenge-card"] a, a[href*="/video/"]',
    HASHTAG_LINK: '[data-e2e="challenge-item"] a, [data-e2e="search-common-link"], ' +
      'a[href*="/tag/"]',
  },
  YOUTUBE: {
    LIKE: 'button[aria-label*="like" i], button[aria-label*="Нравится" i], ' +
      '#like-button button, ytd-toggle-button-renderer button',
    COMMENT_BTN: '#comments-button button, button[aria-label*="Comment" i]',
    COMMENT_INPUT: '#contenteditable-root, #placeholder-area, ' +
      '[contenteditable="true"][aria-label*="comment" i]',
    SUBSCRIBE: '#subscribe-button button, button[aria-label*="Subscribe" i], ' +
      'button:has-text("Subscribe"), button:has-text("Подписаться")',
    SHORTS_CONTAINER: 'ytd-reel-video-renderer, ytd-shorts',
  },
} as const;

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

    // Phase boundaries (proportional to total warmup days)
    const passiveEnd = Math.max(1, Math.ceil(totalDays * 0.3));
    const lightEnd = Math.max(passiveEnd + 1, Math.ceil(totalDays * 0.6));

    // Use user-provided hashtags for niche-focused warmup
    const mergedHashtags = Array.isArray(data.hashtags) && data.hashtags.length > 0
      ? [...new Set(data.hashtags)]
      : [];  // No hashtags = pure FYP browsing, which is also valid

    const phaseCtx: WarmupPhaseContext = {
      warmupDay,
      warmupDays: totalDays,
      platform: ctxAcc.platform,
      hashtags: mergedHashtags,
    };

    // ── Navigate to initial niche content ──────────────────
    // If hashtags provided, start by searching for them (trains TikTok algo)
    // Otherwise, just go to FYP
    if (ctxAcc.platform === 'TIKTOK') {
      if (mergedHashtags.length > 0) {
        const startTag = mergedHashtags[Math.floor(Math.random() * mergedHashtags.length)];
        await _navigateToHashtagSearch(page, cursor, startTag, logger);
      } else {
        await page.goto('https://www.tiktok.com/foryou', { waitUntil: 'domcontentloaded' });
      }
    } else {
      // YouTube — Shorts feed or search via search bar
      if (mergedHashtags.length > 0) {
        const startTag = mergedHashtags[Math.floor(Math.random() * mergedHashtags.length)];
        await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(_randomDelay(2000, 3000));
        await _navigateToYoutubeSearch(page, cursor, startTag, logger);
      } else {
        await page.goto('https://www.youtube.com/shorts', { waitUntil: 'domcontentloaded' });
      }
    }
    await page.waitForTimeout(_randomDelay(3000, 5000));

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


// ── TikTok: Human-like Hashtag Search ───────────────────────
// Opens TikTok, clicks search bar, types hashtag manually, clicks search.
// This is how real users find niche content — NOT via direct URL.

async function _navigateToHashtagSearch(
  page: Page,
  cursor: Awaited<ReturnType<typeof createPageCursor>>,
  hashtag: string,
  logger: SocketLogger,
): Promise<void> {
  logger.info(`🔍 Поиск #${hashtag} в TikTok (через поисковую строку)...`);

  // Make sure we're on TikTok first
  const currentUrl = page.url();
  if (!/tiktok\.com/i.test(currentUrl)) {
    await page.goto('https://www.tiktok.com/foryou', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(_randomDelay(2000, 3000));
  }

  // Method 1: Click search bar, type hashtag, press Enter
  try {
    // Click search icon/bar in header
    await humanClick(page, cursor, SEL.TIKTOK.SEARCH_INPUT, { postClickDelay: 800 });
    await page.waitForTimeout(_randomDelay(500, 1000));

    // Clear any existing text and type the hashtag query
    await page.keyboard.press('Control+A');
    await page.waitForTimeout(_randomDelay(200, 400));
    const query = `#${hashtag}`;
    await humanType(page, SEL.TIKTOK.SEARCH_INPUT, query);
    await page.waitForTimeout(_randomDelay(800, 1500));

    // Press Enter to search (more human than clicking search button)
    await humanPressEnter(page);
    await page.waitForTimeout(_randomDelay(3000, 5000));

    // Try to click on a video from search results
    try {
      await humanClick(page, cursor, SEL.TIKTOK.VIDEO_CARD, { postClickDelay: 2000 });
      logger.info(`  ▶ Открыто видео из поиска #${hashtag}`);
      return;
    } catch {
      // No video cards — maybe we're on a tab, try scrolling
      await humanScroll(page, _randomDelay(300, 500));
      await page.waitForTimeout(_randomDelay(1000, 2000));
      try {
        await humanClick(page, cursor, SEL.TIKTOK.VIDEO_CARD, { postClickDelay: 2000 });
        logger.info(`  ▶ Открыто видео из поиска #${hashtag} (после скролла)`);
        return;
      } catch { /* fallback below */ }
    }
  } catch {
    logger.warn(`  ⚠️ Не удалось ввести запрос в поиск — пробую страницу хештега`);
  }

  // Method 2 (fallback): Direct tag page
  try {
    await page.goto(
      `https://www.tiktok.com/tag/${encodeURIComponent(hashtag)}`,
      { waitUntil: 'domcontentloaded', timeout: 15000 },
    );
    await page.waitForTimeout(_randomDelay(2000, 3000));
    await humanClick(page, cursor, SEL.TIKTOK.VIDEO_CARD, { postClickDelay: 2000 });
    logger.info(`  ▶ Открыто видео со страницы #${hashtag}`);
  } catch {
    // Fallback to FYP
    logger.warn(`  ⚠️ Не удалось открыть #${hashtag} — переход на FYP`);
    await page.goto('https://www.tiktok.com/foryou', { waitUntil: 'domcontentloaded' });
  }
}


// ── YouTube: Human-like Search ──────────────────────────────
// Opens YouTube, clicks search bar, types query manually, clicks search.
// Same principle — real users type, not paste URLs.

async function _navigateToYoutubeSearch(
  page: Page,
  cursor: Awaited<ReturnType<typeof createPageCursor>>,
  hashtag: string,
  logger: SocketLogger,
): Promise<void> {
  logger.info(`🔍 Поиск #${hashtag} в YouTube (через поисковую строку)...`);

  // Make sure we're on YouTube first
  const currentUrl = page.url();
  if (!/youtube\.com/i.test(currentUrl)) {
    await page.goto('https://www.youtube.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(_randomDelay(2000, 3000));
  }

  try {
    // Click YouTube search bar
    const ytSearchSel = 'input#search, input[name="search_query"], ' +
      'input[aria-label*="Search" i], input[placeholder*="Search" i]';
    await humanClick(page, cursor, ytSearchSel, { postClickDelay: 800 });
    await page.waitForTimeout(_randomDelay(500, 1000));

    // Clear and type
    await page.keyboard.press('Control+A');
    await page.waitForTimeout(_randomDelay(200, 400));
    const query = `#${hashtag}`;
    await humanType(page, ytSearchSel, query);
    await page.waitForTimeout(_randomDelay(800, 1500));

    // Press Enter to search
    await humanPressEnter(page);
    await page.waitForTimeout(_randomDelay(3000, 5000));

    // Try to click on a Shorts video from results
    try {
      await humanClick(page, cursor, 'a[href*="/shorts/"]', { postClickDelay: 2000 });
      logger.info(`  ▶ Открыто Shorts видео из поиска #${hashtag}`);
    } catch {
      // Fallback: click any video
      try {
        await humanClick(page, cursor, 'a#video-title, ytd-video-renderer a', { postClickDelay: 2000 });
        logger.info(`  ▶ Открыто видео из поиска #${hashtag}`);
      } catch {
        logger.warn(`  ⚠️ Не удалось найти видео по #${hashtag} в YouTube`);
      }
    }
  } catch {
    // Fallback: go to Shorts feed
    logger.warn(`  ⚠️ Не удалось использовать поиск YouTube — переход на Shorts`);
    await page.goto('https://www.youtube.com/shorts', { waitUntil: 'domcontentloaded' });
  }
}


// ── Day 1-3: Passive Watching ───────────────────────────────
// Scroll FYP / niche content, watch videos, minimal engagement.
// New accounts that mass-like on day 1 = suspicious.
// Allow 1-2 likes per session to look human (even passive users like occasionally).

async function _passiveWatching(
  page: Page,
  cursor: Awaited<ReturnType<typeof createPageCursor>>,
  data: WarmupPhaseContext,
  logger: SocketLogger,
  job: Job,
): Promise<void> {
  const watchCount = _randomDelay(10, 18);
  logger.info(`Day ${data.warmupDay}: Пассивный просмотр (${watchCount} видео, 0-2 лайка)`);

  let likes = 0;
  const maxLikes = _randomDelay(0, 2); // 0-2 likes per passive session

  for (let i = 0; i < watchCount; i++) {
    // Occasionally switch to a different hashtag (niche training)
    if (data.hashtags.length > 0 && Math.random() < 0.15 && i > 0) {
      const tag = data.hashtags[Math.floor(Math.random() * data.hashtags.length)];
      if (data.platform === 'TIKTOK') {
        await _navigateToHashtagSearch(page, cursor, tag, logger);
      }
    }

    // Watch each video for 15-60 seconds (like a real user watching full videos)
    const watchTime = _randomDelay(15000, 60000);
    await page.waitForTimeout(watchTime);

    // Random mouse idle movement (humans move mouse while watching)
    if (Math.random() < 0.4) {
      await humanIdleMove(page, cursor);
    }

    // Very occasional like (1-2 per session max)
    if (likes < maxLikes && Math.random() < 0.1) {
      try {
        const likeSel = data.platform === 'TIKTOK' ? SEL.TIKTOK.LIKE : SEL.YOUTUBE.LIKE;
        await humanClick(page, cursor, likeSel, { postClickDelay: 500 });
        likes++;
        logger.info(`  ❤️ Лайк видео ${i + 1} (${likes}/${maxLikes})`);
      } catch { /* element not found */ }
    }

    // Scroll to next video
    await humanScroll(page, _randomDelay(300, 600));
    await page.waitForTimeout(_randomDelay(1500, 3000));

    await job.updateProgress(Math.round((i / watchCount) * 100));
    logger.info(`  Просмотрено видео ${i + 1}/${watchCount} (${Math.round(watchTime / 1000)}с)`);
  }

  logger.info(`  Итого: ${likes} лайков (пассив)`);
}

// ── Day 4-6: Light Engagement ───────────────────────────────
// Start liking niche videos (20-40% of watched).
// One meaningful comment per session. Occasional saves.
// Browsing is focused on user's hashtags.

async function _lightEngagement(
  page: Page,
  cursor: Awaited<ReturnType<typeof createPageCursor>>,
  data: WarmupPhaseContext,
  logger: SocketLogger,
  job: Job,
): Promise<void> {
  const watchCount = _randomDelay(12, 20);
  // M-3 FIX: Use proportional phase calculation
  const passiveEnd = Math.max(1, Math.ceil(data.warmupDays * 0.3));
  const lightStart = passiveEnd + 1;
  const lightEnd = Math.max(passiveEnd + 1, Math.ceil(data.warmupDays * 0.6));
  const lightSpan = Math.max(1, lightEnd - lightStart + 1);
  const dayInPhase = data.warmupDay - lightStart;
  const likeProb = 0.2 + (dayInPhase / lightSpan) * 0.2; // 20% → 40% across the phase
  let liked = 0;
  let commented = false;

  logger.info(`Day ${data.warmupDay}: Лёгкая активность (${watchCount} видео, like ~${Math.round(likeProb * 100)}%)`);

  // BUG-H4 fix: compute comment target index ONCE before the loop
  const commentAtIndex = _randomDelay(4, Math.max(4, watchCount - 2));

  for (let i = 0; i < watchCount; i++) {
    // Navigate to niche hashtag content (30% chance)
    if (data.hashtags.length > 0 && Math.random() < 0.3 && i > 0) {
      const randomTag = data.hashtags[Math.floor(Math.random() * data.hashtags.length)];
      if (data.platform === 'TIKTOK') {
        await _navigateToHashtagSearch(page, cursor, randomTag, logger);
      } else {
        await _navigateToYoutubeSearch(page, cursor, randomTag, logger);
      }
    }

    // Watch video — longer durations (real users watch 15-45s)
    const watchTime = _randomDelay(15000, 45000);
    await page.waitForTimeout(watchTime);

    // Like with probability — only niche content
    if (Math.random() < likeProb) {
      try {
        const likeSel = data.platform === 'TIKTOK' ? SEL.TIKTOK.LIKE : SEL.YOUTUBE.LIKE;
        await humanClick(page, cursor, likeSel, { postClickDelay: 500 });
        liked++;
        logger.info(`  ❤️ Лайк видео ${i + 1}`);
      } catch { /* element not found */ }
    }

    // One comment per session (meaningful, not emoji spam)
    if (!commented && i === commentAtIndex) {
      const comment = COMMENT_POOL[Math.floor(Math.random() * COMMENT_POOL.length)];
      try {
        if (data.platform === 'TIKTOK') {
          await humanClick(page, cursor, SEL.TIKTOK.COMMENT_BTN, { postClickDelay: 1500 });
          await page.waitForTimeout(_randomDelay(1000, 2000));
          await humanType(page, SEL.TIKTOK.COMMENT_INPUT, comment);
          await humanPressEnter(page);
          commented = true;
          logger.info(`  💬 Комментарий: "${comment}"`);
        } else {
          await humanClick(page, cursor, SEL.YOUTUBE.COMMENT_BTN, { postClickDelay: 1500 });
          await page.waitForTimeout(_randomDelay(1500, 3000));
          await humanType(page, SEL.YOUTUBE.COMMENT_INPUT, comment);
          // YouTube: click "Comment" button to submit
          try {
            await humanClick(page, cursor,
              '#submit-button button, button[aria-label*="Comment" i], button:has-text("Comment")',
              { postClickDelay: 2000 },
            );
          } catch { /* auto-submit or not found */ }
          commented = true;
          logger.info(`  💬 Комментарий (YouTube): "${comment}"`);
        }
      } catch { /* skip */ }
    }

    // Save (bookmark) occasionally — 10%
    if (Math.random() < 0.1 && data.platform === 'TIKTOK') {
      try {
        await humanClick(page, cursor, SEL.TIKTOK.SAVE, { postClickDelay: 500 });
        logger.info(`  🔖 Сохранено видео ${i + 1}`);
      } catch { /* skip */ }
    }

    // Random idle move
    if (Math.random() < 0.3) {
      await humanIdleMove(page, cursor);
    }

    // Scroll to next
    await humanScroll(page, _randomDelay(300, 600));
    await page.waitForTimeout(_randomDelay(1500, 3000));

    await job.updateProgress(Math.round((i / watchCount) * 100));
  }

  logger.info(`  Итого: ${liked} лайков, ${commented ? '1 комментарий' : '0 комментариев'}`);
}

// ── Day 7-10: Active Engagement ─────────────────────────────
// Higher like rate (35-55%), 2-3 comments, saves, follow 1-3 users.
// Follow ONLY niche accounts (those who post hashtag content).
// By day 10, the account looks like an organic user in the niche.

async function _activeEngagement(
  page: Page,
  cursor: Awaited<ReturnType<typeof createPageCursor>>,
  data: WarmupPhaseContext,
  logger: SocketLogger,
  job: Job,
): Promise<void> {
  const watchCount = _randomDelay(15, 25);
  // M-3 FIX: Use proportional phase calculation
  const lightEnd = Math.max(2, Math.ceil(data.warmupDays * 0.6));
  const activeStart = lightEnd + 1;
  const activeSpan = Math.max(1, data.warmupDays - activeStart + 1);
  const dayInPhase = data.warmupDay - activeStart;
  const likeProb = 0.35 + (dayInPhase / activeSpan) * 0.2; // 35% → 55% across the phase
  let liked = 0;
  let comments = 0;
  const maxComments = _randomDelay(2, 3);
  let follows = 0;
  const maxFollows = _randomDelay(1, 3); // Max 1-3 follows per session

  logger.info(`Day ${data.warmupDay}: Активная активность (${watchCount} видео, like ~${Math.round(likeProb * 100)}%, max follows: ${maxFollows})`);

  for (let i = 0; i < watchCount; i++) {
    // Navigate to niche hashtag content more frequently (40%)
    if (data.hashtags.length > 0 && Math.random() < 0.4 && i > 0) {
      const randomTag = data.hashtags[Math.floor(Math.random() * data.hashtags.length)];
      if (data.platform === 'TIKTOK') {
        await _navigateToHashtagSearch(page, cursor, randomTag, logger);
      } else {
        await _navigateToYoutubeSearch(page, cursor, randomTag, logger);
      }
    }

    // Watch video — 15-45 seconds
    const watchTime = _randomDelay(15000, 45000);
    await page.waitForTimeout(watchTime);

    // Like — only with probability (NOT every video!)
    if (Math.random() < likeProb) {
      try {
        const likeSel = data.platform === 'TIKTOK' ? SEL.TIKTOK.LIKE : SEL.YOUTUBE.LIKE;
        await humanClick(page, cursor, likeSel, { postClickDelay: 500 });
        liked++;
        logger.info(`  ❤️ Лайк видео ${i + 1} (всего: ${liked})`);
      } catch { /* skip */ }
    }

    // Comments (up to maxComments per session, 25% chance per video)
    if (comments < maxComments && Math.random() < 0.25) {
      const comment = COMMENT_POOL[Math.floor(Math.random() * COMMENT_POOL.length)];
      try {
        if (data.platform === 'TIKTOK') {
          await humanClick(page, cursor, SEL.TIKTOK.COMMENT_BTN, { postClickDelay: 1500 });
          await page.waitForTimeout(_randomDelay(1000, 2000));
          await humanType(page, SEL.TIKTOK.COMMENT_INPUT, comment);
          await humanPressEnter(page);
          comments++;
          logger.info(`  💬 Комментарий: "${comment}"`);
        } else {
          await humanClick(page, cursor, SEL.YOUTUBE.COMMENT_BTN, { postClickDelay: 1500 });
          await page.waitForTimeout(_randomDelay(1500, 3000));
          await humanType(page, SEL.YOUTUBE.COMMENT_INPUT, comment);
          try {
            await humanClick(page, cursor,
              '#submit-button button, button[aria-label*="Comment" i]',
              { postClickDelay: 2000 },
            );
          } catch { /* auto-submit */ }
          comments++;
          logger.info(`  💬 Комментарий (YouTube): "${comment}"`);
        }
      } catch { /* skip */ }
    }

    // Save (bookmark) occasionally — 12%
    if (Math.random() < 0.12 && data.platform === 'TIKTOK') {
      try {
        await humanClick(page, cursor, SEL.TIKTOK.SAVE, { postClickDelay: 500 });
        logger.info(`  🔖 Сохранено видео ${i + 1}`);
      } catch { /* skip */ }
    }

    // Follow — ONLY niche accounts, 5% chance, capped at maxFollows
    if (follows < maxFollows && Math.random() < 0.05) {
      try {
        if (data.platform === 'TIKTOK') {
          await humanClick(page, cursor, SEL.TIKTOK.FOLLOW, { postClickDelay: 1000 });
          follows++;
          logger.info(`  ➕ Подписка на автора (${follows}/${maxFollows})`);
        } else {
          await humanClick(page, cursor, SEL.YOUTUBE.SUBSCRIBE, { postClickDelay: 1000 });
          follows++;
          logger.info(`  ➕ Подписка на канал (${follows}/${maxFollows})`);
        }
      } catch { /* skip */ }
    }

    // Random idle move
    if (Math.random() < 0.3) {
      await humanIdleMove(page, cursor);
    }

    await humanScroll(page, _randomDelay(300, 600));
    await page.waitForTimeout(_randomDelay(1500, 3000));
    await job.updateProgress(Math.round((i / watchCount) * 100));
    logger.info(`  📺 Видео ${i + 1}/${watchCount} (${Math.round(watchTime / 1000)}с)`);
  }

  logger.info(`  Итого: ${liked} лайков, ${comments} комментариев, ${follows} подписок`);
}

// ── Utility ─────────────────────────────────────────────────

function _randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
