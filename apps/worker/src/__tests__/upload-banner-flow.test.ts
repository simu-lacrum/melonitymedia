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

  it('keeps pixel-shift dimensions even for yuv420p encodes', () => {
    expect(UNIQUIFIER_SRC).toContain('const cropPx = seededInt(rng, 1, 2) * 2');
    expect(UNIQUIFIER_SRC).toContain('odd crop values can shrink output');
  });
});
