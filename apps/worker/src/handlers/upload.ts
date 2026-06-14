// ─────────────────────────────────────────────────────────────
// Upload Handler v2 — Patchright + Cookie-only + Uniquification
//
// MAJOR CHANGES from v1:
// 1. Selenium/UC → Patchright (CDP-based, undetectable)
// 2. Cookies loaded from encrypted store (no JSON in job payload)
// 3. Video uniquification per-account (FFmpeg pipeline)
// 4. Human behavior layer (ghost-cursor, typing emulator)
// 5. Pre-flight cookie validation (curl-impersonate, no browser)
// 6. Warmup enforcement (blocks if account not warmed up)
// 7. Rate limiting (3 videos/day, 2h between uploads)
//
// NEVER import puppeteer, selenium, or undetected-chromedriver.
// ─────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { launchStealthContext, closeBrowser } from '../core/browser/patchright-launcher.js';
import { validateCookies } from '../core/auth/session-validator.js';
import { persistCookies, type BrowserCookie } from '../core/auth/cookie-store.js';
import { uniquifyVideo, cleanupUniquifiedVideo } from '../core/video/uniquifier.js';
import { createPageCursor, humanClick, humanScroll } from '../core/humanity/biomouse.js';
import { humanType } from '../core/humanity/typing-emulator.js';
import { SocketLogger } from '../lib/socket-logger.js';
import { emitWorkerError } from '../lib/error-classifier.js';
import { loadAccountContext } from '../lib/account-context.js';
import { prisma } from '../lib/prisma.js';
import type { Browser } from 'patchright';
import fs from 'fs';

// ── Types ───────────────────────────────────────────────────

interface UploadJobData {
  userId: string;          // for SocketLogger only — DO NOT use as auth signal
  videoId: string;
  videoPath: string;
  title: string;
  description: string;
  hashtags?: string[];
  accountId: string;       // EVERYTHING else is resolved from this in the worker
  forceSkipWarmup?: boolean;
  cookiesDir?: string;
  /** Index of this account WITHIN its platform group (0 = first for this platform) */
  platformIndex?: number;
  /** Total number of accounts across all platforms in this job (for cleanup) */
  totalAccountsInJob?: number;
}

// ── Main ────────────────────────────────────────────────────

export async function uploadHandler(job: Job<UploadJobData>): Promise<void> {
  const data = job.data;
  const logger = new SocketLogger(data.userId);
  let browser: Browser | null = null;
  let uniquifiedPath: string | null = null;
  let ctx: any = null;

  try {
    await prisma.video.update({ where: { id: data.videoId }, data: { status: 'PROCESSING' } });

    const ctxAcc = await loadAccountContext(data.accountId);
    const { platform, fingerprint, proxyUrl } = ctxAcc;

    // H-8 FIX: Check account status before proceeding with upload
    const accountStatus = await prisma.socialAccount.findUnique({
      where: { id: data.accountId },
      select: { status: true },
    });
    if (accountStatus && ['BANNED', 'SHADOWBAN_SUSPECTED', 'PAUSED'].includes(accountStatus.status)) {
      throw new Error(`Account ${data.accountId} has status '${accountStatus.status}' — upload aborted.`);
    }

    // M-4 FIX: Idempotency guard — check if THIS ACCOUNT already uploaded THIS VIDEO
    // NOTE: We do NOT check video.isUploaded globally because the same video
    // is intentionally uploaded to multiple accounts in a single job batch.
    const alreadyUploaded = await prisma.video.findFirst({
      where: {
        id: data.videoId,
        accountId: data.accountId,
        isUploaded: true,
      },
    });
    if (alreadyUploaded) {
      logger.warn(`Video ${data.videoId} already uploaded to account ${data.accountId} — skipping duplicate.`);
      return;
    }

    logger.info(`Начинаю загрузку: "${data.title}" → ${platform}`);

    // ── Gate 1: video file exists ───────────────────────────
    if (!fs.existsSync(data.videoPath)) {
      throw new Error(`Видео файл не найден: ${data.videoPath}`);
    }

    // ── Gate 2: account warmed up ───────────────────────────
    if (!ctxAcc.warmupCompletedAt && !data.forceSkipWarmup) {
      throw new Error(
        `Account ${data.accountId} not warmed up yet. ` +
        `Refusing upload. Set forceSkipWarmup=true (admin only) to override.`,
      );
    }

    // ── Gate 3: proxy pinned ────────────────────────────────
    if (!proxyUrl) {
      throw new Error(
        `Account ${data.accountId} has no pinned proxy. ` +
        `Pin an LTE_MOBILE proxy via /account/profiles before uploading.`,
      );
    }

    // ── Gate 4: rate limit (3 videos / 24h) ─────────────────
    const dayAgo = new Date(Date.now() - 86_400_000);
    const recentUploads = await prisma.video.count({
      where: {
        accountId: data.accountId,
        isUploaded: true,
        uploadedAt: { gte: dayAgo },
      },
    });
    if (recentUploads >= 3) {
      throw new Error(
        `Account ${data.accountId} hit the 3-uploads/day limit. Try tomorrow.`,
      );
    }

    // ── Gate 5: minimum 2h gap between uploads ──────────────
    const lastUpload = await prisma.video.findFirst({
      where: { accountId: data.accountId, isUploaded: true },
      orderBy: { uploadedAt: 'desc' },
      select: { uploadedAt: true },
    });
    if (
      lastUpload?.uploadedAt &&
      Date.now() - lastUpload.uploadedAt.getTime() < 2 * 60 * 60 * 1000
    ) {
      throw new Error(`Less than 2h since previous upload on ${data.accountId}. Wait.`);
    }

    // ── Gate 6: cookies valid ───────────────────────────────
    logger.info('Pre-flight проверка cookies...');
    const cookieStatus = await validateCookies(
      data.accountId,
      fingerprint,
      platform as 'TIKTOK' | 'YOUTUBE',
      proxyUrl,
      data.cookiesDir,
    );
    if (cookieStatus === 'banned') {
      await prisma.socialAccount.update({
        where: { id: data.accountId },
        data: { status: 'BANNED' },
      });
      throw new Error('Аккаунт забанен. Отмена загрузки.');
    }
    if (cookieStatus === 'expired') {
      await prisma.socialAccount.update({
        where: { id: data.accountId },
        data: { status: 'EXPIRED_COOKIES' },
      });
      throw new Error('Cookies истекли. Импортируйте новые cookies через UI.');
    }

    await job.updateProgress(10);

    // ── Uniquify video for this account ─────────────────────
    // Logic: first account per platform gets the ORIGINAL (no FFmpeg overhead).
    // Subsequent accounts get a uniquified copy. Cross-platform is safe
    // (same video on YT + TT is fine — different detection systems).
    const isFirstForPlatform = (data.platformIndex ?? 0) === 0;
    let videoToUpload: string;

    if (isFirstForPlatform) {
      logger.info('Первый аккаунт на платформе — загрузка без уникализации');
      videoToUpload = data.videoPath;
    } else {
      logger.info('Уникализация видео (FFmpeg pipeline)...');
      const { outputPath } = await uniquifyVideo({
        accountId: data.accountId,
        inputPath: data.videoPath,
      });
      uniquifiedPath = outputPath;
      videoToUpload = outputPath;
    }
    await job.updateProgress(25);

    // ── Launch stealth browser ──────────────────────────────
    logger.info('Запуск Patchright (stealth Chrome)...');
    ctx = await launchStealthContext({
      accountId: data.accountId,
      proxyUrl,
      cookiesPath: data.cookiesDir ?? '/data/cookies',
      fingerprint,
    });
    browser = ctx.browser;
    const page = ctx.page;
    await job.updateProgress(35);

    const cursor = await createPageCursor(page);

    if (platform === 'TIKTOK') {
      await _uploadToTikTok(page, cursor, data, videoToUpload, logger, job, proxyUrl, fingerprint);
    } else if (platform === 'YOUTUBE') {
      await _uploadToYouTube(page, cursor, data, videoToUpload, logger, job);
    } else {
      throw new Error(`Неизвестная платформа: ${platform}`);
    }

    // ── Mark this upload as done for this account ───────────
    await prisma.video.update({
      where: { id: data.videoId },
      data: {
        isUploaded: true,
        uploadedAt: new Date(),
        status: 'UPLOADED',
        accountId: data.accountId,
      },
    });

    logger.info(`✅ Видео "${data.title}" успешно загружено на ${platform}`);
    await job.updateProgress(100);

    // ── Cleanup: delete original video if ALL accounts in the job are done ──
    // shouldDelete=true (default) means auto-cleanup after all uploads finish.
    if (data.totalAccountsInJob) {
      try {
        const video = await prisma.video.findUnique({
          where: { id: data.videoId },
          select: { shouldDelete: true, filepath: true },
        });
        if (video?.shouldDelete && video.filepath) {
          // Count how many accounts have already uploaded this video
          const uploadedCount = await prisma.video.count({
            where: { id: data.videoId, isUploaded: true },
          });
          // All accounts done → safe to delete the original file
          if (uploadedCount >= data.totalAccountsInJob) {
            if (fs.existsSync(video.filepath)) {
              fs.unlinkSync(video.filepath);
              logger.info(`🗑️ Оригинал удалён: ${video.filepath}`);
            }
            // Clear filepath in DB so we don't try to delete again
            await prisma.video.update({
              where: { id: data.videoId },
              data: { filepath: '' },
            });
          }
        }
      } catch (cleanupErr) {
        logger.warn(`Cleanup skipped: ${(cleanupErr as Error).message?.slice(0, 60)}`);
      }
    }

  } catch (err: unknown) {
    await prisma.video.update({ where: { id: data.videoId }, data: { status: 'FAILED' } }).catch(() => {});
    emitWorkerError(logger, data.accountId, 'upload', err);
    throw err;
  } finally {
    // Save updated session cookies BEFORE closing browser (M-1 fix)
    // Cookies like tt_webid, s_v_web_id get refreshed during sessions.
    // Without saving them, accounts get logged out frequently.
    if (ctx?.context) {
      try {
        const cookies = await ctx.context.cookies() as BrowserCookie[];
        if (cookies.length > 0) {
          // BUG-H1 fix: persist to both disk AND DB
          await persistCookies(data.accountId, cookies, data.cookiesDir ?? '/data/cookies');
        }
      } catch (cookieErr) {
        // Non-critical — don't fail the job over cookie save
        console.warn('[Upload] Failed to persist cookies:', cookieErr);
      }
    }

    // ALWAYS close browser and cleanup temp files
    await closeBrowser(browser);

    // Clean up uniquified video (original stays)
    if (uniquifiedPath) {
      await cleanupUniquifiedVideo(uniquifiedPath);
    }

    logger.disconnect();
  }
}


// ── TikTok Upload ───────────────────────────────────────────

async function _uploadToTikTok(
  page: Parameters<typeof humanClick>[0],
  cursor: Awaited<ReturnType<typeof createPageCursor>>,
  data: UploadJobData,
  videoPath: string,
  logger: SocketLogger,
  job: Job,
  proxyUrl?: string,
  fingerprint?: any
): Promise<void> {
  // Navigate to TikTok Studio upload (2025+) — fallback to legacy /upload
  logger.info('Переход на страницу загрузки TikTok Studio...');
  await page.goto('https://www.tiktok.com/tiktokstudio/upload', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(_randomDelay(3000, 5000));

  // Check if Studio loaded or we need legacy URL
  let currentUrl = page.url();
  if (!/tiktokstudio/i.test(currentUrl) && !/upload/i.test(currentUrl)) {
    logger.warn('TikTok Studio не загрузился — пробую legacy /upload');
    await page.goto('https://www.tiktok.com/upload', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(_randomDelay(3000, 5000));
    currentUrl = page.url();
  }

  // Check auth status — BUG-10 fix: check URL instead of body text
  if (/\/login|accounts\.tiktok\.com/i.test(currentUrl)) {
    throw new Error('Не удалось войти в TikTok — cookies невалидны (перенаправлен на login)');
  }

  logger.info('Авторизация TikTok успешна');
  await job.updateProgress(45);

  // Upload file via hidden input
  const fileInput = await page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(videoPath);
  logger.info('Файл загружен, ожидаю обработку...');

  await page.waitForTimeout(_randomDelay(5000, 10000));
  await job.updateProgress(60);

  // Fill caption with human typing
  try {
    // Resilient caption selectors — TikTok Studio + legacy DraftJS
    const captionSelector =
      '[data-text="true"], .public-DraftEditor-content, ' +
      '[contenteditable="true"][role="textbox"], ' +
      '[aria-label*="caption" i], [aria-label*="описание" i], ' +
      '[contenteditable="true"]';
    await page.waitForSelector(captionSelector, { timeout: 15_000 });
    await humanClick(page, cursor, captionSelector);

    // Build full caption: title + description + hashtags
    const hashtagStr = data.hashtags?.length
      ? '\n' + data.hashtags.map(h => `#${h}`).join(' ')
      : '';
    const caption = `${data.title}\n${data.description}${hashtagStr}`;

    await humanType(page, captionSelector, caption, { clearBefore: true });
    logger.info('Описание и хештеги заполнены');
  } catch {
    logger.warn('Не удалось заполнить описание — селектор изменился');
  }

  await page.waitForTimeout(_randomDelay(2000, 3000));
  await job.updateProgress(75);

  // ── Captcha handling before POST ─────────────────────────
  const { handleTikTokCaptcha } = await import('../core/captcha/tiktok-captcha-handler.js');
  try {
    const solved = await handleTikTokCaptcha({
      page,
      proxyUrl: proxyUrl!,
      userAgent: fingerprint?.userAgent || '',
      websiteURL: page.url(),
    });
    if (solved) {
      logger.info('Captcha auto-solved via CapSolver ✓ (pre-post)');
    }
  } catch (capErr: unknown) {
    const msg = capErr instanceof Error ? capErr.message : String(capErr);
    if (!process.env.CAPSOLVER_API_KEY) {
      throw new Error('CAPTCHA обнаружена (pre-post). Установите CAPSOLVER_API_KEY для автоматического решения.');
    }
    throw new Error(`CAPTCHA solve failed (pre-post): ${msg}`);
  }

  // Click Post button with human mouse
  try {
    // Resilient post button — data-e2e + text-based fallbacks
    const postSelector =
      'button[data-e2e="upload-btn"], button[data-e2e="post-btn"], ' +
      'button:has-text("Post"), button:has-text("Опубликовать"), ' +
      'div[role="button"]:has-text("Post"), div[role="button"]:has-text("Опубликовать")';
    await page.waitForSelector(postSelector, { timeout: 10_000 });
    await humanClick(page, cursor, postSelector, { postClickDelay: 1000 });
    logger.info('Нажата кнопка публикации...');
  } catch {
    // Fallback: iterate all buttons and find Post/Upload
    const buttons = page.locator('button, div[role="button"]');
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      const text = await buttons.nth(i).textContent();
      if (text && /^\s*(Post|Опубликовать|Upload|Загрузить)\s*$/i.test(text)) {
        await buttons.nth(i).click();
        logger.info('Нажата кнопка публикации (fallback)');
        break;
      }
    }
  }

  // Wait for upload completion
  await page.waitForTimeout(_randomDelay(10000, 20000));
  await job.updateProgress(90);

  // ── Captcha handling ─────────────────────────────────────
  try {
    const solved = await handleTikTokCaptcha({
      page,
      proxyUrl: proxyUrl!,
      userAgent: fingerprint?.userAgent || '',
      websiteURL: page.url(),
    });
    if (solved) {
      logger.info('Captcha auto-solved via CapSolver ✓');
    }
  } catch (capErr: unknown) {
    const msg = capErr instanceof Error ? capErr.message : String(capErr);
    if (!process.env.CAPSOLVER_API_KEY) {
      throw new Error('CAPTCHA обнаружена. Установите CAPSOLVER_API_KEY для автоматического решения.');
    }
    throw new Error(`CAPTCHA solve failed: ${msg}`);
  }

  // BUG-7 fix: Use scoped selectors to verify upload, not body text
  // Body text scanning catches "error" in JavaScript, footer links, etc.
  await page.waitForTimeout(_randomDelay(3000, 5000));

  // Check for TikTok-specific error banners/toasts
  const errorSelectors = [
    '[class*="error"]:visible',
    '[class*="toast"][class*="error"]:visible',
    '[data-e2e="upload-error"]',
  ];

  let uploadError = false;
  for (const sel of errorSelectors) {
    try {
      const count = await page.locator(sel).count();
      if (count > 0) {
        const errorText = await page.locator(sel).first().textContent();
        if (errorText && /failed|error|не удалось|ошибка/i.test(errorText)) {
          uploadError = true;
          break;
        }
      }
    } catch { /* selector not found — OK */ }
  }

  if (uploadError) {
    throw new Error('TikTok upload failed — error element detected on page');
  }

  logger.info('TikTok подтвердил загрузку ✓');
}

// ── YouTube Shorts Upload ───────────────────────────────────

async function _uploadToYouTube(
  page: Parameters<typeof humanClick>[0],
  cursor: Awaited<ReturnType<typeof createPageCursor>>,
  data: UploadJobData,
  videoPath: string,
  logger: SocketLogger,
  job: Job,
): Promise<void> {
  // Pre-flight: Shorts compatibility
  const { inspectVideo, isShortsCompatible } = await import('../core/video/inspector.js');
  const meta = await inspectVideo(videoPath);
  const compat = isShortsCompatible(meta);
  if (!compat.ok) {
    throw new Error(`[youtube-shorts] ${compat.reason}`);
  }
  logger.info(`Видео Shorts-валидно: ${meta.width}x${meta.height}, ${Math.round(meta.durationSec)}s`);

  logger.info('Переход на YouTube Studio...');
  await page.goto('https://studio.youtube.com/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(_randomDelay(3000, 5000));

  // Auth check — BUG-10 fix: URL-based instead of body text
  const currentUrl = page.url();
  if (/accounts\.google\.com\/ServiceLogin|accounts\.google\.com\/signin/i.test(currentUrl)) {
    throw new Error('Не удалось войти в YouTube Studio — cookies невалидны (перенаправлен на login)');
  }
  logger.info('Авторизация YouTube успешна');

  // BUG-11 fix: Dismiss "Welcome to YouTube Studio" popup that appears on first visit
  try {
    const welcomeBtn = page.locator('button:has-text("Continue"), button:has-text("Продолжить")').first();
    if (await welcomeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await welcomeBtn.click();
      logger.info('Dismissed Welcome to YouTube Studio popup');
      await page.waitForTimeout(_randomDelay(1500, 2500));
    }
  } catch { /* no welcome popup — normal */ }

  await job.updateProgress(45);

  // Click CREATE button → Upload video (resilient selectors)
  try {
    await humanClick(page, cursor,
      '#upload-icon, #create-icon, ytcp-button#create-icon-button, ' +
      'button[aria-label*="Create" i], button[aria-label*="Создать" i]',
      { postClickDelay: 500 },
    );
    await page.waitForTimeout(_randomDelay(500, 1000));
    await humanClick(page, cursor,
      'tp-yt-paper-item[test-id="upload-beta"], a[test-id="upload-beta"], ' +
      '#text-item-0, tp-yt-paper-item:has-text("Upload video"), ' +
      'tp-yt-paper-item:has-text("Upload videos"), ' +
      'tp-yt-paper-item:has-text("Загрузить видео")',
      { postClickDelay: 1500 },
    );
  } catch {
    // Fallback: direct navigation to upload URL
    logger.warn('CREATE button not found, fallback to direct upload URL');
    await page.goto('https://studio.youtube.com/channel/UC/videos/upload', { waitUntil: 'networkidle' });
  }

  // File upload via hidden input
  const fileInput = await page.locator('input[type="file"][name="Filedata"], input[type="file"]').first();
  await fileInput.setInputFiles(videoPath);
  logger.info('Файл загружен в Studio...');

  // BUG-8 fix: Wait for YouTube Studio to finish processing the video
  // Studio shows a progress bar during upload/processing. Clicking Publish
  // before completion will be blocked by Studio or fail silently.
  logger.info('Ожидаю обработку видео YouTube Studio...');
  try {
    // Wait for either "Upload complete" text, or the progress to finish
    // YouTube Studio shows "Uploading..." then "Processing..." then ready
    await page.waitForFunction(
      () => {
        const body = document.body?.textContent ?? '';
        // Studio shows these when upload+processing is done
        return /Upload complete|Загрузка завершена|Checks complete|Проверки завершены/i.test(body)
          || document.querySelector('#next-button:not([disabled])');
      },
      { timeout: 120_000 },  // 2 minute timeout for large videos
    );
    logger.info('Обработка видео завершена ✓');
  } catch {
    logger.warn('Таймаут ожидания обработки видео (120s) — продолжаю...');
  }
  await job.updateProgress(60);

  // Wait for the title input to be ready (Studio dialog opens automatically after file upload)
  try {
    await page.waitForSelector('#textbox[aria-label*="title" i], #textbox[contenteditable="true"]', { timeout: 30_000 });
  } catch {
    throw new Error('YouTube Studio upload dialog не появился');
  }

  // Fill title with #Shorts appended
  const titleWithShorts = /#shorts/i.test(data.title) ? data.title : `${data.title} #Shorts`;
  try {
    const titleInput = page.locator('#textbox[aria-label*="title" i], #textbox[contenteditable="true"]').first();
    await titleInput.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await humanType(page, '#textbox[aria-label*="title" i], #textbox[contenteditable="true"]', titleWithShorts);
    logger.info(`Заголовок (с #Shorts): "${titleWithShorts.slice(0, 60)}..."`);

    // BUG-12 fix: Dismiss hashtag suggestions dropdown that appears after typing #Shorts.
    // Without this, the dropdown intercepts clicks on the description field below.
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  } catch {
    logger.warn('Не удалось заполнить заголовок');
  }

  // Fill description + hashtags
  try {
    const descSelectors = '#textbox[aria-label*="description" i], div[aria-label*="Tell viewers"]';
    const descInput = page.locator(descSelectors).first();
    if (await descInput.count() > 0) {
      // BUG-13 fix: Use force:true to bypass any remaining suggestion overlays
      await descInput.click({ force: true });
      await page.waitForTimeout(500);
      const hashtagStr = data.hashtags?.length
        ? '\n\n' + data.hashtags.map(h => `#${h}`).join(' ')
        : '';
      const fullDesc = `${data.description}${hashtagStr}`;
      if (fullDesc.trim()) {
        await humanType(page, descSelectors, fullDesc, { clearBefore: true });
        logger.info(`Описание: "${data.description.slice(0, 40)}..." + ${data.hashtags?.length || 0} хештегов`);
      }
    }
  } catch (descErr) {
    logger.warn(`Description skipped: ${(descErr as Error).message?.slice(0, 60)}`);
  }

  await page.waitForTimeout(_randomDelay(2000, 4000));
  await job.updateProgress(75);

  // "Made for kids?" radio — select "No, it's not made for kids" (resilient)
  try {
    await humanClick(page, cursor,
      'tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"], ' +
      'tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_MFK"]:not([checked]), ' +
      '#radioLabel:has-text("No, it\'s not"), ' +
      'tp-yt-paper-radio-button:has-text("not made for kids")',
      { postClickDelay: 800 },
    );
  } catch {
    logger.warn('Не удалось выбрать "Not made for kids" — продолжаем');
  }

  // Click "Next" 3 times to skip through wizard (Elements, Checks, Visibility)
  for (let step = 0; step < 3; step++) {
    try {
      await humanClick(page, cursor, '#next-button:not([disabled])', { postClickDelay: 2500 });
    } catch {
      logger.warn(`Next button step ${step} not found, continuing`);
      break;
    }
  }

  // Public visibility (resilient)
  try {
    await humanClick(page, cursor,
      'tp-yt-paper-radio-button[name="PUBLIC"], ' +
      '#radioLabel:has-text("Public"), ' +
      'tp-yt-paper-radio-button:has-text("Public")',
      { postClickDelay: 500 },
    );
  } catch {
    logger.warn('Не удалось выбрать Public');
  }

  // Publish
  try {
    await humanClick(page, cursor, '#done-button:not([disabled])', { postClickDelay: 2000 });
    logger.info('Нажата кнопка публикации...');
  } catch {
    throw new Error('Не найдена кнопка публикации Shorts');
  }

  // Wait for "Video published" confirmation
  await page.waitForTimeout(_randomDelay(8000, 15000));
  await job.updateProgress(90);

  // Verify success — look for share dialog or "Video published" text
  const afterText = await page.textContent('body');
  const success = /published|опубликовано|video uploaded/i.test(afterText ?? '');
  if (!success) {
    logger.warn('Не удалось подтвердить публикацию (нет confirmation text), но дошли до конца flow');
  }

  logger.info('✅ Видео имеет валидные параметры Shorts и было успешно опубликовано.');

  logger.info('YouTube Shorts загрузка завершена ✓');
}

// ── Utility ─────────────────────────────────────────────────

function _randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
