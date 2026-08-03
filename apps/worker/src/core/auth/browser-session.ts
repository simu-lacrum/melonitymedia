import type { Page } from 'patchright';

export type BrowserSessionState = 'authenticated' | 'logged_out' | 'unknown';

export interface BrowserSessionCheck {
  state: BrowserSessionState;
  reason: string;
}

function loginUrl(platform: 'TIKTOK' | 'YOUTUBE', url: string): boolean {
  return platform === 'YOUTUBE'
    ? /accounts\.google\.com|ServiceLogin|\/signin(?:\/|\?|$)/i.test(url)
    : /accounts\.tiktok\.com|\/login(?:\/|\?|$)/i.test(url);
}

export async function detectBrowserSession(
  page: Page,
  platform: 'TIKTOK' | 'YOUTUBE',
): Promise<BrowserSessionCheck> {
  if (loginUrl(platform, page.url())) {
    return { state: 'logged_out', reason: `redirected to ${platform} login` };
  }

  try {
    const signals = await page.evaluate((currentPlatform) => {
      const visible = (element: Element | null): boolean => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const anyVisible = (selectors: string[]): boolean => selectors.some((selector) =>
        Array.from(document.querySelectorAll(selector)).some(visible),
      );

      if (currentPlatform === 'YOUTUBE') {
        return {
          authenticated: anyVisible([
            '#avatar-btn',
            'button#avatar-btn',
            'ytd-topbar-menu-button-renderer #avatar-btn',
            'button[aria-label*="Account menu" i]',
          ]),
          loggedOut: anyVisible([
            'a[href*="ServiceLogin"]',
            'a[aria-label*="Sign in" i]',
            'ytd-button-renderer a[href*="accounts.google.com"]',
          ]),
        };
      }

      return {
        authenticated: anyVisible([
          '[data-e2e="profile-icon"]',
          '[data-e2e="top-avatar"]',
          '[data-e2e="inbox-icon"]',
          'a[href^="/@"] [class*="Avatar" i]',
        ]),
        loggedOut: anyVisible([
          'button[data-e2e="top-login-button"]',
          'button[data-e2e*="login"]',
          'a[href*="/login"]',
        ]),
      };
    }, platform);

    if (signals.authenticated) {
      return { state: 'authenticated', reason: `${platform} account controls are visible` };
    }
    if (signals.loggedOut) {
      return { state: 'logged_out', reason: `${platform} login control is visible` };
    }
    return { state: 'unknown', reason: `${platform} page has no conclusive auth controls` };
  } catch (error) {
    return {
      state: 'unknown',
      reason: `could not inspect ${platform} auth controls: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function confirmBrowserSession(
  page: Page,
  platform: 'TIKTOK' | 'YOUTUBE',
  attempts = 2,
): Promise<BrowserSessionCheck> {
  const checks: BrowserSessionCheck[] = [];
  const totalAttempts = Math.max(1, attempts);

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    if (attempt > 0) {
      await page.waitForTimeout(2_000);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(2_000);
    }

    const check = await detectBrowserSession(page, platform);
    checks.push(check);
    if (check.state === 'authenticated') return check;
  }

  if (checks.length === totalAttempts && checks.every((check) => check.state === 'logged_out')) {
    return { state: 'logged_out', reason: checks.at(-1)?.reason ?? `${platform} login confirmed` };
  }

  return {
    state: 'unknown',
    reason: checks.map((check) => check.reason).join('; '),
  };
}
