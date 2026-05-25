// ─────────────────────────────────────────────────────────────
// Edit Profile Handler — Update Account Bio/Name/Avatar
//
// Changes profile details on the platform using UndetectedChrome.
// Navigates to settings, updates fields, saves changes.
// ─────────────────────────────────────────────────────────────

import { Job } from 'bullmq';
import { BrowserAutomation, ProxyConfig } from '../core/browser-automation.js';
import { SocketLogger } from '../lib/socket-logger.js';

interface EditProfileJobData {
  userId: string;
  profileId: string;
  platform: 'TIKTOK' | 'YOUTUBE_SHORTS';
  cookies: string;
  proxy?: ProxyConfig;
  changes: {
    name?: string;
    bio?: string;
  };
}

export async function editProfileHandler(job: Job<EditProfileJobData>): Promise<void> {
  const { userId, profileId, platform, cookies, proxy, changes } = job.data;
  const logger = new SocketLogger(userId);
  const automation = new BrowserAutomation({ proxy, headless: false });

  try {
    logger.info(`Редактирование профиля ${profileId}...`);
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
      } catch { /* skip */ }
    }

    // Navigate to profile settings
    if (platform === 'TIKTOK') {
      await automation.navigateTo('https://www.tiktok.com/setting');
    } else {
      await automation.navigateTo('https://studio.youtube.com/channel/editing');
    }
    await automation.humanDelay(3000, 5000);

    // Update name if provided
    if (changes.name) {
      try {
        const nameInput = await driver.findElement({
          css: 'input[name="nickname"], input[placeholder*="name"], #name-input',
        });
        await nameInput.clear();
        await nameInput.sendKeys(changes.name);
        logger.info(`Имя обновлено: ${changes.name}`);
      } catch {
        logger.warn('Не удалось обновить имя — селектор не найден');
      }
    }

    // Update bio if provided
    if (changes.bio) {
      try {
        const bioInput = await driver.findElement({
          css: 'textarea[name="signature"], textarea[placeholder*="bio"], #description-input',
        });
        await bioInput.clear();
        await bioInput.sendKeys(changes.bio);
        logger.info(`Био обновлено: ${changes.bio.substring(0, 50)}...`);
      } catch {
        logger.warn('Не удалось обновить био — селектор не найден');
      }
    }

    // Click save button
    try {
      const saveButton = await driver.findElement({
        css: 'button[type="submit"], button:has-text("Save"), button:has-text("Сохранить")',
      });
      await saveButton.click();
      await automation.humanDelay(2000, 3000);
      logger.info('✅ Профиль сохранён');
    } catch {
      // Fallback: try clicking any "Save" button
      const buttons = await driver.findElements({ css: 'button' });
      for (const btn of buttons) {
        const text = await btn.getText();
        if (text.includes('Save') || text.includes('Сохранить')) {
          await btn.click();
          logger.info('✅ Профиль сохранён (fallback)');
          break;
        }
      }
    }

    await job.updateProgress(100);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`❌ Ошибка редактирования: ${message}`);
    throw err;
  } finally {
    await automation.close();
    logger.disconnect();
  }
}
