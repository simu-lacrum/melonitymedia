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

import { Job, UnrecoverableError } from 'bullmq';
import { launchStealthContext, closeBrowser } from '../core/browser/patchright-launcher.js';
import { persistCookies, type BrowserCookie } from '../core/auth/cookie-store.js';
import { confirmBrowserSession } from '../core/auth/browser-session.js';
import { SocketLogger } from '../lib/socket-logger.js';
import { emitWorkerError } from '../lib/error-classifier.js';
import { loadAccountContext } from '../lib/account-context.js';
import { acquireAccountLock, releaseAccountLock } from '../lib/account-lock.js';
import { addJob } from '../lib/bullmq.js';
import { prisma } from '../lib/prisma.js';
import type { Browser } from 'patchright';

// ── Types ───────────────────────────────────────────────────

interface CookiesJobData {
  userId: string;
  taskId?: string;
  accountId?: string;
  cookiesDir?: string;
  maintenance?: boolean;
  _maintenanceDispatch?: boolean;
  // platform, fingerprint, proxyUrl are resolved from DB via loadAccountContext()
}

// ── Main ────────────────────────────────────────────────────

export async function cookiesHandler(job: Job<CookiesJobData>): Promise<string> {
  const data = job.data;
  const logger = new SocketLogger(data.userId);
  let browser: Browser | null = null;
  let lockAcquired = false;

  try {
    if (data._maintenanceDispatch) {
      const dispatched = await dispatchSessionMaintenance();
      return JSON.stringify({ dispatched });
    }
    if (!data.accountId) throw new Error('Cookies job is missing accountId');

    // Acquire per-account lock — prevent concurrent browser sessions
    const holder = await acquireAccountLock(data.accountId, 'cookies');
    if (holder) {
      if (data.maintenance) {
        logger.info(`Session maintenance skipped because account is already active: ${holder}`);
        return JSON.stringify({ skipped: true, reason: 'ACCOUNT_BUSY' });
      }
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

    // Two independent DOM checks prevent an incomplete SPA render from being
    // treated as a lost account session.
    const authCheck = await confirmBrowserSession(page, ctxAcc.platform, 2);

    if (authCheck.state === 'logged_out') {
      logger.warn(`Cookies истекли — требуется импорт новых cookies через UI (${authCheck.reason})`);
      await prisma.socialAccount.update({
        where: { id: data.accountId },
        data: { status: 'EXPIRED_COOKIES', lastError: authCheck.reason },
      });
      throw new UnrecoverableError('COOKIES_EXPIRED');
    }
    if (authCheck.state === 'unknown') {
      throw new Error(`SESSION_CHECK_INCONCLUSIVE: ${authCheck.reason}`);
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
    emitWorkerError(logger, data.accountId ?? 'maintenance-dispatch', 'cookies', err);
    throw err;
  } finally {
    await closeBrowser(browser);
    if (lockAcquired && data.accountId) await releaseAccountLock(data.accountId, 'cookies');
    logger.disconnect();
  }
}

// ── Utility ─────────────────────────────────────────────────

function _randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function dispatchSessionMaintenance(): Promise<number> {
  const maxAgeHours = Math.max(24, Number(process.env.SESSION_REFRESH_MAX_AGE_HOURS ?? 72));
  const staleBefore = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
  const accounts = await prisma.socialAccount.findMany({
    where: {
      status: 'ALIVE',
      cookiesEncrypted: { not: null },
      pinnedProxyId: { not: null },
      pinnedProxy: { is: { status: 'ACTIVE' } },
      OR: [
        { cookiesUpdatedAt: null },
        { cookiesUpdatedAt: { lt: staleBefore } },
      ],
    },
    select: { id: true, userId: true, fingerprint: true },
    orderBy: { cookiesUpdatedAt: 'asc' },
    take: 50,
  });

  const bucket = Math.floor(Date.now() / (6 * 60 * 60 * 1000));
  let dispatched = 0;
  for (const account of accounts) {
    if (!account.fingerprint) continue;
    await addJob('cookies', {
      userId: account.userId,
      accountId: account.id,
      maintenance: true,
    }, {
      jobId: `session-maintenance-${account.id}-${bucket}`,
      delay: dispatched * 2 * 60 * 1000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 15 * 60 * 1000 },
    });
    dispatched++;
  }

  console.log(`[SessionMaintenance] Dispatched ${dispatched} stale session refresh jobs`);
  return dispatched;
}
