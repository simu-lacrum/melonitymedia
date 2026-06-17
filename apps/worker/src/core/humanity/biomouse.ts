// ─────────────────────────────────────────────────────────────
// BioMouse — Human-like mouse movement via ghost-cursor
//
// Anti-fraud systems (TikTok BotManager, Akamai) track:
// 1. Mouse movement trajectory (straight lines = bot)
// 2. Click coordinates (center of element = bot)
// 3. Hover patterns (real humans hover randomly)
//
// ghost-cursor generates Bezier-curve trajectories that mimic
// real human hand tremor and acceleration patterns.
// ─────────────────────────────────────────────────────────────

import { createCursor, GhostCursor } from 'ghost-cursor';
import type { Page, ElementHandle } from 'patchright';

// ── Types ───────────────────────────────────────────────────

interface ClickOptions {
  /** Additional random offset from element center (px) */
  jitter?: number;
  /** Delay after click (ms) */
  postClickDelay?: number;
}

// ── Cursor Factory ──────────────────────────────────────────

/**
 * Create a ghost cursor bound to a Patchright page.
 *
 * Usage:
 *   const cursor = await createPageCursor(page);
 *   await humanClick(page, cursor, 'button.upload');
 */
export async function createPageCursor(page: Page): Promise<GhostCursor> {
  // ghost-cursor was written for Puppeteer and uses several Puppeteer-only APIs.
  // We shim them to work with Patchright (Playwright fork):
  //
  // 1. page.browser()        → page.context().browser()
  // 2. page.target()._targetId → stub (used for getRandomPagePoint)
  // 3. page._client            → CDP session (used for mouse events + DOM queries)

  const patchedPage = page as any;

  // Shim browser()
  if (typeof patchedPage.browser !== 'function') {
    patchedPage.browser = () => page.context().browser();
  }

  // Shim target()
  if (typeof patchedPage.target !== 'function') {
    patchedPage.target = () => ({ _targetId: 'page' });
  }

  // Shim _client — ghost-cursor uses it for CDP Input.dispatchMouseEvent
  if (!patchedPage._client) {
    const cdpSession = await page.context().newCDPSession(page);
    patchedPage._client = cdpSession;
  }

  return createCursor(patchedPage as unknown as Parameters<typeof createCursor>[0]);
}

// ── Human Click ─────────────────────────────────────────────

/**
 * Click an element with human-like mouse movement.
 *
 * Flow:
 * 1. Find element by CSS selector
 * 2. Move cursor in Bezier curve (not straight line)
 * 3. Add random offset from center (humans don't click dead center)
 * 4. Click with random delay
 *
 * @param page - Patchright page instance
 * @param cursor - Ghost cursor instance
 * @param selector - CSS selector for target element
 * @param options - Click behavior options
 */
export async function humanClick(
  page: Page,
  cursor: GhostCursor,
  selector: string,
  options: ClickOptions = {},
): Promise<void> {
  const { jitter = 5, postClickDelay = 0 } = options;

  // Wait for element to be visible
  await page.waitForSelector(selector, { state: 'visible', timeout: 10_000 });

  // Move to element with Bezier curve trajectory
  await cursor.click(selector, {
    paddingPercentage: jitter > 0 ? 10 : 0,
    waitForClick: randomDelay(50, 200),
  });

  // Optional post-click delay
  if (postClickDelay > 0) {
    await page.waitForTimeout(randomDelay(postClickDelay * 0.7, postClickDelay * 1.3));
  }
}

// ── Human Scroll ────────────────────────────────────────────

/**
 * Scroll the page with human-like step patterns.
 *
 * Real humans don't scroll smoothly — they do it in bursts:
 * fast flick → slow to read → fast flick → stop
 *
 * @param page - Patchright page instance
 * @param totalDistance - Total scroll distance in pixels
 * @param direction - 'down' or 'up'
 */
export async function humanScroll(
  page: Page,
  totalDistance: number,
  direction: 'down' | 'up' = 'down',
): Promise<void> {
  const sign = direction === 'down' ? 1 : -1;
  let scrolled = 0;

  while (scrolled < totalDistance) {
    // Each scroll burst: 50-200px
    const burstSize = Math.min(
      randomDelay(50, 200),
      totalDistance - scrolled,
    );

    await page.mouse.wheel(0, burstSize * sign);
    scrolled += burstSize;

    // Random pause between bursts (simulates reading)
    // Longer pauses are more common (reading pattern)
    const pauseChance = Math.random();
    if (pauseChance < 0.3) {
      // Short pause — fast scrolling
      await page.waitForTimeout(randomDelay(50, 150));
    } else if (pauseChance < 0.7) {
      // Medium pause — skimming
      await page.waitForTimeout(randomDelay(200, 500));
    } else {
      // Long pause — reading content
      await page.waitForTimeout(randomDelay(800, 2000));
    }
  }
}

// ── Human Move (Random Idle Movement) ───────────────────────

/**
 * Move mouse to a random position on the page.
 * Call this between actions to simulate idle mouse movement.
 */
export async function humanIdleMove(
  page: Page,
  cursor: GhostCursor,
): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) return;

  const x = randomDelay(50, viewport.width - 50);
  const y = randomDelay(50, viewport.height - 50);

  await cursor.moveTo({ x, y });
}

// ── Random Mouse Wander ─────────────────────────────────────

/**
 * Simulate a human "looking around" the page by making several
 * random cursor movements over a given duration.
 * Use before form fills or clicks to appear natural.
 *
 * @param page - Patchright page instance
 * @param cursor - Ghost cursor instance
 * @param durationMs - Total duration to wander (ms)
 */
export async function randomMouseWander(
  page: Page,
  cursor: GhostCursor,
  durationMs: number = 2000,
): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) return;

  const startTime = Date.now();
  const moveCount = randomDelay(3, 6); // 3-6 random movements
  const intervalMs = Math.floor(durationMs / moveCount);

  for (let i = 0; i < moveCount; i++) {
    if (Date.now() - startTime >= durationMs) break;

    const x = randomDelay(80, viewport.width - 80);
    const y = randomDelay(80, viewport.height - 80);

    try {
      await cursor.moveTo({ x, y });
    } catch {
      // ghost-cursor may fail on edge coords — ignore
    }

    await page.waitForTimeout(randomDelay(intervalMs * 0.5, intervalMs * 1.5));
  }
}

/**
 * Human-like pre-action sequence: slight scroll + wander + pause.
 * Call before filling forms to simulate a human reading the page.
 */
export async function humanPreActionWander(
  page: Page,
  cursor: GhostCursor,
): Promise<void> {
  // Small scroll to "look at the page"
  const scrollChance = Math.random();
  if (scrollChance < 0.4) {
    await humanScroll(page, randomDelay(50, 200), 'down');
    await page.waitForTimeout(randomDelay(300, 800));
    await humanScroll(page, randomDelay(30, 100), 'up');
  }

  // Random mouse wander
  await randomMouseWander(page, cursor, randomDelay(1000, 2500));

  // Brief thinking pause
  await page.waitForTimeout(randomDelay(200, 600));
}

// ── Utility ─────────────────────────────────────────────────

/**
 * Generate a random integer between min and max (inclusive).
 */
function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
