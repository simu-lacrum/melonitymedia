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
  // ghost-cursor works with Playwright pages directly
  return createCursor(page as unknown as Parameters<typeof createCursor>[0]);
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

// ── Utility ─────────────────────────────────────────────────

/**
 * Generate a random integer between min and max (inclusive).
 */
function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
