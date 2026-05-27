// ─────────────────────────────────────────────────────────────
// TikTok captcha auto-solve workflow
//
// Called from upload.ts when CAPTCHA is detected on page.
// Strategy:
// 1. Extract challenge images from DOM (slider piece + background, or whirl images)
// 2. Send to CapSolver via solveCaptcha()
// 3. Replay solution as real mouse drag on the slider handle
// ─────────────────────────────────────────────────────────────

import type { Page } from 'patchright';
import { solveCaptcha, type TikTokSolution } from './capsolver-client.js';

export interface TikTokCaptchaContext {
  page: Page;
  proxyUrl: string;
  userAgent: string;
  websiteURL: string;  // current page URL
}

/**
 * Detect if a TikTok captcha is currently visible on the page.
 * Returns the challenge type or null.
 */
export async function detectTikTokCaptcha(page: Page): Promise<'slide' | 'whirl' | '3d' | null> {
  // TikTok captcha DOM markers (2026)
  const hasSlide = await page.locator('.secsdk-captcha-drag-icon, [class*="captcha"][class*="slide"]').count() > 0;
  const hasWhirl = await page.locator('[class*="captcha"][class*="whirl"], [class*="rotate-captcha"]').count() > 0;
  const has3D = await page.locator('[class*="captcha-3d"], [class*="object-detection"]').count() > 0;

  if (hasSlide) return 'slide';
  if (hasWhirl) return 'whirl';
  if (has3D) return '3d';
  return null;
}

/**
 * Extract captcha images as base64 from the page.
 * Selectors vary by challenge type — slide has 2 imgs, whirl has 2 imgs (inner+outer), 3d has 1.
 */
async function extractCaptchaImages(
  page: Page,
  challengeType: 'slide' | 'whirl' | '3d',
): Promise<{ bodyImage?: string; pieceImage?: string }> {
  const imgs = await page.locator('img[src^="data:image"], img[src^="https://"]').all();
  const captchaImgs: Array<{ src: string; bbox: { width: number; height: number } | null }> = [];

  for (const img of imgs) {
    const src = await img.getAttribute('src');
    if (!src) continue;
    const bbox = await img.boundingBox();
    if (!bbox || bbox.width < 100) continue;  // skip tiny icons
    captchaImgs.push({ src, bbox });
  }

  // Heuristic: largest image is the background, second-largest is the piece
  captchaImgs.sort((a, b) => (b.bbox?.width ?? 0) - (a.bbox?.width ?? 0));

  async function toBase64(src: string): Promise<string> {
    if (src.startsWith('data:image')) {
      return src.replace(/^data:image\/\w+;base64,/, '');
    }
    const resp = await fetch(src);
    const buf = Buffer.from(await resp.arrayBuffer());
    return buf.toString('base64');
  }

  if (challengeType === 'slide' && captchaImgs.length >= 2) {
    return {
      bodyImage: await toBase64(captchaImgs[0].src),
      pieceImage: await toBase64(captchaImgs[1].src),
    };
  }
  if (challengeType === 'whirl' && captchaImgs.length >= 2) {
    return {
      bodyImage: await toBase64(captchaImgs[0].src),   // outer
      pieceImage: await toBase64(captchaImgs[1].src),  // inner
    };
  }
  if (challengeType === '3d' && captchaImgs.length >= 1) {
    return { bodyImage: await toBase64(captchaImgs[0].src) };
  }

  throw new Error(`[tiktok-captcha] could not extract images for challenge type ${challengeType}`);
}

/**
 * Apply slider solution as a human-like mouse drag.
 */
async function applySliderSolution(page: Page, solution: TikTokSolution): Promise<void> {
  if (solution.kind !== 'slider') {
    throw new Error(`[tiktok-captcha] expected slider, got ${solution.kind}`);
  }

  const handle = page
    .locator('.secsdk-captcha-drag-icon, [class*="captcha"][class*="drag"]')
    .first();
  const box = await handle.boundingBox();
  if (!box) throw new Error('[tiktok-captcha] slider handle bounding box not found');

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const targetX = startX + solution.x;
  const targetY = startY + (solution.y ?? 0);

  // Human-like drag: start, hold, multi-step move, release
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.waitForTimeout(150 + Math.random() * 200);

  // Move in 10-20 small steps with bezier-like easing
  const steps = 12 + Math.floor(Math.random() * 8);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // ease-in-out cubic
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const x = startX + (targetX - startX) * eased;
    const y = startY + (targetY - startY) * eased + (Math.random() - 0.5) * 2;  // jitter
    await page.mouse.move(x, y);
    await page.waitForTimeout(15 + Math.random() * 30);
  }

  await page.waitForTimeout(100 + Math.random() * 150);
  await page.mouse.up();
}

async function applyWhirlSolution(page: Page, solution: TikTokSolution): Promise<void> {
  if (solution.kind !== 'whirl') {
    throw new Error(`[tiktok-captcha] expected whirl, got ${solution.kind}`);
  }

  // Whirl uses the same drag slider, x displacement proportional to angle
  const pxPerDegree = 300 / 360;  // TikTok whirl track is ~300px for 360°
  const targetX = solution.angle * pxPerDegree;

  await applySliderSolution(page, { kind: 'slider', x: targetX });
}

async function apply3DSolution(page: Page, solution: TikTokSolution): Promise<void> {
  if (solution.kind !== 'shape') {
    throw new Error(`[tiktok-captcha] expected shape, got ${solution.kind}`);
  }

  // Click each point sequentially with small delays
  for (const pt of solution.points) {
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(300 + Math.random() * 400);
  }
}

/**
 * Main entry — detect captcha, solve via CapSolver, apply solution.
 * Returns true if captcha was found and solved; false if no captcha present.
 * Throws if captcha was found but solve failed.
 */
export async function handleTikTokCaptcha(ctx: TikTokCaptchaContext): Promise<boolean> {
  const challengeType = await detectTikTokCaptcha(ctx.page);
  if (!challengeType) return false;

  console.log(`[tiktok-captcha] detected: ${challengeType}`);

  const images = await extractCaptchaImages(ctx.page, challengeType);

  const solution = await solveCaptcha({
    type: 'tiktok',
    websiteURL: ctx.websiteURL,
    proxyUrl: ctx.proxyUrl,
    userAgent: ctx.userAgent,
    challengeType,
    ...images,
  }) as TikTokSolution;

  if (challengeType === 'slide') await applySliderSolution(ctx.page, solution);
  else if (challengeType === 'whirl') await applyWhirlSolution(ctx.page, solution);
  else if (challengeType === '3d') await apply3DSolution(ctx.page, solution);

  // Wait for TikTok to validate and proceed
  await ctx.page.waitForTimeout(2000 + Math.random() * 2000);

  // Re-check if captcha is still visible — sometimes one solve isn't enough
  const stillThere = await detectTikTokCaptcha(ctx.page);
  if (stillThere) {
    throw new Error(`[tiktok-captcha] solve applied but captcha still visible (${stillThere}). Need second attempt or manual review.`);
  }

  return true;
}
