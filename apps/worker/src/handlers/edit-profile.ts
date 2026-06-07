// ─────────────────────────────────────────────────────────────
// Edit Profile Handler v3 — Uses Patchright + ghost-cursor
//
// CHANGES in v3 (audit fix):
// 1. Uses loadAccountContext() instead of stale BullMQ payload
//    for platform, fingerprint, proxyUrl (BUG-C2 fix)
// 2. Persists updated cookies to BOTH disk AND DB via
//    persistCookies() (BUG-H2 fix)
// ─────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { launchStealthContext, closeBrowser } from '../core/browser/patchright-launcher.js';
import { createPageCursor, humanClick } from '../core/humanity/biomouse.js';
import { humanType } from '../core/humanity/typing-emulator.js';
import { persistCookies, type BrowserCookie } from '../core/auth/cookie-store.js';
import { SocketLogger } from '../lib/socket-logger.js';
import { loadAccountContext } from '../lib/account-context.js';
import type { Browser } from 'patchright';

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

// ── Main ────────────────────────────────────────────────────

export async function editProfileHandler(job: Job<EditProfileJobData>): Promise<void> {
  const data = job.data;
  const logger = new SocketLogger(data.userId);
  let browser: Browser | null = null;
  let ctx: any = null;

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

    // Navigate to profile settings
    if (ctxAcc.platform === 'TIKTOK') {
      await page.goto('https://www.tiktok.com/setting', { waitUntil: 'networkidle' });
    } else {
      await page.goto('https://studio.youtube.com/channel/editing', { waitUntil: 'networkidle' });
    }
    await page.waitForTimeout(_randomDelay(3000, 5000));

    // Update name if provided
    if (data.changes.name) {
      try {
        const nameSelector = 'input[name="nickname"], input[placeholder*="name"], #name-input';
        await page.waitForSelector(nameSelector, { timeout: 5_000 });
        await humanType(page, nameSelector, data.changes.name, { clearBefore: true });
        logger.info(`Имя обновлено: ${data.changes.name}`);
      } catch {
        logger.warn('Не удалось обновить имя — селектор не найден');
      }
    }

    // Update bio if provided
    if (data.changes.bio) {
      try {
        const bioSelector = 'textarea[name="signature"], textarea[placeholder*="bio"], #description-input';
        await page.waitForSelector(bioSelector, { timeout: 5_000 });
        await humanType(page, bioSelector, data.changes.bio, { clearBefore: true });
        logger.info(`Био обновлено: ${data.changes.bio.substring(0, 50)}...`);
      } catch {
        logger.warn('Не удалось обновить био — селектор не найден');
      }
    }

    // Upload avatar if provided
    if (data.changes.avatarUrl) {
      try {
        logger.info(`Загрузка аватара: ${data.changes.avatarUrl.substring(0, 60)}...`);

        // Download image to temp file
        const fs = await import('fs/promises');
        const path = await import('path');
        const https = await import('https');
        const http = await import('http');

        const tmpPath = path.join('/tmp', `avatar_${data.accountId}_${Date.now()}.jpg`);

        await new Promise<void>((resolve, reject) => {
          const mod = data.changes.avatarUrl!.startsWith('https') ? https : http;
          const file = require('fs').createWriteStream(tmpPath);
          mod.get(data.changes.avatarUrl!, (response: any) => {
            response.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
          }).on('error', reject);
        });

        // Click avatar area to trigger file upload dialog
        if (ctxAcc.platform === 'TIKTOK') {
          // TikTok settings: click on avatar image to open change dialog
          const avatarSelector = '[data-e2e="edit-avatar"], .avatar-edit, img.tiktok-avatar, [class*="avatar"]';
          try {
            await humanClick(page, cursor, avatarSelector, { postClickDelay: 1500 });
            await page.waitForTimeout(_randomDelay(1000, 2000));

            // Upload via hidden file input
            const fileInput = await page.locator('input[type="file"][accept*="image"]').first();
            await fileInput.setInputFiles(tmpPath);
            await page.waitForTimeout(_randomDelay(3000, 5000));

            // Confirm/apply crop if dialog appears
            try {
              await humanClick(page, cursor, 'button:has-text("Apply"), button:has-text("Применить"), button:has-text("Save")', { postClickDelay: 2000 });
            } catch { /* no crop dialog */ }

            logger.info('Аватар загружен ✓');
          } catch {
            logger.warn('Не удалось загрузить аватар — селектор не найден');
          }
        } else {
          // YouTube Studio: avatar change in channel editing
          try {
            await humanClick(page, cursor, '#avatar-editor, .avatar-image-wrapper, [aria-label*="avatar" i]', { postClickDelay: 1500 });
            const fileInput = await page.locator('input[type="file"][accept*="image"]').first();
            await fileInput.setInputFiles(tmpPath);
            await page.waitForTimeout(_randomDelay(3000, 5000));
            try {
              await humanClick(page, cursor, '#done-button, button:has-text("Done"), button:has-text("Готово")', { postClickDelay: 2000 });
            } catch { /* no confirm dialog */ }
            logger.info('Аватар YouTube загружен ✓');
          } catch {
            logger.warn('Не удалось загрузить аватар YouTube');
          }
        }

        // Cleanup temp file
        try { await fs.unlink(tmpPath); } catch { /* non-critical */ }
      } catch (avatarErr) {
        const msg = avatarErr instanceof Error ? avatarErr.message : String(avatarErr);
        logger.warn(`Не удалось загрузить аватар: ${msg}`);
      }
    }

    // Click save with human mouse
    try {
      const saveSelector = 'button[type="submit"]';
      await humanClick(page, cursor, saveSelector, { postClickDelay: 2000 });
      logger.info('✅ Профиль сохранён');
    } catch {
      // Fallback: try any Save/Submit button
      const buttons = page.locator('button');
      const count = await buttons.count();
      for (let i = 0; i < count; i++) {
        const text = await buttons.nth(i).textContent();
        if (text?.includes('Save') || text?.includes('Сохранить')) {
          await buttons.nth(i).click();
          logger.info('✅ Профиль сохранён (fallback)');
          break;
        }
      }
    }

    await job.updateProgress(100);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`❌ Ошибка редактирования: ${message}`);
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
    logger.disconnect();
  }
}

function _randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
