// ─────────────────────────────────────────────────────────────
// Edit Profile Handler v4 — Patchright + ghost-cursor
//
// CHANGES in v4 (full audit fix):
// 1. Avatar download: ESM-compatible, os.tmpdir(), redirect-follow,
//    Content-Type validation, guaranteed cleanup
// 2. YouTube avatar: route through myaccount.google.com/personal-info
//    (YouTube Studio does NOT allow avatar changes)
// 3. YouTube bio: correct selector #textbox[aria-label*="description"]
// 4. YouTube name: correct selector #textbox[aria-label*="name"]
// 5. YouTube save: #save-button instead of button[type="submit"]
// 6. Socket events for real-time progress
// ─────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { launchStealthContext, closeBrowser } from '../core/browser/patchright-launcher.js';
import { createPageCursor, humanClick } from '../core/humanity/biomouse.js';
import { humanType } from '../core/humanity/typing-emulator.js';
import { persistCookies, type BrowserCookie } from '../core/auth/cookie-store.js';
import { SocketLogger } from '../lib/socket-logger.js';
import { emitWorkerError } from '../lib/error-classifier.js';
import { loadAccountContext } from '../lib/account-context.js';
import type { Browser } from 'patchright';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import https from 'https';
import http from 'http';

// ── Types ───────────────────────────────────────────────────

interface EditProfileJobData {
  userId: string;
  accountId: string;
  cookiesDir?: string;
  changes: {
    name?: string;
    bio?: string;
    avatarUrl?: string;
  };
  // platform, fingerprint, proxyUrl are resolved from DB via loadAccountContext()
}

// ── Avatar download helper ──────────────────────────────────

/**
 * Download an image from URL to a local temp file.
 * Handles redirects (up to 5 hops), validates Content-Type,
 * and uses os.tmpdir() for cross-platform compatibility.
 */
async function downloadAvatar(
  url: string,
  accountId: string,
  maxRedirects = 5,
): Promise<string> {
  const ext = url.match(/\.(png|jpg|jpeg|gif|webp)/i)?.[1] || 'jpg';
  const tmpPath = path.join(os.tmpdir(), `avatar_${accountId}_${Date.now()}.${ext}`);

  return new Promise<string>((resolve, reject) => {
    const doRequest = (currentUrl: string, redirectsLeft: number) => {
      const mod = currentUrl.startsWith('https') ? https : http;
      const req = mod.get(currentUrl, (response) => {
        // Handle redirects
        if (
          [301, 302, 307, 308].includes(response.statusCode ?? 0) &&
          response.headers.location
        ) {
          if (redirectsLeft <= 0) {
            reject(new Error('Too many redirects while downloading avatar'));
            return;
          }
          // Resolve relative redirects
          const redirectUrl = new URL(response.headers.location, currentUrl).toString();
          doRequest(redirectUrl, redirectsLeft - 1);
          return;
        }

        // Check status
        if (response.statusCode !== 200) {
          reject(new Error(`Avatar download failed: HTTP ${response.statusCode}`));
          return;
        }

        // Check Content-Type
        const contentType = response.headers['content-type'] || '';
        if (!contentType.startsWith('image/')) {
          reject(new Error(`Avatar URL returned non-image Content-Type: ${contentType}`));
          return;
        }

        const fileStream = fs.createWriteStream(tmpPath);
        response.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close();
          resolve(tmpPath);
        });
        fileStream.on('error', (err) => {
          // Cleanup partial file
          fsp.unlink(tmpPath).catch(() => {});
          reject(err);
        });
      });

      req.on('error', (err) => {
        fsp.unlink(tmpPath).catch(() => {});
        reject(err);
      });

      // Timeout: 30s
      req.setTimeout(30_000, () => {
        req.destroy();
        fsp.unlink(tmpPath).catch(() => {});
        reject(new Error('Avatar download timed out (30s)'));
      });
    };

    doRequest(url, maxRedirects);
  });
}

// ── Main ────────────────────────────────────────────────────

export async function editProfileHandler(job: Job<EditProfileJobData>): Promise<void> {
  const data = job.data;
  const logger = new SocketLogger(data.userId);
  let browser: Browser | null = null;
  let ctx: any = null;
  let avatarTmpPath: string | null = null;

  try {
    logger.info(`Редактирование профиля ${data.accountId}...`);

    // Resolve everything fresh from DB — never trust BullMQ payload
    const ctxAcc = await loadAccountContext(data.accountId);

    ctx = await launchStealthContext({
      accountId: data.accountId,
      proxyUrl: ctxAcc.proxyUrl,
      cookiesPath: data.cookiesDir ?? '/data/cookies',
      fingerprint: ctxAcc.fingerprint,
    });
    browser = ctx.browser;
    const page = ctx.page;
    const cursor = await createPageCursor(page);

    await job.updateProgress(10);

    // ── Download avatar to temp file first (if provided) ────
    if (data.changes.avatarUrl) {
      try {
        const avatarSrc = data.changes.avatarUrl;
        // Support local file paths (e.g. /tmp/avatar.png or file:///tmp/avatar.png)
        const localPath = avatarSrc.startsWith('file:///')
          ? avatarSrc.replace('file://', '')
          : avatarSrc.startsWith('/') ? avatarSrc : null;

        if (localPath) {
          // Local file — verify it exists, no download needed
          await fsp.access(localPath);
          avatarTmpPath = localPath;
          logger.info(`Аватар из локального файла: ${localPath}`);
        } else {
          logger.info(`Скачиваю аватар: ${avatarSrc.substring(0, 60)}...`);
          avatarTmpPath = await downloadAvatar(avatarSrc, data.accountId);
          logger.info('Аватар скачан на сервер ✓');
        }
      } catch (dlErr) {
        const msg = dlErr instanceof Error ? dlErr.message : String(dlErr);
        logger.warn(`Не удалось загрузить аватар: ${msg}`);
        // Continue without avatar — don't fail the whole job
        avatarTmpPath = null;
      }
    }

    await job.updateProgress(20);

    // ── Platform-specific profile editing ───────────────────
    if (ctxAcc.platform === 'TIKTOK') {
      await _editTikTokProfile(page, cursor, data, avatarTmpPath, logger);
    } else {
      await _editYouTubeProfile(page, cursor, data, avatarTmpPath, logger);
    }

    await job.updateProgress(90);

    logger.info('✅ Профиль обновлён');
    await job.updateProgress(100);

  } catch (err: unknown) {
    emitWorkerError(logger, data.accountId, 'edit-profile', err);
    throw err;
  } finally {
    // Persist cookies to BOTH disk AND DB (BUG-H2 fix)
    if (ctx?.context) {
      try {
        const cookies = await ctx.context.cookies();
        const browserCookies: BrowserCookie[] = cookies.map((c: any) => ({
          name: c.name, value: c.value, domain: c.domain, path: c.path,
          expires: c.expires, httpOnly: c.httpOnly, secure: c.secure,
          sameSite: c.sameSite === 'Strict' ? 'Strict' : c.sameSite === 'None' ? 'None' : 'Lax',
        }));
        await persistCookies(data.accountId, browserCookies, data.cookiesDir ?? '/data/cookies');
      } catch (cookieErr) {
        console.warn('[EditProfile] Failed to persist cookies:', cookieErr);
      }
    }
    await closeBrowser(browser);

    // Cleanup temp avatar file (only downloaded ones, not user-provided local files)
    if (avatarTmpPath && avatarTmpPath.includes(`avatar_${data.accountId}_`)) {
      fsp.unlink(avatarTmpPath).catch(() => {});
    }

    logger.disconnect();
  }
}


// ── TikTok Profile Edit ─────────────────────────────────────

async function _editTikTokProfile(
  page: any,
  cursor: any,
  data: EditProfileJobData,
  avatarTmpPath: string | null,
  logger: SocketLogger,
): Promise<void> {
  logger.info('Переход на настройки TikTok...');
  await page.goto('https://www.tiktok.com/setting', { waitUntil: 'networkidle' });
  await page.waitForTimeout(_randomDelay(3000, 5000));

  // Update name if provided
  if (data.changes.name) {
    try {
      logger.info(`Обновляю имя: ${data.changes.name}`);
      const nameSelector = 'input[name="nickname"], input[placeholder*="name" i], input[placeholder*="имя" i]';
      await page.waitForSelector(nameSelector, { timeout: 5_000 });
      await humanType(page, nameSelector, data.changes.name, { clearBefore: true });
      logger.info('Имя обновлено ✓');
    } catch {
      logger.warn('Не удалось обновить имя — селектор не найден');
    }
  }

  // Update bio if provided
  if (data.changes.bio) {
    try {
      logger.info(`Обновляю био...`);
      const bioSelector = 'textarea[name="signature"], textarea[placeholder*="bio" i], textarea[placeholder*="описание" i]';
      await page.waitForSelector(bioSelector, { timeout: 5_000 });
      await humanType(page, bioSelector, data.changes.bio, { clearBefore: true });
      logger.info(`Био обновлено: ${data.changes.bio.substring(0, 50)}...`);
    } catch {
      logger.warn('Не удалось обновить био — селектор не найден');
    }
  }

  // Upload avatar if downloaded
  if (avatarTmpPath) {
    try {
      logger.info('Загружаю аватар TikTok...');
      const avatarSelector = '[data-e2e="edit-avatar"], .avatar-edit, img.tiktok-avatar, [class*="avatar"]';
      await humanClick(page, cursor, avatarSelector, { postClickDelay: 1500 });
      await page.waitForTimeout(_randomDelay(1000, 2000));

      // Upload via hidden file input
      const fileInput = await page.locator('input[type="file"][accept*="image"]').first();
      await fileInput.setInputFiles(avatarTmpPath);
      await page.waitForTimeout(_randomDelay(3000, 5000));

      // Confirm/apply crop if dialog appears
      try {
        await humanClick(page, cursor, 'button:has-text("Apply"), button:has-text("Применить"), button:has-text("Save")', { postClickDelay: 2000 });
      } catch { /* no crop dialog */ }

      logger.info('Аватар TikTok загружен ✓');
    } catch {
      logger.warn('Не удалось загрузить аватар TikTok — селектор не найден');
    }
  }

  // Save profile
  await _saveTikTokProfile(page, cursor, logger);
}


// ── YouTube Profile Edit ────────────────────────────────────

async function _editYouTubeProfile(
  page: any,
  cursor: any,
  data: EditProfileJobData,
  avatarTmpPath: string | null,
  logger: SocketLogger,
): Promise<void> {
  // ── Step 1: Avatar via Google Account (not YouTube Studio) ──
  // YouTube Studio does NOT allow avatar changes — it redirects to Google Account
  if (avatarTmpPath) {
    try {
      logger.info('Загружаю аватар YouTube через Google Account...');
      await page.goto('https://myaccount.google.com/personal-info', { waitUntil: 'networkidle' });
      await page.waitForTimeout(_randomDelay(3000, 5000));

      // Click on the profile photo area
      // Google shows a camera icon or "Add profile photo" or existing photo
      const photoSelectors = [
        'a[href*="photo"], a[href*="profilephoto"]',  // Link to photo editor
        '[data-photo-action], [aria-label*="photo" i], [aria-label*="фото" i]',  // Photo action button
        '.yDSiEe',  // Google profile photo container class
      ];

      let clicked = false;
      for (const sel of photoSelectors) {
        try {
          const count = await page.locator(sel).count();
          if (count > 0) {
            await humanClick(page, cursor, sel, { postClickDelay: 2000 });
            clicked = true;
            break;
          }
        } catch { continue; }
      }

      if (!clicked) {
        logger.warn('Не нашёл кнопку фото в Google Account, пробую прямой URL...');
        await page.goto('https://myaccount.google.com/profile/photo/edit', { waitUntil: 'networkidle' });
        await page.waitForTimeout(_randomDelay(2000, 3000));
      }

      // Look for file input on the photo editor page
      const fileInput = await page.locator('input[type="file"][accept*="image"]').first();
      if (await fileInput.count() > 0) {
        await fileInput.setInputFiles(avatarTmpPath);
        await page.waitForTimeout(_randomDelay(3000, 5000));

        // Confirm crop / save
        const saveSelectors = [
          'button:has-text("Save"), button:has-text("Сохранить")',
          'button:has-text("Save as profile photo")',
          'button:has-text("Done"), button:has-text("Готово")',
          '[data-mdc-dialog-action="ok"]',
        ];
        for (const sel of saveSelectors) {
          try {
            const count = await page.locator(sel).count();
            if (count > 0) {
              await humanClick(page, cursor, sel, { postClickDelay: 2000 });
              break;
            }
          } catch { continue; }
        }
        logger.info('Аватар YouTube загружен через Google Account ✓');
      } else {
        logger.warn('Не удалось найти input для загрузки аватара в Google Account');
      }
    } catch (avatarErr) {
      const msg = avatarErr instanceof Error ? avatarErr.message : String(avatarErr);
      logger.warn(`Не удалось загрузить аватар YouTube: ${msg}`);
    }
  }

  // ── Step 2: Name + Bio via YouTube Studio ──────────────────
  if (data.changes.name || data.changes.bio) {
    logger.info('Переход в YouTube Studio для редактирования...');
    // Use 'load' not 'networkidle' — YouTube Studio has endless background XHRs
    await page.goto('https://studio.youtube.com', { waitUntil: 'load', timeout: 30_000 });
    await page.waitForTimeout(_randomDelay(5000, 8000));

    // Dismiss ALL overlays/modals (welcome tour, cookie consent, etc.)
    for (let i = 0; i < 5; i++) {
      try {
        const modal = page.locator(
          'button:has-text("Далее"), button:has-text("Next"), button:has-text("Начать"), ' +
          'button:has-text("Get started"), button:has-text("Skip"), button:has-text("Пропустить"), ' +
          'button:has-text("OK"), button:has-text("Понятно"), button:has-text("Got it"), ' +
          '#dismiss-button, [aria-label="Dismiss"], [aria-label="Закрыть"]'
        );
        if (await modal.count() > 0) {
          await modal.first().click();
          await page.waitForTimeout(_randomDelay(1500, 2500));
          logger.info(`Закрыт модальный элемент (${i + 1})`);
        } else break;
      } catch { break; }
    }

    // Also dismiss the top security banner if it exists
    try {
      const hideBanner = page.locator('button:has-text("Скрыть"), button:has-text("Hide")');
      if (await hideBanner.count() > 0) {
        await hideBanner.first().click();
        await page.waitForTimeout(1000);
      }
    } catch { /* banner optional */ }

    // Navigate to customization page — try multiple approaches
    let onEditingPage = false;

    // Approach 1: Click the edit/pencil icon in top-right corner
    if (!onEditingPage) {
      try {
        const editIcon = page.locator(
          'a[href*="/channel/editing"], ' +
          'button[aria-label*="Edit" i], button[aria-label*="Изменить" i], ' +
          'a[aria-label*="Edit channel" i], a[aria-label*="Настроить" i]'
        );
        if (await editIcon.count() > 0) {
          await editIcon.first().click();
          await page.waitForTimeout(_randomDelay(3000, 5000));
          if (page.url().includes('/editing')) {
            onEditingPage = true;
            logger.info('Editing page via icon click');
          }
        }
      } catch { /* icon not found */ }
    }

    // Approach 2: Direct URL with 'load' wait
    if (!onEditingPage) {
      logger.info('Пробую прямой URL /channel/editing/basic_info...');
      try {
        await page.goto('https://studio.youtube.com/channel/editing/basic_info', {
          waitUntil: 'load', timeout: 30_000,
        });
        await page.waitForTimeout(_randomDelay(5000, 8000));
        if (page.url().includes('/editing')) {
          onEditingPage = true;
          logger.info('Editing page via direct URL');
        }
      } catch (navErr) {
        logger.warn(`URL навигация: ${navErr instanceof Error ? navErr.message : navErr}`);
      }
    }

    // Check if Studio shows error page and retry
    const pageText = await page.textContent('body').catch(() => '');
    if (pageText?.includes('Произошла ошибка') || pageText?.includes('error') && !pageText?.includes('textarea')) {
      logger.warn('YouTube Studio показал ошибку — перезагрузка...');
      await page.reload({ waitUntil: 'load', timeout: 30_000 });
      await page.waitForTimeout(_randomDelay(5000, 8000));
      
      // Check again after reload
      const pageText2 = await page.textContent('body').catch(() => '');
      if (pageText2?.includes('Произошла ошибка')) {
        logger.warn('Ошибка Studio сохраняется — возможно сессия невалидна');
        // Try going to youtube.com first then back to studio
        await page.goto('https://www.youtube.com', { waitUntil: 'load', timeout: 20_000 });
        await page.waitForTimeout(_randomDelay(3000, 5000));
        await page.goto('https://studio.youtube.com/channel/editing/basic_info', { waitUntil: 'load', timeout: 30_000 });
        await page.waitForTimeout(_randomDelay(5000, 8000));
      }
    }

    logger.info(`YouTube Studio final URL: ${page.url()}`);

    // Dump page info for debugging
    const bodyText = await page.textContent('body').catch(() => 'EMPTY');
    logger.info(`Page body text length: ${bodyText?.length || 0}`);
    const allInputs = await page.locator('input, textarea, [contenteditable="true"], [contenteditable=""]').count().catch(() => 0);
    logger.info(`Found ${allInputs} input/textarea/contenteditable elements on page`);

    // Take debug screenshot after all navigation
    try {
      await page.screenshot({ path: '/tmp/yt-studio-debug.png', fullPage: false });
      logger.info('Debug screenshot saved: /tmp/yt-studio-debug.png');
    } catch { /* screenshot optional */ }

    // Check if we ended up on Google login (cookies expired)
    const finalUrl = page.url();
    logger.info(`YouTube Studio final URL: ${finalUrl}`);
    if (/accounts\.google\.com/i.test(finalUrl)) {
      logger.warn('YouTube Studio перенаправил на Google login — cookies невалидны');
    }

    // YouTube Studio 2025+ uses a different layout with tabs.
    // Try clicking "Basic info" tab first if it exists
    try {
      const basicInfoTab = page.locator('tp-yt-paper-tab:has-text("Basic info"), tp-yt-paper-tab:has-text("Основная информация"), [role="tab"]:has-text("Basic")');
      if (await basicInfoTab.count() > 0) {
        await basicInfoTab.first().click();
        await page.waitForTimeout(_randomDelay(1000, 2000));
        logger.info('Переключено на вкладку "Basic info" ✓');
      }
    } catch { /* tab not found — might already be on correct tab */ }

    // Update name if provided
    if (data.changes.name) {
      try {
        logger.info(`Обновляю имя YouTube: ${data.changes.name}`);
        // YouTube Studio uses contenteditable textboxes, not standard inputs
        // Extended selectors: Studio 2025 uses #textbox inside ytcp-social-suggestions-textbox
        const nameSelector = '#textbox[aria-label*="name" i], #textbox[aria-label*="название" i], #textbox[aria-label*="имя" i], ' +
          'ytcp-social-suggestions-textbox #textbox, ' +
          '#name-container #textbox, ' +
          'div[id="textbox"][contenteditable="true"]';
        await page.waitForSelector(nameSelector, { timeout: 15_000 });
        const nameInput = page.locator(nameSelector).first();
        await nameInput.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Delete');
        await humanType(page, nameSelector, data.changes.name);
        logger.info('Имя YouTube обновлено ✓');
      } catch (nameErr) {
        logger.warn('Не удалось обновить имя YouTube — селектор не найден');
        // Take screenshot for debugging
        try {
          await page.screenshot({ path: '/tmp/yt-name-fail.png', fullPage: false });
          logger.info('Name fail screenshot: /tmp/yt-name-fail.png');
        } catch { /* screenshot optional */ }
        // Fallback: list all visible elements for debugging
        try {
          const html = await page.locator('#textbox, [contenteditable="true"]').count();
          logger.info(`Found ${html} contenteditable elements on page`);
        } catch { /* debug optional */ }
      }
    }

    // Update bio/description if provided
    if (data.changes.bio) {
      try {
        logger.info(`Обновляю описание YouTube...`);
        // Same contenteditable textbox pattern as upload.ts
        // YouTube Studio has multiple #textbox elements — description is usually the 2nd one
        const descSelector = '#textbox[aria-label*="description" i], #textbox[aria-label*="описание" i], div[aria-label*="Tell viewers"]';
        await page.waitForSelector(descSelector, { timeout: 15_000 });
        const descInput = page.locator(descSelector).first();
        await descInput.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Delete');
        await humanType(page, descSelector, data.changes.bio);
        logger.info(`Описание YouTube обновлено: ${data.changes.bio.substring(0, 50)}...`);
      } catch {
        logger.warn('Не удалось обновить описание YouTube — селектор не найден');
        try {
          await page.screenshot({ path: '/tmp/yt-desc-fail.png', fullPage: false });
          logger.info('Desc fail screenshot: /tmp/yt-desc-fail.png');
        } catch { /* screenshot optional */ }
      }
    }

    // Save via YouTube Studio save button
    await _saveYouTubeProfile(page, cursor, logger);
  }
}


// ── Save helpers ────────────────────────────────────────────

async function _saveTikTokProfile(page: any, cursor: any, logger: SocketLogger): Promise<void> {
  try {
    // TikTok uses a Save button — try specific first, then generic fallback
    const saveSelectors = [
      'button[data-e2e="save-btn"]',
      'button:has-text("Save")',
      'button:has-text("Сохранить")',
      'button[type="submit"]',
    ];

    for (const sel of saveSelectors) {
      try {
        const count = await page.locator(sel).count();
        if (count > 0) {
          await humanClick(page, cursor, sel, { postClickDelay: 2000 });
          logger.info('Профиль TikTok сохранён ✓');
          return;
        }
      } catch { continue; }
    }

    // Ultimate fallback: scan all buttons
    const buttons = page.locator('button');
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      const text = await buttons.nth(i).textContent();
      if (text?.includes('Save') || text?.includes('Сохранить')) {
        await buttons.nth(i).click();
        logger.info('Профиль TikTok сохранён (fallback) ✓');
        return;
      }
    }

    logger.warn('Кнопка сохранения TikTok не найдена');
  } catch {
    logger.warn('Не удалось сохранить профиль TikTok');
  }
}

async function _saveYouTubeProfile(page: any, cursor: any, logger: SocketLogger): Promise<void> {
  try {
    // YouTube Studio uses #save-button (not type="submit")
    const saveSelectors = [
      '#save-button:not([disabled])',
      'ytcp-button#save-button',
      'button:has-text("PUBLISH"), button:has-text("ОПУБЛИКОВАТЬ")',
      'button:has-text("Save"), button:has-text("Сохранить")',
    ];

    for (const sel of saveSelectors) {
      try {
        const count = await page.locator(sel).count();
        if (count > 0) {
          await humanClick(page, cursor, sel, { postClickDelay: 2000 });
          logger.info('Профиль YouTube сохранён ✓');
          return;
        }
      } catch { continue; }
    }

    logger.warn('Кнопка сохранения YouTube Studio не найдена');
  } catch {
    logger.warn('Не удалось сохранить профиль YouTube');
  }
}


// ── Utility ─────────────────────────────────────────────────

function _randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
