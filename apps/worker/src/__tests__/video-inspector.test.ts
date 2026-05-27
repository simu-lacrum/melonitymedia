import { describe, it, expect } from 'vitest';
import { isShortsCompatible } from '../core/video/inspector.js';

describe('isShortsCompatible', () => {
  it('accepts 1080x1920 (9:16) under 60s', () => {
    expect(isShortsCompatible({ width: 1080, height: 1920, durationSec: 45, aspectRatio: 1080/1920 })).toEqual({ ok: true });
  });

  it('rejects horizontal 1920x1080', () => {
    const r = isShortsCompatible({ width: 1920, height: 1080, durationSec: 30, aspectRatio: 1920/1080 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/вертикальное/);
  });

  it('rejects 3min+ duration', () => {
    const r = isShortsCompatible({ width: 1080, height: 1920, durationSec: 185, aspectRatio: 1080/1920 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/180s/);
  });

  it('accepts 1080x1920 at exactly 180s', () => {
    expect(isShortsCompatible({ width: 1080, height: 1920, durationSec: 180, aspectRatio: 1080/1920 })).toEqual({ ok: true });
  });
});
