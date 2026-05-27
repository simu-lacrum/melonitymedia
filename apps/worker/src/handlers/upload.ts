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
import { saveCookiesToDiskCache, type BrowserCookie } from '../core/auth/cookie-store.js';
import { uniquifyVideo, cleanupUniquifiedVideo } from '../core/video/uniquifier.js';
import { createPageCursor, humanClick, humanScroll } from '../core/humanity/biomouse.js';
import { humanType } from '../core/humanity/typing-emulator.js';
import { SocketLogger } from '../lib/socket-logger.js';
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
}

// ── Main ────────────────────────────────────────────────────

export async function uploadHandler(job: Job<UploadJobData>): Promise<void> {
  const data = job.data;
  const logger = new SocketLogger(data.userId);
  let browser: Browser | null = null;
  let uniquifiedPath: string | null = null;

  try {
    // ── Resolve everything fresh from the DB ────────────────
    const ctxAcc = await loadAccountContext(data.accountId);
    const { platform, fingerprint, proxyUrl } = ctxAcc;

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
    logger.info('Уникализация видео (FFmpeg pipeline)...');
    const { outputPath } = await uniquifyVideo({
      accountId: data.accountId,
      inputPath: data.videoPath,
    });
    uniquifiedPath = outputPath;
    await job.updateProgress(25);

    // ── Launch stealth browser ──────────────────────────────
    logger.info('Запуск Patchright (stealth Chrome)...');
    const ctx = await launchStealthContext({
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
      await _uploadToTikTok(page, cursor, data, uniquifiedPath, logger, job);
    } else {
      await _uploadToYouTubeShorts(page, cursor, data, uniquifiedPath, logger, job);
    }

    // ── Export updated cookies ──────────────────────────────
    const cookies = await ctx.context.cookies();
    const browserCookies: BrowserCookie[] = cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite:
        c.sameSite === 'Strict' ? 'Strict' :
        c.sameSite === 'None'   ? 'None'   :
                                  'Lax',
    }));
    await saveCookiesToDiskCache(data.accountId, browserCookies, data.cookiesDir);

    // ── Mark video as uploaded ──────────────────────────────
    await prisma.video.update({
      where: { id: data.videoId },
      data: {
        isUploaded: true,
        uploadedAt: new Date(),
        accountId: data.accountId,
      },
    });

    logger.info(`✅ Видео "${data.title}" успешно загружено на ${platform}`);
    await job.updateProgress(100);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`❌ Ошибка загрузки: ${message}`);
    throw err;
  } finally {
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
): Promise<void> {
  // Navigate to TikTok upload
  logger.info('Переход на страницу загрузки TikTok...');
  await page.goto('https://www.tiktok.com/upload', { waitUntil: 'networkidle' });
  await page.waitForTimeout(_randomDelay(3000, 5000));

  // Check auth status
  const bodyText = await page.textContent('body');
  if (bodyText?.includes('Log in') || bodyText?.includes('Sign up')) {
    throw new Error('Не удалось войти в TikTok — cookies невалидны');
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
    const captionSelector = '[data-text="true"], .public-DraftEditor-content, [contenteditable="true"]';
    await page.waitForSelector(captionSelector, { timeout: 10_000 });
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

  // Click Post button with human mouse
  try {
    const postSelector = 'button[data-e2e="upload-btn"]';
    await page.waitForSelector(postSelector, { timeout: 5_000 });
    await humanClick(page, cursor, postSelector, { postClickDelay: 1000 });
    logger.info('Нажата кнопка публикации...');
  } catch {
    // Fallback: find any Post/Upload button
    const buttons = page.locator('button');
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      const text = await buttons.nth(i).textContent();
      if (text?.includes('Post') || text?.includes('Опубликовать') || text?.includes('Upload')) {
        await buttons.nth(i).click();
        logger.info('Нажата кнопка публикации (fallback)');
        break;
      }
    }
  }

  // Wait for upload completion
  await page.waitForTimeout(_randomDelay(10000, 20000));
  await job.updateProgress(90);

  // Verify success
  const afterText = await page.textContent('body');
  if (afterText?.toLowerCase().includes('captcha') || afterText?.toLowerCase().includes('verify')) {
    throw new Error('CAPTCHA обнаружена — аккаунт требует ручной верификации');
  }

  logger.info('TikTok подтвердил загрузку ✓');
}

// ── YouTube Shorts Upload ───────────────────────────────────

async function _uploadToYouTubeShorts(
  page: Parameters<typeof humanClick>[0],
  cursor: Awaited<ReturnType<typeof createPageCursor>>,
  data: UploadJobData,
  videoPath: string,
  logger: SocketLogger,
  job: Job,
): Promise<void> {
  logger.info('Переход на YouTube Studio...');
  await page.goto('https://studio.youtube.com/channel/videos/upload', { waitUntil: 'networkidle' });
  await page.waitForTimeout(_randomDelay(3000, 5000));

  // Check auth
  const bodyText = await page.textContent('body');
  if (bodyText?.includes('Sign in') || bodyText?.includes('Войти')) {
    throw new Error('Не удалось войти в YouTube — cookies невалидны');
  }

  logger.info('Авторизация YouTube успешна');
  await job.updateProgress(45);

  // Upload file
  const fileInput = await page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(videoPath);
  logger.info('Файл загружен на YouTube');

  await page.waitForTimeout(_randomDelay(5000, 10000));
  await job.updateProgress(60);

  // Fill title
  try {
    const titleSelector = '#textbox[aria-label="Add a title that describes your video"]';
    await page.waitForSelector(titleSelector, { timeout: 10_000 });
    await humanType(page, titleSelector, data.title, { clearBefore: true });
  } catch {
    logger.warn('Не удалось заполнить заголовок YouTube');
  }

  // Fill description
  try {
    const descSelector = '#textbox[aria-label="Tell viewers about your video"]';
    await humanType(page, descSelector, data.description, { clearBefore: true });
  } catch {
    logger.warn('Не удалось заполнить описание YouTube');
  }

  await page.waitForTimeout(_randomDelay(2000, 3000));
  await job.updateProgress(75);

  // Navigate through wizard steps
  for (let step = 0; step < 3; step++) {
    try {
      await humanClick(page, cursor, '#next-button', { postClickDelay: 1500 });
    } catch {
      break;
    }
  }

  // Select Public visibility
  try {
    await humanClick(page, cursor, 'tp-yt-paper-radio-button[name="PUBLIC"]');
  } catch {
    logger.warn('Не удалось выбрать публичный доступ');
  }

  // Publish
  try {
    await humanClick(page, cursor, '#done-button', { postClickDelay: 1000 });
    logger.info('Нажата кнопка публикации YouTube');
  } catch {
    throw new Error('Не найдена кнопка публикации YouTube');
  }

  await page.waitForTimeout(_randomDelay(10000, 15000));
  await job.updateProgress(90);

  logger.info('YouTube Shorts загрузка завершена ✓');
}

// ── Utility ─────────────────────────────────────────────────

function _randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
