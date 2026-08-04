import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  analyticsCronQueue,
  cookiesQueue,
  shadowbanCheckQueue,
  findMany,
} = vi.hoisted(() => ({
  analyticsCronQueue: {
    add: vi.fn(),
    getRepeatableJobs: vi.fn(),
    removeRepeatableByKey: vi.fn(),
  },
  cookiesQueue: { add: vi.fn() },
  shadowbanCheckQueue: { add: vi.fn() },
  findMany: vi.fn(),
}));

vi.mock('../bullmq.js', () => ({
  analyticsCronQueue,
  cookiesQueue,
  shadowbanCheckQueue,
}));

vi.mock('../prisma.js', () => ({
  prisma: {
    socialAccount: { findMany },
  },
}));

import {
  ANALYTICS_CRON_PATTERN,
  fanOutAnalyticsJobs,
  registerCronJobs,
} from '../cron-scheduler.js';

describe('daily analytics cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    analyticsCronQueue.add.mockResolvedValue(undefined);
    analyticsCronQueue.removeRepeatableByKey.mockResolvedValue(undefined);
    cookiesQueue.add.mockResolvedValue(undefined);
    shadowbanCheckQueue.add.mockResolvedValue(undefined);
  });

  it('removes obsolete analytics repeatables and registers one daily UTC run', async () => {
    analyticsCronQueue.getRepeatableJobs.mockResolvedValue([
      { name: 'analytics-dispatch', pattern: '0 */6 * * *', key: 'old-six-hour-job' },
      { name: 'analytics-dispatch', pattern: ANALYTICS_CRON_PATTERN, key: 'current-job' },
      { name: 'another-job', pattern: '0 */6 * * *', key: 'unrelated-job' },
    ]);

    await registerCronJobs();

    expect(analyticsCronQueue.removeRepeatableByKey).toHaveBeenCalledTimes(1);
    expect(analyticsCronQueue.removeRepeatableByKey).toHaveBeenCalledWith('old-six-hour-job');
    expect(analyticsCronQueue.add).toHaveBeenCalledWith(
      'analytics-dispatch',
      { _cron: true },
      expect.objectContaining({
        repeat: { pattern: '15 3 * * *', tz: 'UTC' },
      }),
    );
  });

  it('fans out once per connected account with a deterministic daily job id', async () => {
    analyticsCronQueue.getRepeatableJobs.mockResolvedValue([]);
    findMany.mockResolvedValue([
      { id: 'account-1', userId: 'user-1', secUid: null, nickname: null },
    ]);

    await expect(fanOutAnalyticsJobs()).resolves.toBe(1);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: { in: ['ALIVE', 'WARMING_UP'] },
        cookiesEncrypted: { not: null },
        pinnedProxy: { is: { status: 'ACTIVE' } },
      },
    }));
    expect(analyticsCronQueue.add).toHaveBeenCalledWith(
      'analytics-account-1',
      expect.objectContaining({
        accountId: 'account-1',
        coordinationAttempt: 0,
      }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^analytics-account-1-\d{4}-\d{2}-\d{2}$/),
      }),
    );
  });
});
