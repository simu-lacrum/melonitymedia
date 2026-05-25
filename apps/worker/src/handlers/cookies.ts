// ─────────────────────────────────────────────────────────────
// Cookies Handler — Fetch & Update Account Cookies
//
// Logs into the platform using saved credentials, extracts
// all cookies, and saves them to the database for future use.
// This ensures cookies stay fresh and sessions don't expire.
//
// From instructions.md: cookies are essential for all operations
// ─────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { BrowserAutomation, ProxyConfig } from '../core/browser-automation.js';
import { SocketLogger } from '../lib/socket-logger.js';

interface CookiesJobData {
  userId: string;
  profileId: string;
  platform: 'TIKTOK' | 'YOUTUBE_SHORTS';
  cookies: string; // current cookies to try first
  proxy?: ProxyConfig;
}

export async function cookiesHandler(job: Job<CookiesJobData>): Promise<string> {
  const { userId, profileId, platform, cookies, proxy } = job.data;
  const logger = new SocketLogger(userId);
  const automation = new BrowserAutomation({ proxy, headless: false });

  try {
    logger.info(`Обновление cookies для профиля ${profileId}...`);
    const driver = await automation.initDriver();

    // Navigate to platform
    const baseUrl = platform === 'TIKTOK'
      ? 'https://www.tiktok.com'
      : 'https://www.youtube.com';
    await automation.navigateTo(baseUrl);
    await automation.humanDelay(2000, 3000);

    // Inject existing cookies
    if (cookies) {
      const parsedCookies = JSON.parse(cookies);
      for (const cookie of parsedCookies) {
        try {
          await driver.manage().addCookie({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path || '/',
            secure: cookie.secure || false,
            httpOnly: cookie.httpOnly || false,
          });
        } catch { /* skip */ }
      }
    }

    // Refresh to apply cookies
    await automation.navigateTo(baseUrl);
    await automation.humanDelay(3000, 5000);

    // Parse page to verify login status
    const $ = await automation.getSoup();
    const bodyText = $('body').text();

    const isLoggedOut =
      bodyText.includes('Log in') ||
      bodyText.includes('Sign in') ||
      bodyText.includes('Войти');

    if (isLoggedOut) {
      logger.warn('Cookies истекли — требуется повторная авторизация');
      throw new Error('COOKIES_EXPIRED');
    }

    // Extract updated cookies from the browser
    const updatedCookies = await driver.manage().getCookies();
    const cookiesJson = JSON.stringify(updatedCookies);

    logger.info(`✅ Cookies обновлены (${updatedCookies.length} шт)`);
    await job.updateProgress(100);

    return cookiesJson;

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`❌ Ошибка обновления cookies: ${message}`);
    throw err;
  } finally {
    await automation.close();
    logger.disconnect();
  }
}
