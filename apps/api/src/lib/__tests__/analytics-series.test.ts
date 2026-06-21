import { describe, expect, it } from 'vitest';
import { buildDailyDeltaSeries } from '../analytics-series.js';

describe('buildDailyDeltaSeries', () => {
  it('returns daily view deltas from cumulative snapshots', () => {
    const data = buildDailyDeltaSeries(new Date('2026-06-19T00:00:00Z'), 3, [
      { date: '2026-06-18', views: 100, followers: 10, likes: 7 },
      { date: '2026-06-19', views: 130, followers: 11, likes: 9 },
      { date: '2026-06-20', views: 180, followers: 11, likes: 12 },
      { date: '2026-06-21', views: 175, followers: 12, likes: 13 },
    ]);

    expect(data).toEqual([
      { date: '2026-06-19', views: 30, followers: 11, likes: 2 },
      { date: '2026-06-20', views: 50, followers: 11, likes: 3 },
      { date: '2026-06-21', views: 0, followers: 12, likes: 1 },
    ]);
  });

  it('does not invent first-day activity when no previous snapshot exists', () => {
    const data = buildDailyDeltaSeries(new Date('2026-06-20T00:00:00Z'), 2, [
      { date: '2026-06-20', views: 500, followers: 20, likes: 50 },
      { date: '2026-06-21', views: 620, followers: 21, likes: 70 },
    ]);

    expect(data).toEqual([
      { date: '2026-06-20', views: 0, followers: 20, likes: 0 },
      { date: '2026-06-21', views: 120, followers: 21, likes: 20 },
    ]);
  });
});
