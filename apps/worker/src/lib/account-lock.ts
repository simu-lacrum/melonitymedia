// ─────────────────────────────────────────────────────────────
// Per-Account Browser Lock
//
// Prevents two browser-heavy jobs from running simultaneously
// for the same account. If warmup is running and analytics cron
// fires, the analytics job skips rather than opening a second
// browser with a potentially different proxy/fingerprint state.
//
// Uses Redis SET with NX (set-if-not-exists) + EX (auto-expire).
// Auto-expiry prevents deadlocks if a worker crashes mid-job.
//
// Lock key format: account-browser-lock:{accountId}
// Lock value: job type string (e.g., "warmup", "upload", "login")
// TTL: 4 hours by default. Uploads, manual checks, captcha waits, and slow
// platform processing can exceed 30 minutes; too-short locks allow a second
// browser session to start on the same account while the first is still alive.
// ─────────────────────────────────────────────────────────────

import Redis from 'ioredis';

const LOCK_TTL_SECONDS = Number(process.env.ACCOUNT_LOCK_TTL_SECONDS ?? 4 * 60 * 60);
const LOCK_PREFIX = 'account-browser-lock:';

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    _redis.connect().catch(() => {
      console.warn('[account-lock] Redis connection failed');
    });
  }
  return _redis;
}

/**
 * Try to acquire a per-account browser lock.
 *
 * @param accountId - Account ID to lock
 * @param jobType - Job type name (for logging: "warmup", "upload", "login", "analytics")
 * @returns Lock holder name if already locked (null = lock acquired successfully)
 */
export async function acquireAccountLock(
  accountId: string,
  jobType: string,
): Promise<string | null> {
  try {
    const redis = getRedis();
    const key = `${LOCK_PREFIX}${accountId}`;

    // SET NX = only set if key does NOT exist
    const result = await redis.set(key, jobType, 'EX', LOCK_TTL_SECONDS, 'NX');

    if (result === 'OK') {
      return null; // lock acquired
    }

    // Lock exists — return the holder
    const holder = await redis.get(key);
    return holder || 'unknown';
  } catch {
    // Redis failure — allow job to proceed (best effort)
    console.warn(`[account-lock] Redis error on acquire for ${accountId} — allowing job`);
    return null;
  }
}

/**
 * Release a per-account browser lock.
 * Only releases if the lock is held by the specified jobType (safety check).
 *
 * @param accountId - Account ID to unlock
 * @param jobType - Job type that holds the lock
 */
export async function releaseAccountLock(
  accountId: string,
  jobType: string,
): Promise<void> {
  try {
    const redis = getRedis();
    const key = `${LOCK_PREFIX}${accountId}`;

    // Only delete if WE hold the lock (Lua atomic check-and-delete)
    await redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
      1,
      key,
      jobType,
    );
  } catch {
    // Best effort — TTL will clean up
    console.warn(`[account-lock] Redis error on release for ${accountId}`);
  }
}

/**
 * Check if an account is currently locked (browser session active).
 *
 * @param accountId - Account ID to check
 * @returns Job type holding the lock, or null if unlocked
 */
export async function checkAccountLock(accountId: string): Promise<string | null> {
  try {
    const redis = getRedis();
    return await redis.get(`${LOCK_PREFIX}${accountId}`);
  } catch {
    return null;
  }
}
