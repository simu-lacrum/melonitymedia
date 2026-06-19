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
import type { Browser, Page } from 'patchright';

// ── Types ───────────────────────────────────────────────────

interface CookiesJobData {
  userId: string;
  taskId?: string;
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
      taskId: data.taskId,
      jobId: job.id,
      jobType: 'cookies',
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

    const waitUntil = ctxAcc.platform === 'YOUTUBE' ? 'load' : 'domcontentloaded';
    await page.goto(baseUrl, { waitUntil, timeout: 45_000 });
    await page.waitForTimeout(_randomDelay(3000, 5000));

    // Check auth status with platform-specific positive logout signals.
    // Full body text is too noisy: logged-in pages can contain "Sign in" strings
    // inside scripts, comments, or guest-only prompts.
    const authCheck = await _detectLoggedOut(page, ctxAcc.platform);

    if (authCheck.loggedOut) {
      logger.warn(`Cookies истекли — требуется импорт новых cookies через UI (${authCheck.reason})`);
      await prisma.socialAccount.update({
        where: { id: data.accountId },
        data: { status: 'EXPIRED_COOKIES', lastError: authCheck.reason },
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

    const statusReset = ['EXPIRED_COOKIES', 'AUTH_NEEDED', 'VERIFYING'].includes(ctxAcc.status)
      ? { status: 'ALIVE' as const }
      : {};
    await prisma.socialAccount.update({
      where: { id: data.accountId },
      data: { ...statusReset, lastError: null },
    });

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

async function _detectLoggedOut(
  page: Page,
  platform: 'TIKTOK' | 'YOUTUBE',
): Promise<{ loggedOut: boolean; reason: string }> {
  const url = page.url();

  if (platform === 'YOUTUBE') {
    if (/accounts\.google\.com|ServiceLogin/i.test(url)) {
      return { loggedOut: true, reason: 'redirected to Google login' };
    }

    const signInVisible = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('a, button, ytd-button-renderer, tp-yt-paper-button'));
      return elements.some((el) => {
        const href = (el as HTMLAnchorElement).href || el.getAttribute('href') || '';
        const label = `${el.getAttribute('aria-label') || ''} ${el.textContent || ''}`.toLowerCase();
        const rect = (el as HTMLElement).getBoundingClientRect?.();
        const visible = rect ? rect.width > 0 && rect.height > 0 : true;
        return visible && (href.includes('ServiceLogin') || /\bsign in\b/.test(label));
      });
    }).catch(() => true);

    return {
      loggedOut: signInVisible,
      reason: signInVisible ? 'YouTube sign-in control is visible' : 'session is authenticated',
    };
  }

  if (/\/login|accounts\.tiktok\.com/i.test(url)) {
    return { loggedOut: true, reason: 'redirected to TikTok login' };
  }

  const loginVisible = await page.evaluate(() => {
    const selectors = [
      'button[data-e2e="top-login-button"]',
      'button[data-e2e*="login"]',
      'a[href*="/login"]',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return true;
    }

    return Array.from(document.querySelectorAll('button')).some((button) => {
      const text = (button.textContent || '').trim().toLowerCase();
      const rect = button.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && (text === 'log in' || text === 'войти');
    });
  }).catch(() => true);

  return {
    loggedOut: loginVisible,
    reason: loginVisible ? 'TikTok login control is visible' : 'session is authenticated',
  };
}
