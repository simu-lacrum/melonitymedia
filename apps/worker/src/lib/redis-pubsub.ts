// ─────────────────────────────────────────────────────────────
// Redis Pub/Sub — 2FA Code Exchange between API and Worker
//
// Flow:
// 1. Worker detects 2FA challenge → emits login:2fa_required via Socket.io
// 2. Frontend shows code input dialog → user enters code
// 3. API receives POST /accounts/:id/verify-code → publishes to Redis channel
// 4. Worker subscribes to channel → receives code → enters it in browser
//
// Resend flow:
// 1. User clicks "Отправить повторно" in frontend
// 2. API receives POST /accounts/:id/resend-code → publishes __RESEND__ command
// 3. Worker receives __RESEND__ → clicks resend button in browser → keeps waiting
//
// Channel format: verification_code:{accountId}
// Message format: JSON { code: string, timestamp: number }
//   Special: { code: "__RESEND__", timestamp: number } = resend request
// ─────────────────────────────────────────────────────────────

import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/** Sentinel value for "please click resend in browser" */
export const RESEND_COMMAND = '__RESEND__';

/**
 * Result of waiting for a verification code.
 */
export type VerificationResult =
  | { type: 'code'; code: string }
  | { type: 'resend' }
  | { type: 'timeout' };

/**
 * Wait for a verification code from the user via Redis pub/sub.
 * Can receive either a real code or a RESEND command.
 *
 * @param accountId - The account waiting for verification
 * @param timeoutMs - Max wait time (default 10 minutes)
 */
export async function waitForVerificationCode(
  accountId: string,
  timeoutMs: number = 10 * 60 * 1000,
): Promise<string | null> {
  const result = await waitForVerificationResult(accountId, timeoutMs);
  if (result.type === 'code') return result.code;
  return null;
}

/**
 * Wait for a verification result (code, resend, or timeout).
 * Used by the login handler to support resend functionality.
 */
export async function waitForVerificationResult(
  accountId: string,
  timeoutMs: number = 10 * 60 * 1000,
): Promise<VerificationResult> {
  const channel = `verification_code:${accountId}`;
  const subscriber = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

  return new Promise<VerificationResult>((resolve) => {
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
      resolve({ type: 'timeout' });
    }, timeoutMs);

    subscriber.subscribe(channel, (err) => {
      if (err) {
        console.error(`[RedisPubSub] Subscribe error for ${channel}:`, err);
        clearTimeout(timer);
        cleanup();
        resolve({ type: 'timeout' });
      }
    });

    subscriber.on('message', (_ch, message) => {
      try {
        const data = JSON.parse(message);
        if (data.code && typeof data.code === 'string') {
          clearTimeout(timer);
          cleanup();
          if (data.code === RESEND_COMMAND) {
            resolve({ type: 'resend' });
          } else {
            resolve({ type: 'code', code: data.code.trim() });
          }
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

/**
 * Publish a resend command to a waiting worker.
 * Called by the API when user clicks "Resend code".
 */
export async function publishResendCommand(
  accountId: string,
): Promise<void> {
  await publishVerificationCode(accountId, RESEND_COMMAND);
}
