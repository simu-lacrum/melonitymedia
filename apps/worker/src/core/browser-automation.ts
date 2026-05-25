// ─────────────────────────────────────────────────────────────
// ⚠️  DEPRECATED — DO NOT USE
//
// This file was the original browser automation module using
// Selenium WebDriver / UndetectedChrome / Puppeteer.
//
// It has been replaced by:
//   apps/worker/src/core/browser/patchright-launcher.ts
//
// This file is kept ONLY for reference during migration.
// It will be deleted after all handlers are confirmed working
// with the new Patchright-based launcher.
//
// Migration guide:
//   Old: const automation = new BrowserAutomation({ proxy, headless: false });
//        const driver = await automation.initDriver();
//        await automation.navigateTo(url);
//        const $ = await automation.getSoup();
//
//   New: const { browser, context, page } = await launchStealthContext({
//          accountId, proxyUrl, cookiesPath, fingerprint
//        });
//        await page.goto(url);
//        const body = await page.textContent('body');
//
// BANNED: This file and its exports must NOT be imported anywhere.
// ESLint rule `no-restricted-imports` will catch violations.
// ─────────────────────────────────────────────────────────────

/**
 * @deprecated Use `patchright-launcher.ts` instead.
 * This class is kept for reference only.
 */
export class BrowserAutomation {
  constructor(_opts?: unknown) {
    throw new Error(
      'BrowserAutomation is DEPRECATED. ' +
      'Use launchStealthContext() from patchright-launcher.ts instead.',
    );
  }
}

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}
