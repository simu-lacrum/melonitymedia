// ─────────────────────────────────────────────────────────────
// BrowserAutomation — Undetected ChromeDriver + Selenium Wrapper
//
// Replaces Puppeteer with undetected-chromedriver-js for superior
// anti-detection. Platforms like TikTok and YouTube aggressively
// detect automated browsers — UC patches the ChromeDriver binary
// to remove all Selenium/WebDriver fingerprints.
//
// Key architecture decisions:
// 1. undetected-chromedriver-js handles driver patching automatically
// 2. Proxy injection via Chrome launch args (--proxy-server)
// 3. Proxy auth via background.js extension (Manifest V2)
// 4. Page parsing via cheerio (Node.js equivalent of Python's bs4)
// 5. Mobile proxy IP rotation via HTTP GET to modem API
// 6. Headless mode configurable (default: false for Xvfb)
//
// Python equivalent (for reference):
//   import undetected_chromedriver as uc
//   driver = uc.Chrome(headless=True, use_subprocess=False)
//   driver.get('https://nowsecure.nl')
// ─────────────────────────────────────────────────────────────

import UndetectedChrome from 'undetected-chromedriver-js';
import { WebDriver, By, until } from 'selenium-webdriver';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ── Constants ───────────────────────────────────────────────

// Time to wait after triggering mobile proxy IP rotation (ms)
// Why 12s? Physical modem restart takes 8-15s on most carriers.
// 12s is a safe middle ground based on real-world testing.
const PROXY_ROTATION_DELAY_MS = 12_000;

// Default Chrome arguments for stealth + stability
const DEFAULT_CHROME_ARGS = [
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

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  /** If true, IP will be rotated before each session via rotationLink */
  isRotating?: boolean;
  /** HTTP endpoint that triggers modem IP rotation (e.g., proxys.io API) */
  rotationLink?: string;
}

export interface BrowserAutomationOptions {
  proxy?: ProxyConfig;
  /** Custom user agent string (default: Chrome mobile UA) */
  userAgent?: string;
  /** Run in headless mode. Default false — we use Xvfb for stealth */
  headless?: boolean;
  /** Page load timeout in milliseconds */
  timeout?: number;
}

// ── BrowserAutomation Class ─────────────────────────────────

export class BrowserAutomation {
  private ucInstance: UndetectedChrome | null = null;
  private driver: WebDriver | null = null;
  private proxy?: ProxyConfig;
  private tempExtDir?: string;

  constructor(private options: BrowserAutomationOptions = {}) {
    this.proxy = options.proxy;
  }

  // ── Proxy IP Rotation ────────────────────────────────────

  /**
   * Rotate mobile proxy IP by calling the modem's API.
   * The modem physically disconnects and reconnects to the cell tower,
   * getting a new IP from the carrier's DHCP pool.
   *
   * Flow: GET rotationLink → wait 12s → new IP assigned
   */
  private async _rotateMobileProxyIP(): Promise<void> {
    if (!this.proxy?.isRotating || !this.proxy.rotationLink) return;

    console.log('[UC] Rotating mobile proxy IP...');

    try {
      const response = await fetch(this.proxy.rotationLink);
      if (!response.ok) {
        console.warn(`[UC] Rotation link returned ${response.status}`);
      }
    } catch (err) {
      console.warn('[UC] Rotation request failed:', err);
      // Don't throw — rotation failure shouldn't block the entire job
    }

    // Wait for modem to restart and get new IP
    console.log(`[UC] Waiting ${PROXY_ROTATION_DELAY_MS / 1000}s for modem restart...`);
    await new Promise(resolve => setTimeout(resolve, PROXY_ROTATION_DELAY_MS));
  }

  // ── Proxy Auth Extension ─────────────────────────────────

  /**
   * Create a temporary Chrome extension for proxy authentication.
   *
   * Why an extension? Chrome's `--proxy-server` flag doesn't support
   * username:password auth. The only way to inject credentials is
   * via a Manifest V2 extension using webRequest.onAuthRequired.
   *
   * This is the same technique used by the Python undetected-chromedriver
   * when handling authenticated proxies.
   */
  private _createProxyExtension(): string {
    if (!this.proxy?.username || !this.proxy?.password) {
      throw new Error('Proxy credentials required for extension auth');
    }

    // Create temp directory for the extension files
    const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-proxy-ext-'));

    // Manifest V2 (V3 doesn't support webRequest.onAuthRequired blocking)
    const manifest = {
      version: '1.0.0',
      manifest_version: 2,
      name: 'Proxy Auth Helper',
      permissions: [
        'proxy', 'tabs', 'unlimitedStorage', 'storage',
        '<all_urls>', 'webRequest', 'webRequestBlocking',
      ],
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

  // ── Driver Initialization ────────────────────────────────

  /**
   * Initialize the Undetected ChromeDriver with all settings.
   * Returns the Selenium WebDriver ready for automation.
   *
   * Equivalent Python:
   *   driver = uc.Chrome(headless=True, use_subprocess=False)
   */
  async initDriver(): Promise<WebDriver> {
    // Step 1: Rotate proxy IP if using mobile modem
    await this._rotateMobileProxyIP();

    // Step 2: Build Chrome arguments
    const args = [...DEFAULT_CHROME_ARGS];

    if (this.proxy) {
      if (this.proxy.username && this.proxy.password) {
        // Use extension-based auth for proxies with credentials
        const extDir = this._createProxyExtension();
        args.push(`--disable-extensions-except=${extDir}`);
        args.push(`--load-extension=${extDir}`);
      }
      // Always set the proxy server
      args.push(`--proxy-server=http://${this.proxy.host}:${this.proxy.port}`);
    }

    // Step 3: Build UndetectedChrome instance
    // headless:false + Xvfb = real browser behavior, undetectable
    this.ucInstance = new UndetectedChrome({
      headless: this.options.headless ?? false,
      arguments: args,
    });

    // Step 4: Build the Selenium WebDriver
    const driver = await this.ucInstance.build();
    this.driver = driver;

    // Step 5: Configure timeouts
    const timeout = this.options.timeout || 30_000;
    await driver.manage().setTimeouts({
      implicit: timeout,
      pageLoad: timeout,
      script: timeout,
    });

    console.log('[UC] Browser initialized successfully');
    return driver;
  }

  // ── Navigation Helpers ───────────────────────────────────

  /**
   * Navigate to a URL and wait for the page to load.
   *
   * Equivalent Python:
   *   driver.get('https://example.com')
   */
  async navigateTo(url: string): Promise<void> {
    if (!this.driver) throw new Error('Driver not initialized. Call initDriver() first.');
    console.log(`[UC] Navigating to: ${url}`);
    await this.driver.get(url);
  }

  /**
   * Get a cheerio instance from the current page HTML.
   * cheerio is the Node.js equivalent of Python's BeautifulSoup (bs4).
   *
   * Equivalent Python:
   *   from bs4 import BeautifulSoup
   *   soup = BeautifulSoup(driver.page_source, 'html.parser')
   *
   * Usage:
   *   const $ = await automation.getSoup();
   *   const title = $('h1').text();
   *   const links = $('a').map((i, el) => $(el).attr('href')).get();
   */
  async getSoup(): Promise<cheerio.CheerioAPI> {
    if (!this.driver) throw new Error('Driver not initialized. Call initDriver() first.');
    const html = await this.driver.getPageSource();
    return cheerio.load(html);
  }

  /**
   * Get the raw page HTML source.
   *
   * Equivalent Python:
   *   html = driver.page_source
   */
  async getPageSource(): Promise<string> {
    if (!this.driver) throw new Error('Driver not initialized.');
    return this.driver.getPageSource();
  }

  /**
   * Take a screenshot and save to a file.
   *
   * Equivalent Python:
   *   driver.save_screenshot('screenshot.png')
   */
  async saveScreenshot(filepath: string): Promise<void> {
    if (!this.driver) throw new Error('Driver not initialized.');
    const data = await this.driver.takeScreenshot();
    fs.writeFileSync(filepath, data, 'base64');
    console.log(`[UC] Screenshot saved: ${filepath}`);
  }

  /**
   * Wait for an element to appear on the page.
   *
   * Equivalent Python:
   *   WebDriverWait(driver, 10).until(
   *     EC.presence_of_element_located((By.CSS_SELECTOR, selector))
   *   )
   */
  async waitForElement(cssSelector: string, timeoutMs: number = 10_000): Promise<void> {
    if (!this.driver) throw new Error('Driver not initialized.');
    await this.driver.wait(until.elementLocated(By.css(cssSelector)), timeoutMs);
  }

  /**
   * Execute JavaScript in the browser context.
   *
   * Equivalent Python:
   *   driver.execute_script("return document.title")
   */
  async executeScript<T>(script: string, ...args: unknown[]): Promise<T> {
    if (!this.driver) throw new Error('Driver not initialized.');
    return this.driver.executeScript(script, ...args) as Promise<T>;
  }

  /**
   * Add a random delay to simulate human behavior.
   * Anti-fraud systems track timing patterns — consistent delays
   * are a strong signal of automation.
   */
  async humanDelay(minMs: number = 1000, maxMs: number = 3000): Promise<void> {
    const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Get the underlying Selenium WebDriver for advanced operations.
   * Use sparingly — prefer the wrapped methods above.
   */
  getDriver(): WebDriver {
    if (!this.driver) throw new Error('Driver not initialized.');
    return this.driver;
  }

  // ── Cleanup ──────────────────────────────────────────────

  /**
   * Close browser and clean up temp files.
   * CRITICAL: Always call this, even on error. Zombie Chrome
   * processes will eat all server RAM.
   *
   * Equivalent Python:
   *   driver.quit()
   */
  async close(): Promise<void> {
    try {
      if (this.ucInstance) {
        await this.ucInstance.quit();
        this.ucInstance = null;
        this.driver = null;
        console.log('[UC] Browser closed');
      }
    } catch (err) {
      console.error('[UC] Error closing browser:', err);
      // Try force-killing via driver if ucInstance.quit() failed
      try {
        if (this.driver) {
          await this.driver.quit();
          this.driver = null;
        }
      } catch {
        // Last resort — process will be orphaned
      }
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
