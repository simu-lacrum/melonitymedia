// ─────────────────────────────────────────────────────────────
// Analytics Handler — Collects profile statistics via Scraping
//
// Runs as a daily cron job. Opens each profile page and uses
// cheerio (bs4 equivalent) to parse view counts, followers, etc.
// Stores results in the database for dashboard charts.
//
// From instructions.md §2.3: cron 1 time per day, parse via cheerio
// ─────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { BrowserAutomation, ProxyConfig } from '../core/browser-automation.js';
import { SocketLogger } from '../lib/socket-logger.js';

interface AnalyticsJobData {
  userId: string;
  profileId: string;
  platform: 'TIKTOK' | 'YOUTUBE_SHORTS';
  profileUrl: string;
  cookies: string;
  proxy?: ProxyConfig;
}

interface ProfileStats {
  followers: number;
  views: number;
  likes: number;
  videos: number;
}

export async function analyticsHandler(job: Job<AnalyticsJobData>): Promise<ProfileStats> {
  const { userId, profileId, profileUrl, platform, cookies, proxy } = job.data;
  const logger = new SocketLogger(userId);
  const automation = new BrowserAutomation({ proxy, headless: false });

  try {
    logger.info(`Сбор аналитики для ${profileId} (${platform})...`);
    const driver = await automation.initDriver();

    // Inject cookies
    const baseUrl = platform === 'TIKTOK'
      ? 'https://www.tiktok.com'
      : 'https://www.youtube.com';
    await automation.navigateTo(baseUrl);
    await automation.humanDelay(1500, 2500);

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

    // Navigate to profile page
    await automation.navigateTo(profileUrl);
    await automation.humanDelay(3000, 5000);

    // Parse the page with cheerio (like bs4 in Python)
    const $ = await automation.getSoup();
    let stats: ProfileStats = { followers: 0, views: 0, likes: 0, videos: 0 };

    if (platform === 'TIKTOK') {
      stats = _parseTikTokProfile($);
    } else {
      stats = _parseYouTubeProfile($);
    }

    logger.info(
      `📊 ${profileId}: ${stats.followers} подписчиков, ` +
      `${stats.views} просмотров, ${stats.likes} лайков, ` +
      `${stats.videos} видео`,
    );

    await job.updateProgress(100);
    return stats;

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`❌ Ошибка аналитики: ${message}`);
    throw err;
  } finally {
    await automation.close();
    logger.disconnect();
  }
}

// ── TikTok Profile Parser ──────────────────────────────────
// Uses cheerio (bs4) to extract stats from the profile page.
// TikTok's selectors change frequently — we use multiple
// fallback patterns to handle different page versions.

function _parseTikTokProfile($: ReturnType<typeof import('cheerio').load>): ProfileStats {
  const stats: ProfileStats = { followers: 0, views: 0, likes: 0, videos: 0 };

  try {
    // TikTok profile stats are typically in data-e2e attributes
    const followersEl = $('[data-e2e="followers-count"]').first();
    const likesEl = $('[data-e2e="likes-count"]').first();

    stats.followers = _parseShortNumber(followersEl.text());
    stats.likes = _parseShortNumber(likesEl.text());

    // Count video items on the page
    stats.videos = $('[data-e2e="user-post-item"]').length;
  } catch {
    // Parsing failed — return zeros rather than crash
  }

  return stats;
}

// ── YouTube Profile Parser ─────────────────────────────────

function _parseYouTubeProfile($: ReturnType<typeof import('cheerio').load>): ProfileStats {
  const stats: ProfileStats = { followers: 0, views: 0, likes: 0, videos: 0 };

  try {
    // YouTube subscriber count
    const subText = $('#subscriber-count').text();
    stats.followers = _parseShortNumber(subText);

    // Video count from channel header
    const videoText = $('span:contains("videos")').first().text();
    const videoMatch = videoText.match(/(\d[\d,]*)/);
    if (videoMatch) stats.videos = parseInt(videoMatch[1].replace(/,/g, ''), 10);
  } catch {
    // Return zeros on failure
  }

  return stats;
}

// ── Number Parsing Helper ──────────────────────────────────
// Converts shortened numbers: "12.5K" → 12500, "1.2M" → 1200000

function _parseShortNumber(text: string): number {
  if (!text) return 0;
  const cleaned = text.trim().replace(/[, ]/g, '');

  const multipliers: Record<string, number> = {
    K: 1_000, k: 1_000,
    M: 1_000_000, m: 1_000_000,
    B: 1_000_000_000, b: 1_000_000_000,
    'тыс': 1_000, 'млн': 1_000_000,
  };

  for (const [suffix, multiplier] of Object.entries(multipliers)) {
    if (cleaned.endsWith(suffix)) {
      const num = parseFloat(cleaned.replace(suffix, ''));
      return Math.round(num * multiplier);
    }
  }

  return parseInt(cleaned, 10) || 0;
}
