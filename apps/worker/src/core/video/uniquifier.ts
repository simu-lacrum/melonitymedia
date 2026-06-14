// ─────────────────────────────────────────────────────────────
// Video Uniquifier — FFmpeg-based video fingerprint mutation
//
// TikTok deduplicates videos via perceptual hashing:
// 1. pHash (perceptual hash) of I-frames
// 2. Audio spectral fingerprint
// 3. EXIF/metadata comparison
// 4. Duration matching
//
// To bypass: each account gets a UNIQUE version of the same video
// with deterministic transforms seeded by accountId.
//
// Transforms applied:
// - Pixel shift (crop + pad by 1-3px)
// - Brightness/contrast adjustment (±2-5%)
// - Audio pitch shift (±2%)
// - Trim first/last 0.1-0.5s
// - Metadata strip (all EXIF/comments removed)
// - Color channel swap seed (unique per account)
//
// REQUIRES: ffmpeg installed in Docker container
// ─────────────────────────────────────────────────────────────

import { execFile } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';

const execFileAsync = promisify(execFile);

// ── Types ───────────────────────────────────────────────────

export interface UniquifyOptions {
  /** Account ID — used as seed for deterministic transforms */
  accountId: string;
  /** Source video path */
  inputPath: string;
  /** Output directory (default: /tmp/uniquified/) */
  outputDir?: string;
}

export interface UniquifyResult {
  /** Path to uniquified video */
  outputPath: string;
  /** Applied transforms for logging */
  transforms: string[];
  /** Abort controller to cancel the ffmpeg process */
  abort: () => void;
}

// ── Deterministic Random from Account Seed ──────────────────

/**
 * Create a seeded PRNG from accountId.
 * Same accountId always produces same transforms — deterministic.
 */
function createSeededRandom(accountId: string): () => number {
  let hash = crypto.createHash('sha256').update(accountId).digest();
  let idx = 0;

  return (): number => {
    if (idx >= 32) {
      // Re-hash to extend the sequence when we've exhausted the current hash
      hash = crypto.createHash('sha256').update(hash).digest();
      idx = 0;
    }
    const val = hash.readUInt32BE(idx);
    idx += 4;
    return val / 0xFFFFFFFF;
  };
}

function seededRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

function seededInt(rng: () => number, min: number, max: number): number {
  return Math.floor(seededRange(rng, min, max + 1));
}

// ── Main ────────────────────────────────────────────────────

/**
 * Create a unique version of a video for a specific account.
 *
 * The transforms are deterministic — same accountId + video
 * always produces the same output. This ensures consistency
 * if the job is retried.
 *
 * @returns Path to the uniquified video file
 */
export async function uniquifyVideo(opts: UniquifyOptions): Promise<UniquifyResult> {
  const { accountId, inputPath, outputDir = '/tmp/uniquified' } = opts;
  // Seed from accountId + inputPath so different videos get different transforms
  const rng = createSeededRandom(`${accountId}:${inputPath}`);
  const transforms: string[] = [];

  // Ensure output directory exists
  await fs.mkdir(outputDir, { recursive: true });

  const ext = path.extname(inputPath);
  const outputPath = path.join(outputDir, `${accountId}_${Date.now()}${ext}`);

  // Build FFmpeg filter chain
  const filters: string[] = [];
  const audioFilters: string[] = [];

  // 1. Pixel shift — crop by 1-3px from random edges, pad back
  const cropPx = seededInt(rng, 1, 3);
  const cropSide = seededInt(rng, 0, 3); // 0=top, 1=right, 2=bottom, 3=left
  const cropMap = [
    `crop=iw:ih-${cropPx}:0:${cropPx},pad=iw:ih+${cropPx}:0:0`,       // top
    `crop=iw-${cropPx}:ih:0:0,pad=iw+${cropPx}:ih:0:0`,               // right
    `crop=iw:ih-${cropPx}:0:0,pad=iw:ih+${cropPx}:0:${cropPx}`,       // bottom
    `crop=iw-${cropPx}:ih:${cropPx}:0,pad=iw+${cropPx}:ih:${cropPx}:0`, // left
  ];
  filters.push(cropMap[cropSide]);
  transforms.push(`pixel_shift: ${cropPx}px from ${['top', 'right', 'bottom', 'left'][cropSide]}`);

  // 2. Brightness/contrast adjustment
  const brightness = seededRange(rng, -0.05, 0.05);
  const contrast = seededRange(rng, 0.96, 1.04);
  filters.push(`eq=brightness=${brightness.toFixed(4)}:contrast=${contrast.toFixed(4)}`);
  transforms.push(`brightness: ${(brightness * 100).toFixed(1)}%, contrast: ${(contrast * 100).toFixed(1)}%`);

  // 3. Subtle hue rotation (±5 degrees)
  const hue = seededRange(rng, -5, 5);
  filters.push(`hue=h=${hue.toFixed(2)}`);
  transforms.push(`hue: ${hue.toFixed(1)}°`);

  // 4. Audio pitch shift (±2%)
  const pitchShift = seededRange(rng, 0.98, 1.02);
  audioFilters.push(`asetrate=44100*${pitchShift.toFixed(4)},aresample=44100`);
  transforms.push(`audio_pitch: ${((pitchShift - 1) * 100).toFixed(1)}%`);

  // 5. Trim start/end
  const trimStart = seededRange(rng, 0.05, 0.3);
  const trimEnd = seededRange(rng, 0.05, 0.3);
  transforms.push(`trim: start=${trimStart.toFixed(2)}s, end=-${trimEnd.toFixed(2)}s`);

    // Get video duration via ffprobe for end trim
    let duration = 99999;
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        inputPath,
      ]);
      duration = parseFloat(stdout.trim());
    } catch {
      // If ffprobe fails, use the full video without end trim
    }

    // Calculate effective duration: total - trimStart - trimEnd
    const effectiveDuration = Math.max(1, duration - trimStart - trimEnd);

  // Build FFmpeg command
  const args: string[] = [
    '-y',                      // overwrite output
    '-i', inputPath,
    // Trim from start
    '-ss', trimStart.toFixed(3),
    // Video filters
    '-vf', filters.join(','),
    // Audio filters
    '-af', audioFilters.join(','),
    // Metadata strip — remove ALL tags (EXIF, comments, creation date)
    '-map_metadata', '-1',
    '-fflags', '+bitexact',
    '-flags:v', '+bitexact',
    '-flags:a', '+bitexact',
    // Encoding — re-encode for pixel-level differences
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    // Trim from end using calculated effective duration
    '-t', effectiveDuration.toFixed(3),
    outputPath,
  ];

  transforms.push('metadata: stripped');

  const ac = new AbortController();

  try {
    await execFileAsync('ffmpeg', args, {
      timeout: 300_000, // 5 minutes max
      maxBuffer: 10 * 1024 * 1024,
      signal: ac.signal
    });

    console.log(`[Uniquifier] Created: ${outputPath}`);
    console.log(`[Uniquifier] Transforms: ${transforms.join(' | ')}`);

    return { outputPath, transforms, abort: () => ac.abort() };
  } catch (err: any) {
    // Clean up partial output
    try { await fs.unlink(outputPath); } catch { /* ignore */ }
    
    if (err.name === 'AbortError') {
      throw new Error('FFmpeg process was aborted');
    }
    throw new Error(`FFmpeg uniquification failed: ${err.message}`);
  }
}

/**
 * Clean up a uniquified video file after upload.
 */
export async function cleanupUniquifiedVideo(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
    console.log(`[Uniquifier] Cleaned up: ${filePath}`);
  } catch {
    // Non-critical
  }
}
