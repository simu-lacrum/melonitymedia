import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WARMUP_DAYS,
  DEFAULT_WARMUP_HOURS,
  getWarmupDisplayDay,
  hasCompletedWarmupMismatch,
  MAX_WARMUP_COMMENT_LENGTH,
  MAX_WARMUP_COMMENTS,
  normalizeWarmupComments,
  normalizeWarmupDays,
  normalizeWarmupHours,
  normalizeWarmupMode,
  recoverWarmupProgress,
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

  it('reports worker-completed days instead of elapsed calendar days', () => {
    expect(getWarmupDisplayDay({
      lastWarmupDay: 4,
      warmupCompletedAt: null,
      warmupDays: 5,
    })).toBe(4);
    expect(getWarmupDisplayDay({
      lastWarmupDay: null,
      warmupCompletedAt: null,
      warmupDays: 5,
    })).toBeNull();
    expect(getWarmupDisplayDay({
      lastWarmupDay: 2,
      warmupCompletedAt: new Date('2026-06-18T17:40:56.094Z'),
      warmupDays: 5,
    })).toBe(5);
  });

  it('recovers completed days from worker-created next-day jobs', () => {
    const progress = recoverWarmupProgress('account-1', [{
      accountId: 'account-1',
      bullmqJobId: 'warmup-task-account-1-day5-s0',
      completedAt: null,
      createdAt: new Date('2026-08-01T08:00:00.000Z'),
      config: { accountIds: ['account-1'], warmupDays: 5 },
      status: 'FAILED',
    }]);

    expect(progress.completedDays).toBe(4);
    expect(progress.completedAt).toBeNull();
    expect(progress.startedAt).toEqual(new Date('2026-08-01T08:00:00.000Z'));
  });

  it('restores permanent readiness from a completed warmup task', () => {
    const progress = recoverWarmupProgress('account-1', [{
      accountId: null,
      bullmqJobId: 'warmup-task-account-1-day5-s2',
      completedAt: new Date('2026-08-05T08:00:00.000Z'),
      createdAt: new Date('2026-08-01T08:00:00.000Z'),
      config: { accountIds: ['account-1', 'account-2'], warmupDays: 5 },
      status: 'COMPLETED',
    }]);

    expect(progress.completedDays).toBe(5);
    expect(progress.completedAt).toEqual(new Date('2026-08-05T08:00:00.000Z'));
  });

  it('does not credit unrelated, initial, or same-day jobs', () => {
    const progress = recoverWarmupProgress('account-1', [
      {
        accountId: 'account-2',
        bullmqJobId: 'warmup-task-account-2-day8-s0',
        createdAt: new Date(),
        config: { warmupDays: 10 },
        status: 'FAILED',
      },
      {
        accountId: 'account-1',
        bullmqJobId: '319',
        createdAt: new Date(),
        config: { warmupDays: 5 },
        status: 'FAILED',
      },
      {
        accountId: 'account-1',
        bullmqJobId: 'warmup-task-account-1-day1-s3',
        createdAt: new Date(),
        config: { warmupDays: 5 },
        status: 'FAILED',
      },
    ]);

    expect(progress.completedDays).toBe(0);
  });
});
