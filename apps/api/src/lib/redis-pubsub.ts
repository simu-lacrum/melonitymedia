// ─────────────────────────────────────────────────────────────
// Redis Pub/Sub — API-side publisher for 2FA verification codes
//
// When the user enters a verification code in the frontend,
// the API publishes it to a Redis channel that the Worker
// is subscribed to. This allows asynchronous 2FA flow.
// ─────────────────────────────────────────────────────────────

import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Publish a verification code so the waiting Worker can pick it up.
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
