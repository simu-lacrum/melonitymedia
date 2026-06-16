// ─────────────────────────────────────────────────────────────
// Cookies Handler v3 — Refresh cookies from existing sessions
//
// CHANGES in v3 (audit fix):
// 1. Uses loadAccountContext() instead of stale BullMQ payload
//    for platform, fingerprint, proxyUrl (BUG-C1 fix)
// 2. Persists updated cookies to BOTH disk AND DB via
//    persistCookies() (BUG-H3 fix)
//
// Cookie IMPORT is handled by the API (accounts.ts POST endpoint).
// ─────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { launchStealthContext, closeBrowser } from '../core/browser/patchright-launcher.js';
import { persistCookies, type BrowserCookie } from '../core/auth/cookie-store.js';
import { SocketLogger } from '../lib/socket-logger.js';
import { emitWorkerError } from '../lib/error-classifier.js';
import { loadAccountContext } from '../lib/account-context.js';
import { acquireAccountLock, releaseAccountLock } from '../lib/account-lock.js';
import { prisma } from '../lib/prisma.js';
import type { Browser } from 'patchright';

// ── Types ───────────────────────────────────────────────────

interface CookiesJobData {
  userId: string;
  accountId: string;
  cookiesDir?: string;
  // platform, fingerprint, proxyUrl are resolved from DB via loadAccountContext()
}

// ── Main ────────────────────────────────────────────────────

export async function cookiesHandler(job: Job<CookiesJobData>): Promise<string> {
  const data = job.data;
  const logger = new SocketLogger(data.userId);
  let browser: Browser | null = null;
  let lockAcquired = false;

  try {
    // Acquire per-account lock — prevent concurrent browser sessions
    const holder = await acquireAccountLock(data.accountId, 'cookies');
    if (holder) {
      logger.warn(`⏭️ Пропускаю cookies — для аккаунта уже запущен: ${holder}`);
      throw new Error(`Account ${data.accountId} is busy: ${holder}`);
    }
    lockAcquired = true;
    logger.info(`Обновление cookies для ${data.accountId}...`);

    // Resolve everything fresh from DB — never trust BullMQ payload
    const ctxAcc = await loadAccountContext(data.accountId);

    // Launch browser with existing cookies
    const ctx = await launchStealthContext({
      accountId: data.accountId,
      proxyUrl: ctxAcc.proxyUrl,
      cookiesPath: data.cookiesDir ?? '/data/cookies',
      fingerprint: ctxAcc.fingerprint,
    });
    browser = ctx.browser;
    const page = ctx.page;

    // Navigate to platform to refresh session
    const baseUrl = ctxAcc.platform === 'TIKTOK'
      ? 'https://www.tiktok.com'
      : 'https://www.youtube.com';

    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(_randomDelay(3000, 5000));

    // Check auth status
    const bodyText = await page.textContent('body');
    const isLoggedOut =
      bodyText?.includes('Log in') ||
      bodyText?.includes('Sign in') ||
      bodyText?.includes('Войти');

    if (isLoggedOut) {
      logger.warn('Cookies истекли — требуется импорт новых cookies через UI');
      await prisma.socialAccount.update({
        where: { id: data.accountId },
        data: { status: 'EXPIRED_COOKIES' },
      });
      throw new Error('COOKIES_EXPIRED');
    }

    // Export updated cookies from browser session
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

    // Persist to BOTH disk cache AND database (BUG-H3 fix)
    await persistCookies(data.accountId, browserCookies, data.cookiesDir ?? '/data/cookies');

    logger.info(`✅ Cookies обновлены и сохранены в DB (${browserCookies.length} шт)`);
    await job.updateProgress(100);

    return JSON.stringify({ count: browserCookies.length, updatedAt: new Date().toISOString() });

  } catch (err: unknown) {
    emitWorkerError(logger, data.accountId, 'cookies', err);
    throw err;
  } finally {
    if (lockAcquired) await releaseAccountLock(data.accountId, 'cookies');
    await closeBrowser(browser);
    logger.disconnect();
  }
}

// ── Utility ─────────────────────────────────────────────────

function _randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
