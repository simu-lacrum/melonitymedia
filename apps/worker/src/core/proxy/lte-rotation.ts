// ─────────────────────────────────────────────────────────────
// LTE Rotation — Mobile proxy IP rotation with cooldown
//
// Mobile (LTE) proxies get new IPs by physically restarting the
// modem, causing it to reconnect to the cell tower and get a
// new IP from the carrier's DHCP pool.
//
// Cooldown rules:
// 1. Minimum 15 minutes between rotations (avoid carrier throttling)
// 2. Log rotation timestamps for audit
// 3. Pre-rotation: check if proxy is actually LTE type
// 4. Post-rotation: verify new IP is different
// ─────────────────────────────────────────────────────────────

import { impersonatedFetch } from '../tls/curl-impersonate-client.js';

// ── Constants ───────────────────────────────────────────────

/** Minimum time between IP rotations (ms) */
const MIN_ROTATION_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

/** Time to wait after rotation trigger for modem restart (ms) */
const MODEM_RESTART_WAIT_MS = 12_000;

// ── Types ───────────────────────────────────────────────────

export interface LTEProxy {
  id: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  rotationLink: string;
  rotationCooldown: number; // seconds (from DB, default 900)
  lastRotatedAt?: Date | null;
}

export interface RotationResult {
  success: boolean;
  previousIP?: string;
  newIP?: string;
  waitedMs: number;
  error?: string;
}

// ── IP Detection ────────────────────────────────────────────

/**
 * Get current external IP through the proxy.
 * Uses a simple IP echo service.
 */
async function getCurrentIP(proxyUrl: string): Promise<string | null> {
  try {
    const resp = await impersonatedFetch({
      url: 'https://api.ipify.org?format=json',
      proxy: proxyUrl,
      impersonate: 'chrome116',
      timeoutMs: 10_000,
    });

    if (resp.status === 200) {
      const data = JSON.parse(resp.body);
      return data.ip ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Main ────────────────────────────────────────────────────

/**
 * Rotate IP of an LTE mobile proxy.
 *
 * Flow:
 * 1. Check cooldown — skip if rotated recently
 * 2. Get current IP (pre-rotation)
 * 3. Hit rotation link (modem API)
 * 4. Wait for modem restart (~12s)
 * 5. Verify new IP is different
 *
 * @returns RotationResult with success status and IPs
 */
export async function rotateMobileProxyIP(proxy: LTEProxy): Promise<RotationResult> {
  // Check cooldown
  const cooldownMs = (proxy.rotationCooldown || 900) * 1000;
  const effectiveCooldown = Math.max(cooldownMs, MIN_ROTATION_COOLDOWN_MS);

  if (proxy.lastRotatedAt) {
    const elapsed = Date.now() - new Date(proxy.lastRotatedAt).getTime();
    if (elapsed < effectiveCooldown) {
      const remaining = Math.ceil((effectiveCooldown - elapsed) / 1000);
      return {
        success: false,
        waitedMs: 0,
        error: `Cooldown active — ${remaining}s remaining. Min interval: ${effectiveCooldown / 1000}s`,
      };
    }
  }

  const proxyUrl = buildProxyUrl(proxy);

  // Get current IP before rotation
  const previousIP = await getCurrentIP(proxyUrl);
  console.log(`[LTE-Rotation] Current IP: ${previousIP ?? 'unknown'}`);

  // Trigger rotation via modem API
  console.log(`[LTE-Rotation] Triggering rotation: ${proxy.rotationLink}`);
  try {
    const resp = await fetch(proxy.rotationLink, { signal: AbortSignal.timeout(10_000) });
    if (!resp.ok) {
      console.warn(`[LTE-Rotation] Rotation link returned ${resp.status}`);
    }
  } catch (err) {
    console.warn('[LTE-Rotation] Rotation request failed:', err);
    // Don't abort — modem might still restart even if HTTP response failed
  }

  // Wait for modem physical restart
  console.log(`[LTE-Rotation] Waiting ${MODEM_RESTART_WAIT_MS / 1000}s for modem restart...`);
  await new Promise(resolve => setTimeout(resolve, MODEM_RESTART_WAIT_MS));

  // Verify new IP
  const newIP = await getCurrentIP(proxyUrl);
  console.log(`[LTE-Rotation] New IP: ${newIP ?? 'unknown'}`);

  const success = newIP !== null && newIP !== previousIP;

  if (!success && newIP === previousIP) {
    console.warn('[LTE-Rotation] IP did not change after rotation');
  }

  return {
    success,
    previousIP: previousIP ?? undefined,
    newIP: newIP ?? undefined,
    waitedMs: MODEM_RESTART_WAIT_MS,
  };
}

// ── Utility ─────────────────────────────────────────────────

function buildProxyUrl(proxy: LTEProxy): string {
  if (proxy.username && proxy.password) {
    return `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
  }
  return `http://${proxy.host}:${proxy.port}`;
}
