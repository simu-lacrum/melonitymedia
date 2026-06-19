import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WARMUP_DAYS,
  DEFAULT_WARMUP_HOURS,
  hasCompletedWarmupMismatch,
  MAX_WARMUP_COMMENT_LENGTH,
  MAX_WARMUP_COMMENTS,
  normalizeWarmupComments,
  normalizeWarmupDays,
  normalizeWarmupHours,
  normalizeWarmupMode,
} from '../warmup-state.js';

describe('warmup-state', () => {
  it('normalizes warmup duration inputs', () => {
    expect(normalizeWarmupDays(undefined)).toBe(DEFAULT_WARMUP_DAYS);
    expect(normalizeWarmupDays(1)).toBe(1);
    expect(normalizeWarmupDays(99)).toBe(21);
    expect(normalizeWarmupDays('7')).toBe(7);

    expect(normalizeWarmupHours(undefined)).toBe(DEFAULT_WARMUP_HOURS);
    expect(normalizeWarmupHours(0)).toBe(1);
    expect(normalizeWarmupHours(48)).toBe(24);
    expect(normalizeWarmupHours('6')).toBe(6);
  });

  it('defaults warmup mode to DAYS', () => {
    expect(normalizeWarmupMode('HOURS')).toBe('HOURS');
    expect(normalizeWarmupMode('DAYS')).toBe('DAYS');
    expect(normalizeWarmupMode('anything')).toBe('DAYS');
  });

  it('normalizes user-provided warmup comments', () => {
    expect(normalizeWarmupComments(undefined)).toEqual([]);
    expect(normalizeWarmupComments('nice')).toEqual([]);
    expect(normalizeWarmupComments([
      '  good clip  ',
      'good   clip',
      '',
      null,
      'another one',
    ])).toEqual(['good clip', 'another one']);
  });

  it('limits warmup comments to safe counts and lengths', () => {
    const long = 'x'.repeat(MAX_WARMUP_COMMENT_LENGTH + 20);
    const many = Array.from({ length: MAX_WARMUP_COMMENTS + 10 }, (_, index) => `comment ${index}`);

    expect(normalizeWarmupComments([long])[0]).toHaveLength(MAX_WARMUP_COMMENT_LENGTH);
    expect(normalizeWarmupComments(many)).toHaveLength(MAX_WARMUP_COMMENTS);
  });

  it('detects completed warmup rows stuck in WARMING_UP', () => {
    expect(hasCompletedWarmupMismatch({
      status: 'WARMING_UP',
      warmupCompletedAt: new Date('2026-06-18T17:40:56.094Z'),
    })).toBe(true);

    expect(hasCompletedWarmupMismatch({
      status: 'WARMING_UP',
      warmupCompletedAt: null,
    })).toBe(false);

    expect(hasCompletedWarmupMismatch({
      status: 'ALIVE',
      warmupCompletedAt: new Date('2026-06-18T17:40:56.094Z'),
    })).toBe(false);
  });
});
