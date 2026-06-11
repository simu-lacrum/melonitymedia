// ─────────────────────────────────────────────────────────────
// Redis Pub/Sub — API-side publisher for 2FA verification codes
//
// When the user enters a verification code in the frontend,
// the API publishes it to a Redis channel that the Worker
// is subscribed to. This allows asynchronous 2FA flow.
//
// Also supports RESEND command: frontend → API → Redis → Worker
// clicks "Resend code" in browser → continues waiting.
// ─────────────────────────────────────────────────────────────

import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/** Sentinel value: tells the worker to click "Resend" in the browser */
export const RESEND_COMMAND = '__RESEND__';

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

/**
 * Tell the Worker to click "Resend code" in the browser and keep waiting.
 */
export async function publishResendCommand(
  accountId: string,
): Promise<void> {
  await publishVerificationCode(accountId, RESEND_COMMAND);
}
