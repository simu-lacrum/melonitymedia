// ─────────────────────────────────────────────────────────────
// Upload Handler — TikTok & YouTube Shorts Video Upload
//
// This handler is the core of MelonityMedia. It:
// 1. Initializes UndetectedChrome with the account's proxy
// 2. Logs into TikTok/YouTube using saved cookies
// 3. Navigates to the upload page
// 4. Uploads the video file
// 5. Fills in title + description
// 6. Submits and waits for processing
// 7. Reports success/failure via Socket.io
// 8. Marks video for auto-cleanup (delete from disk)
//
// Anti-fraud measures:
// - UndetectedChrome patches the driver binary
// - Mobile proxy IP rotation before each session
// - Random human-like delays between actions
// - Real Chrome (not Chromium) inside Xvfb
// - Manifest V2 extension for proxy auth
// ─────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { BrowserAutomation, ProxyConfig } from '../core/browser-automation.js';
import { SocketLogger } from '../lib/socket-logger.js';
import fs from 'fs';

interface UploadJobData {
  userId: string;
  videoId: string;
  videoPath: string;
  title: string;
  description: string;
  platform: 'TIKTOK' | 'YOUTUBE_SHORTS';
  accountLogin: string;
  cookies: string; // JSON stringified cookies
  proxy?: ProxyConfig;
}

/**
 * Upload handler — entry point for the 'upload' queue.
 * Each job represents one video → one platform → one account.
 */
export async function uploadHandler(job: Job<UploadJobData>): Promise<void> {
  const { userId, videoId, videoPath, title, description, platform, accountLogin, cookies, proxy } = job.data;
  const logger = new SocketLogger(userId);
  const automation = new BrowserAutomation({
    proxy,
    headless: false, // headless:false inside Xvfb for stealth
  });

  try {
    logger.info(`Начинаю загрузку: ${title} → ${platform}`);

    // Step 1: Check that the video file exists
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Видео файл не найден: ${videoPath}`);
    }

    // Step 2: Initialize UndetectedChrome
    logger.info('Запуск браузера (UndetectedChrome)...');
    const driver = await automation.initDriver();

    // Step 3: Inject saved cookies to bypass login
    logger.info(`Загрузка cookies для ${accountLogin}...`);
    const parsedCookies = JSON.parse(cookies);

    // Navigate to the platform first (cookies need a domain context)
    const baseUrl = platform === 'TIKTOK'
      ? 'https://www.tiktok.com'
      : 'https://studio.youtube.com';
    await automation.navigateTo(baseUrl);
    await automation.humanDelay(2000, 4000);

    // Inject cookies one by one
    for (const cookie of parsedCookies) {
      try {
        await driver.manage().addCookie({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path || '/',
          secure: cookie.secure || false,
          httpOnly: cookie.httpOnly || false,
        });
      } catch {
        // Some cookies may fail (cross-domain) — that's OK
      }
    }

    // Step 4: Refresh page to apply cookies (now logged in)
    await automation.navigateTo(baseUrl);
    await automation.humanDelay(3000, 5000);

    // Step 5: Route to platform-specific upload logic
    if (platform === 'TIKTOK') {
      await _uploadToTikTok(automation, job.data, logger);
    } else {
      await _uploadToYouTubeShorts(automation, job.data, logger);
    }

    // Step 6: Report success
    logger.info(`✅ Видео "${title}" успешно загружено на ${platform}`);
    await job.updateProgress(100);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`❌ Ошибка загрузки: ${message}`);

    // Take screenshot on failure for debugging
    try {
      const screenshotPath = `./uploads/error_${videoId}_${Date.now()}.png`;
      await automation.saveScreenshot(screenshotPath);
      logger.warn(`Скриншот ошибки сохранён: ${screenshotPath}`);
    } catch {
      // Screenshot failed too — nothing we can do
    }

    throw err; // Re-throw so BullMQ marks the job as failed
  } finally {
    // ALWAYS close the browser — prevent zombie processes
    await automation.close();
  }
}

// ─────────────────────────────────────────────────────────────
// TikTok Upload Flow
//
// Navigate to tiktok.com/upload → select file via input →
// fill title/description → click publish → wait for success
// ─────────────────────────────────────────────────────────────

async function _uploadToTikTok(
  automation: BrowserAutomation,
  data: UploadJobData,
  logger: SocketLogger,
): Promise<void> {
  const driver = automation.getDriver();

  // Navigate to TikTok upload page
  logger.info('Переход на страницу загрузки TikTok...');
  await automation.navigateTo('https://www.tiktok.com/upload');
  await automation.humanDelay(3000, 5000);

  // Parse page with cheerio (bs4 equivalent) to check auth state
  const $ = await automation.getSoup();
  const pageText = $('body').text();

  if (pageText.includes('Log in') || pageText.includes('Sign up')) {
    throw new Error('Не удалось войти в TikTok — cookies истекли или невалидны');
  }

  logger.info('Авторизация успешна, загружаю видео...');

  // Find the file input and upload the video
  // TikTok uses a hidden <input type="file"> element
  try {
    const fileInput = await driver.findElement({ css: 'input[type="file"]' });
    await fileInput.sendKeys(data.videoPath);
    logger.info('Файл загружен, ожидаю обработку...');
  } catch {
    throw new Error('Не найден элемент загрузки файла на странице TikTok');
  }

  // Wait for video to process (TikTok shows a thumbnail preview)
  await automation.humanDelay(5000, 10000);

  // Fill in the caption/description
  // TikTok's editor uses a contenteditable div
  try {
    const captionEditor = await driver.findElement({
      css: '[data-text="true"], .public-DraftEditor-content, [contenteditable="true"]',
    });
    await captionEditor.clear();
    await captionEditor.sendKeys(`${data.title}\n${data.description}`);
    logger.info('Описание заполнено');
  } catch {
    logger.warn('Не удалось заполнить описание — возможно, интерфейс изменился');
  }

  await automation.humanDelay(2000, 3000);

  // Click the Post/Publish button
  try {
    const postButton = await driver.findElement({
      css: 'button[data-e2e="upload-btn"], button:has-text("Post"), button:has-text("Опубликовать")',
    });
    await postButton.click();
    logger.info('Нажата кнопка публикации...');
  } catch {
    // Try fallback selector
    const buttons = await driver.findElements({ css: 'button' });
    for (const btn of buttons) {
      const text = await btn.getText();
      if (text.includes('Post') || text.includes('Опубликовать') || text.includes('Upload')) {
        await btn.click();
        logger.info('Нажата кнопка публикации (fallback)...');
        break;
      }
    }
  }

  // Wait for upload to complete
  await automation.humanDelay(10000, 20000);

  // Verify upload success by parsing the page
  const $after = await automation.getSoup();
  const bodyText = $after('body').text().toLowerCase();

  if (bodyText.includes('uploaded') || bodyText.includes('your video is being')) {
    logger.info('TikTok подтвердил загрузку ✓');
  } else if (bodyText.includes('captcha') || bodyText.includes('verify')) {
    throw new Error('CAPTCHA обнаружена — аккаунт требует ручной верификации');
  }
}

// ─────────────────────────────────────────────────────────────
// YouTube Shorts Upload Flow
//
// Navigate to studio.youtube.com → upload → select file →
// fill details → set as Short → publish
// ─────────────────────────────────────────────────────────────

async function _uploadToYouTubeShorts(
  automation: BrowserAutomation,
  data: UploadJobData,
  logger: SocketLogger,
): Promise<void> {
  const driver = automation.getDriver();

  // Navigate to YouTube Studio upload
  logger.info('Переход на YouTube Studio...');
  await automation.navigateTo('https://studio.youtube.com/channel/videos/upload');
  await automation.humanDelay(3000, 5000);

  // Check auth
  const $ = await automation.getSoup();
  const pageText = $('body').text();

  if (pageText.includes('Sign in') || pageText.includes('Войти')) {
    throw new Error('Не удалось войти в YouTube — cookies истекли');
  }

  logger.info('Авторизация YouTube успешна, загружаю...');

  // Upload file via input
  try {
    const fileInput = await driver.findElement({ css: 'input[type="file"]' });
    await fileInput.sendKeys(data.videoPath);
    logger.info('Файл загружен на YouTube, ожидаю...');
  } catch {
    throw new Error('Не найден элемент загрузки на YouTube Studio');
  }

  await automation.humanDelay(5000, 10000);

  // Fill in title
  try {
    const titleInput = await driver.findElement({
      css: '#textbox[aria-label="Add a title that describes your video"]',
    });
    await titleInput.clear();
    await titleInput.sendKeys(data.title);
  } catch {
    logger.warn('Не удалось заполнить заголовок YouTube');
  }

  // Fill in description
  try {
    const descInput = await driver.findElement({
      css: '#textbox[aria-label="Tell viewers about your video"]',
    });
    await descInput.clear();
    await descInput.sendKeys(data.description);
  } catch {
    logger.warn('Не удалось заполнить описание YouTube');
  }

  await automation.humanDelay(2000, 3000);

  // Click "Next" buttons to proceed through the wizard
  for (let step = 0; step < 3; step++) {
    try {
      const nextButton = await driver.findElement({ css: '#next-button' });
      await nextButton.click();
      await automation.humanDelay(1500, 2500);
    } catch {
      break; // No more "Next" buttons
    }
  }

  // Select "Public" visibility
  try {
    const publicRadio = await driver.findElement({
      css: 'tp-yt-paper-radio-button[name="PUBLIC"]',
    });
    await publicRadio.click();
  } catch {
    logger.warn('Не удалось выбрать публичный доступ');
  }

  // Click "Publish"
  try {
    const publishButton = await driver.findElement({ css: '#done-button' });
    await publishButton.click();
    logger.info('Нажата кнопка публикации YouTube...');
  } catch {
    throw new Error('Не найдена кнопка публикации YouTube');
  }

  await automation.humanDelay(10000, 15000);
  logger.info('YouTube Shorts загрузка завершена ✓');
}
