import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

const prismaMock = mockDeep<PrismaClient>();
vi.mock('../prisma.js', () => ({
  get prisma() { return prismaMock; }
}));

import { loadAccountContext } from '../account-context.js';

beforeEach(() => mockReset(prismaMock));

describe('loadAccountContext', () => {
  it('throws if fingerprint missing', async () => {
    (prismaMock.socialAccount.findUniqueOrThrow as any).mockResolvedValue({
      id: 'a1', userId: 'u1', platform: 'TIKTOK',
      fingerprint: null, pinnedProxy: null,
      warmupCompletedAt: null, warmupStartedAt: null, warmupDays: 10,
      status: 'ALIVE',
    });
    await expect(loadAccountContext('a1')).rejects.toThrow(/no fingerprint/);
  });

  it('builds proxyUrl with URL-encoded auth', async () => {
    (prismaMock.socialAccount.findUniqueOrThrow as any).mockResolvedValue({
      id: 'a1', userId: 'u1', platform: 'TIKTOK',
      fingerprint: { /* whatever, opaque to the resolver */ } as any,
      pinnedProxy: {
        host: '1.2.3.4', port: 8000,
        username: 'u@me', password: 'p@ss',
        carrier: 'T-Mobile', country: 'US',
      },
      warmupCompletedAt: new Date(), warmupStartedAt: new Date(), warmupDays: 10,
      status: 'ALIVE',
    });
    const ctx = await loadAccountContext('a1');
    expect(ctx.proxyUrl).toBe('http://u%40me:p%40ss@1.2.3.4:8000');
    expect(ctx.carrier).toBe('T-Mobile');
  });

  it('returns proxyUrl=undefined when no proxy pinned', async () => {
    (prismaMock.socialAccount.findUniqueOrThrow as any).mockResolvedValue({
      id: 'a1', userId: 'u1', platform: 'TIKTOK',
      fingerprint: {} as any,
      pinnedProxy: null,
      warmupCompletedAt: null, warmupStartedAt: null, warmupDays: 10,
      status: 'ALIVE',
    });
    const ctx = await loadAccountContext('a1');
    expect(ctx.proxyUrl).toBeUndefined();
  });
});
