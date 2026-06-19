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
import { createPageCursor, humanClick, humanScroll, humanIdleMove, randomMouseWander } from '../core/humanity/biomouse.js';
import { humanType, humanPressEnter } from '../core/humanity/typing-emulator.js';
import { SocketLogger } from '../lib/socket-logger.js';
import { emitWorkerError } from '../lib/error-classifier.js';
import { prisma } from '../lib/prisma.js';
import { loadAccountContext } from '../lib/account-context.js';
import { acquireAccountLock, releaseAccountLock } from '../lib/account-lock.js';
import type { Browser, Page } from 'patchright';
import type { GhostCursor } from 'ghost-cursor';

// ── Types ───────────────────────────────────────────────────

interface WarmupJobData {
  userId: string;
  taskId?: string;
  accountId: string;          // only field needed; the rest comes from the DB
  cookiesDir?: string;
  /** Optional override of warmupDay for replays; normally derived from warmupStartedAt */
  warmupDay?: number;
  warmupDays?: number;
  warmupMode?: 'DAYS' | 'HOURS';
  warmupHours?: number;
  /** Hashtags to use for warmup (e.g. ['dota2', 'gaming']) */
  hashtags?: string[];
  /** Which session within the current day (0-based). Used for multi-session scheduling. */
  sessionInDay?: number;
}

/** Inline context shim passed to phase helpers (replaces WarmupJobData). */
interface WarmupPhaseContext {
  accountId: string;
  warmupDay: number;
  warmupDays: number;
  platform: 'TIKTOK' | 'YOUTUBE';
  hashtags: string[];
}

function _normalizeWarmupDays(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(21, Math.floor(parsed)));
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
    // ── Like ─────────────────────────────────────────────────
    // Must work on BOTH Shorts and regular watch pages:
    // Shorts: ytd-reel-video-renderer > #like-button, like-button-view-model
    // Regular: segmented-like-dislike-button-view-model, ytd-menu-renderer
    LIKE: '#like-button button, ' +
      'like-button-view-model button, ' +
      'ytd-reel-video-renderer #like-button button, ' +
      'ytd-toggle-button-renderer #button, ' +
      'segmented-like-dislike-button-view-model button:first-child, ' +
      'ytd-segmented-like-dislike-button-renderer #like-button button, ' +
      '#top-level-buttons-computed ytd-toggle-button-renderer:first-child button, ' +
      'button[aria-label*="like" i], ' +
      'button[aria-label*="Нравится" i], ' +
      'ytd-like-button-renderer button',
    // ── Comment ──────────────────────────────────────────────
    // Shorts: #comments-button in reel renderer
    // Regular: comment section scroll target or count link
    COMMENT_BTN: '#comments-button button, ' +
      'ytd-reel-video-renderer #comments-button button, ' +
      'ytd-comments-header-renderer #title, ' +
      '#comment-teaser button, ' +
      'button[aria-label*="Comment" i], ' +
      'button[aria-label*="Комментар" i]',
    COMMENT_INPUT: '#contenteditable-root, #placeholder-area, ' +
      '#comment-input #contenteditable-root, ' +
      '#simplebox-placeholder, ' +
      '[contenteditable="true"][aria-label*="comment" i], ' +
      '[contenteditable="true"][aria-label*="Комментар" i], ' +
      '[contenteditable="true"][aria-label*="Add" i], ' +
      'ytd-comments-entry-point-header-renderer #contenteditable-root',
    // ── Subscribe ────────────────────────────────────────────
    SUBSCRIBE: '#subscribe-button button, ' +
      'ytd-reel-video-renderer #subscribe-button button, ' +
      'ytd-subscribe-button-renderer button, ' +
      'ytd-watch-metadata #subscribe-button button, ' +
      'button[aria-label*="Subscribe" i], ' +
      'button[aria-label*="Подписаться" i], ' +
      'button:has-text("Subscribe"), button:has-text("Подписаться")',
    SHORTS_CONTAINER: 'ytd-reel-video-renderer, ytd-shorts',
  },
} as const;

// ── Main ────────────────────────────────────────────────────

export async function warmupHandler(job: Job<WarmupJobData>): Promise<void> {
  const data = job.data;
  const logger = new SocketLogger(data.userId);
  let browser: Browser | null = null;
  let lockAcquired = false;

  try {
    // Ensure screenshots directory exists
    const fs = require('fs');
    fs.mkdirSync('/tmp/warmup-screenshots', { recursive: true });

    // Acquire per-account lock — prevent concurrent browser sessions
    const holder = await acquireAccountLock(data.accountId, 'warmup');
    if (holder) {
      logger.warn(`⏭️ Пропускаю прогрев — для аккаунта уже запущен: ${holder}`);
      throw new Error(`Account ${data.accountId} is busy: ${holder}`);
    }
    lockAcquired = true;

    // Check account status — skip unsafe states before every self-rescheduled session.
    const accStatus = await prisma.socialAccount.findUnique({
      where: { id: data.accountId },
      select: { status: true },
    });
    if (accStatus && ['BANNED', 'SHADOWBAN_SUSPECTED', 'PAUSED'].includes(accStatus.status)) {
      logger.warn(`⏭️ Пропускаю прогрев — аккаунт ${accStatus.status}`);
      throw new Error(`Account ${data.accountId} is ${accStatus.status}`);
    }

    const ctxAcc = await loadAccountContext(data.accountId);
    const totalDays = _normalizeWarmupDays(data.warmupDays, ctxAcc.warmupDays || 10);

    if (!ctxAcc.warmupStartedAt) {
      // Auto-initialize warmup — don't require a separate API call
      logger.info('Warmup не был инициализирован — автоматическая инициализация...');
      await prisma.socialAccount.update({
        where: { id: data.accountId },
        data: {
          warmupStartedAt: new Date(),
          warmupCompletedAt: null,
          lastWarmupDay: null,
          warmupDays: totalDays,
          status: 'WARMING_UP',
          lastError: null,
        },
      });
    }

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

    // Track which session we're in within this warmup day
    const sessionInDay = data.sessionInDay ?? 0;
    // Each day has 2-4 sessions (deterministic per account for consistency)
    const sessionsPerDay = 2 + (parseInt(data.accountId.slice(-2), 16) % 3); // 2, 3, or 4

    logger.info(
      `🔥 Прогрев аккаунта — День ${warmupDay}/${totalDays}, сессия ${sessionInDay + 1}/${sessionsPerDay} (${ctxAcc.platform})`,
    );

    const ctx = await launchStealthContext({
      accountId: data.accountId,
      taskId: data.taskId,
      jobId: job.id,
      jobType: 'warmup',
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
      accountId: data.accountId,
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

    // Auth check — verify we're not redirected to login and actually logged in
    await page.waitForTimeout(3000);
    const currentUrl = page.url();
    
    let isGuest = false;
    if (ctxAcc.platform === 'YOUTUBE') {
      isGuest = await page.evaluate(() => {
        return !!document.querySelector('a[href*="ServiceLogin"], a[aria-label*="Sign in" i], a[aria-label*="Войти" i]');
      });
    } else {
      isGuest = await page.evaluate(() => {
        return !!document.querySelector('button[data-e2e="top-login-button"]') || window.location.href.includes('/login');
      });
    }

    if (isGuest) {
      await page.screenshot({ path: `/tmp/warmup-screenshots/${data.accountId}_auth_fail.png` }).catch(() => {});
      logger.error('❌ Cookies устарели или невалидны — аккаунт не авторизован');
      throw new Error(`Auth failed: Not logged in to ${ctxAcc.platform}. Re-import cookies.`);
    }
    
    logger.info('✅ Авторизация подтверждена');
    await page.screenshot({ path: `/tmp/warmup-screenshots/${data.accountId}_auth_ok.png` }).catch(() => {});

    await page.waitForTimeout(_randomDelay(3000, 5000));

    if (data.warmupMode === 'HOURS') {
      const hours = data.warmupHours || 2;
      const endTime = Date.now() + hours * 3600_000;
      logger.info(`⏳ Быстрый прогрев запущен на ${hours} часов`);
      
      let cycle = 1;
      while (Date.now() < endTime) {
        logger.info(`🔄 Часовой прогрев — цикл ${cycle}...`);
        const activePhaseCtx = { ...phaseCtx, warmupDay: totalDays, warmupDays: totalDays };
        await _activeEngagement(page, cursor, activePhaseCtx, logger, job);
        
        if (Date.now() < endTime) {
           const breakDelay = _randomDelay(2 * 60_000, 5 * 60_000);
           logger.info(`☕ Короткий перерыв ${Math.round(breakDelay/60_000)} мин...`);
           await page.waitForTimeout(breakDelay);
        }
        cycle++;
      }

      await prisma.socialAccount.update({
        where: { id: data.accountId },
        data: { warmupCompletedAt: new Date(), status: 'ALIVE', lastWarmupDay: totalDays },
      });
      logger.info(`🎉 Быстрый прогрев (${hours}ч) завершён! Аккаунт ${data.accountId} готов к загрузкам.`);
      
      await job.updateProgress(100);
      return;
    }

    if (warmupDay <= passiveEnd) {
      await _passiveWatching(page, cursor, phaseCtx, logger, job);
    } else if (warmupDay <= lightEnd) {
      await _lightEngagement(page, cursor, phaseCtx, logger, job);
    } else {
      await _activeEngagement(page, cursor, phaseCtx, logger, job);
    }

    logger.info(`✅ Прогрев День ${warmupDay}/${totalDays}, сессия ${sessionInDay + 1}/${sessionsPerDay} завершена`);

    // ── Self-reschedule: multi-session per day + sleep ────────
    // Real user behavior:
    //   Session 1 (morning)  → break 1.5-4h
    //   Session 2 (day)      → break 1.5-4h
    //   Session 3 (evening)  → 💤 sleep 6-8h → next day
    //
    // sessionsPerDay: 2-4 (deterministic per account)
    // sessionInDay:   0-based index of current session

    const { addJob } = await import('../lib/bullmq.js');
    const isLastSessionOfDay = sessionInDay + 1 >= sessionsPerDay;
    const isLastDay = warmupDay >= totalDays;

    if (isLastDay && isLastSessionOfDay) {
      // 🎉 All done — warmup complete
      await prisma.socialAccount.update({
        where: { id: data.accountId },
        data: { warmupCompletedAt: new Date(), status: 'ALIVE', lastWarmupDay: warmupDay },
      });
      logger.info(`🎉 Прогрев завершён! Аккаунт ${data.accountId} готов к загрузкам.`);

    } else if (isLastSessionOfDay) {
      // 💤 Last session of the day — "sleep" 6-8 hours, then start next day
      const sleepDelay = _randomDelay(6 * 3600_000, 8 * 3600_000);
      const sleepHours = (sleepDelay / 3600_000).toFixed(1);

      await prisma.socialAccount.update({
        where: { id: data.accountId },
        data: { lastWarmupDay: warmupDay },
      });

      await addJob('warmup' as any, {
        userId: data.userId,
        accountId: data.accountId,
        hashtags: data.hashtags,
        cookiesDir: data.cookiesDir,
        sessionInDay: 0, // reset to first session of new day
      }, {
        delay: sleepDelay,
        jobId: `warmup-${data.accountId}-day${warmupDay + 1}-s0`,
      });
      logger.info(`💤 Сон ~${sleepHours}ч. Следующий день прогрева (${warmupDay + 1}/${totalDays}) запланирован`);

    } else {
      // ☕ Mid-day break — next session in 1.5-4 hours
      const breakDelay = _randomDelay(90 * 60_000, 240 * 60_000);
      const breakMins = Math.round(breakDelay / 60_000);
      const nextSession = sessionInDay + 1;

      // Don't increment warmupDay yet — still same day
      await addJob('warmup' as any, {
        userId: data.userId,
        accountId: data.accountId,
        hashtags: data.hashtags,
        cookiesDir: data.cookiesDir,
        warmupDay: warmupDay, // keep same day
        sessionInDay: nextSession,
      }, {
        delay: breakDelay,
        jobId: `warmup-${data.accountId}-day${warmupDay}-s${nextSession}`,
      });
      logger.info(`☕ Перерыв ~${breakMins} мин. Сессия ${nextSession + 1}/${sessionsPerDay} запланирована`);
    }

    await job.updateProgress(100);

  } catch (err: unknown) {
    const classified = emitWorkerError(logger, data.accountId, 'warmup', err);
    await prisma.socialAccount.findUnique({
      where: { id: data.accountId },
      select: { status: true, warmupCompletedAt: true },
    }).then((account) => {
      if (!account) return null;
      const updateData: Record<string, unknown> = {
        lastError: classified.message,
      };

      if (account.status === 'WARMING_UP' && account.warmupCompletedAt) {
        updateData.status = 'ALIVE';
      } else if (classified.code === 'COOKIES_EXPIRED') {
        updateData.status = 'EXPIRED_COOKIES';
      } else if (classified.code === 'AUTH_NEEDED') {
        updateData.status = 'AUTH_NEEDED';
      } else if (classified.code === 'ACCOUNT_BANNED' || classified.code === 'ACCOUNT_SUSPENDED') {
        updateData.status = 'BANNED';
      }

      return prisma.socialAccount.update({
        where: { id: data.accountId },
        data: updateData,
      });
    }).catch(() => {});
    throw err;
  } finally {
    if (lockAcquired) await releaseAccountLock(data.accountId, 'warmup');
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

    // Extract video URLs from search results via DOM evaluation
    const videoUrl = await page.evaluate(() => {
      // Collect all Shorts links
      const shortsLinks = Array.from(document.querySelectorAll('a[href*="/shorts/"]')) as HTMLAnchorElement[];
      // Collect all regular video links
      const videoLinks = Array.from(document.querySelectorAll('a#video-title, ytd-video-renderer a#thumbnail')) as HTMLAnchorElement[];
      
      const shorts: string[] = [];
      const regular: string[] = [];
      for (const a of shortsLinks) {
        if (a.href && a.href.includes('/shorts/')) shorts.push(a.href);
      }
      for (const a of videoLinks) {
        if (a.href && a.href.includes('/watch?')) regular.push(a.href);
      }
      
      // Mix: 70% chance Shorts, 30% chance regular video
      // Real users watch both formats
      const useRegular = regular.length > 0 && Math.random() < 0.3;
      const pool = useRegular ? regular.slice(0, 5) : (shorts.length > 0 ? shorts.slice(0, 5) : regular.slice(0, 5));
      return pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
    });

    if (videoUrl) {
      await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(_randomDelay(2000, 3000));
      const isShort = videoUrl.includes('/shorts/');
      logger.info(`  ▶ Открыто ${isShort ? 'Shorts' : ''} видео из поиска #${hashtag}`);
    } else {
      // No results — fallback to Shorts feed  
      logger.warn(`  ⚠️ Не удалось найти видео по #${hashtag} — переход на Shorts ленту`);
      await page.goto('https://www.youtube.com/shorts', { waitUntil: 'domcontentloaded' });
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
      } else {
        await _navigateToYoutubeSearch(page, cursor, tag, logger);
      }
    }

    // Watch each video for 15-60 seconds (like a real user watching full videos)
    const watchTime = _randomDelay(15000, 60000);
    // Screenshot every 3rd video or first video
    if (i === 0 || i % 3 === 0) {
      await page.screenshot({ path: `/tmp/warmup-screenshots/${data.accountId}_watch_${i + 1}.png` }).catch(() => {});
    }
    await page.waitForTimeout(watchTime);

    // Random mouse idle movement (humans move mouse while watching)
    if (Math.random() < 0.6) {
      await humanIdleMove(page, cursor);
    }
    // Extended mouse wander for longer watches (>30s) — simulates reading comments, checking description
    if (watchTime > 30000 && Math.random() < 0.4) {
      await randomMouseWander(page, cursor, _randomDelay(1500, 3000));
    }
    // Occasional micro-scroll while watching (reading comments, checking description)
    if (Math.random() < 0.25) {
      await humanScroll(page, _randomDelay(80, 200));
      await page.waitForTimeout(_randomDelay(500, 1500));
    }
    // Shorts-specific: occasional swipe-like scroll down then back up (checking comments section)
    if (page.url().includes('/shorts/') && Math.random() < 0.2) {
      await humanScroll(page, _randomDelay(150, 300), 'down');
      await page.waitForTimeout(_randomDelay(1000, 3000));
      await humanScroll(page, _randomDelay(100, 200), 'up');
    }

    // Very occasional like (1-2 per session max)
    if (likes < maxLikes && Math.random() < 0.1) {
      try {
        const likeSel = data.platform === 'TIKTOK' ? SEL.TIKTOK.LIKE : SEL.YOUTUBE.LIKE;
        if (data.platform === 'YOUTUBE') {
          const clicked = await _resilientClick(page, cursor, likeSel, logger, 'like');
          if (clicked) {
            likes++;
            logger.info(`  ❤️ Лайк видео ${i + 1} (${likes}/${maxLikes})`);
          }
        } else {
          await _resilientClick(page, cursor, likeSel, logger, 'tiktok-like');
          likes++;
          logger.info(`  ❤️ Лайк видео ${i + 1} (${likes}/${maxLikes})`);
        }
      } catch { /* element not found */ }
    }

    // Navigate to next video (ArrowDown for YouTube Shorts, goBack for regular)
    // Human-like: move mouse before navigating
    await humanIdleMove(page, cursor);
    if (data.platform === 'YOUTUBE') {
      const url = page.url();
      if (url.includes('/shorts/')) {
        // Shorts: ArrowDown switches to next Short — this works correctly
        await page.waitForTimeout(_randomDelay(200, 500));
        await page.keyboard.press('ArrowDown');
      } else {
        // Regular video: go back to search, pick next unwatched video
        if (Math.random() < 0.3) await humanScroll(page, _randomDelay(50, 150), 'up');
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(_randomDelay(1500, 3000));
        // Click next video from search results
        const nextUrl = await page.evaluate((idx: number) => {
          const links = Array.from(document.querySelectorAll('a#video-title, a[href*="/shorts/"], ytd-video-renderer a#thumbnail')) as HTMLAnchorElement[];
          const valid = links.filter(a => a.href && (a.href.includes('/watch?') || a.href.includes('/shorts/')));
          // Pick video at offset idx to avoid re-watching the same one
          const pick = valid[idx % valid.length];
          return pick ? pick.href : null;
        }, i + 1);
        if (nextUrl) {
          await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(_randomDelay(1000, 2000));
        }
      }
    } else {
      await humanScroll(page, _randomDelay(300, 600));
    }
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
        if (data.platform === 'YOUTUBE') {
          const clicked = await _resilientClick(page, cursor, likeSel, logger, 'like');
          if (clicked) {
            liked++;
            logger.info(`  ❤️ Лайк видео ${i + 1}`);
          }
        } else {
          await _resilientClick(page, cursor, likeSel, logger, 'tiktok-like');
          liked++;
          logger.info(`  ❤️ Лайк видео ${i + 1}`);
        }
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
          // YouTube Shorts: resilient click to open comment panel
          const commentOpened = await _resilientClick(page, cursor, SEL.YOUTUBE.COMMENT_BTN, logger, 'comment-btn');
          if (commentOpened) {
            await page.waitForTimeout(_randomDelay(2000, 4000));
            try {
              await page.waitForSelector(SEL.YOUTUBE.COMMENT_INPUT, { state: 'visible', timeout: 5000 });
              await humanType(page, SEL.YOUTUBE.COMMENT_INPUT, comment);
              try {
                await _resilientClick(page, cursor,
                  '#submit-button button, button[aria-label*="Comment" i], button[aria-label*="Комментар" i]',
                  logger, 'comment-submit');
              } catch { await humanPressEnter(page); }
              commented = true;
              logger.info(`  💬 Комментарий (YouTube): "${comment}"`);
            } catch {
              logger.info(`  ⚠️ Comment input не найден`);
              await page.keyboard.press('Escape');
            }
          }
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

    // Random idle move + micro-scroll (human watching behavior)
    if (Math.random() < 0.5) {
      await humanIdleMove(page, cursor);
    }
    // Extended mouse wander during longer watches
    if (watchTime > 25000 && Math.random() < 0.4) {
      await randomMouseWander(page, cursor, _randomDelay(1500, 3000));
    }
    if (Math.random() < 0.2) {
      await humanScroll(page, _randomDelay(80, 200));
      await page.waitForTimeout(_randomDelay(400, 1000));
    }
    // Shorts-specific scroll gesture
    if (page.url().includes('/shorts/') && Math.random() < 0.2) {
      await humanScroll(page, _randomDelay(150, 300), 'down');
      await page.waitForTimeout(_randomDelay(1000, 3000));
      await humanScroll(page, _randomDelay(100, 200), 'up');
    }

    // Scroll to next (ArrowDown for YouTube Shorts, goBack for regular, scroll for TikTok)
    // Human-like: move mouse before navigating
    await humanIdleMove(page, cursor);
    if (data.platform === 'YOUTUBE') {
      const url = page.url();
      if (url.includes('/shorts/')) {
        await page.waitForTimeout(_randomDelay(200, 500));
        await page.keyboard.press('ArrowDown');
      } else {
        if (Math.random() < 0.3) await humanScroll(page, _randomDelay(50, 150), 'up');
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(_randomDelay(1500, 3000));
        const nextUrl = await page.evaluate((idx: number) => {
          const links = Array.from(document.querySelectorAll('a#video-title, a[href*="/shorts/"], ytd-video-renderer a#thumbnail')) as HTMLAnchorElement[];
          const valid = links.filter(a => a.href && (a.href.includes('/watch?') || a.href.includes('/shorts/')));
          const pick = valid[idx % valid.length];
          return pick ? pick.href : null;
        }, i + 1);
        if (nextUrl) {
          await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(_randomDelay(1000, 2000));
        }
      }
    } else {
      await humanScroll(page, _randomDelay(300, 600));
    }
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

  const isYT = data.platform === 'YOUTUBE';

  logger.info(`Day ${data.warmupDay}: Активная активность (${watchCount} видео, like ~${Math.round(likeProb * 100)}%, max follows: ${maxFollows})`);;

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
        if (isYT) {
          // YouTube Shorts: try locator-based click with short timeout + fallback
          const clicked = await _resilientClick(page, cursor, likeSel, logger, 'like');
          if (clicked) {
            liked++;
            logger.info(`  ❤️ Лайк видео ${i + 1} (всего: ${liked})`);
          }
        } else {
          await _resilientClick(page, cursor, likeSel, logger, 'tiktok-like');
          liked++;
          logger.info(`  ❤️ Лайк видео ${i + 1} (всего: ${liked})`);
        }
      } catch (e: any) {
        logger.info(`  ⚠️ Like skip (${e?.message?.slice(0, 60) || 'unknown'})`);
      }
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
          // YouTube Shorts: open comment panel
          const commentOpened = await _resilientClick(page, cursor, SEL.YOUTUBE.COMMENT_BTN, logger, 'comment-btn');
          if (commentOpened) {
            await page.waitForTimeout(_randomDelay(2000, 4000));
            // Wait for comment input to appear
            try {
              await page.waitForSelector(SEL.YOUTUBE.COMMENT_INPUT, { state: 'visible', timeout: 5000 });
              await humanType(page, SEL.YOUTUBE.COMMENT_INPUT, comment);
              // Submit
              try {
                await _resilientClick(page, cursor,
                  '#submit-button button, button[aria-label*="Comment" i], button[aria-label*="Комментар" i]',
                  logger, 'comment-submit');
              } catch { /* auto-submit via Enter */ await humanPressEnter(page); }
              comments++;
              logger.info(`  💬 Комментарий (YouTube): "${comment}"`);
            } catch {
              logger.info(`  ⚠️ Comment input не найден, закрываю панель`);
              await page.keyboard.press('Escape');
            }
          }
        }
      } catch (e: any) {
        logger.info(`  ⚠️ Comment skip (${e?.message?.slice(0, 60) || 'unknown'})`);
      }
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
          const subClicked = await _resilientClick(page, cursor, SEL.YOUTUBE.SUBSCRIBE, logger, 'subscribe');
          if (subClicked) {
            follows++;
            logger.info(`  ➕ Подписка на канал (${follows}/${maxFollows})`);
          }
        }
      } catch (e: any) {
        logger.info(`  ⚠️ Follow skip (${e?.message?.slice(0, 60) || 'unknown'})`);
      }
    }

    // Random idle move + micro-scroll (human watching behavior)
    if (Math.random() < 0.5) {
      await humanIdleMove(page, cursor);
    }
    // Extended mouse wander during longer watches
    if (watchTime > 25000 && Math.random() < 0.4) {
      await randomMouseWander(page, cursor, _randomDelay(1500, 3000));
    }
    if (Math.random() < 0.2) {
      await humanScroll(page, _randomDelay(80, 200));
      await page.waitForTimeout(_randomDelay(400, 1000));
    }
    // Shorts-specific scroll gesture
    if (page.url().includes('/shorts/') && Math.random() < 0.2) {
      await humanScroll(page, _randomDelay(150, 300), 'down');
      await page.waitForTimeout(_randomDelay(1000, 3000));
      await humanScroll(page, _randomDelay(100, 200), 'up');
    }

    // Navigate to next video: depends on video type
    // Human-like: move mouse before navigating
    await humanIdleMove(page, cursor);
    if (isYT) {
      const url = page.url();
      if (url.includes('/shorts/')) {
        // YouTube Shorts: ArrowDown scrolls to next Short
        await page.waitForTimeout(_randomDelay(200, 500));
        await page.keyboard.press('ArrowDown');
      } else {
        // Regular YouTube video: go back to search and pick next
        if (Math.random() < 0.3) await humanScroll(page, _randomDelay(50, 150), 'up');
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(_randomDelay(1500, 3000));
        const nextUrl = await page.evaluate((idx: number) => {
          const links = Array.from(document.querySelectorAll('a#video-title, a[href*="/shorts/"], ytd-video-renderer a#thumbnail')) as HTMLAnchorElement[];
          const valid = links.filter(a => a.href && (a.href.includes('/watch?') || a.href.includes('/shorts/')));
          const pick = valid[idx % valid.length];
          return pick ? pick.href : null;
        }, i + 1);
        if (nextUrl) {
          await page.goto(nextUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(_randomDelay(1000, 2000));
        }
      }
      await page.waitForTimeout(_randomDelay(1500, 3000));
    } else {
      await humanScroll(page, _randomDelay(300, 600));
      await page.waitForTimeout(_randomDelay(1500, 3000));
    }
    await job.updateProgress(Math.round((i / watchCount) * 100));
    logger.info(`  📺 Видео ${i + 1}/${watchCount} (${Math.round(watchTime / 1000)}с)`);
  }

  logger.info(`  Итого: ${liked} лайков, ${comments} комментариев, ${follows} подписок`);
}

// ── Resilient Click (YouTube Shorts fallback) ───────────────

/**
 * Try humanClick first (human-like Bezier cursor), fall back to
 * Playwright locator.click() if the selector times out.
 *
 * YouTube Shorts uses custom web-components (like-button-view-model,
 * ytd-reel-video-renderer) where standard waitForSelector may fail
 * within the ghost-cursor 10s timeout. The locator API handles these
 * elements more reliably.
 *
 * @returns true if click succeeded, false if all attempts failed
 */
async function _resilientClick(
  page: Page,
  cursor: Awaited<ReturnType<typeof createPageCursor>>,
  selector: string,
  logger: SocketLogger,
  action: string,
): Promise<boolean> {
  // Split compound selectors and try each individually
  const selectors = selector.split(',').map(s => s.trim()).filter(Boolean);

  // Strategy 1: Try humanClick with reduced timeout (3s instead of 10s)
  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { state: 'visible', timeout: 3000 });
      await cursor.click(sel, {
        paddingPercentage: 10,
        waitForClick: _randomDelay(50, 200),
      });
      await page.waitForTimeout(_randomDelay(300, 700));
      return true;
    } catch {
      // This selector didn't work, try next
    }
  }

  // Strategy 2: Playwright locator with force:true (bypasses visibility checks)
  for (const sel of selectors) {
    try {
      const locator = page.locator(sel).first();
      if (await locator.count() > 0) {
        await locator.click({ force: true, timeout: 3000 });
        await page.waitForTimeout(_randomDelay(300, 700));
        return true;
      }
    } catch {
      // Next selector
    }
  }

  // Strategy 3: Try JavaScript click as last resort
  for (const sel of selectors) {
    try {
      const clicked = await page.evaluate((s) => {
        const el = document.querySelector(s) as HTMLElement | null;
        if (el) { el.click(); return true; }
        return false;
      }, sel);
      if (clicked) {
        await page.waitForTimeout(_randomDelay(300, 700));
        return true;
      }
    } catch {
      // Next selector
    }
  }

  logger.info(`  ⚠️ ${action}: ни один селектор не сработал`);
  return false;
}

// ── Utility ─────────────────────────────────────────────────

function _randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
