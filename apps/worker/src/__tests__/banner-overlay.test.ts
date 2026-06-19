import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const BANNER_OVERLAY_SRC = fs.readFileSync(
  path.resolve(__dirname, '../core/video/banner-overlay.ts'),
  'utf-8',
);

describe('banner overlay source verification', () => {
  it('keys out black MP4 banner backgrounds before overlaying', () => {
    expect(BANNER_OVERLAY_SRC).toContain('format=rgba,colorkey=');
    expect(BANNER_OVERLAY_SRC).toContain('BLACK_KEY_SIMILARITY');
    expect(BANNER_OVERLAY_SRC).toContain('BLACK_KEY_BLEND');
  });

  it('preserves keyed transparency during the final overlay', () => {
    expect(BANNER_OVERLAY_SRC).toContain('overlay=${overlayX}:${overlayY}:shortest=1:format=auto');
  });

  it('does not use the filesize-heavy ultrafast x264 preset for banner intermediates', () => {
    expect(BANNER_OVERLAY_SRC).toContain("'-preset', 'veryfast'");
    expect(BANNER_OVERLAY_SRC).not.toContain("'-preset', 'ultrafast'");
  });
});
