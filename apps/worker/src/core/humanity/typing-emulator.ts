// ─────────────────────────────────────────────────────────────
// Typing Emulator — Human-like keyboard input
//
// Anti-fraud systems track keystroke dynamics:
// 1. Inter-key delay (constant = bot)
// 2. Key-down duration (instant release = bot)
// 3. Error rate (humans make ~2% typos)
// 4. Pause patterns (humans pause at word boundaries)
//
// This module simulates realistic typing with:
// - Variable inter-key delays (gaussian distribution)
// - 2% typo rate with backspace correction
// - Longer pauses at spaces and punctuation
// - Burst typing patterns (fast runs, then pause)
// ─────────────────────────────────────────────────────────────

import type { Page } from 'patchright';

// ── Constants ───────────────────────────────────────────────

/** Base delay between keystrokes (ms) */
const BASE_DELAY_MS = 65;

/** Standard deviation for delay variation */
const DELAY_STDDEV_MS = 25;

/** Probability of making a typo */
const TYPO_RATE = 0.02;

/** Extra delay at word boundaries (spaces, punctuation) */
const WORD_BOUNDARY_EXTRA_MS = 120;

/** Delay for typo correction (key + backspace) */
const TYPO_CORRECTION_DELAY_MS = 200;

// ── Adjacent Key Map ────────────────────────────────────────
// Common typo substitutions based on keyboard layout (QWERTY)

const ADJACENT_KEYS: Record<string, string[]> = {
  q: ['w', 'a'], w: ['q', 'e', 's'], e: ['w', 'r', 'd'],
  r: ['e', 't', 'f'], t: ['r', 'y', 'g'], y: ['t', 'u', 'h'],
  u: ['y', 'i', 'j'], i: ['u', 'o', 'k'], o: ['i', 'p', 'l'],
  p: ['o', 'l'],
  a: ['q', 's', 'z'], s: ['a', 'w', 'd', 'x'], d: ['s', 'e', 'f', 'c'],
  f: ['d', 'r', 'g', 'v'], g: ['f', 't', 'h', 'b'], h: ['g', 'y', 'j', 'n'],
  j: ['h', 'u', 'k', 'm'], k: ['j', 'i', 'l'], l: ['k', 'o', 'p'],
  z: ['a', 'x'], x: ['z', 's', 'c'], c: ['x', 'd', 'v'],
  v: ['c', 'f', 'b'], b: ['v', 'g', 'n'], n: ['b', 'h', 'm'],
  m: ['n', 'j'],
};

// ── Main ────────────────────────────────────────────────────

/**
 * Type text into a focused element with human-like timing.
 *
 * @param page - Patchright page
 * @param selector - CSS selector to focus first
 * @param text - Text to type
 * @param options - Typing behavior options
 */
export async function humanType(
  page: Page,
  selector: string,
  text: string,
  options: {
    /** Clear existing text before typing */
    clearBefore?: boolean;
    /** Multiplier for typing speed (0.5 = faster, 2.0 = slower) */
    speedMultiplier?: number;
  } = {},
): Promise<void> {
  const { clearBefore = true, speedMultiplier = 1.0 } = options;

  // Focus the element safely avoiding strict mode violations
  await page.locator(selector).first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(gaussianDelay(100, 50));

  // Clear existing text if needed
  if (clearBefore) {
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.waitForTimeout(gaussianDelay(50, 20));
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(gaussianDelay(100, 30));
  }

  // Type each character with human timing
  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Simulate typo at TYPO_RATE probability
    if (Math.random() < TYPO_RATE && ADJACENT_KEYS[char.toLowerCase()]) {
      const adjacentKeys = ADJACENT_KEYS[char.toLowerCase()];
      const typoChar = adjacentKeys[Math.floor(Math.random() * adjacentKeys.length)];

      // Type wrong character
      await page.keyboard.type(typoChar, { delay: 0 });
      await page.waitForTimeout(
        gaussianDelay(TYPO_CORRECTION_DELAY_MS, 80) * speedMultiplier,
      );

      // Notice mistake → backspace
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(
        gaussianDelay(100, 40) * speedMultiplier,
      );
    }

    // Type correct character
    await page.keyboard.type(char, { delay: 0 });

    // Variable delay
    let delay = gaussianDelay(BASE_DELAY_MS, DELAY_STDDEV_MS);

    // Longer pause at word boundaries
    if (char === ' ' || char === '.' || char === ',' || char === '!' || char === '?') {
      delay += gaussianDelay(WORD_BOUNDARY_EXTRA_MS, 50);
    }

    // Occasional longer pause (thinking)
    if (Math.random() < 0.05) {
      delay += gaussianDelay(400, 150);
    }

    await page.waitForTimeout(Math.max(20, delay * speedMultiplier));
  }
}

/**
 * Press Enter with human-like timing (slight pause before pressing).
 */
export async function humanPressEnter(page: Page): Promise<void> {
  await page.waitForTimeout(gaussianDelay(200, 80));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(gaussianDelay(300, 100));
}

// ── Utility ─────────────────────────────────────────────────

/**
 * Generate a gaussian (normal distribution) random delay.
 * Box-Muller transform for natural-feeling timing variation.
 */
function gaussianDelay(mean: number, stddev: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();

  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return Math.max(10, Math.round(mean + z * stddev));
}
