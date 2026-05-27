// ─────────────────────────────────────────────────────────────
// Login Handler — login:password fresh auth
//
// Strategy:
// 1. Launch stealth browser with pinned proxy + fingerprint
// 2. Navigate to platform login page
// 3. Type login + password (humanType)
// 4. Click submit, wait for either:
//    - success (redirect to home/feed)
//    - captcha (handle via CapSolver — blocking)
//    - 2FA challenge (throw with TWO_FA_REQUIRED — user must resolve manually)
//    - bad credentials (throw with INVALID_CREDENTIALS)
// 5. On success, extract cookies, save to DB, mark account as ALIVE
//
// Job payload: { userId, accountId }  — credentials resolved from DB
// ─────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { launchStealthContext, closeBrowser } from '../core/browser/patchright-launcher.js';
import { createPageCursor, humanClick } from '../core/humanity/biomouse.js';
import { humanType } from '../core/humanity/typing-emulator.js';
import { handleTikTokCaptcha } from '../core/captcha/tiktok-captcha-handler.js';
import { saveCookiesToDiskCache, type BrowserCookie } from '../core/auth/cookie-store.js';
import { SocketLogger } from '../lib/socket-logger.js';
import { prisma } from '../lib/prisma.js';
import { loadAccountContext } from '../lib/account-context.js';
import crypto from 'crypto';
import type { Browser } from 'patchright';

interface LoginJobData {
  userId: string;
  accountId: string;
  cookiesDir?: string;
}

function decryptField(encrypted: Buffer, iv: Buffer, authTag: Buffer): string {
  const keyBuf = Buffer.from(process.env.MASTER_KEY ?? '', 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv);
  decipher.setAuthTag(authTag);
  const out = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return out.toString('utf8');
}

export async function loginHandler(job: Job<LoginJobData>): Promise<void> {
  const data = job.data;
  const logger = new SocketLogger(data.userId);
  let browser: Browser | null = null;

  try {
    const ctx = await loadAccountContext(data.accountId);

    // Load credentials from DB
    const acc = await prisma.socialAccount.findUniqueOrThrow({
      where: { id: data.accountId },
      select: {
        loginEncrypted: true, loginIv: true, loginAuthTag: true,
        passwordEncrypted: true, passwordIv: true, passwordAuthTag: true,
      },
    });

    if (!acc.loginEncrypted || !acc.passwordEncrypted) {
      throw new Error('[login] Account has no encrypted credentials');
    }

    const login = decryptField(Buffer.from(acc.loginEncrypted), Buffer.from(acc.loginIv!), Buffer.from(acc.loginAuthTag!));
    const password = decryptField(Buffer.from(acc.passwordEncrypted), Buffer.from(acc.passwordIv!), Buffer.from(acc.passwordAuthTag!));

    logger.info(`Login: ${ctx.platform} → ${login.slice(0, 3)}***`);
    await job.updateProgress(10);

    // Launch
    const stealth = await launchStealthContext({
      accountId: data.accountId,
      proxyUrl: ctx.proxyUrl,
      cookiesPath: data.cookiesDir ?? '/data/cookies',
      fingerprint: ctx.fingerprint,
    });
    browser = stealth.browser;
    const page = stealth.page;
    const cursor = await createPageCursor(page);

    // Navigate to login
    const loginUrl = ctx.platform === 'TIKTOK'
      ? 'https://www.tiktok.com/login/phone-or-email/email'
      : 'https://accounts.google.com/signin/v2/identifier?service=youtube';
    await page.goto(loginUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000 + Math.random() * 2000);
    await job.updateProgress(25);

    if (ctx.platform === 'TIKTOK') {
      // TikTok email login
      await humanType(page, 'input[name="username"], input[type="text"]', login);
      await page.waitForTimeout(500 + Math.random() * 800);
      await humanType(page, 'input[type="password"]', password);
      await page.waitForTimeout(500 + Math.random() * 800);
      await humanClick(page, cursor, 'button[type="submit"], button[data-e2e="login-button"]', { postClickDelay: 2000 });

      // Captcha may appear
      await page.waitForTimeout(3000);
      try {
        await handleTikTokCaptcha({
          page,
          proxyUrl: ctx.proxyUrl!,
          userAgent: ctx.fingerprint.userAgent,
          websiteURL: page.url(),
        });
      } catch (capErr) {
        // No captcha, or failed — let next checks decide
      }

      // 2FA detection
      await page.waitForTimeout(2000);
      const has2FA = await page.locator('input[name="code"], input[autocomplete*="one-time"]').count() > 0;
      if (has2FA) {
        throw new Error('[login] TWO_FA_REQUIRED — TikTok requested 2FA code, manual intervention needed');
      }

      // Bad credentials marker
      const errorText = await page.textContent('body');
      if (errorText && /password.*incorrect|неверный/i.test(errorText)) {
        throw new Error('[login] INVALID_CREDENTIALS');
      }
    } else {
      // YouTube (Google) login
      await humanType(page, 'input[type="email"]', login);
      await humanClick(page, cursor, '#identifierNext button, button[jsname="LgbsSe"]', { postClickDelay: 2000 });
      await page.waitForTimeout(2000 + Math.random() * 2000);
      await humanType(page, 'input[type="password"]', password);
      await humanClick(page, cursor, '#passwordNext button, button[jsname="LgbsSe"]', { postClickDelay: 3000 });

      // 2FA detection (very common on YouTube)
      await page.waitForTimeout(3000);
      const has2FA = await page.locator('input[type="tel"], input[autocomplete="one-time-code"]').count() > 0;
      if (has2FA) {
        throw new Error('[login] TWO_FA_REQUIRED — Google requested 2FA, manual intervention needed');
      }
    }

    // Wait for redirect to feed/home as success signal
    await page.waitForURL(
      ctx.platform === 'TIKTOK'
        ? /tiktok\.com\/(foryou|@|en|ru|.*\/feed)/
        : /youtube\.com\/(?:feed|watch|@|channel|c)/,
      { timeout: 30_000 },
    );
    await job.updateProgress(70);

    logger.info('Login успешен, извлекаю cookies...');

    // Extract cookies
    const cookies = await stealth.context.cookies();
    const browserCookies: BrowserCookie[] = cookies.map(c => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path,
      expires: c.expires, httpOnly: c.httpOnly, secure: c.secure,
      sameSite: c.sameSite === 'Strict' ? 'Strict' : c.sameSite === 'None' ? 'None' : 'Lax',
    }));
    await saveCookiesToDiskCache(data.accountId, browserCookies, data.cookiesDir);

    // Store encrypted in DB
    const jsonStr = JSON.stringify(browserCookies);
    const keyBuf = Buffer.from(process.env.MASTER_KEY ?? '', 'base64');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
    const encrypted = Buffer.concat([cipher.update(jsonStr, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    await prisma.socialAccount.update({
      where: { id: data.accountId },
      data: {
        cookiesEncrypted: encrypted,
        cookiesIv: iv,
        cookiesAuthTag: authTag,
        cookiesUpdatedAt: new Date(),
        status: 'ALIVE',
        // Optional: clear plaintext password backup once cookies are confirmed working
        // passwordEncrypted: null, passwordIv: null, passwordAuthTag: null,
      },
    });

    await job.updateProgress(100);
    logger.info(`✅ Login завершён, cookies сохранены`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`❌ Login failed: ${msg}`);

    // Mark account based on error code
    if (msg.includes('TWO_FA_REQUIRED')) {
      await prisma.socialAccount.update({
        where: { id: data.accountId },
        data: { status: 'AUTH_NEEDED' },
      });
    } else if (msg.includes('INVALID_CREDENTIALS')) {
      await prisma.socialAccount.update({
        where: { id: data.accountId },
        data: { status: 'AUTH_NEEDED' },
      });
    }
    throw err;
  } finally {
    await closeBrowser(browser);
    logger.disconnect();
  }
}
