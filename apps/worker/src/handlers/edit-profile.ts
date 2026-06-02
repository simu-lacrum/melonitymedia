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
