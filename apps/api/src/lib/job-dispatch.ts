// ─────────────────────────────────────────────────────────────
// Job Dispatch — Per-account enrichment layer for BullMQ jobs
//
// Solves the API↔Worker payload disconnect: the old POST /launch
// dispatched a single bulk job with {taskId, accountIds, config},
// but workers expect per-account payloads with fingerprint, proxy
// URL, and cookies reference.
//
// This module:
// 1. Validates account readiness (proxy, fingerprint, cookies, warmup)
// 2. Builds proxy URL with real credentials (NEVER logged)
// 3. Enriches payload with fingerprint + secUid + platform
// 4. Dispatches one BullMQ job per account
// ─────────────────────────────────────────────────────────────

import { prisma } from "./prisma.js";
import { addJob } from "./bullmq.js";
import { redis } from "./redis.js";
import type { QueueName } from "./bullmq.js";

const LOCK_PREFIX = 'account-browser-lock:';

/**
 * Check if an account has an active browser lock in Redis.
 * Returns the job type holding the lock, or null if free.
 */
async function checkAccountLock(accountId: string): Promise<string | null> {
  try {
    return await redis.get(`${LOCK_PREFIX}${accountId}`);
  } catch {
    return null; // Redis error — allow job (best effort)
  }
}

/**
 * Build a proxy URL with real credentials for worker use.
 * NEVER log this string — credentials are inline.
 *
 * Output: http://user:pass@host:port / socks5://user:pass@host:port.
 */
export function buildProxyUrlWithCreds(proxy: {
  host: string;
  port: number;
  protocol?: string | null;
  username?: string | null;
  password?: string | null;
}): string {
  const scheme = proxy.protocol === 'SOCKS5' ? 'socks5' : 'http';
  if (proxy.username && proxy.password) {
    const u = encodeURIComponent(proxy.username);
    const p = encodeURIComponent(proxy.password);
    return `${scheme}://${u}:${p}@${proxy.host}:${proxy.port}`;
  }
  return `${scheme}://${proxy.host}:${proxy.port}`;
}

export interface DispatchedJob {
  accountId: string;
  jobId: string | null;
  error?: string;
}

/**
 * Enrich one account into a fully-formed worker payload and dispatch it.
 * Returns the new BullMQ job id or an error message (one of):
 *   - "NO_ACCOUNT"       — account not found or doesn't belong to user
 *   - "NO_PROXY"         — account has no pinned proxy
 *   - "NO_FINGERPRINT"   — fingerprint not generated (bad import)
 *   - "NO_COOKIES"       — no encrypted cookies on file
 *   - "WARMUP_REQUIRED"  — upload requested but warmupCompletedAt is null
 */
export async function dispatchAccountJob(args: {
  queueName: "upload" | "warmup" | "cookies" | "edit-profile" | "shadowban-check" | "login";
  userId: string;
  accountId: string;
  /** Job-type-specific extra fields (video paths, etc.) */
  extra: Record<string, unknown>;
  /** Allow upload even without warmup (user acknowledged risk via ?force=true ADMIN flow) */
  forceSkipWarmup?: boolean;
  /** BullMQ delay in ms before the job becomes processable */
  delay?: number;
}): Promise<DispatchedJob> {
  const account = await prisma.socialAccount.findFirst({
    where: { id: args.accountId, userId: args.userId },
    include: { pinnedProxy: true },
  });

  if (!account) return { accountId: args.accountId, jobId: null, error: "NO_ACCOUNT" };

  // ── Check if account is already running a task ────────────
  // Uses the same Redis lock that workers acquire when they start a browser session.
  // This prevents queuing a second task while one is active — the user sees an
  // error immediately, and the running task is NOT interrupted.
  const currentLockHolder = await checkAccountLock(account.id);
  if (currentLockHolder) {
    return {
      accountId: account.id,
      jobId: null,
      error: `ACCOUNT_BUSY:${currentLockHolder}`,
    };
  }

  // M-7 FIX: Reject jobs for accounts in invalid states
  // Login queue is exempt — it's used to fix auth issues
  const blockedStatuses = ['BANNED', 'SHADOWBAN_SUSPECTED', 'PAUSED'];
  if (args.queueName !== 'login' && blockedStatuses.includes(account.status)) {
    return { accountId: args.accountId, jobId: null, error: `ACCOUNT_${account.status}` };
  }

  // Upload-specific guards
  if (args.queueName === "upload") {
    if (!account.warmupCompletedAt && !args.forceSkipWarmup) {
      return { accountId: args.accountId, jobId: null, error: "WARMUP_REQUIRED" };
    }
  }

  if (!account.pinnedProxy && args.queueName !== 'login') {
    return { accountId: args.accountId, jobId: null, error: "NO_PROXY" };
  }

  if (account.pinnedProxy) {
    const accountAgeDays = (Date.now() - account.createdAt.getTime()) / 86_400_000;
    if (accountAgeDays < 30 && account.pinnedProxy.type !== 'LTE_MOBILE') {
      return {
        accountId: args.accountId,
        jobId: null,
        error: 'PROXY_NOT_LTE_FOR_YOUNG_ACCOUNT',
      };
    }
  }

  if (!account.fingerprint && args.queueName !== 'login') {
    return { accountId: args.accountId, jobId: null, error: "NO_FINGERPRINT" };
  }

  if (!account.cookiesEncrypted && args.queueName !== 'login') {
    return { accountId: args.accountId, jobId: null, error: "NO_COOKIES" };
  }

  // NOTE: fingerprint, proxyUrl, and platform are intentionally NOT included
  // in the BullMQ payload. Workers resolve them fresh from the DB via
  // loadAccountContext(accountId) — this prevents stale-data crashes when
  // proxy is re-pinned or fingerprint is regenerated while a job sits in
  // the queue.
  const payload = {
    userId: args.userId,
    accountId: account.id,
    ...args.extra,
  };

  const jobId = await addJob(args.queueName as QueueName, payload as Record<string, unknown>, args.delay ? { delay: args.delay } : undefined);
  return { accountId: account.id, jobId: jobId ?? null };
}
