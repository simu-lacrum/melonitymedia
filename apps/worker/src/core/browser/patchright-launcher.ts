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
import { applyFingerprint, inspectFingerprintConsistency, getSystemChromeMajor, type AccountFingerprint } from './fingerprint-manager.js';
import { prisma } from '../../lib/prisma.js';
import crypto from 'crypto';
import { spawn, type ChildProcess } from 'child_process';
import net from 'net';
import fs from 'fs';

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
  vncPort?: number;
  vncUrl?: string;
}

async function getFreePortAndDisplay(): Promise<{ display: number; vncPort: number; webPort: number }> {
  for (let webPort = 6000; webPort <= 6020; webPort++) {
    try {
      // Check if webPort is free
      await new Promise<void>((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(webPort, () => server.close(() => resolve()));
      });

      const display = webPort - 5900; // e.g. webPort 6005 -> display 105
      const vncPortCandidate = webPort - 100; // e.g. 5905
      
      // Check if vncPortCandidate is free
      await new Promise<void>((resolve, reject) => {
        const server = net.createServer();
        server.unref();
        server.on('error', reject);
        server.listen(vncPortCandidate, () => server.close(() => resolve()));
      });

      // Check if display lock exists
      if (fs.existsSync(`/tmp/.X11-unix/X${display}`) || fs.existsSync(`/tmp/.X${display}-lock`)) {
        continue;
      }

      return { display, vncPort: vncPortCandidate, webPort };
    } catch (e) {
      continue;
    }
  }
  throw new Error('No free ports/displays available for VNC');
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
  '--autoplay-policy=no-user-gesture-required',
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

  // Soft validation: fatal issues block, stale issues warn and continue
  const issues = inspectFingerprintConsistency(fingerprint, getSystemChromeMajor());
  const fatal = issues.filter(i => i.severity === "fatal");
  const stale = issues.filter(i => i.severity === "stale");

  if (fatal.length > 0) {
    throw new Error(
      `[Patchright] Cannot launch — fingerprint has fatal issues: ` +
      fatal.map(i => `${i.rule}: ${i.message}`).join("; ")
    );
  }

  if (stale.length > 0) {
    console.warn(
      `[Patchright] Fingerprint stale for account ${opts.accountId}: ` +
      stale.map(i => i.message).join("; ") +
      ` — launching anyway; mark for regeneration on safe occasion.`
    );
  }
  // Build proxy config for Patchright — parse URL to separate server from auth
  // Playwright prefers { server, username, password } over credentials-in-URL
  let proxyConfig: { server: string; username?: string; password?: string } | undefined;
  if (opts.proxyUrl) {
    try {
      const url = new URL(opts.proxyUrl);
      const serverOnly = `${url.protocol}//${url.hostname}:${url.port}`;
      proxyConfig = {
        server: serverOnly,
        ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
        ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
      };
      console.log(`[Patchright] Using proxy: ${url.protocol}//${url.hostname}:${url.port} for account ${opts.accountId}`);
      console.log(`[Patchright] Proxy config: server=${proxyConfig.server} user=${proxyConfig.username ? '***' : 'none'} pass=${proxyConfig.password ? '***' : 'none'}`);
    } catch {
      // Fallback: pass as-is if URL parsing fails
      proxyConfig = { server: opts.proxyUrl };
      console.log(`[Patchright] Using proxy (raw) for account ${opts.accountId}`);
    }
  } else {
    console.log(`[Patchright] ⚠️ No proxy configured for account ${opts.accountId} — using direct connection`);
  }


  // Trigger rotation if proxy is configured for per-session mode
  if (opts.proxyUrl) {
    try {
      const url = new URL(opts.proxyUrl);
      const host = url.hostname;
      const port = parseInt(url.port || '80', 10);
      // H-7 FIX: Scope proxy lookup by account's userId to prevent cross-tenant access
      const account = await prisma.socialAccount.findUnique({
        where: { id: opts.accountId },
        select: { userId: true },
      });
      const proxy = await prisma.proxy.findFirst({
        where: { host, port, userId: account?.userId },
      });
      if (proxy?.rotationMode === 'PER_SESSION') {
        const { rotateProxy } = await import('../proxy/rotation-client.js');
        let apiKey: string | null = null;
        if (proxy.providerApiKey && proxy.providerApiKeyIv && proxy.providerApiKeyTag && process.env.MASTER_KEY) {
          try {
            const masterKey = Buffer.from(process.env.MASTER_KEY, 'base64');
            const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, proxy.providerApiKeyIv);
            decipher.setAuthTag(proxy.providerApiKeyTag);
            const enc = Buffer.from(proxy.providerApiKey, 'base64');
            apiKey = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
          } catch (e) {
            console.error('[Patchright] Failed to decrypt API key', e);
          }
        }
        const r = await rotateProxy({
          provider: proxy.provider as any,
          externalId: proxy.providerExternalId,
          apiKey,
          rotationLink: proxy.rotationLink,
        });
        if (r.ok) {
          await prisma.proxy.update({ where: { id: proxy.id }, data: { lastRotatedAt: new Date() } });
          console.log(`[patchright-launcher] rotation triggered, new IP: ${r.newIp || 'unknown'}`);
          // give the modem 5s to settle on new IP
          await new Promise(res => setTimeout(res, 5000));
        } else {
          console.warn(`[patchright-launcher] per-session rotation failed: ${r.error}`);
        }
      }
    } catch (e) {
      console.warn(`[Patchright] Error processing per-session rotation:`, e);
    }
  }

  // Setup dynamic GUI (Xvfb + VNC)
  let displayConfig: { display: number; vncPort: number; webPort: number } | null = null;
  const guiProcesses: ChildProcess[] = [];
  try {
    displayConfig = await getFreePortAndDisplay();
    console.log(`[Patchright] Allocated Display :${displayConfig.display}, VNC port ${displayConfig.vncPort}, noVNC web port ${displayConfig.webPort}`);
    
    // Start Xvfb
    const xvfb = spawn('Xvfb', [`:${displayConfig.display}`, '-screen', '0', '1920x1080x24', '-ac'], { stdio: 'ignore' });
    guiProcesses.push(xvfb);
    await new Promise(r => setTimeout(r, 1000)); // wait for Xvfb to init

    // Start fluxbox
    const fluxbox = spawn('fluxbox', ['-display', `:${displayConfig.display}`], { stdio: 'ignore' });
    guiProcesses.push(fluxbox);

    // Start x11vnc
    const x11vncArgs = ['-display', `:${displayConfig.display}`, '-forever', '-shared', '-bg', '-rfbport', displayConfig.vncPort.toString()];
    if (fs.existsSync(process.env.HOME + '/.vnc/passwd')) {
      x11vncArgs.push('-rfbauth', process.env.HOME + '/.vnc/passwd');
    } else {
      x11vncArgs.push('-nopw');
    }
    const x11vnc = spawn('x11vnc', x11vncArgs, { stdio: 'ignore' });
    guiProcesses.push(x11vnc);

    // Start websockify
    const websockify = spawn('websockify', ['--web', '/usr/share/novnc', displayConfig.webPort.toString(), `localhost:${displayConfig.vncPort}`], { stdio: 'ignore' });
    guiProcesses.push(websockify);

  } catch (e) {
    console.warn(`[Patchright] Failed to start dynamic GUI:`, e);
    // Cleanup if partially started
    for (const p of guiProcesses) p.kill();
    displayConfig = null;
  }

  const env = { ...process.env };
  if (displayConfig) {
    env.DISPLAY = `:${displayConfig.display}`;
  }

  const browser = await chromium.launch({
    channel: 'chrome',        // CRITICAL: use system Chrome, not bundled Chromium
    headless: false,           // CRITICAL: TikTok detects headless even patched
    env,
    args: [
      ...STEALTH_ARGS,
      `--user-agent=${fingerprint.userAgent}`,
    ],
    proxy: proxyConfig,
  });

  // Cleanup GUI processes when browser closes
  browser.on('disconnected', () => {
    console.log(`[Patchright] Browser disconnected, cleaning up GUI processes for display :${displayConfig?.display}`);
    for (const p of guiProcesses) {
      try { p.kill(); } catch (e) {}
    }
  });

  const isMobileDevice = fingerprint.deviceClass === 'mobile';

  const context = await browser.newContext({
    viewport: fingerprint.viewport,
    locale: fingerprint.locale,
    timezoneId: fingerprint.timezone,
    userAgent: fingerprint.userAgent,
    deviceScaleFactor: fingerprint.devicePixelRatio ?? 1,
    isMobile: isMobileDevice,
    hasTouch: fingerprint.maxTouchPoints > 0,
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

  return { 
    browser, 
    context, 
    page,
    vncPort: displayConfig?.webPort,
    vncUrl: displayConfig ? `http://cluster-cheats.shop:${displayConfig.webPort}/vnc.html` : undefined
  };
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
