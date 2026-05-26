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
import type { QueueName } from "./bullmq.js";

/**
 * Build a proxy URL with real credentials for worker use.
 * NEVER log this string — credentials are inline.
 *
 * Output: http://user:pass@host:port  (or http://host:port if no auth)
 */
export function buildProxyUrlWithCreds(proxy: {
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
}): string {
  if (proxy.username && proxy.password) {
    const u = encodeURIComponent(proxy.username);
    const p = encodeURIComponent(proxy.password);
    return `http://${u}:${p}@${proxy.host}:${proxy.port}`;
  }
  return `http://${proxy.host}:${proxy.port}`;
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
  queueName: "upload" | "warmup" | "cookies" | "edit-profile" | "shadowban-check";
  userId: string;
  accountId: string;
  /** Job-type-specific extra fields (video paths, etc.) */
  extra: Record<string, unknown>;
  /** Allow upload even without warmup (user acknowledged risk via ?force=true ADMIN flow) */
  forceSkipWarmup?: boolean;
}): Promise<DispatchedJob> {
  const account = await prisma.socialAccount.findFirst({
    where: { id: args.accountId, userId: args.userId },
    include: { pinnedProxy: true },
  });

  if (!account) return { accountId: args.accountId, jobId: null, error: "NO_ACCOUNT" };

  // Upload-specific guards
  if (args.queueName === "upload") {
    if (!account.warmupCompletedAt && !args.forceSkipWarmup) {
      return { accountId: args.accountId, jobId: null, error: "WARMUP_REQUIRED" };
    }
  }

  if (!account.pinnedProxy) {
    return { accountId: args.accountId, jobId: null, error: "NO_PROXY" };
  }

  if (!account.fingerprint) {
    return { accountId: args.accountId, jobId: null, error: "NO_FINGERPRINT" };
  }

  if (!account.cookiesEncrypted) {
    return { accountId: args.accountId, jobId: null, error: "NO_COOKIES" };
  }

  const proxyUrl = buildProxyUrlWithCreds(account.pinnedProxy);

  const payload = {
    userId: args.userId,
    accountId: account.id,
    platform: account.platform,
    nickname: account.nickname,
    secUid: account.secUid,
    fingerprint: account.fingerprint,
    proxyUrl,
    // cookies are NOT inlined into the queue — worker reads them straight from DB
    // via loadCookiesForAccount(accountId), keeping payloads small and
    // leaving cookie material out of BullMQ history.
    ...args.extra,
  };

  const jobId = await addJob(args.queueName as QueueName, payload as Record<string, unknown>);
  return { accountId: account.id, jobId: jobId ?? null };
}
