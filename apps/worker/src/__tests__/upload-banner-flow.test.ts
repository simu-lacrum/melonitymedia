import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const UPLOAD_SRC = fs.readFileSync(
  path.resolve(__dirname, '../handlers/upload.ts'),
  'utf-8',
);

const UNIQUIFIER_SRC = fs.readFileSync(
  path.resolve(__dirname, '../core/video/uniquifier.ts'),
  'utf-8',
);

describe('upload banner and uniquification source verification', () => {
  it('fails loudly when a selected banner file is missing', () => {
    expect(UPLOAD_SRC).toContain('if (data.bannerPath)');
    expect(UPLOAD_SRC).toContain('Баннер выбран, но файл не найден');
    expect(UPLOAD_SRC).not.toContain('data.bannerPath && fs.existsSync(data.bannerPath)');
  });

  it('uses a stable logical seed after creating temporary banner files', () => {
    expect(UPLOAD_SRC).toContain('seedKey:');
    expect(UPLOAD_SRC).toContain("data.bannerPath ?? 'no-banner'");
    expect(UNIQUIFIER_SRC).toContain('seedKey?: string');
    expect(UNIQUIFIER_SRC).toContain('const seedMaterial = seedKey ?? inputPath');
  });

  it('keeps final upload files platform-compatible and reasonably sized', () => {
    expect(UNIQUIFIER_SRC).toContain("'-preset', 'veryfast'");
    expect(UNIQUIFIER_SRC).toContain("'-pix_fmt', 'yuv420p'");
    expect(UNIQUIFIER_SRC).toContain("'-movflags', '+faststart'");
    expect(UNIQUIFIER_SRC).not.toContain("'-preset', 'ultrafast'");
  });

  it('applies the required 1-3px deterministic pixel shift', () => {
    expect(UNIQUIFIER_SRC).toContain('const cropPx = seededInt(rng, 1, 3)');
    expect(UNIQUIFIER_SRC).toContain('Pixel shift (crop + pad by 1-3px)');
  });

  it('keeps the required FFmpeg uniqueness transforms', () => {
    expect(UNIQUIFIER_SRC).toContain('asetrate=44100*${pitchShift.toFixed(4)},aresample=44100');
    expect(UNIQUIFIER_SRC).toContain("'-map_metadata', '-1'");
    expect(UNIQUIFIER_SRC).toContain('metadata: stripped');
  });
});
