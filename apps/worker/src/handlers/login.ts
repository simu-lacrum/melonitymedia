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
import { waitForVerificationCode, waitForVerificationResult, type VerificationResult } from '../lib/redis-pubsub.js';
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
    // Check 1: code input field present (classic 2FA)
    const codeInput = await page.locator('input[name="code"], input[autocomplete*="one-time"]').count();
    if (codeInput > 0) {
      const bodyText = await page.textContent('body') || '';
      if (/email|почт/i.test(bodyText)) return { has2FA: true, type: 'email', hint: 'TikTok запросил код из email' };
      if (/sms|смс|phone|телефон/i.test(bodyText)) return { has2FA: true, type: 'sms', hint: 'TikTok запросил код из SMS' };
      if (/authenticator|2fa|двухфакторн/i.test(bodyText)) return { has2FA: true, type: 'authenticator', hint: 'TikTok запросил код из приложения-аутентификатора' };
      return { has2FA: true, type: 'unknown', hint: 'TikTok запросил код подтверждения' };
    }

    // Check 2: TikTok email/SMS verification page without code input
    // TikTok sometimes shows a "verify via email" page with a button, not a code input.
    // URL patterns: /login/verify, /verify, or body text mentions verification.
    const currentUrl = page.url();
    const bodyText = await page.textContent('body') || '';
    const isVerifyUrl = /verify|verification|challenge/i.test(currentUrl);
    const isVerifyText = /verify.*email|send.*code|verification.*code|подтвер|отправ.*код|check.*email|проверь.*почт/i.test(bodyText);

    if (isVerifyUrl || isVerifyText) {
      if (/email|почт|mail/i.test(bodyText)) return { has2FA: true, type: 'email', hint: 'TikTok просит подтвердить вход через email' };
      if (/sms|смс|phone|телефон/i.test(bodyText)) return { has2FA: true, type: 'sms', hint: 'TikTok просит подтвердить вход через SMS' };
      return { has2FA: true, type: 'unknown', hint: 'TikTok запросил подтверждение входа' };
    }
  } else {
    // YouTube/Google — extensive challenge detection
    // Google uses many verification methods. Detect by URL, selectors, and content.
    const currentUrl = page.url();
    const bodyText = await page.textContent('body') || '';

    // Google challenge URLs (most reliable signal)
    const isChallengePage = /accounts\.google\.com\/(signin\/(challenge|v2\/challenge)|CheckCookie|ServiceLogin\/webreauth)/i.test(currentUrl)
      || /challenge|interstitial|speedbump/i.test(currentUrl);

    // ── Check 1: Code input field (email/SMS/TOTP) ──
    const codeInput = await page.locator('input[type="tel"], input[autocomplete="one-time-code"], input[name="pin"], input[name="totpPin"], #totpPin').count();
    if (codeInput > 0) {
      if (/authenticator|google auth|аутентификат/i.test(bodyText)) return { has2FA: true, type: 'authenticator', hint: 'Google запросил код из приложения-аутентификатора (Google Authenticator)' };
      if (/sms|text message|текстовое сообщение|phone.*number|номер.*телефон/i.test(bodyText)) return { has2FA: true, type: 'sms', hint: 'Google отправил SMS-код на привязанный номер телефона' };
      if (/email|gmail|эл.*почт|recovery.*email|резервн.*адрес/i.test(bodyText)) return { has2FA: true, type: 'email', hint: 'Google отправил код на привязанный email' };
      return { has2FA: true, type: 'unknown', hint: 'Google запросил код подтверждения' };
    }

    // ── Check 2: "Tap Yes on your phone" / trusted device prompt ──
    if (/tap.*yes|нажмите.*да|check.*phone|проверьте.*телефон|trying to sign in|пытается.*войти/i.test(bodyText) && isChallengePage) {
      return { has2FA: true, type: 'sms', hint: 'Google просит подтвердить вход на доверенном устройстве. Откройте уведомление на телефоне и нажмите "Да".' };
    }

    // ── Check 3: Recovery email/phone selection page ──
    if (/choose.*method|выберите.*способ|verify.*it.*s.*you|подтвердите.*что.*это|confirm.*recovery|подтверд.*восстановлен/i.test(bodyText) && isChallengePage) {
      // Try to detect which methods are available
      if (/recovery.*email|резервн.*email|backup.*email/i.test(bodyText)) return { has2FA: true, type: 'email', hint: 'Google просит подтвердить через резервный email. Проверьте почту.' };
      if (/recovery.*phone|резервн.*телефон|backup.*phone/i.test(bodyText)) return { has2FA: true, type: 'sms', hint: 'Google просит подтвердить через резервный телефон.' };
      return { has2FA: true, type: 'unknown', hint: 'Google запросил подтверждение личности. Выберите способ подтверждения.' };
    }

    // ── Check 4: Security key prompt ──
    if (/security.*key|ключ.*безопасности|usb.*key|insert.*key|вставьте.*ключ/i.test(bodyText) && isChallengePage) {
      return { has2FA: true, type: 'unknown', hint: 'Google просит использовать аппаратный ключ безопасности (Security Key). Вставьте ключ и нажмите кнопку.' };
    }

    // ── Check 5: Google Prompt "type the number" challenge ──
    if (/type.*number|match.*number|введите.*число|number.*shown/i.test(bodyText) && isChallengePage) {
      return { has2FA: true, type: 'sms', hint: 'Google показывает число для подтверждения. Откройте уведомление на телефоне и выберите показанное число.' };
    }

    // ── Check 6: Generic challenge page without specific type ──
    if (isChallengePage) {
      if (/verify.*identity|подтверд.*личность|prove.*it.*s.*you|докаж.*что.*это/i.test(bodyText)) {
        return { has2FA: true, type: 'unknown', hint: 'Google запросил подтверждение личности' };
      }
      // Challenge URL but unclear type — still flag it
      if (bodyText.length > 100) {
        return { has2FA: true, type: 'unknown', hint: 'Google запросил дополнительную проверку' };
      }
    }

    // ── Check 7: "Enter your email/phone" for recovery (not login) ──
    const recoveryInput = await page.locator('#knowledge-preregistered-email-response, input[name="knowledgePreregisteredEmailResponse"], #phoneNumberId').count();
    if (recoveryInput > 0) {
      if (/email|почт/i.test(bodyText)) return { has2FA: true, type: 'email', hint: 'Google просит ввести резервный email для подтверждения' };
      if (/phone|телефон/i.test(bodyText)) return { has2FA: true, type: 'sms', hint: 'Google просит ввести номер телефона для подтверждения' };
      return { has2FA: true, type: 'unknown', hint: 'Google запросил дополнительные данные для подтверждения' };
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
          data: { status: 'ALIVE', lastError: null },
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

      // ── FIRST: check for 2FA/verification BEFORE password errors ──
      // TikTok's verification page body text can contain words like "неверный"
      // in unrelated UI elements, causing false "wrong password" detection.
      const earlyFA = await detect2FAType(page, ctx.platform);
      if (!earlyFA.has2FA) {
        // Only check for password errors if NOT on a verification page
        // Use specific error selectors instead of full body text to avoid false positives
        let hasPasswordError = false;
        try {
          // TikTok shows login errors in specific toast/alert elements
          const errorEl = page.locator('[class*="error"], [class*="alert"], [class*="toast"], [data-e2e*="error"], [class*="message-text"]');
          const errorCount = await errorEl.count();
          if (errorCount > 0) {
            const errorText = await errorEl.allTextContents();
            const combined = errorText.join(' ');
            if (/password.*incorrect|incorrect.*password|неверный.*парол|парол.*невер|wrong.*password|password.*wrong/i.test(combined)) {
              hasPasswordError = true;
            }
          }
        } catch {
          // Selector failed — fallback: do NOT check full body, just skip
        }

        if (hasPasswordError) {
          const errMsg = 'Неверный пароль. Проверьте учётные данные и попробуйте снова.';
          await prisma.socialAccount.update({
            where: { id: data.accountId },
            data: { status: 'AUTH_NEEDED', lastError: errMsg },
          });
          emitLoginEvent(logger, data.accountId, 'login:failed', {
            code: 'INVALID_CREDENTIALS',
            message: errMsg,
          });
          throw new LoginError('INVALID_CREDENTIALS', 'Wrong password');
        }

        // Check for ban/suspension (only if not on verification page)
        try {
          const banEl = page.locator('[class*="error"], [class*="alert"], [class*="banned"]');
          const banCount = await banEl.count();
          if (banCount > 0) {
            const banText = (await banEl.allTextContents()).join(' ');
            if (/banned|suspended|заблокирован/i.test(banText)) {
              await prisma.socialAccount.update({
                where: { id: data.accountId },
                data: { status: 'BANNED', lastError: 'Аккаунт заблокирован TikTok.' },
              });
              emitLoginEvent(logger, data.accountId, 'login:failed', {
                code: 'ACCOUNT_BANNED',
                message: 'Аккаунт заблокирован TikTok.',
              });
              throw new LoginError('ACCOUNT_BANNED', 'Account is banned by TikTok');
            }
          }
        } catch (e) {
          if (e instanceof LoginError) throw e;
          // Selector failed — continue
        }
      }
      // If earlyFA.has2FA === true, we skip password checks entirely
      // and let the 2FA handler below deal with it
    } else {
      // ════════════════════════════════════════════════════════
      // YouTube/Google login — same safety patterns as TikTok
      // ════════════════════════════════════════════════════════

      // ── Step 1: Enter email ──────────────────────────────
      logger.info(`⌨️ Ввожу email...`);
      await humanType(page, 'input[type="email"]', login);
      await humanClick(page, cursor, '#identifierNext button, button[jsname="LgbsSe"]', { postClickDelay: 2000 });
      await page.waitForTimeout(2000 + Math.random() * 2000);

      // Check if email exists — use Google's specific error elements
      let emailNotFound = false;
      try {
        // Google shows "Couldn't find your Google Account" in specific elements
        const errorEl = page.locator('.o6cuMc, .dEOOab, [jsname="B34EJ"], #headingSubtext, .Ekjuhf');
        const errorCount = await errorEl.count();
        if (errorCount > 0) {
          const errorText = (await errorEl.allTextContents()).join(' ');
          if (/couldn.?t find|не удалось найти|no account|нет аккаунта/i.test(errorText)) {
            emailNotFound = true;
          }
        }
      } catch {
        // Selector failed — skip
      }

      if (emailNotFound) {
        const errMsg = 'Аккаунт Google не найден. Проверьте email.';
        await prisma.socialAccount.update({
          where: { id: data.accountId },
          data: { status: 'AUTH_NEEDED', lastError: errMsg },
        });
        emitStatusChange(logger, data.accountId, 'AUTH_NEEDED', errMsg);
        emitLoginEvent(logger, data.accountId, 'login:failed', {
          code: 'INVALID_CREDENTIALS',
          message: errMsg,
        });
        throw new LoginError('INVALID_CREDENTIALS', 'Google account not found');
      }

      // ── Step 2: Enter password ───────────────────────────
      logger.info(`⌨️ Ввожу пароль...`);
      // Google sometimes shows a separate password page, wait for it
      try {
        await page.waitForSelector('input[type="password"]', { timeout: 10000 });
      } catch {
        // Password field didn't appear — might be challenge page already
        logger.warn('⚠️ Поле пароля не появилось — возможно Google показал challenge');
      }

      const pwdField = await page.locator('input[type="password"]').count();
      if (pwdField > 0) {
        await humanType(page, 'input[type="password"]', password);
        await humanClick(page, cursor, '#passwordNext button, button[jsname="LgbsSe"]', { postClickDelay: 3000 });
        await job.updateProgress(50);
        await page.waitForTimeout(3000);
      } else {
        // No password field — early 2FA/challenge already active
        await job.updateProgress(50);
      }

      // ── Step 3: FIRST check for 2FA/challenge BEFORE password errors ──
      // Google's challenge pages can contain text matching "wrong password" regexes
      // in unrelated elements. Check challenge state first.
      const earlyGoogleFA = await detect2FAType(page, ctx.platform);
      if (!earlyGoogleFA.has2FA) {
        // Only check for password errors if NOT on a challenge page
        let hasPasswordError = false;
        try {
          // Google shows wrong password in specific error elements
          const errorEl = page.locator('.o6cuMc, .dEOOab, [jsname="B34EJ"], .Ekjuhf, [class*="error-msg"]');
          const errorCount = await errorEl.count();
          if (errorCount > 0) {
            const errorText = (await errorEl.allTextContents()).join(' ');
            if (/wrong.*password|неверный.*парол|incorrect.*password|парол.*невер/i.test(errorText)) {
              hasPasswordError = true;
            }
          }
        } catch {
          // Selector failed — skip
        }

        if (hasPasswordError) {
          const errMsg = 'Неверный пароль Google. Проверьте учётные данные.';
          await prisma.socialAccount.update({
            where: { id: data.accountId },
            data: { status: 'AUTH_NEEDED', lastError: errMsg },
          });
          emitStatusChange(logger, data.accountId, 'AUTH_NEEDED', errMsg);
          emitLoginEvent(logger, data.accountId, 'login:failed', {
            code: 'INVALID_CREDENTIALS',
            message: errMsg,
          });
          throw new LoginError('INVALID_CREDENTIALS', 'Wrong Google password');
        }

        // Check for account disabled/suspended
        try {
          const suspendEl = page.locator('.o6cuMc, .dEOOab, [jsname="B34EJ"], #headingText, #headingSubtext');
          const suspendCount = await suspendEl.count();
          if (suspendCount > 0) {
            const suspendText = (await suspendEl.allTextContents()).join(' ');
            if (/disabled|отключен|suspended|заблокирован|has been disabled|был отключён/i.test(suspendText)) {
              const errMsg = 'Аккаунт Google отключён или заблокирован.';
              await prisma.socialAccount.update({
                where: { id: data.accountId },
                data: { status: 'BANNED', lastError: errMsg },
              });
              emitStatusChange(logger, data.accountId, 'BANNED', errMsg);
              emitLoginEvent(logger, data.accountId, 'login:failed', {
                code: 'ACCOUNT_BANNED',
                message: errMsg,
              });
              throw new LoginError('ACCOUNT_BANNED', 'Google account disabled');
            }
          }
        } catch (e) {
          if (e instanceof LoginError) throw e;
          // Selector failed — continue
        }
      }
      // If earlyGoogleFA.has2FA === true, skip password errors
      // and let the 2FA handler below deal with it
    }

    // ── 2FA Detection ──────────────────────────────────────
    const twoFA = await detect2FAType(page, ctx.platform);

    if (twoFA.has2FA) {
      logger.warn(`🔒 ${twoFA.hint}`);

      // ── Step 1: TikTok method selection screen ──────────
      // TikTok shows TWO screens:
      //   Screen 1: "Подтвердите, что это действительно вы" with email/phone options + "Далее"
      //   Screen 2: Code input field
      // We must handle Screen 1 first before waiting for code.
      // maskedContact is extracted from Screen 1 BEFORE clicking (it disappears after).
      let maskedContact = '';
      if (ctx.platform === 'TIKTOK') {
        maskedContact = await _handleTikTokMethodSelection(page, cursor, logger);
      } else {
        // YouTube/Google: extract from current page
        try {
          const bodyText = await page.textContent('body') || '';
          const emailMatch = bodyText.match(/[a-zA-Z0-9]\*{2,}[a-zA-Z0-9]@\S+/);
          const phoneMatch = bodyText.match(/\+?\d\*{2,}\d+/);
          maskedContact = emailMatch?.[0] || phoneMatch?.[0] || '';
        } catch { /* ignore */ }
      }

      // Emit 2FA required to frontend
      emitLoginEvent(logger, data.accountId, 'login:2fa_required', {
        type: twoFA.type,
        hint: twoFA.hint,
        platform: ctx.platform,
        maskedContact, // so frontend can show which email/phone
        timeoutSeconds: 600, // 10 minutes
      });

      // ── Step 2: Wait for code with resend support ───────
      // Loop: wait for user input. If resend → click resend in browser, re-wait.
      logger.info(`⏳ Ожидаю код подтверждения (10 мин)...`);
      const codeResult = await _waitForCodeWithResend(
        page, cursor, data.accountId, ctx.platform, logger, 10 * 60 * 1000,
      );

      if (!codeResult) {
        const errMsg = 'Время ожидания кода истекло (10 мин). Повторите попытку входа.';
        await prisma.socialAccount.update({
          where: { id: data.accountId },
          data: { status: 'AUTH_NEEDED', lastError: errMsg },
        });
        emitStatusChange(logger, data.accountId, 'AUTH_NEEDED', errMsg);
        emitLoginEvent(logger, data.accountId, 'login:failed', {
          code: 'TWO_FA_TIMEOUT',
          message: errMsg,
        });
        throw new LoginError('TWO_FA_TIMEOUT', 'User did not provide 2FA code within 10 minutes');
      }

      logger.info(`📱 Код получен, ввожу...`);

      // Enter the code — platform-specific selectors
      if (ctx.platform === 'TIKTOK') {
        const tiktokCodeSelectors = 'input[name="code"], input[autocomplete*="one-time"], input[type="text"], input[type="tel"], input[type="number"]';
        await humanType(page, tiktokCodeSelectors, codeResult);
        await page.waitForTimeout(500);
        try {
          await humanClick(page, cursor, 'button[type="submit"], button:has-text("Verify"), button:has-text("Подтвердить"), button:has-text("Submit"), button:has-text("Отправить")', { postClickDelay: 3000 });
        } catch {
          // Some forms auto-submit
        }
      } else {
        // Google — multiple possible code input selectors
        const googleCodeSelectors = [
          'input[type="tel"]',
          'input[autocomplete="one-time-code"]',
          'input[name="pin"]',
          'input[name="totpPin"]',
          '#totpPin',
          '#knowledge-preregistered-email-response',       // recovery email
          'input[name="knowledgePreregisteredEmailResponse"]',
          '#phoneNumberId',                                 // recovery phone
        ];
        let codeEntered = false;
        for (const sel of googleCodeSelectors) {
          try {
            const count = await page.locator(sel).count();
            if (count > 0) {
              await humanType(page, sel, codeResult);
              codeEntered = true;
              break;
            }
          } catch {
            // continue to next selector
          }
        }
        if (!codeEntered) {
          // Fallback: try any visible input
          logger.warn('⚠️ Не найден стандартный Google input — пробую generic input');
          try { await humanType(page, 'input[type="text"]:visible, input[type="tel"]:visible', codeResult); } catch {}
        }

        await page.waitForTimeout(500);

        // Google "Next" / "Verify" button — multiple possible selectors
        try {
          await humanClick(page, cursor,
            '#idvPreregisteredPhoneNext button, #next button, button[jsname="LgbsSe"], ' +
            'button:has-text("Next"), button:has-text("Далее"), button:has-text("Verify"), ' +
            'button:has-text("Подтвердить"), button:has-text("Continue"), button:has-text("Продолжить")',
            { postClickDelay: 3000 },
          );
        } catch {
          // Auto-submit or no visible button
        }
      }

      await page.waitForTimeout(3000);

      // Check if code was invalid — use scoped selectors (same pattern as password check)
      let codeInvalid = false;
      try {
        if (ctx.platform === 'TIKTOK') {
          const errorEl = page.locator('[class*="error"], [class*="alert"], [class*="toast"]');
          const count = await errorEl.count();
          if (count > 0) {
            const text = (await errorEl.allTextContents()).join(' ');
            if (/wrong.*code|invalid.*code|неверный.*код|incorrect.*code/i.test(text)) codeInvalid = true;
          }
        } else {
          // Google error elements
          const errorEl = page.locator('.o6cuMc, .dEOOab, [jsname="B34EJ"], .Ekjuhf, [class*="error"]');
          const count = await errorEl.count();
          if (count > 0) {
            const text = (await errorEl.allTextContents()).join(' ');
            if (/wrong.*code|invalid|incorrect|неверн|неправильн|try again|попробуйте ещё/i.test(text)) codeInvalid = true;
          }
        }
      } catch {
        // Selector failed — skip
      }

      if (codeInvalid) {
        const errMsg = 'Введён неверный код подтверждения. Повторите попытку входа.';
        await prisma.socialAccount.update({
          where: { id: data.accountId },
          data: { status: 'AUTH_NEEDED', lastError: errMsg },
        });
        emitStatusChange(logger, data.accountId, 'AUTH_NEEDED', errMsg);
        emitLoginEvent(logger, data.accountId, 'login:failed', {
          code: 'TWO_FA_INVALID',
          message: errMsg,
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
      // Timeout waiting for redirect — could be captcha, 2FA, email verification, or other issue
      const currentUrl = page.url();
      const bodyText = await page.textContent('body') || '';
      logger.warn(`⚠️ Не удалось дождаться перенаправления. URL: ${currentUrl}`);

      // ── Check for email/SMS verification (late detection) ──
      // Both TikTok and Google can show verification after password entry
      const isVerificationPage = /verify|verification|challenge|interstitial/i.test(currentUrl)
        || /accounts\.google\.com\/(signin\/(challenge|v2\/challenge)|CheckCookie)/i.test(currentUrl)
        || /verify.*email|send.*code|verification.*code|подтвер|отправ.*код|check.*email|проверь.*почт|enter.*code|введите.*код/i.test(bodyText);

      const platformLabel = ctx.platform === 'TIKTOK' ? 'TikTok' : 'Google';

      if (isVerificationPage) {
        // Re-run 2FA detection — the page might now have a code input
        const lateFA = await detect2FAType(page, ctx.platform);
        if (lateFA.has2FA) {
          logger.warn(`🔒 Обнаружена верификация (после redirect timeout): ${lateFA.hint}`);
          emitLoginEvent(logger, data.accountId, 'login:2fa_required', {
            type: lateFA.type,
            hint: lateFA.hint,
            platform: ctx.platform,
            timeoutSeconds: 600,
          });

          const code = await waitForVerificationCode(data.accountId, 10 * 60 * 1000);
          if (!code) {
            const errMsg = `${platformLabel} требует подтверждение. Время ожидания кода истекло (10 мин).`;
            await prisma.socialAccount.update({
              where: { id: data.accountId },
              data: { status: 'AUTH_NEEDED', lastError: errMsg },
            });
            emitStatusChange(logger, data.accountId, 'AUTH_NEEDED', errMsg);
            emitLoginEvent(logger, data.accountId, 'login:failed', {
              code: 'TWO_FA_TIMEOUT',
              message: errMsg,
            });
            throw new LoginError('TWO_FA_TIMEOUT', 'Late verification timeout');
          }

          // Enter the code — platform-specific selectors
          logger.info(`📱 Код получен, ввожу...`);
          if (ctx.platform === 'TIKTOK') {
            const codeSelector = 'input[name="code"], input[autocomplete*="one-time"], input[type="text"], input[type="tel"]';
            try {
              await humanType(page, codeSelector, code);
              await page.waitForTimeout(500);
              await humanClick(page, cursor, 'button[type="submit"], button:has-text("Verify"), button:has-text("Подтвердить"), button:has-text("Next"), button:has-text("Далее")', { postClickDelay: 3000 });
            } catch {
              // Auto-submit or no submit button
            }
          } else {
            // Google — try multiple selectors
            const googleSelectors = [
              'input[type="tel"]', 'input[autocomplete="one-time-code"]',
              'input[name="pin"]', 'input[name="totpPin"]', '#totpPin',
              '#knowledge-preregistered-email-response', '#phoneNumberId',
            ];
            let entered = false;
            for (const sel of googleSelectors) {
              try {
                if (await page.locator(sel).count() > 0) {
                  await humanType(page, sel, code);
                  entered = true;
                  break;
                }
              } catch {}
            }
            if (!entered) {
              try { await humanType(page, 'input[type="text"]:visible, input[type="tel"]:visible', code); } catch {}
            }
            await page.waitForTimeout(500);
            try {
              await humanClick(page, cursor,
                '#idvPreregisteredPhoneNext button, #next button, button[jsname="LgbsSe"], ' +
                'button:has-text("Next"), button:has-text("Далее"), button:has-text("Verify"), button:has-text("Подтвердить")',
                { postClickDelay: 3000 },
              );
            } catch {}
          }

          // Wait for successful redirect after code entry
          try {
            await page.waitForURL(
              ctx.platform === 'TIKTOK'
                ? /tiktok\.com\/(foryou|@|en|ru|.*\/feed)/
                : /youtube\.com\/(?:feed|watch|@|channel|c)|myaccount\.google\.com/,
              { timeout: 15_000 },
            );
            // Success! Fall through to cookie extraction below.
          } catch {
            const errMsg = 'Код введён, но вход не завершился. Попробуйте снова.';
            await prisma.socialAccount.update({
              where: { id: data.accountId },
              data: { status: 'AUTH_NEEDED', lastError: errMsg },
            });
            emitStatusChange(logger, data.accountId, 'AUTH_NEEDED', errMsg);
            throw new LoginError('TWO_FA_INVALID', errMsg);
          }
        } else {
          // Verification page detected but no code input — inform user
          const errMsg = `${platformLabel} запросил подтверждение входа. Зайдите в аккаунт вручную, подтвердите, затем повторите.`;
          await prisma.socialAccount.update({
            where: { id: data.accountId },
            data: { status: 'AUTH_NEEDED', lastError: errMsg },
          });
          emitStatusChange(logger, data.accountId, 'AUTH_NEEDED', errMsg);
          emitLoginEvent(logger, data.accountId, 'login:failed', {
            code: 'TWO_FA_TIMEOUT',
            message: errMsg,
          });
          throw new LoginError('TWO_FA_TIMEOUT', 'Verification required but no code input found');
        }
      }
      // ── Not verification — check other failure modes ──
      else if (/captcha|verify.*human/i.test(bodyText)) {
        const errMsg = 'Платформа показала капчу, которую не удалось решить автоматически.';
        emitLoginEvent(logger, data.accountId, 'login:failed', {
          code: 'CAPTCHA_FAILED',
          message: errMsg,
        });
        await prisma.socialAccount.update({ where: { id: data.accountId }, data: { status: 'AUTH_NEEDED', lastError: errMsg } });
        emitStatusChange(logger, data.accountId, 'AUTH_NEEDED', errMsg);
        throw new LoginError('CAPTCHA_FAILED', 'Captcha not resolved');
      }
      else if (/suspended|заблокирован|disabled/i.test(bodyText)) {
        const errMsg = 'Аккаунт приостановлен платформой.';
        emitLoginEvent(logger, data.accountId, 'login:failed', {
          code: 'ACCOUNT_SUSPENDED',
          message: errMsg,
        });
        await prisma.socialAccount.update({ where: { id: data.accountId }, data: { status: 'BANNED', lastError: errMsg } });
        emitStatusChange(logger, data.accountId, 'BANNED', errMsg);
        throw new LoginError('ACCOUNT_SUSPENDED', 'Account suspended');
      }
      else {
        const errMsg = `Вход не завершился. Страница: ${currentUrl}. Попробуйте снова или войдите вручную.`;
        emitLoginEvent(logger, data.accountId, 'login:failed', {
          code: 'UNKNOWN_ERROR',
          message: errMsg,
        });
        await prisma.socialAccount.update({ where: { id: data.accountId }, data: { status: 'AUTH_NEEDED', lastError: errMsg } });
        emitStatusChange(logger, data.accountId, 'AUTH_NEEDED', errMsg);
        throw new LoginError('UNKNOWN_ERROR', `Login flow stuck at ${currentUrl}`);
      }
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
        lastError: null,
        ...(extractedUsername ? { username: extractedUsername } : {}),
      },
    });
    emitStatusChange(logger, data.accountId, 'ALIVE', null);

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

      // Translate internal error to user-friendly message
      let userMessage = message;
      if (/setLocaleOverride|Protocol error/i.test(msg)) {
        userMessage = 'Внутренняя ошибка браузера. Попробуйте повторить вход.';
      } else if (/timeout|Timeout/i.test(msg)) {
        userMessage = 'Превышено время ожидания. Проверьте прокси и попробуйте снова.';
      } else if (/captcha|CAPTCHA/i.test(msg)) {
        userMessage = 'TikTok запросил капчу. Попробуйте позже или используйте другой прокси.';
      }

      await prisma.socialAccount.update({
        where: { id: data.accountId },
        data: { status: 'AUTH_NEEDED', lastError: userMessage },
      }).catch(() => {});

      emitStatusChange(logger, data.accountId, 'AUTH_NEEDED', userMessage);
      emitLoginEvent(logger, data.accountId, 'login:failed', { code, message });
    }

    throw err;
  } finally {
    await closeBrowser(browser);
    logger.disconnect();
  }
}

// ── TikTok method selection handler ─────────────────────────
/**
 * Handle TikTok's two-screen verification flow.
 * Screen 1: "Подтвердите, что это действительно вы" — email/phone options + "Далее" button
 * Screen 2: Code input field
 *
 * This function:
 * 1. Dumps the DOM for diagnostics
 * 2. Extracts the masked email/phone from the page text
 * 3. Clicks the email/phone option row
 * 4. Clicks "Далее" to trigger code delivery
 *
 * @returns The masked contact string (e.g. "x***r@mail.com")
 */
async function _handleTikTokMethodSelection(
  page: any,
  cursor: any,
  logger: SocketLogger,
): Promise<string> {
  let maskedContact = '';

  try {
    // ── Phase 0: Check if we're already on the code input screen ──
    // Try a wider set of input selectors (TikTok changes these)
    const codeInputCount = await page.locator(
      'input[name="code"], input[autocomplete*="one-time"], input[type="tel"][maxlength], input[type="number"][maxlength]'
    ).count();
    if (codeInputCount > 0) {
      logger.info('Экран ввода кода уже отображается — пропускаю выбор метода');
      return '';
    }

    // ── Phase 1: DOM snapshot for diagnostics ──
    // Log the page content so we can debug selector failures
    try {
      const pageUrl = page.url();
      logger.info(`📍 URL верификации: ${pageUrl}`);

      // Get all visible text on the page (not HTML, just text)
      const bodyText = await page.textContent('body') || '';
      // Log first 500 chars for debugging (avoid flooding logs)
      const snippet = bodyText.replace(/\s+/g, ' ').trim().slice(0, 500);
      logger.info(`📄 Текст страницы: ${snippet}`);

      // Get a compact representation of interactive elements
      const interactiveHTML = await page.evaluate(() => {
        const els: string[] = [];
        // All buttons
        document.querySelectorAll('button').forEach((btn, i) => {
          const txt = (btn as HTMLElement).innerText?.trim().slice(0, 80) || '';
          const cls = btn.className?.slice(0, 40) || '';
          const type = btn.getAttribute('type') || '';
          els.push(`BTN[${i}] text="${txt}" class="${cls}" type="${type}"`);
        });
        // All inputs
        document.querySelectorAll('input').forEach((inp, i) => {
          const name = inp.getAttribute('name') || '';
          const type = inp.getAttribute('type') || '';
          const ph = inp.getAttribute('placeholder') || '';
          const ac = inp.getAttribute('autocomplete') || '';
          els.push(`INPUT[${i}] name="${name}" type="${type}" placeholder="${ph}" autocomplete="${ac}"`);
        });
        // All links
        document.querySelectorAll('a').forEach((a, i) => {
          const txt = (a as HTMLElement).innerText?.trim().slice(0, 60) || '';
          const href = a.getAttribute('href')?.slice(0, 60) || '';
          els.push(`A[${i}] text="${txt}" href="${href}"`);
        });
        // All divs/spans with click handlers or role attributes
        document.querySelectorAll('[role="radio"], [role="option"], [role="button"], [data-e2e]').forEach((el, i) => {
          const tag = el.tagName;
          const role = el.getAttribute('role') || '';
          const de = el.getAttribute('data-e2e') || '';
          const txt = (el as HTMLElement).innerText?.trim().slice(0, 60) || '';
          els.push(`ROLE[${i}] <${tag}> role="${role}" data-e2e="${de}" text="${txt}"`);
        });
        return els.join('\n');
      });
      logger.info(`🔍 Интерактивные элементы:\n${interactiveHTML}`);
    } catch (e) {
      logger.warn(`⚠️ Не удалось снять DOM-дамп: ${e instanceof Error ? e.message : e}`);
    }

    // ── Phase 2: Extract masked contact from page ──
    try {
      const bodyText = await page.textContent('body') || '';
      // Pattern: letter(s) + asterisks + letter(s) + @ + domain
      // e.g. x***r@reevalmail.com, te***@gmail.com
      const emailMatch = bodyText.match(/[a-zA-Z0-9][a-zA-Z0-9*]*\*{2,}[a-zA-Z0-9*]*[a-zA-Z0-9]?@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      // Pattern: +7***123, or ***1234
      const phoneMatch = bodyText.match(/\+?\d[\d*]{3,}\d{2,}/);
      maskedContact = emailMatch?.[0] || phoneMatch?.[0] || '';
      if (maskedContact) {
        logger.info(`📧 Найден контакт: ${maskedContact}`);
      }
    } catch { /* ignore */ }

    // ── Phase 3: Click the email/phone option row ──
    // TikTok uses dynamic class names, so we CANNOT rely on CSS classes.
    // Strategy: find any clickable element that contains the "@" pattern (masked email)
    // or phone pattern, then click it.
    let methodSelected = false;

    // Strategy A: Click the element containing the masked email text
    if (maskedContact && maskedContact.includes('@')) {
      try {
        // Find any element whose text contains the masked email
        const emailEl = page.locator(`text=${maskedContact}`).first();
        if (await emailEl.count() > 0) {
          await emailEl.click();
          methodSelected = true;
          logger.info('✅ Клик по строке с email');
        }
      } catch { /* continue */ }
    }

    // Strategy B: Find element with text matching *@*.* pattern
    if (!methodSelected) {
      try {
        // Use evaluate to find and click the element containing masked email
        const clicked = await page.evaluate(() => {
          // Find all elements with text that looks like a masked email
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          let node: Text | null;
          while ((node = walker.nextNode() as Text | null)) {
            const text = node.textContent || '';
            if (/[a-zA-Z0-9]\*{2,}.*@/.test(text)) {
              // Found the text node — click its parent element
              let el: HTMLElement | null = node.parentElement;
              // Walk up to find a reasonably-sized clickable container
              for (let i = 0; i < 5 && el; i++) {
                const rect = el.getBoundingClientRect();
                if (rect.height > 30 && rect.height < 200) {
                  el.click();
                  return `clicked: ${el.tagName}.${el.className?.slice(0, 30)} h=${rect.height}`;
                }
                el = el.parentElement;
              }
            }
          }
          return null;
        });
        if (clicked) {
          methodSelected = true;
          logger.info(`✅ Клик по элементу с email (evaluate): ${clicked}`);
        }
      } catch (e) {
        logger.warn(`Evaluate click failed: ${e instanceof Error ? e.message : e}`);
      }
    }

    // Strategy C: Use role-based selectors
    if (!methodSelected) {
      const roleSelectors = [
        '[role="radio"]',
        '[role="option"]',
        '[role="button"][data-e2e]',
      ];
      for (const sel of roleSelectors) {
        try {
          const els = page.locator(sel);
          const count = await els.count();
          if (count > 0) {
            // Click the first one (usually email option)
            await els.first().click();
            methodSelected = true;
            logger.info(`✅ Клик по ${sel} (count=${count})`);
            break;
          }
        } catch { continue; }
      }
    }

    if (!methodSelected) {
      logger.warn('⚠️ Не удалось найти строку выбора метода — попробую нажать Далее напрямую');
    }

    // Wait after selecting method
    await page.waitForTimeout(1000);

    // ── Phase 4: Click "Далее" / "Next" button ──
    // Use page.evaluate to find the button by text content (most robust)
    let nextClicked = false;

    try {
      const btnResult = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const targets = ['далее', 'next', 'send code', 'отправить код', 'continue', 'продолжить', 'submit', 'отправить'];
        for (const btn of buttons) {
          const text = (btn as HTMLElement).innerText?.trim().toLowerCase() || '';
          if (targets.some(t => text.includes(t))) {
            // Check if button is visible and enabled
            const rect = btn.getBoundingClientRect();
            if (rect.height > 0 && !btn.disabled) {
              (btn as HTMLElement).click();
              return `clicked: "${text}" tag=${btn.tagName}`;
            }
          }
        }
        return null;
      });
      if (btnResult) {
        nextClicked = true;
        logger.info(`✅ Кнопка: ${btnResult}`);
      }
    } catch (e) {
      logger.warn(`Evaluate button click failed: ${e instanceof Error ? e.message : e}`);
    }

    // Fallback: Playwright text selectors
    if (!nextClicked) {
      const textBtns = ['Далее', 'Next', 'Send code', 'Отправить код', 'Continue', 'Продолжить'];
      for (const text of textBtns) {
        try {
          const btn = page.locator(`button:has-text("${text}")`).first();
          if (await btn.count() > 0 && await btn.isEnabled()) {
            await btn.click();
            nextClicked = true;
            logger.info(`✅ Кнопка (fallback): "${text}"`);
            break;
          }
        } catch { continue; }
      }
    }

    // Last resort: click any submit button
    if (!nextClicked) {
      try {
        const submit = page.locator('button[type="submit"]').first();
        if (await submit.count() > 0) {
          await submit.click();
          nextClicked = true;
          logger.info('✅ Кнопка: submit (last resort)');
        }
      } catch { /* nothing */ }
    }

    if (!nextClicked) {
      logger.warn('⚠️ Кнопка "Далее" НЕ найдена — код может не отправиться!');
    } else {
      // Wait for code entry screen to load
      logger.info('⏳ Ожидаю экран ввода кода...');
      await page.waitForTimeout(3000);

      // Log the new page state
      try {
        const newUrl = page.url();
        const newText = ((await page.textContent('body')) || '').replace(/\s+/g, ' ').trim().slice(0, 300);
        logger.info(`📍 Новый URL: ${newUrl}`);
        logger.info(`📄 Текст: ${newText}`);
      } catch { /* ignore */ }
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`⚠️ Ошибка при выборе метода подтверждения: ${msg}`);
    // Don't throw — continue to code waiting
  }

  return maskedContact;
}

// ── Wait for code with resend support ───────────────────────
/**
 * Wait for verification code from user, supporting resend requests.
 * If user clicks "Resend" in frontend, worker clicks resend in browser
 * and continues waiting for a new code.
 *
 * @returns The verification code string, or null if timeout
 */
async function _waitForCodeWithResend(
  page: any,
  cursor: any,
  accountId: string,
  platform: 'TIKTOK' | 'YOUTUBE',
  logger: SocketLogger,
  totalTimeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + totalTimeoutMs;

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;

    const result = await waitForVerificationResult(accountId, remaining);

    if (result.type === 'timeout') {
      return null;
    }

    if (result.type === 'code') {
      return result.code;
    }

    // result.type === 'resend'
    logger.info('🔄 Пользователь запросил повторную отправку кода...');

    try {
      await _clickResendButton(page, cursor, platform, logger);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(`⚠️ Не удалось нажать кнопку повторной отправки: ${msg}`);
    }

    // Continue loop — wait for next code
    logger.info('⏳ Ожидаю новый код...');
  }
}

/**
 * Click the "Resend code" button in the browser.
 * Uses page.evaluate to find elements by text content (robust against dynamic classes).
 */
async function _clickResendButton(
  page: any,
  cursor: any,
  platform: 'TIKTOK' | 'YOUTUBE',
  logger: SocketLogger,
): Promise<void> {
  // First try: page.evaluate to find and click by text content
  try {
    const resendTargets = platform === 'TIKTOK'
      ? ['resend', 'отправить повторно', 'повторно', 'send again', 'не получили', 'отправить снова', 'получить код']
      : ['resend', 'try another way', 'другой способ', 'повтор', 'отправить снова'];

    const result = await page.evaluate((targets: string[]) => {
      // Check buttons and links
      const elements = Array.from(document.querySelectorAll('button, a, span[role="button"], div[role="button"]'));
      for (const el of elements) {
        const text = (el as HTMLElement).innerText?.trim().toLowerCase() || '';
        if (targets.some(t => text.includes(t))) {
          const rect = (el as HTMLElement).getBoundingClientRect();
          if (rect.height > 0) {
            (el as HTMLElement).click();
            return `clicked: "${text}" <${el.tagName}>`;
          }
        }
      }
      return null;
    }, resendTargets);

    if (result) {
      logger.info(`🔄 ${result}`);
      await page.waitForTimeout(2000);
      return;
    }
  } catch { /* continue to fallback */ }

  // Fallback: Playwright text selectors
  const resendTexts = platform === 'TIKTOK'
    ? ['Resend', 'Отправить повторно', 'Повторно', 'Send again']
    : ['Resend', 'Try another way', 'Другой способ'];

  for (const text of resendTexts) {
    try {
      const el = page.locator(`button:has-text("${text}"), a:has-text("${text}")`).first();
      if (await el.count() > 0) {
        await el.click();
        logger.info(`🔄 Клик по "${text}" (fallback)`);
        await page.waitForTimeout(2000);
        return;
      }
    } catch { continue; }
  }

  logger.warn('⚠️ Кнопка повторной отправки не найдена на странице');
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

/** Emit account status change for real-time frontend updates */
function emitStatusChange(
  logger: SocketLogger,
  accountId: string,
  status: string,
  lastError?: string | null,
): void {
  const socket = (logger as any).socket;
  if (socket) {
    socket.emit('account:status_changed', { accountId, status, lastError: lastError ?? undefined });
  }
}
