// ─────────────────────────────────────────────────────────────
// Edit Profile Handler v2 — Uses Patchright + ghost-cursor
//
// Same function, new browser engine. All interactions use
// human-like mouse movements and typing patterns.
// ─────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { launchStealthContext, closeBrowser } from '../core/browser/patchright-launcher.js';
import { createPageCursor, humanClick } from '../core/humanity/biomouse.js';
import { humanType } from '../core/humanity/typing-emulator.js';
import { saveCookiesToDiskCache, type BrowserCookie } from '../core/auth/cookie-store.js';
import { SocketLogger } from '../lib/socket-logger.js';
import type { AccountFingerprint } from '../core/browser/fingerprint-manager.js';
import type { Browser } from 'patchright';

// ── Types ───────────────────────────────────────────────────

interface EditProfileJobData {
  userId: string;
  accountId: string;
  platform: 'TIKTOK' | 'YOUTUBE';
  fingerprint: AccountFingerprint;
  proxyUrl?: string;
  cookiesDir?: string;
  changes: {
    name?: string;
    bio?: string;
  };
}

// ── Main ────────────────────────────────────────────────────

export async function editProfileHandler(job: Job<EditProfileJobData>): Promise<void> {
  const data = job.data;
  const logger = new SocketLogger(data.userId);
  let browser: Browser | null = null;

  try {
    logger.info(`Редактирование профиля ${data.accountId}...`);

    const ctx = await launchStealthContext({
      accountId: data.accountId,
      proxyUrl: data.proxyUrl,
      cookiesPath: data.cookiesDir ?? '/data/cookies',
      fingerprint: data.fingerprint,
    });
    browser = ctx.browser;
    const page = ctx.page;
    const cursor = await createPageCursor(page);

    // Navigate to profile settings
    if (data.platform === 'TIKTOK') {
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

    // Save updated cookies
    const cookies = await ctx.context.cookies();
    const browserCookies: BrowserCookie[] = cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite === 'Strict' ? 'Strict' : c.sameSite === 'None' ? 'None' : 'Lax',
    }));
    await saveCookiesToDiskCache(data.accountId, browserCookies, data.cookiesDir);

    await job.updateProgress(100);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`❌ Ошибка редактирования: ${message}`);
    throw err;
  } finally {
    await closeBrowser(browser);
    logger.disconnect();
  }
}

function _randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
