// ─────────────────────────────────────────────────────────────
// Login Handler v2 — Verification-on-Import with 2FA Support
//
// Called during account import (both login:pass AND cookies).
// This handler is the gatekeeper — accounts only get ALIVE status
// after successful verification here.
//
// Modes:
// A) login:password → Launch browser → Type credentials → Handle 2FA/captcha
// B) cookies        → curl-impersonate validation (fast, ~200ms, no browser)
//
// 2FA Flow:
// 1. Detect 2FA challenge in browser
// 2. Emit login:2fa_required via Socket.io to frontend
// 3. Subscribe to Redis channel verification_code:{accountId}
// 4. Wait up to 10 minutes for user to enter code
// 5. Type code into browser → continue login
//
// Error codes emitted via Socket.io login:failed:
//   INVALID_CREDENTIALS, ACCOUNT_BANNED, ACCOUNT_SUSPENDED,
//   CAPTCHA_FAILED, TWO_FA_TIMEOUT, TWO_FA_INVALID,
//   COOKIES_EXPIRED, NETWORK_ERROR, UNKNOWN_ERROR
// ─────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { launchStealthContext, closeBrowser } from '../core/browser/patchright-launcher.js';
import { createPageCursor, humanClick } from '../core/humanity/biomouse.js';
import { humanType } from '../core/humanity/typing-emulator.js';
import { handleTikTokCaptcha } from '../core/captcha/tiktok-captcha-handler.js';
import { persistCookies, type BrowserCookie } from '../core/auth/cookie-store.js';
import { validateCookies } from '../core/auth/session-validator.js';
import { waitForVerificationCode } from '../lib/redis-pubsub.js';
import { SocketLogger } from '../lib/socket-logger.js';
import { prisma } from '../lib/prisma.js';
import { loadAccountContext } from '../lib/account-context.js';
import crypto from 'crypto';
import type { Browser } from 'patchright';

interface LoginJobData {
  userId: string;
  accountId: string;
  cookiesDir?: string;
  /** 'credentials' = login:pass flow, 'cookies' = cookie validation only */
  mode: 'credentials' | 'cookies';
}

// ── Error codes ─────────────────────────────────────────────
type LoginErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_BANNED'
  | 'ACCOUNT_SUSPENDED'
  | 'CAPTCHA_FAILED'
  | 'TWO_FA_TIMEOUT'
  | 'TWO_FA_INVALID'
  | 'COOKIES_EXPIRED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

class LoginError extends Error {
  constructor(
    public code: LoginErrorCode,
    public detail: string,
  ) {
    super(`[login] ${code}: ${detail}`);
    this.name = 'LoginError';
  }
}

// ── Crypto helpers ──────────────────────────────────────────
function decryptField(encrypted: Buffer, iv: Buffer, authTag: Buffer): string {
  const masterKey = process.env.MASTER_KEY;
  if (!masterKey) throw new Error('MASTER_KEY not set');
  const keyBuf = Buffer.from(masterKey, 'base64');
  if (keyBuf.length !== 32) throw new Error('MASTER_KEY must be 32 bytes');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv);
  decipher.setAuthTag(authTag);
  const out = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return out.toString('utf8');
}

// ── 2FA type detection ──────────────────────────────────────
type TwoFAType = 'email' | 'sms' | 'authenticator' | 'unknown';

async function detect2FAType(page: any, platform: 'TIKTOK' | 'YOUTUBE'): Promise<{ has2FA: boolean; type: TwoFAType; hint: string }> {
  if (platform === 'TIKTOK') {
    const codeInput = await page.locator('input[name="code"], input[autocomplete*="one-time"]').count();
    if (codeInput > 0) {
      // Try to detect type from page text
      const bodyText = await page.textContent('body') || '';
      if (/email|почт/i.test(bodyText)) return { has2FA: true, type: 'email', hint: 'TikTok запросил код из email' };
      if (/sms|смс|phone|телефон/i.test(bodyText)) return { has2FA: true, type: 'sms', hint: 'TikTok запросил код из SMS' };
      if (/authenticator|2fa|двухфакторн/i.test(bodyText)) return { has2FA: true, type: 'authenticator', hint: 'TikTok запросил код из приложения-аутентификатора' };
      return { has2FA: true, type: 'unknown', hint: 'TikTok запросил код подтверждения' };
    }
  } else {
    // YouTube/Google 2FA
    const telInput = await page.locator('input[type="tel"], input[autocomplete="one-time-code"]').count();
    if (telInput > 0) {
      const bodyText = await page.textContent('body') || '';
      if (/email|gmail|почт/i.test(bodyText)) return { has2FA: true, type: 'email', hint: 'Google запросил код из email' };
      if (/sms|phone|телефон|номер/i.test(bodyText)) return { has2FA: true, type: 'sms', hint: 'Google запросил код из SMS' };
      if (/authenticator|google auth/i.test(bodyText)) return { has2FA: true, type: 'authenticator', hint: 'Google запросил код из Authenticator' };
      return { has2FA: true, type: 'unknown', hint: 'Google запросил код подтверждения' };
    }
    // Google "choose verification method" page
    const challengeText = await page.textContent('body') || '';
    if (/verify.*identity|подтверд.*личность/i.test(challengeText)) {
      return { has2FA: true, type: 'unknown', hint: 'Google запросил подтверждение личности' };
    }
  }
  return { has2FA: false, type: 'unknown', hint: '' };
}

// ── Main handler ────────────────────────────────────────────
export async function loginHandler(job: Job<LoginJobData>): Promise<void> {
  const data = job.data;
  const mode = data.mode || 'credentials';
  const logger = new SocketLogger(data.userId);
  let browser: Browser | null = null;

  try {
    const ctx = await loadAccountContext(data.accountId);

    // ════════════════════════════════════════════════════════
    // MODE B: Cookie validation (curl-impersonate, no browser)
    // ════════════════════════════════════════════════════════
    if (mode === 'cookies') {
      logger.info(`🔍 Проверка cookies: ${ctx.platform}...`);
      await job.updateProgress(20);

      const status = await validateCookies(
        data.accountId,
        ctx.fingerprint,
        ctx.platform,
        ctx.proxyUrl,
        data.cookiesDir ?? '/data/cookies',
      );

      if (status === 'alive') {
        await prisma.socialAccount.update({
          where: { id: data.accountId },
          data: { status: 'ALIVE' },
        });
        await job.updateProgress(100);
        logger.info(`✅ Cookies валидны, аккаунт активирован`);

        // Emit success to frontend
        emitLoginEvent(logger, data.accountId, 'login:success', {
          message: 'Cookies проверены, аккаунт активен',
        });
        return;
      }

      if (status === 'banned') {
        await prisma.socialAccount.update({
          where: { id: data.accountId },
          data: { status: 'BANNED' },
        });
        emitLoginEvent(logger, data.accountId, 'login:failed', {
          code: 'ACCOUNT_BANNED',
          message: 'Аккаунт заблокирован платформой',
        });
        throw new LoginError('ACCOUNT_BANNED', 'Platform detected account ban');
      }

      // expired
      await prisma.socialAccount.update({
        where: { id: data.accountId },
        data: { status: 'AUTH_NEEDED' },
      });
      emitLoginEvent(logger, data.accountId, 'login:failed', {
        code: 'COOKIES_EXPIRED',
        message: 'Cookies недействительны или истекли. Попробуйте импортировать свежие cookies или войти через login:password.',
      });
      throw new LoginError('COOKIES_EXPIRED', 'Cookies are expired or invalid');
    }

    // ════════════════════════════════════════════════════════
    // MODE A: Login:password (browser-based)
    // ════════════════════════════════════════════════════════
    const acc = await prisma.socialAccount.findUniqueOrThrow({
      where: { id: data.accountId },
      select: {
        loginEncrypted: true, loginIv: true, loginAuthTag: true,
        passwordEncrypted: true, passwordIv: true, passwordAuthTag: true,
      },
    });

    if (!acc.loginEncrypted || !acc.passwordEncrypted) {
      emitLoginEvent(logger, data.accountId, 'login:failed', {
        code: 'INVALID_CREDENTIALS',
        message: 'Учётные данные отсутствуют в базе',
      });
      throw new LoginError('INVALID_CREDENTIALS', 'No encrypted credentials found');
    }

    const login = decryptField(acc.loginEncrypted as Buffer, acc.loginIv as Buffer, acc.loginAuthTag as Buffer);
    const password = decryptField(acc.passwordEncrypted as Buffer, acc.passwordIv as Buffer, acc.passwordAuthTag as Buffer);

    logger.info(`🔐 Вход: ${ctx.platform} → ${login.slice(0, 3)}***`);
    await job.updateProgress(10);

    // Launch browser
    const stealth = await launchStealthContext({
      accountId: data.accountId,
      proxyUrl: ctx.proxyUrl,
      cookiesPath: data.cookiesDir ?? '/data/cookies',
      fingerprint: ctx.fingerprint,
    });
    browser = stealth.browser;
    const page = stealth.page;
    const cursor = await createPageCursor(page);

    // Navigate to login page
    const loginUrl = ctx.platform === 'TIKTOK'
      ? 'https://www.tiktok.com/login/phone-or-email/email'
      : 'https://accounts.google.com/signin/v2/identifier?service=youtube';

    logger.info(`🌐 Открываю страницу входа...`);
    await page.goto(loginUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000 + Math.random() * 2000);
    await job.updateProgress(25);

    // ── Enter credentials ──────────────────────────────────
    if (ctx.platform === 'TIKTOK') {
      logger.info(`⌨️ Ввожу учётные данные...`);
      await humanType(page, 'input[name="username"], input[type="text"]', login);
      await page.waitForTimeout(500 + Math.random() * 800);
      await humanType(page, 'input[type="password"]', password);
      await page.waitForTimeout(500 + Math.random() * 800);
      await humanClick(page, cursor, 'button[type="submit"], button[data-e2e="login-button"]', { postClickDelay: 2000 });

      // Handle captcha
      await page.waitForTimeout(3000);
      try {
        logger.info(`🧩 Проверяю капчу...`);
        await handleTikTokCaptcha({
          page,
          proxyUrl: ctx.proxyUrl!,
          userAgent: ctx.fingerprint.userAgent,
          websiteURL: page.url(),
        });
        logger.info(`✅ Капча решена`);
      } catch {
        // No captcha or failed — next checks decide
      }

      await job.updateProgress(50);
      await page.waitForTimeout(2000);

      // Check bad credentials first
      const errorText = await page.textContent('body') || '';
      if (/password.*incorrect|неверный|wrong.*password/i.test(errorText)) {
        await prisma.socialAccount.update({
          where: { id: data.accountId },
          data: { status: 'AUTH_NEEDED' },
        });
        emitLoginEvent(logger, data.accountId, 'login:failed', {
          code: 'INVALID_CREDENTIALS',
          message: 'Неверный пароль. Проверьте учётные данные и попробуйте снова.',
        });
        throw new LoginError('INVALID_CREDENTIALS', 'Wrong password');
      }

      if (/banned|suspended|заблокирован/i.test(errorText)) {
        await prisma.socialAccount.update({
          where: { id: data.accountId },
          data: { status: 'BANNED' },
        });
        emitLoginEvent(logger, data.accountId, 'login:failed', {
          code: 'ACCOUNT_BANNED',
          message: 'Аккаунт заблокирован TikTok.',
        });
        throw new LoginError('ACCOUNT_BANNED', 'Account is banned by TikTok');
      }
    } else {
      // YouTube/Google login
      logger.info(`⌨️ Ввожу email...`);
      await humanType(page, 'input[type="email"]', login);
      await humanClick(page, cursor, '#identifierNext button, button[jsname="LgbsSe"]', { postClickDelay: 2000 });
      await page.waitForTimeout(2000 + Math.random() * 2000);

      // Check if email exists
      const emailError = await page.textContent('body') || '';
      if (/couldn.?t find|не удалось найти/i.test(emailError)) {
        await prisma.socialAccount.update({
          where: { id: data.accountId },
          data: { status: 'AUTH_NEEDED' },
        });
        emitLoginEvent(logger, data.accountId, 'login:failed', {
          code: 'INVALID_CREDENTIALS',
          message: 'Аккаунт Google не найден. Проверьте email.',
        });
        throw new LoginError('INVALID_CREDENTIALS', 'Google account not found');
      }

      logger.info(`⌨️ Ввожу пароль...`);
      await humanType(page, 'input[type="password"]', password);
      await humanClick(page, cursor, '#passwordNext button, button[jsname="LgbsSe"]', { postClickDelay: 3000 });

      await job.updateProgress(50);
      await page.waitForTimeout(3000);

      // Check wrong password
      const pwdError = await page.textContent('body') || '';
      if (/wrong.*password|неверный.*пароль/i.test(pwdError)) {
        await prisma.socialAccount.update({
          where: { id: data.accountId },
          data: { status: 'AUTH_NEEDED' },
        });
        emitLoginEvent(logger, data.accountId, 'login:failed', {
          code: 'INVALID_CREDENTIALS',
          message: 'Неверный пароль Google. Проверьте учётные данные.',
        });
        throw new LoginError('INVALID_CREDENTIALS', 'Wrong Google password');
      }
    }

    // ── 2FA Detection ──────────────────────────────────────
    const twoFA = await detect2FAType(page, ctx.platform);

    if (twoFA.has2FA) {
      logger.warn(`🔒 ${twoFA.hint}`);

      // Emit 2FA required to frontend
      emitLoginEvent(logger, data.accountId, 'login:2fa_required', {
        type: twoFA.type,
        hint: twoFA.hint,
        platform: ctx.platform,
        timeoutSeconds: 600, // 10 minutes
      });

      // Wait for code from user via Redis pub/sub
      logger.info(`⏳ Ожидаю код подтверждения (10 мин)...`);
      const code = await waitForVerificationCode(data.accountId, 10 * 60 * 1000);

      if (!code) {
        await prisma.socialAccount.update({
          where: { id: data.accountId },
          data: { status: 'AUTH_NEEDED' },
        });
        emitLoginEvent(logger, data.accountId, 'login:failed', {
          code: 'TWO_FA_TIMEOUT',
          message: 'Время ожидания кода истекло (10 мин). Повторите попытку входа.',
        });
        throw new LoginError('TWO_FA_TIMEOUT', 'User did not provide 2FA code within 10 minutes');
      }

      logger.info(`📱 Код получен, ввожу...`);

      // Enter the code
      if (ctx.platform === 'TIKTOK') {
        await humanType(page, 'input[name="code"], input[autocomplete*="one-time"]', code);
        await page.waitForTimeout(500);
        // Try to click verify/submit button
        try {
          await humanClick(page, cursor, 'button[type="submit"], button:has-text("Verify"), button:has-text("Подтвердить")', { postClickDelay: 3000 });
        } catch {
          // Some forms auto-submit
        }
      } else {
        await humanType(page, 'input[type="tel"], input[autocomplete="one-time-code"]', code);
        await page.waitForTimeout(500);
        try {
          await humanClick(page, cursor, '#idvPreregisteredPhoneNext button, button[jsname="LgbsSe"], button:has-text("Next")', { postClickDelay: 3000 });
        } catch {
          // Auto-submit
        }
      }

      await page.waitForTimeout(3000);

      // Check if code was invalid
      const postCodeText = await page.textContent('body') || '';
      if (/wrong.*code|invalid.*code|неверный.*код|incorrect/i.test(postCodeText)) {
        await prisma.socialAccount.update({
          where: { id: data.accountId },
          data: { status: 'AUTH_NEEDED' },
        });
        emitLoginEvent(logger, data.accountId, 'login:failed', {
          code: 'TWO_FA_INVALID',
          message: 'Введён неверный код подтверждения. Повторите попытку входа.',
        });
        throw new LoginError('TWO_FA_INVALID', 'Invalid 2FA code');
      }

      await job.updateProgress(70);
    }

    // ── Wait for redirect to feed/home (success signal) ────
    logger.info(`⏳ Ожидаю перенаправление на главную...`);
    try {
      await page.waitForURL(
        ctx.platform === 'TIKTOK'
          ? /tiktok\.com\/(foryou|@|en|ru|.*\/feed)/
          : /youtube\.com\/(?:feed|watch|@|channel|c)|myaccount\.google\.com/,
        { timeout: 30_000 },
      );
    } catch {
      // Timeout waiting for redirect — could be captcha, 2FA, or other issue
      const currentUrl = page.url();
      logger.warn(`⚠️ Не удалось дождаться перенаправления. URL: ${currentUrl}`);

      // Try to detect what went wrong
      const bodyText = await page.textContent('body') || '';
      if (/captcha|verify.*human/i.test(bodyText)) {
        emitLoginEvent(logger, data.accountId, 'login:failed', {
          code: 'CAPTCHA_FAILED',
          message: 'Платформа показала капчу, которую не удалось решить автоматически.',
        });
        await prisma.socialAccount.update({ where: { id: data.accountId }, data: { status: 'AUTH_NEEDED' } });
        throw new LoginError('CAPTCHA_FAILED', 'Captcha not resolved');
      }

      if (/suspended|заблокирован|disabled/i.test(bodyText)) {
        emitLoginEvent(logger, data.accountId, 'login:failed', {
          code: 'ACCOUNT_SUSPENDED',
          message: 'Аккаунт приостановлен платформой.',
        });
        await prisma.socialAccount.update({ where: { id: data.accountId }, data: { status: 'BANNED' } });
        throw new LoginError('ACCOUNT_SUSPENDED', 'Account suspended');
      }

      emitLoginEvent(logger, data.accountId, 'login:failed', {
        code: 'UNKNOWN_ERROR',
        message: `Не удалось завершить вход. Текущий URL: ${currentUrl}`,
      });
      await prisma.socialAccount.update({ where: { id: data.accountId }, data: { status: 'AUTH_NEEDED' } });
      throw new LoginError('UNKNOWN_ERROR', `Login flow stuck at ${currentUrl}`);
    }

    await job.updateProgress(80);
    logger.info('✅ Вход успешен! Извлекаю cookies...');

    // ── Extract and save cookies ───────────────────────────
    const cookies = await stealth.context.cookies();
    const browserCookies: BrowserCookie[] = cookies.map(c => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path,
      expires: c.expires, httpOnly: c.httpOnly, secure: c.secure,
      sameSite: c.sameSite === 'Strict' ? 'Strict' : c.sameSite === 'None' ? 'None' : 'Lax',
    }));

    await persistCookies(data.accountId, browserCookies, data.cookiesDir ?? '/data/cookies');

    // ── Try to extract username from profile ───────────────
    let extractedUsername: string | null = null;
    try {
      if (ctx.platform === 'TIKTOK') {
        // Navigate to profile to get username
        await page.goto('https://www.tiktok.com/@me', { waitUntil: 'networkidle', timeout: 15000 });
        const currentUrl = page.url();
        const match = currentUrl.match(/@([^/?]+)/);
        if (match) extractedUsername = match[1];
      } else {
        // YouTube — try to get channel name
        await page.goto('https://www.youtube.com/account', { waitUntil: 'networkidle', timeout: 15000 });
        const nameEl = await page.locator('#account-name, .channel-header-profile-image-container + .ytd-account-settings').first();
        if (await nameEl.count() > 0) {
          extractedUsername = (await nameEl.textContent())?.trim() || null;
        }
      }
    } catch {
      // Non-critical — username extraction is best-effort
    }

    // ── Update account to ALIVE ────────────────────────────
    await prisma.socialAccount.update({
      where: { id: data.accountId },
      data: {
        status: 'ALIVE',
        ...(extractedUsername ? { username: extractedUsername } : {}),
      },
    });

    await job.updateProgress(100);
    logger.info(`✅ Вход завершён, cookies сохранены${extractedUsername ? `, username: ${extractedUsername}` : ''}`);

    // Emit success to frontend
    emitLoginEvent(logger, data.accountId, 'login:success', {
      message: 'Вход выполнен успешно, аккаунт активирован',
      username: extractedUsername,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    // Only log if not already a LoginError (those already emitted)
    if (!(err instanceof LoginError)) {
      logger.error(`❌ Ошибка входа: ${msg}`);

      // Determine error code for unexpected errors
      let code: LoginErrorCode = 'UNKNOWN_ERROR';
      let message = msg;
      if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|proxy/i.test(msg)) {
        code = 'NETWORK_ERROR';
        message = 'Ошибка сети или прокси. Проверьте прокси и попробуйте снова.';
      }

      await prisma.socialAccount.update({
        where: { id: data.accountId },
        data: { status: 'AUTH_NEEDED' },
      }).catch(() => {});

      emitLoginEvent(logger, data.accountId, 'login:failed', { code, message });
    }

    throw err;
  } finally {
    await closeBrowser(browser);
    logger.disconnect();
  }
}

// ── Socket.io event helpers ─────────────────────────────────
function emitLoginEvent(
  logger: SocketLogger,
  accountId: string,
  event: 'login:success' | 'login:failed' | 'login:2fa_required',
  data: Record<string, unknown>,
): void {
  // Use the socket logger's underlying socket to emit typed events
  // The socket connects to /logs namespace, which relays to the user's room
  const socket = (logger as any).socket;
  if (socket) {
    socket.emit(event, { accountId, ...data });
  }
}
