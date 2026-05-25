// ─────────────────────────────────────────────────────────────
// Warmup Handler — Profile Warmup for Anti-Fraud
//
// New social media accounts get flagged if they immediately
// start uploading content. The warmup handler simulates real
// user behavior: scrolling feed, liking, watching videos.
//
// From instructions.md §2.3: warmup runs 1 time per day via Cron
// ─────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { BrowserAutomation, ProxyConfig } from '../core/browser-automation.js';
import { SocketLogger } from '../lib/socket-logger.js';

interface WarmupJobData {
  userId: string;
  profileId: string;
  platform: 'TIKTOK' | 'YOUTUBE_SHORTS';
  cookies: string;
  proxy?: ProxyConfig;
}

export async function warmupHandler(job: Job<WarmupJobData>): Promise<void> {
  const { userId, profileId, platform, cookies, proxy } = job.data;
  const logger = new SocketLogger(userId);
  const automation = new BrowserAutomation({ proxy, headless: false });

  try {
    logger.info(`Прогрев профиля ${profileId} на ${platform}...`);
    const driver = await automation.initDriver();

    // Inject cookies
    const baseUrl = platform === 'TIKTOK'
      ? 'https://www.tiktok.com'
      : 'https://www.youtube.com';
    await automation.navigateTo(baseUrl);
    await automation.humanDelay(2000, 3000);

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
      } catch { /* skip invalid cookies */ }
    }

    // Refresh with cookies applied
    await automation.navigateTo(baseUrl);
    await automation.humanDelay(3000, 5000);

    // Simulate human browsing: scroll the feed 5-10 times
    const scrollCount = Math.floor(Math.random() * 6) + 5;
    for (let i = 0; i < scrollCount; i++) {
      logger.info(`Прокрутка ленты ${i + 1}/${scrollCount}...`);
      await automation.executeScript('window.scrollBy(0, window.innerHeight)');
      await automation.humanDelay(2000, 5000);
    }

    // Like 1-3 random videos (TikTok)
    if (platform === 'TIKTOK') {
      const likeCount = Math.floor(Math.random() * 3) + 1;
      try {
        const hearts = await driver.findElements({ css: '[data-e2e="like-icon"]' });
        for (let i = 0; i < Math.min(likeCount, hearts.length); i++) {
          await hearts[i].click();
          logger.info(`Лайк видео ${i + 1}/${likeCount}`);
          await automation.humanDelay(1000, 3000);
        }
      } catch {
        logger.warn('Не удалось поставить лайки');
      }
    }

    logger.info(`✅ Прогрев профиля ${profileId} завершён`);
    await job.updateProgress(100);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`❌ Ошибка прогрева: ${message}`);
    throw err;
  } finally {
    await automation.close();
    logger.disconnect();
  }
}
