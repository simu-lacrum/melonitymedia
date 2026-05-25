// ─────────────────────────────────────────────────────────────
// Cookies Handler v2 — Export cookies from existing sessions
//
// In v2, this handler's role is EXPORT only:
// 1. Launch browser with current cookies
// 2. Navigate to platform to refresh session
// 3. Export updated cookies back to encrypted store
//
// It does NOT do "cookie warmup" (visiting donor sites).
// That practice was a myth from 2020 that never worked.
//
// Cookie IMPORT is handled by the API (accounts.ts POST endpoint).
// ─────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { launchStealthContext, closeBrowser } from '../core/browser/patchright-launcher.js';
import { saveCookiesToDiskCache, type BrowserCookie } from '../core/auth/cookie-store.js';
import { SocketLogger } from '../lib/socket-logger.js';
import type { AccountFingerprint } from '../core/browser/fingerprint-manager.js';
import type { Browser } from 'patchright';

// ── Types ───────────────────────────────────────────────────

interface CookiesJobData {
  userId: string;
  accountId: string;
  platform: 'TIKTOK' | 'YOUTUBE';
  fingerprint: AccountFingerprint;
  proxyUrl?: string;
  cookiesDir?: string;
}

// ── Main ────────────────────────────────────────────────────

export async function cookiesHandler(job: Job<CookiesJobData>): Promise<string> {
  const data = job.data;
  const logger = new SocketLogger(data.userId);
  let browser: Browser | null = null;

  try {
    logger.info(`Обновление cookies для ${data.accountId}...`);

    // Launch browser with existing cookies
    const ctx = await launchStealthContext({
      accountId: data.accountId,
      proxyUrl: data.proxyUrl,
      cookiesPath: data.cookiesDir ?? '/data/cookies',
      fingerprint: data.fingerprint,
    });
    browser = ctx.browser;
    const page = ctx.page;

    // Navigate to platform to refresh session
    const baseUrl = data.platform === 'TIKTOK'
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

    // Save updated cookies to encrypted store
    await saveCookiesToDiskCache(data.accountId, browserCookies, data.cookiesDir);

    logger.info(`✅ Cookies обновлены (${browserCookies.length} шт)`);
    await job.updateProgress(100);

    return JSON.stringify({ count: browserCookies.length, updatedAt: new Date().toISOString() });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`❌ Ошибка обновления cookies: ${message}`);
    throw err;
  } finally {
    await closeBrowser(browser);
    logger.disconnect();
  }
}

// ── Utility ─────────────────────────────────────────────────

function _randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
