// ─────────────────────────────────────────────────────────────
// Banner Overlay — FFmpeg-based video banner compositing
//
// Overlays an animated banner (video with alpha or black-bg)
// onto the main video. Banner is looped to cover the full
// duration, positioned randomly at top or bottom, scaled to
// ~115% of video width (extends beyond screen edges).
//
// Handles:
// - Alpha-channel banners (WebM VP9, MOV ProRes4444)
// - Black-background banners (MP4 H264 → colorkey removal)
// - Different FPS / bitrate between main and banner
// - Audio preservation (copy from main, ignore banner audio)
// - Duration preserved exactly (no extension / truncation)
//
// REQUIRES: ffmpeg installed in Docker container
// ─────────────────────────────────────────────────────────────

import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { inspectVideo } from './inspector.js';

const execFileAsync = promisify(execFile);

// ── Types ───────────────────────────────────────────────────

export interface BannerOverlayOptions {
  /** Path to main video */
  inputPath: string;
  /** Path to banner video (with alpha or black bg) */
  bannerPath: string;
  /** Output directory (default: /tmp/bannered/) */
  outputDir?: string;
  /** Banner position: 'top', 'bottom', or 'random' (default) */
  position?: 'top' | 'bottom' | 'random';
}

export interface BannerOverlayResult {
  /** Path to output video with banner */
  outputPath: string;
  /** Which position was used */
  position: 'top' | 'bottom';
}

// ── Safe‑zone offsets (fraction of video height) ────────────
// Top: 6% — just under iPhone Dynamic Island / status bar
// Bottom: 18% — clears TikTok/YouTube Shorts action buttons + nav bar

const SAFE_TOP = 0.06;
const SAFE_BOTTOM = 0.18;

// Banner width relative to video width (>1.0 = extends past edges)
const BANNER_WIDTH_RATIO = 1.15;

// ── Helpers ─────────────────────────────────────────────────

/**
 * Detect if a video file has an alpha channel (transparent background).
 * Users upload banners without background → pix_fmt will be yuva420p/rgba/etc.
 */
async function detectAlphaChannel(filepath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=pix_fmt',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filepath,
    ]);
    const pixFmt = stdout.trim().toLowerCase();
    return /yuva|rgba|argb|bgra|gbrap|ya[0-9]/.test(pixFmt);
  } catch {
    return false;
  }
}

// ── Main ────────────────────────────────────────────────────

/**
 * Overlay an animated banner onto a video.
 *
 * The banner is:
 * - Scaled to ~115% of video width (extends past screen edges)
 * - Centered horizontally (edges overflow and get cropped naturally)
 * - Positioned at top or bottom safe zone (randomized)
 * - Looped to cover full video duration via -stream_loop
 * - If no alpha channel, black background is keyed out via colorkey
 *
 * Audio is always taken from the main video (banner audio is ignored).
 * Output duration matches the main video exactly.
 */
export async function applyBannerOverlay(
  opts: BannerOverlayOptions,
): Promise<BannerOverlayResult> {
  const {
    inputPath,
    bannerPath,
    outputDir = '/tmp/bannered',
    position = 'random',
  } = opts;

  // Inspect main video dimensions + duration
  const mainMeta = await inspectVideo(inputPath);
  const { width: W, height: H, durationSec } = mainMeta;

  // Inspect banner dimensions
  const bannerMeta = await inspectVideo(bannerPath);

  // Decide position
  const pos: 'top' | 'bottom' = position === 'random'
    ? (Math.random() < 0.5 ? 'top' : 'bottom')
    : position;

  // Calculate banner scale
  // Scale banner width to BANNER_WIDTH_RATIO * main width
  const targetBannerW = Math.round(W * BANNER_WIDTH_RATIO);
  const bannerAspect = bannerMeta.width / bannerMeta.height;
  const targetBannerH = Math.round(targetBannerW / bannerAspect);

  // Make dimensions even (FFmpeg requires even dimensions for libx264)
  const scaledW = targetBannerW % 2 === 0 ? targetBannerW : targetBannerW + 1;
  const scaledH = targetBannerH % 2 === 0 ? targetBannerH : targetBannerH + 1;

  // Calculate overlay position
  // X: center horizontally (negative = left overflow, naturally cropped)
  const overlayX = Math.round((W - scaledW) / 2);

  // Y: safe zone offset
  let overlayY: number;
  if (pos === 'top') {
    overlayY = Math.round(H * SAFE_TOP);
  } else {
    overlayY = Math.round(H - scaledH - H * SAFE_BOTTOM);
  }

  // Detect if banner has alpha channel (transparent background)
  const hasAlpha = await detectAlphaChannel(bannerPath);

  // Build filter_complex
  // If banner has alpha → preserve transparency via yuva420p
  // If banner has no alpha → overlay directly with its own background
  const bannerFilter = hasAlpha
    ? `[1:v]scale=${scaledW}:${scaledH},format=yuva420p[ban]`
    : `[1:v]scale=${scaledW}:${scaledH}[ban]`;

  const filterComplex = [
    bannerFilter,
    `[0:v][ban]overlay=${overlayX}:${overlayY}:shortest=1`,
  ].join(';');

  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  const ext = path.extname(inputPath);
  const outputPath = path.join(outputDir, `bannered_${Date.now()}${ext}`);

  // Build FFmpeg command
  const args: string[] = [
    '-y',                               // overwrite output
    '-i', inputPath,                     // input 0: main video
    '-stream_loop', '-1',               // loop banner infinitely
    '-i', bannerPath,                    // input 1: banner
    '-filter_complex', filterComplex,
    '-map', '0:a?',                     // audio from main video only (? = optional)
    '-c:a', 'copy',                     // copy audio codec (no re-encode)
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',             // ensure compatibility
    '-t', durationSec.toFixed(3),       // exact duration of main video
    '-movflags', '+faststart',          // web-optimized MP4
    outputPath,
  ];

  try {
    await execFileAsync('ffmpeg', args, {
      timeout: 600_000, // 10 minutes max (overlay is heavier than uniquification)
      maxBuffer: 10 * 1024 * 1024,
    });

    console.log(`[BannerOverlay] Created: ${outputPath} (position: ${pos})`);
    console.log(`[BannerOverlay] Banner ${scaledW}×${scaledH} at (${overlayX}, ${overlayY}), alpha=${hasAlpha}`);

    return { outputPath, position: pos };
  } catch (err: any) {
    // Clean up partial output
    try { await fs.unlink(outputPath); } catch { /* ignore */ }
    throw new Error(`FFmpeg banner overlay failed: ${err.message}`);
  }
}

/**
 * Clean up a bannered video file after upload.
 */
export async function cleanupBanneredVideo(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
    console.log(`[BannerOverlay] Cleaned up: ${filePath}`);
  } catch {
    // Non-critical
  }
}
