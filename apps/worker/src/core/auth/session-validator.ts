// ─────────────────────────────────────────────────────────────
// Session Validator — Pre-flight cookie health check
//
// Before launching a browser session (expensive: Chrome + Xvfb),
// we validate cookies via a lightweight HTTP request using
// curl-impersonate (TLS fingerprint impersonation).
//
// This saves ~30s of browser startup time on dead accounts.
// ─────────────────────────────────────────────────────────────

import { impersonatedFetch } from '../tls/curl-impersonate-client.js';
import { loadCookiesFromEncryptedStore, type BrowserCookie } from './cookie-store.js';

export type CookieStatus = 'alive' | 'expired' | 'banned';

/**
 * Validate account cookies without launching a browser.
 * Uses curl-impersonate for TLS-level Chrome impersonation.
 *
 * @returns 'alive' | 'expired' | 'banned'
 */
export async function validateCookies(
  accountId: string,
  fingerprint: { userAgent: string; locale: string },
  platform: 'TIKTOK' | 'YOUTUBE',
  proxyUrl?: string,
  cookiesDir?: string,
): Promise<CookieStatus> {
  const cookies = await loadCookiesFromEncryptedStore(accountId, cookiesDir);

  if (cookies.length === 0) {
    return 'expired';
  }

  const cookieHeader = formatCookieHeader(cookies);

  // Platform-specific validation URL and success check
  const validationUrl = platform === 'TIKTOK'
    ? 'https://www.tiktok.com/api/user/detail/?aid=1988'
    : 'https://www.youtube.com/account';

  const referer = platform === 'TIKTOK'
    ? 'https://www.tiktok.com/'
    : 'https://www.youtube.com/';

  try {
    const resp = await impersonatedFetch({
      url: validationUrl,
      impersonate: 'chrome116',
      cookies: cookieHeader,
      proxy: proxyUrl,
      headers: {
        'User-Agent': fingerprint.userAgent,
        'Accept': 'application/json, text/html',
        'Accept-Language': `${fingerprint.locale},en;q=0.9`,
        'Referer': referer,
      },
      timeoutMs: 15_000,
    });

    if (resp.status === 200) {
      if (platform === 'TIKTOK') {
        try {
          const data = JSON.parse(resp.body);
          if (data.userInfo) return 'alive';
          return 'expired'; // 200 but no user data = anonymous
        } catch {
          return 'expired';
        }
      } else {
        // YouTube: if we get 200 on /account, cookies are valid
        // If redirected to login, cookies expired
        if (resp.body.includes('accounts.google.com/ServiceLogin')) {
          return 'expired';
        }
        return 'alive';
      }
    }

    if (resp.status === 401 || resp.status === 403) {
      if (resp.body.includes('user_banned') || resp.body.includes('account_disabled')) {
        return 'banned';
      }
      return 'expired';
    }

    return 'expired';
  } catch (err) {
    console.warn(`[SessionValidator] Failed to validate cookies for ${accountId}:`, err);
    return 'expired';
  }
}

/**
 * Format cookies array into a Cookie header string.
 */
function formatCookieHeader(cookies: BrowserCookie[]): string {
  return cookies
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
}
