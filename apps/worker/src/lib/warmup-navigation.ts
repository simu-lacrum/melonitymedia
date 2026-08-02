import type { Page } from 'patchright';

interface NavigationLogger {
  warn(message: string): void;
}

interface WarmupNavigationOptions {
  attempts?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
  referer?: string;
}

const CLOSED_PAGE_ERROR = /(?:target|page|context|browser).*(?:closed|crash|disconnect)/i;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function hasUsableTargetDocument(page: Page, targetUrl: string): Promise<boolean> {
  try {
    const current = new URL(page.url());
    const target = new URL(targetUrl);
    if (current.hostname !== target.hostname) return false;

    return await page.evaluate(() => {
      if (!document.body) return false;
      if (document.querySelector('#main-frame-error, .neterror, [data-error-code]')) return false;

      const text = (document.body.innerText || '').slice(0, 500);
      if (/ERR_[A-Z_]+|This site can.t be reached|Proxy server is refusing connections/i.test(text)) {
        return false;
      }

      return document.body.childElementCount > 0;
    });
  } catch {
    return false;
  }
}

/**
 * Recover from transient proxy/platform stalls without aborting a long warmup.
 * A timed-out navigation can still leave a usable document, so inspect it before retrying.
 */
export async function navigateForWarmup(
  page: Page,
  targetUrl: string,
  logger: NavigationLogger,
  options: WarmupNavigationOptions = {},
): Promise<void> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const timeoutMs = Math.max(5_000, options.timeoutMs ?? 30_000);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 3_000);
  const targetHost = new URL(targetUrl).hostname;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await page.goto(targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
        ...(options.referer ? { referer: options.referer } : {}),
      });
      return;
    } catch (error) {
      lastError = error;

      if (await hasUsableTargetDocument(page, targetUrl)) {
        logger.warn(`Навигация к ${targetHost} превысила лимит, но страница уже доступна. Продолжаю прогрев.`);
        return;
      }

      if (CLOSED_PAGE_ERROR.test(errorMessage(error)) || attempt === attempts) break;

      logger.warn(`Не удалось открыть ${targetHost}, попытка ${attempt}/${attempts}. Повторяю навигацию...`);
      await page.evaluate(() => window.stop()).catch(() => {});
      await page.goto('about:blank', { waitUntil: 'commit', timeout: 5_000 }).catch(() => {});
      await page.waitForTimeout(retryDelayMs * attempt);
    }
  }

  throw new Error(
    `Warmup navigation failed after ${attempts} attempts for ${targetHost}: ${errorMessage(lastError)}`,
  );
}
