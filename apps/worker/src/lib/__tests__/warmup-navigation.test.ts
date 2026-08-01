import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'patchright';
import { navigateForWarmup } from '../warmup-navigation.js';

function createPage(gotoImpl: (url: string) => Promise<unknown>, usableDocument = false) {
  const goto = vi.fn(gotoImpl);
  const page = {
    goto,
    url: vi.fn(() => 'https://www.youtube.com/'),
    evaluate: vi.fn().mockResolvedValue(usableDocument),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
  } as unknown as Page;
  const logger = { warn: vi.fn() };

  return { page, goto, logger };
}

describe('navigateForWarmup', () => {
  it('recovers a transient timeout inside the same browser session', async () => {
    let targetAttempts = 0;
    const { page, goto, logger } = createPage(async (url) => {
      if (url === 'about:blank') return null;
      targetAttempts += 1;
      if (targetAttempts === 1) throw new Error('page.goto: Timeout 30000ms exceeded');
      return null;
    });

    await navigateForWarmup(page, 'https://www.youtube.com', logger, {
      attempts: 3,
      retryDelayMs: 0,
    });

    expect(targetAttempts).toBe(2);
    expect(goto).toHaveBeenCalledWith('about:blank', expect.objectContaining({ waitUntil: 'commit' }));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Повторяю навигацию'));
  });

  it('continues when a timed-out navigation already produced a usable document', async () => {
    const { page, goto, logger } = createPage(
      async () => { throw new Error('page.goto: Timeout 30000ms exceeded'); },
      true,
    );

    await navigateForWarmup(page, 'https://www.youtube.com', logger);

    expect(goto).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('страница уже доступна'));
  });

  it('throws only after all navigation attempts are exhausted', async () => {
    let targetAttempts = 0;
    const { page } = createPage(async (url) => {
      if (url === 'about:blank') return null;
      targetAttempts += 1;
      throw new Error('page.goto: Timeout 30000ms exceeded');
    });

    await expect(navigateForWarmup(page, 'https://www.youtube.com', { warn: vi.fn() }, {
      attempts: 3,
      retryDelayMs: 0,
    })).rejects.toThrow('Warmup navigation failed after 3 attempts');
    expect(targetAttempts).toBe(3);
  });

  it('does not retry a closed browser page', async () => {
    let targetAttempts = 0;
    const { page } = createPage(async () => {
      targetAttempts += 1;
      throw new Error('Target page, context or browser has been closed');
    });

    await expect(navigateForWarmup(page, 'https://www.youtube.com', { warn: vi.fn() }))
      .rejects.toThrow('Target page, context or browser has been closed');
    expect(targetAttempts).toBe(1);
  });
});
