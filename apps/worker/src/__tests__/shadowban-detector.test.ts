import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

// Mock prisma BEFORE importing the detector — module-level singleton.
const prismaMock = mockDeep<PrismaClient>();
vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }));

// Mock SocketLogger to avoid real socket.io connection
vi.mock('../lib/socket-logger.js', () => ({
  SocketLogger: vi.fn().mockImplementation(function() {
    return {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      disconnect: vi.fn(),
    };
  }),
}));

let detectShadowbanForAccount: any;

describe('detectShadowbanForAccount', () => {
  beforeAll(async () => {
    const module = await import('../handlers/shadowban-detector.js');
    detectShadowbanForAccount = module.detectShadowbanForAccount;
  });

  beforeEach(() => {
    mockReset(prismaMock);
  });

  const baseAccount = {
    id: 'acc-1',
    userId: 'user-1',
    nickname: '@melon',
    status: 'ALIVE' as const,
    warmupCompletedAt: new Date('2026-05-01'),
  };

  it('returns flagged:false when account is not ALIVE', async () => {
    prismaMock.socialAccount.findUniqueOrThrow.mockResolvedValue({
      ...baseAccount,
      status: 'BANNED' as any,
    } as any);

    const result = await detectShadowbanForAccount('acc-1');
    expect(result.flagged).toBe(false);
    expect(prismaMock.video.findMany).not.toHaveBeenCalled();
  });

  it('returns flagged:false when warmupCompletedAt is null', async () => {
    prismaMock.socialAccount.findUniqueOrThrow.mockResolvedValue({
      ...baseAccount,
      warmupCompletedAt: null,
    } as any);

    const result = await detectShadowbanForAccount('acc-1');
    expect(result.flagged).toBe(false);
  });

  it('returns flagged:false when fewer than 3 candidate videos exist', async () => {
    prismaMock.socialAccount.findUniqueOrThrow.mockResolvedValue(baseAccount as any);
    prismaMock.video.findMany.mockResolvedValue([
      { id: 'v1', views: 5, uploadedAt: new Date() },
      { id: 'v2', views: 8, uploadedAt: new Date() },
    ] as any);

    const result = await detectShadowbanForAccount('acc-1');
    expect(result.flagged).toBe(false);
    expect(prismaMock.socialAccount.update).not.toHaveBeenCalled();
  });

  it('returns flagged:false when any video has >= 100 views', async () => {
    prismaMock.socialAccount.findUniqueOrThrow.mockResolvedValue(baseAccount as any);
    prismaMock.video.findMany.mockResolvedValue([
      { id: 'v1', views: 5, uploadedAt: new Date() },
      { id: 'v2', views: 150, uploadedAt: new Date() },
      { id: 'v3', views: 8, uploadedAt: new Date() },
    ] as any);

    const result = await detectShadowbanForAccount('acc-1');
    expect(result.flagged).toBe(false);
    expect(prismaMock.socialAccount.update).not.toHaveBeenCalled();
  });

  it('flags account and cancels PENDING upload tasks when 3 consecutive low-view videos exist', async () => {
    prismaMock.socialAccount.findUniqueOrThrow.mockResolvedValue(baseAccount as any);
    prismaMock.video.findMany.mockResolvedValue([
      { id: 'v1', views: 5, uploadedAt: new Date() },
      { id: 'v2', views: 12, uploadedAt: new Date() },
      { id: 'v3', views: 3, uploadedAt: new Date() },
    ] as any);
    prismaMock.socialAccount.update.mockResolvedValue({} as any);
    prismaMock.task.updateMany.mockResolvedValue({ count: 2 } as any);

    const result = await detectShadowbanForAccount('acc-1');

    expect(result.flagged).toBe(true);
    expect(result.matchedVideos).toEqual(['v1', 'v2', 'v3']);

    // exact toHaveBeenCalledWith — verifies the cancel-cascade payload byte-for-byte
    expect(prismaMock.socialAccount.update).toHaveBeenCalledWith({
      where: { id: 'acc-1' },
      data: { status: 'SHADOWBAN_SUSPECTED' },
    });
    expect(prismaMock.task.updateMany).toHaveBeenCalledWith({
      where: { accountId: 'acc-1', status: 'PENDING', type: 'UPLOAD' },
      data: { status: 'CANCELLED', cancelReason: 'SHADOWBAN_SUSPECTED' },
    });
  });

  it('uses 24h age gate — fresh videos must NOT be queried', async () => {
    prismaMock.socialAccount.findUniqueOrThrow.mockResolvedValue(baseAccount as any);
    prismaMock.video.findMany.mockResolvedValue([] as any);

    await detectShadowbanForAccount('acc-1');

    const findManyCall = prismaMock.video.findMany.mock.calls[0][0]!;
    const where = findManyCall.where as any;
    expect(where.uploadedAt).toHaveProperty('lte');
    expect(where.uploadedAt).toHaveProperty('gte');

    const lte = where.uploadedAt.lte as Date;
    const gte = where.uploadedAt.gte as Date;
    const now = Date.now();

    // lte should be ~24h ago (within 5 sec of now-24h)
    expect(now - lte.getTime()).toBeGreaterThan(86_400_000 - 5000);
    expect(now - lte.getTime()).toBeLessThan(86_400_000 + 5000);

    // gte should be ~14 days ago
    expect(now - gte.getTime()).toBeGreaterThan(14 * 86_400_000 - 5000);
    expect(now - gte.getTime()).toBeLessThan(14 * 86_400_000 + 5000);
  });
});
