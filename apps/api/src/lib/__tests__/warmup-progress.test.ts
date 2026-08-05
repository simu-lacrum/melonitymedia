import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  socialAccount: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  task: {
    findMany: vi.fn(),
  },
}));

vi.mock('../prisma.js', () => ({ prisma: prismaMock }));

import { reconcileUserWarmupProgress } from '../warmup-progress.js';

const resetAccount = {
  id: 'account-1',
  status: 'WARMING_UP',
  warmupDays: 5,
  warmupStartedAt: new Date('2026-08-05T08:00:00.000Z'),
  warmupCompletedAt: null,
  lastWarmupDay: null,
};

describe('warmup progress reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.socialAccount.update.mockResolvedValue({});
  });

  it('restores four completed days without falsely opening a five-day gate', async () => {
    prismaMock.socialAccount.findMany.mockResolvedValue([resetAccount]);
    prismaMock.task.findMany.mockResolvedValue([{
      accountId: 'account-1',
      bullmqJobId: 'warmup-old-account-1-day5-s0',
      completedAt: null,
      createdAt: new Date('2026-08-01T08:00:00.000Z'),
      config: { accountIds: ['account-1'], warmupDays: 5 },
      status: 'FAILED',
    }]);

    const result = await reconcileUserWarmupProgress('user-1', ['account-1']);

    expect(result.repaired).toEqual([{
      accountId: 'account-1',
      completed: false,
      recoveredDay: 4,
      totalDays: 5,
    }]);
    expect(prismaMock.socialAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      data: expect.objectContaining({
        lastWarmupDay: 4,
        warmupCompletedAt: null,
        warmupDays: 5,
      }),
    });
  });

  it('restores permanent upload readiness from a completed parent task', async () => {
    prismaMock.socialAccount.findMany.mockResolvedValue([resetAccount]);
    prismaMock.task.findMany.mockResolvedValue([{
      accountId: 'account-1',
      bullmqJobId: 'warmup-old-account-1-day4-s2',
      completedAt: new Date('2026-08-04T18:00:00.000Z'),
      createdAt: new Date('2026-08-01T08:00:00.000Z'),
      config: { accountIds: ['account-1'], warmupDays: 4 },
      status: 'COMPLETED',
    }]);

    const result = await reconcileUserWarmupProgress('user-1');

    expect(result.repaired[0]).toEqual({
      accountId: 'account-1',
      completed: true,
      recoveredDay: 4,
      totalDays: 4,
    });
    expect(prismaMock.socialAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      data: expect.objectContaining({
        status: 'ALIVE',
        lastWarmupDay: 4,
        warmupDays: 4,
        warmupCompletedAt: new Date('2026-08-04T18:00:00.000Z'),
      }),
    });
  });

  it('leaves accounts unchanged when history contains no stronger evidence', async () => {
    prismaMock.socialAccount.findMany.mockResolvedValue([{
      ...resetAccount,
      status: 'ALIVE',
      warmupStartedAt: new Date('2026-08-01T08:00:00.000Z'),
      lastWarmupDay: 2,
    }]);
    prismaMock.task.findMany.mockResolvedValue([{
      accountId: 'account-1',
      bullmqJobId: 'warmup-old-account-1-day2-s1',
      completedAt: null,
      createdAt: new Date('2026-08-01T08:00:00.000Z'),
      config: { warmupDays: 5 },
      status: 'FAILED',
    }]);

    const result = await reconcileUserWarmupProgress('user-1');

    expect(result.repaired).toEqual([]);
    expect(prismaMock.socialAccount.update).not.toHaveBeenCalled();
  });

  it('keeps the strongest completed curriculum after a shorter accidental restart', async () => {
    prismaMock.socialAccount.findMany.mockResolvedValue([{
      ...resetAccount,
      status: 'ALIVE',
      warmupDays: 2,
      warmupCompletedAt: new Date('2026-08-04T18:00:00.000Z'),
      lastWarmupDay: 5,
    }]);
    prismaMock.task.findMany.mockResolvedValue([]);

    const result = await reconcileUserWarmupProgress('user-1');

    expect(result.repaired).toEqual([{
      accountId: 'account-1',
      completed: true,
      recoveredDay: 5,
      totalDays: 5,
    }]);
    expect(prismaMock.socialAccount.update).toHaveBeenCalledWith({
      where: { id: 'account-1' },
      data: expect.objectContaining({
        warmupDays: 5,
        lastWarmupDay: 5,
        warmupCompletedAt: new Date('2026-08-04T18:00:00.000Z'),
      }),
    });
  });
});
