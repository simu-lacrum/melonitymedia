// ─────────────────────────────────────────────────────────────
// BrowserAutomation — Core Puppeteer Wrapper
//
// This is the beating heart of the worker. It handles:
// 1. Proxy rotation (mobile modems: GET link → wait 12s)
// 2. Proxy auth via dynamic Chrome extension (Manifest V2)
// 3. Stealth mode (puppeteer-extra-plugin-stealth)
// 4. DOM parsing via cheerio (no extra browser overhead)
// 5. Clean browser shutdown (no zombie processes)
//
// Anti-fraud strategy:
// - headless:false inside Xvfb = undetectable by platforms
// - Stealth plugin patches navigator, webdriver, plugins
// - Real Chrome (not Chromium) for genuine fingerprint
// - Random viewport + timezone matching proxy geo
// ─────────────────────────────────────────────────────────────

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { type Browser, type Page } from 'puppeteer-extra/dist/puppeteer';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Apply stealth patches — must be done before launch
puppeteer.use(StealthPlugin());

// ── Constants ───────────────────────────────────────────────

// Time to wait after triggering mobile proxy IP rotation (ms)
// Why 12s? Physical modem restart takes 8-15s on most carriers.
// 12s is a safe middle ground based on real-world testing.
const PROXY_ROTATION_DELAY_MS = 12_000;

// Chrome launch arguments optimized for automation + stealth
const CHROME_ARGS = [
  '--no-sandbox',                     // Required in Docker
  '--disable-setuid-sandbox',         // Required in Docker
  '--disable-dev-shm-usage',          // Prevent /dev/shm issues in Docker
  '--disable-gpu',                    // GPU not available in Xvfb
  '--disable-blink-features=AutomationControlled', // Hide automation flag
  '--disable-infobars',               // No "Chrome is controlled" bar
  '--window-size=412,915',            // Mobile viewport (Galaxy S21)
  '--no-first-run',
  '--no-default-browser-check',
];

// ── Types ───────────────────────────────────────────────────

interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  isRotating?: boolean;
  rotationLink?: string;
}

interface BrowserAutomationOptions {
  proxy?: ProxyConfig;
  userAgent?: string;
  headless?: boolean;
  timeout?: number;
}

// ── BrowserAutomation Class ─────────────────────────────────

export class BrowserAutomation {
  private browser: Browser | null = null;
  private proxy?: ProxyConfig;
  private tempExtDir?: string;

  constructor(private options: BrowserAutomationOptions = {}) {
    this.proxy = options.proxy;
  }

  /**
   * Rotate mobile proxy IP by calling the modem's API.
   * The modem physically disconnects and reconnects to the cell tower,
   * getting a new IP from the carrier's DHCP pool.
   */
  private async _rotateMobileProxyIP(): Promise<void> {
    if (!this.proxy?.isRotating || !this.proxy.rotationLink) return;

    console.log('[Browser] Rotating mobile proxy IP...');

    try {
      const response = await fetch(this.proxy.rotationLink);
      if (!response.ok) {
        console.warn(`[Browser] Rotation link returned ${response.status}`);
      }
    } catch (err) {
      console.warn('[Browser] Rotation request failed:', err);
      // Don't throw — rotation failure shouldn't block the entire job
    }

    // Wait for modem to restart and get new IP
    console.log(`[Browser] Waiting ${PROXY_ROTATION_DELAY_MS / 1000}s for modem restart...`);
    await new Promise(resolve => setTimeout(resolve, PROXY_ROTATION_DELAY_MS));
  }

  /**
   * Create a temporary Chrome extension for proxy authentication.
   * Why an extension? Chrome's `--proxy-server` flag doesn't support
   * username:password auth. The only way to inject credentials is
   * via a Manifest V2 extension using webRequest.onAuthRequired.
   */
  private _createProxyExtension(): string {
    if (!this.proxy?.username || !this.proxy?.password) {
      throw new Error('Proxy credentials required for extension auth');
    }

    // Create temp directory for the extension files
    const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-ext-'));

    // Manifest V2 (V3 doesn't support webRequest.onAuthRequired blocking)
    const manifest = {
      version: '1.0.0',
      manifest_version: 2,
      name: 'Proxy Auth',
      permissions: ['proxy', 'tabs', 'unlimitedStorage', 'storage',
        '<all_urls>', 'webRequest', 'webRequestBlocking'],
      background: { scripts: ['background.js'] },
    };

    // Background script: intercept auth challenges and inject credentials
    const background = `
      var config = {
        mode: "fixed_servers",
        rules: {
          singleProxy: {
            scheme: "http",
            host: "${this.proxy.host}",
            port: parseInt("${this.proxy.port}")
          },
          bypassList: ["localhost"]
        }
      };

      chrome.proxy.settings.set({value: config, scope: "regular"}, function(){});

      function callbackFn(details) {
        return {
          authCredentials: {
            username: "${this.proxy.username}",
            password: "${this.proxy.password}"
          }
        };
      }

      chrome.webRequest.onAuthRequired.addListener(
        callbackFn,
        {urls: ["<all_urls>"]},
        ["blocking"]
      );
    `;

    fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(extDir, 'background.js'), background);

    this.tempExtDir = extDir;
    return extDir;
  }

  /**
   * Initialize the browser with all stealth + proxy settings.
   * Returns a fresh Page ready for automation.
   */
  async initDriver(): Promise<Page> {
    // Step 1: Rotate proxy IP if using mobile modem
    await this._rotateMobileProxyIP();

    // Step 2: Build launch arguments
    const args = [...CHROME_ARGS];

    if (this.proxy) {
      if (this.proxy.username && this.proxy.password) {
        // Use extension-based auth for proxies with credentials
        const extDir = this._createProxyExtension();
        args.push(`--disable-extensions-except=${extDir}`);
        args.push(`--load-extension=${extDir}`);
      } else {
        // Simple proxy without auth
        args.push(`--proxy-server=http://${this.proxy.host}:${this.proxy.port}`);
      }
    }

    // Step 3: Launch browser
    // headless:false + Xvfb = real browser behavior, undetectable
    this.browser = await puppeteer.launch({
      headless: this.options.headless ?? false,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args,
      defaultViewport: { width: 412, height: 915, isMobile: true },
      timeout: this.options.timeout || 30_000,
    });

    const page = await this.browser.newPage();

    // Set custom user agent if provided
    if (this.options.userAgent) {
      await page.setUserAgent(this.options.userAgent);
    }

    // Block unnecessary resource types for faster page loads
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const blocked = ['font', 'image', 'stylesheet'];
      // Only block in headless mode; in visual mode we need full rendering
      if (this.options.headless && blocked.includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    return page;
  }

  /**
   * Get a cheerio instance from the current page HTML.
   * Use this for data extraction instead of page.$eval —
   * cheerio is faster and doesn't require the browser context.
   */
  async getSoup(page: Page): Promise<cheerio.CheerioAPI> {
    const html = await page.content();
    return cheerio.load(html);
  }

  /**
   * Close browser and clean up temp files.
   * CRITICAL: Always call this, even on error. Zombie Chrome
   * processes will eat all server RAM.
   */
  async close(): Promise<void> {
    try {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
    } catch (err) {
      console.error('[Browser] Error closing browser:', err);
    }

    // Clean up temp proxy extension directory
    if (this.tempExtDir && fs.existsSync(this.tempExtDir)) {
      try {
        fs.rmSync(this.tempExtDir, { recursive: true, force: true });
      } catch {
        // Non-critical: temp files will be cleaned by OS eventually
      }
    }
  }
}
