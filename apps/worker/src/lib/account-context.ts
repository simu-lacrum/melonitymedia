// apps/worker/src/lib/account-context.ts
//
// Resolve everything a handler needs about an account from the DB,
// using only the accountId as input. Handlers must NEVER receive
// fingerprint / proxyUrl / platform in their BullMQ payload —
// those can go stale while the job sits in the queue (proxy got
// re-pinned, fingerprint marked stale, account banned).

import { prisma } from './prisma.js';
import type { AccountFingerprint } from '../core/browser/fingerprint-manager.js';

export interface AccountContext {
  accountId: string;
  userId: string;
  platform: 'TIKTOK' | 'YOUTUBE';
  fingerprint: AccountFingerprint;
  proxyUrl: string | undefined;
  carrier: string | null;
  country: string;
  warmupCompletedAt: Date | null;
  warmupStartedAt: Date | null;
  warmupDays: number;
  status: string;
}

export async function loadAccountContext(accountId: string): Promise<AccountContext> {
  const acc = await prisma.socialAccount.findUniqueOrThrow({
    where: { id: accountId },
    include: {
      pinnedProxy: {
        select: {
          host: true,
          port: true,
          username: true,
          password: true,
          carrier: true,
          country: true,
        },
      },
    },
  });

  if (!acc.fingerprint) {
    throw new Error(
      `[account-context] Account ${accountId} has no fingerprint. ` +
      `Re-import the account via POST /api/accounts/import.`,
    );
  }

  const rawFp = acc.fingerprint as Record<string, unknown>;
  const fingerprint = {
    deviceClass: 'desktop',
    ...rawFp,
  } as unknown as AccountFingerprint;

  return {
    accountId: acc.id,
    userId: acc.userId,
    platform: acc.platform,
    fingerprint,
    proxyUrl: acc.pinnedProxy ? buildProxyUrl(acc.pinnedProxy) : undefined,
    carrier: acc.pinnedProxy?.carrier ?? null,
    country: acc.pinnedProxy?.country ?? 'US',
    warmupCompletedAt: acc.warmupCompletedAt,
    warmupStartedAt: acc.warmupStartedAt,
    warmupDays: acc.warmupDays ?? 10,
    status: acc.status,
  };
}

function buildProxyUrl(p: {
  host: string;
  port: number;
  username: string | null;
  password: string | null;
}): string {
  const auth =
    p.username && p.password
      ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password)}@`
      : '';
  return `http://${auth}${p.host}:${p.port}`;
}
