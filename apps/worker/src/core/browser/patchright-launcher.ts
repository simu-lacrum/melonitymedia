// ─────────────────────────────────────────────────────────────
// PatchrightLauncher — Stealth browser context for TikTok/YT
//
// Replaces the old BrowserAutomation (Selenium + UC) with
// Patchright — a drop-in Playwright fork that patches CDP
// handshake to avoid detection by Akamai/Datadome/TikTok
// BotManager.
//
// Key differences from old stack:
// 1. Uses system Chrome via channel:'chrome' (not bundled Chromium)
// 2. Native proxy auth (no ZIP extension hack)
// 3. Cookie-only auth (no log:pass on login forms)
// 4. Per-account stable fingerprint applied via CDP
// 5. headless:false always — TikTok detects headless via C++ layer
//
// NEVER import puppeteer, selenium, or undetected-chromedriver here.
// ESLint rule no-restricted-imports will block it.
// ─────────────────────────────────────────────────────────────

import { chromium } from 'patchright';
import type { Browser, BrowserContext, Page } from 'patchright';
import { loadCookiesFromEncryptedStore } from '../auth/cookie-store.js';
import { applyFingerprint, validateFingerprintConsistency, type AccountFingerprint } from './fingerprint-manager.js';

// ── Types ───────────────────────────────────────────────────

export interface LaunchOptions {
  /** Account ID for cookie/fingerprint lookup */
  accountId: string;
  /** Proxy URL: http://user:pass@host:port */
  proxyUrl?: string;
  /** Path to encrypted cookie store */
  cookiesPath: string;
  /** Per-account stable fingerprint */
  fingerprint: AccountFingerprint;
}

export interface StealthContext {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

// ── Default Chrome Args ─────────────────────────────────────

const STEALTH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--no-default-browser-check',
  '--no-first-run',
  '--password-store=basic',
  '--use-mock-keychain',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-infobars',
  '--window-size=1920,1080',
  '--start-maximized',
];

// ── Launcher ────────────────────────────────────────────────

/**
 * Launch a stealth browser context for TikTok/YouTube automation.
 *
 * Flow:
 * 1. Launch system Chrome via Patchright (channel: 'chrome')
 * 2. Create context with per-account fingerprint settings
 * 3. Load encrypted cookies for auth (NO login forms)
 * 4. Apply fingerprint overrides via CDP
 * 5. Return ready-to-use page
 */
export async function launchStealthContext(opts: LaunchOptions): Promise<StealthContext> {
  const { fingerprint } = opts;

  // Validate fingerprint before launching browser — throws on tampered/legacy data
  validateFingerprintConsistency(fingerprint);
  // Build proxy config for Patchright (native auth support, no extension needed)
  const proxyConfig = opts.proxyUrl
    ? { server: opts.proxyUrl }
    : undefined;

  const browser = await chromium.launch({
    channel: 'chrome',        // CRITICAL: use system Chrome, not bundled Chromium
    headless: false,           // CRITICAL: TikTok detects headless even patched
    args: [
      ...STEALTH_ARGS,
      `--user-agent=${fingerprint.userAgent}`,
    ],
    proxy: proxyConfig,
  });

  const context = await browser.newContext({
    viewport: fingerprint.viewport,
    locale: fingerprint.locale,
    timezoneId: fingerprint.timezone,
    userAgent: fingerprint.userAgent,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    // Don't request geolocation — TikTok dislikes this
    geolocation: undefined,
  });

  // Load cookies — the ONLY auth method
  // Never use log:pass on login forms — instant ban signal
  try {
    const cookies = await loadCookiesFromEncryptedStore(
      opts.accountId,
      opts.cookiesPath,
    );
    if (cookies.length > 0) {
      await context.addCookies(cookies);
    }
  } catch (err) {
    console.warn(`[Patchright] Failed to load cookies for ${opts.accountId}:`, err);
    // Continue without cookies — session-validator should have caught this
  }

  const page = await context.newPage();

  // Apply fingerprint overrides via CDP (canvas, WebGL, hardware, etc.)
  await applyFingerprint(page, fingerprint);

  return { browser, context, page };
}

/**
 * Build a proxy URL string from separate components.
 * Returns format: http://user:pass@host:port
 */
export function buildProxyUrl(proxy: {
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
}): string {
  if (proxy.username && proxy.password) {
    return `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
  }
  return `http://${proxy.host}:${proxy.port}`;
}

/**
 * Safely close browser and all pages.
 * CRITICAL: Always call this, even on error.
 * Zombie Chrome processes will eat all server RAM.
 */
export async function closeBrowser(browser: Browser | null): Promise<void> {
  if (!browser) return;
  try {
    await browser.close();
    console.log('[Patchright] Browser closed');
  } catch (err) {
    console.error('[Patchright] Error closing browser:', err);
  }
}
