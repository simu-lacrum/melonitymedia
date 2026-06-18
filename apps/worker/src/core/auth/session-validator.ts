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
        // BUG-L8 fix: Also check for empty body (possible redirect that
        // curl-impersonate didn't follow since we don't use -L flag)
        if (resp.body.trim().length === 0) {
          return 'expired';
        }
        return 'alive';
      }
    }

    // BUG-L8 fix: Handle HTTP 302/303 redirects to Google login
    // curl-impersonate without -L flag returns the redirect response
    if (resp.status === 302 || resp.status === 303) {
      const location = resp.headers['location'] ?? '';
      if (location.includes('accounts.google.com') || location.includes('ServiceLogin')) {
        return 'expired';
      }
    }

    if (resp.status === 401 || resp.status === 403) {
      if (resp.body.includes('user_banned') || resp.body.includes('account_disabled')) {
        return 'banned';
      }
      return 'expired';
    }

    // Transient server errors (429, 5xx) — NOT expired, just a hiccup
    if (resp.status === 429 || resp.status >= 500) {
      console.warn(`[SessionValidator] Transient HTTP ${resp.status} for ${accountId} — assuming alive`);
      return 'alive';
    }

    return 'expired';
  } catch (err) {
    // Network errors (proxy timeout, DNS, connection refused) should NOT
    // mark cookies as expired — the problem is connectivity, not auth.
    // Let the real browser session handle auth checking.
    console.warn(`[SessionValidator] Network error for ${accountId} — assuming alive:`, (err as Error).message);
    return 'alive';
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
