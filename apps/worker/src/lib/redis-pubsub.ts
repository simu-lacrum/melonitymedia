// ─────────────────────────────────────────────────────────────
// Redis Pub/Sub — 2FA Code Exchange between API and Worker
//
// Flow:
// 1. Worker detects 2FA challenge → emits login:2fa_required via Socket.io
// 2. Frontend shows code input dialog → user enters code
// 3. API receives POST /accounts/:id/verify-code → publishes to Redis channel
// 4. Worker subscribes to channel → receives code → enters it in browser
//
// Channel format: verification_code:{accountId}
// Message format: JSON { code: string, timestamp: number }
// ─────────────────────────────────────────────────────────────

import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Wait for a verification code from the user via Redis pub/sub.
 * Returns the code string or null if timeout expires.
 *
 * @param accountId - The account waiting for verification
 * @param timeoutMs - Max wait time (default 10 minutes)
 */
export async function waitForVerificationCode(
  accountId: string,
  timeoutMs: number = 10 * 60 * 1000,
): Promise<string | null> {
  const channel = `verification_code:${accountId}`;
  const subscriber = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

  return new Promise<string | null>((resolve) => {
    let resolved = false;
    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        subscriber.unsubscribe(channel).catch(() => {});
        subscriber.quit().catch(() => {});
      }
    };

    // Timeout
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    subscriber.subscribe(channel, (err) => {
      if (err) {
        console.error(`[RedisPubSub] Subscribe error for ${channel}:`, err);
        clearTimeout(timer);
        cleanup();
        resolve(null);
      }
    });

    subscriber.on('message', (_ch, message) => {
      try {
        const data = JSON.parse(message);
        if (data.code && typeof data.code === 'string') {
          clearTimeout(timer);
          cleanup();
          resolve(data.code.trim());
        }
      } catch {
        // Invalid message, ignore
      }
    });
  });
}

/**
 * Publish a verification code to a waiting worker.
 * Called by the API when user submits the 2FA code.
 */
export async function publishVerificationCode(
  accountId: string,
  code: string,
): Promise<void> {
  const publisher = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  const channel = `verification_code:${accountId}`;
  await publisher.publish(
    channel,
    JSON.stringify({ code, timestamp: Date.now() }),
  );
  await publisher.quit();
}
