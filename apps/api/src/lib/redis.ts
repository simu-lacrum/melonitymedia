// ─────────────────────────────────────────────────────────────
// Redis Client Singleton (ioredis)
// Used for: BullMQ broker, firewall IP blacklist, session cache.
// Why ioredis over node-redis? Better TypeScript support,
// built-in reconnection, cluster-ready, Lua scripting.
// ─────────────────────────────────────────────────────────────

import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: true,
  retryStrategy(times: number) {
    // Exponential backoff: 50ms, 100ms, 200ms... max 30s
    const delay = Math.min(times * 50, 30000);
    console.log(`[Redis] Reconnecting in ${delay}ms (attempt ${times})`);
    return delay;
  },
});

redis.on('connect', () => {
  console.log('[Redis] Connected successfully');
});

redis.on('error', (err: Error) => {
  console.error('[Redis] Connection error:', err.message);
});
