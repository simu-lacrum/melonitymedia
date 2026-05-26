import type { Proxy, SocialAccount } from "@prisma/client";

export const PROXY_PIN_WINDOW_DAYS = 14;

export interface PinViolation {
  code:
    | "PIN_WINDOW_ACTIVE"
    | "CARRIER_CHANGE_BLOCKED"
    | "COUNTRY_CHANGE_BLOCKED"
    | "PROXY_NOT_LTE_FOR_TIKTOK";
  message: string;
  daysRemaining?: number;
  oldCarrier?: string | null;
  newCarrier?: string | null;
  oldCountry?: string | null;
  newCountry?: string | null;
}

/**
 * Validate a proxy reassignment against the 14-day correlation window rules.
 *
 * Returns `null` if the change is safe, or a `PinViolation` describing why it must be blocked.
 *
 * Rules enforced (TikTok 2026 antifraud):
 *  1. Within 14 days of pinning a proxy, you cannot reassign to a different proxy
 *     of the SAME carrier without explicit `force` — frequent rotations are themselves a signal.
 *  2. Carrier change at any point within the 14-day window is a hard block —
 *     correlation window resets, account hits shadowban for 14-21 days.
 *  3. Country change at any point is a hard block — TikTok geo-correlates with carrier.
 *  4. TikTok accounts younger than 30 days must use LTE_MOBILE proxy. Residential is rejected.
 */
export function validatePinChange(args: {
  account: Pick<
    SocialAccount,
    "id" | "platform" | "pinnedProxyId" | "proxyPinnedAt" | "createdAt"
  >;
  oldProxy: Pick<Proxy, "id" | "carrier" | "country" | "type"> | null;
  newProxy: Pick<Proxy, "id" | "carrier" | "country" | "type">;
  now?: Date;
}): PinViolation | null {
  const { account, oldProxy, newProxy } = args;
  const now = args.now ?? new Date();

  // Rule 4: TikTok + young account => must be LTE_MOBILE.
  const ageDays = (now.getTime() - account.createdAt.getTime()) / 86_400_000;
  if (
    account.platform === "TIKTOK" &&
    ageDays < 30 &&
    newProxy.type !== "LTE_MOBILE"
  ) {
    return {
      code: "PROXY_NOT_LTE_FOR_TIKTOK",
      message:
        `TikTok accounts younger than 30 days require LTE_MOBILE proxy (got ${newProxy.type}). ` +
        `Datacenter and residential proxies trigger BGP path scoring on new accounts.`,
    };
  }

  // If there's no previous pin, anything goes (within Rule 4 above).
  if (!oldProxy || !account.proxyPinnedAt) {
    return null;
  }

  // Same proxy reassignment — always allowed (idempotent).
  if (oldProxy.id === newProxy.id) {
    return null;
  }

  const pinAgeDays =
    (now.getTime() - account.proxyPinnedAt.getTime()) / 86_400_000;
  const daysRemaining = Math.ceil(PROXY_PIN_WINDOW_DAYS - pinAgeDays);

  // Rule 3: country change at any point — hard block.
  if (oldProxy.country !== newProxy.country) {
    return {
      code: "COUNTRY_CHANGE_BLOCKED",
      message:
        `Cannot switch proxy country (${oldProxy.country} -> ${newProxy.country}) ` +
        `for an account that already has session history. TikTok geo-correlates with carrier; ` +
        `country change forces full re-warming. Use force=true if you accept the risk.`,
      daysRemaining: Math.max(daysRemaining, 0),
      oldCountry: oldProxy.country,
      newCountry: newProxy.country,
    };
  }

  // Rule 2: TikTok-specific carrier change rule (any time, but most punishing within 14d).
  if (
    account.platform === "TIKTOK" &&
    oldProxy.carrier !== newProxy.carrier
  ) {
    return {
      code: "CARRIER_CHANGE_BLOCKED",
      message:
        `Carrier change (${oldProxy.carrier ?? "unknown"} -> ${newProxy.carrier ?? "unknown"}) ` +
        `resets the 14-day TikTok correlation window. Expected shadowban 14-21 days. ` +
        `Use force=true if you accept the risk.`,
      daysRemaining: Math.max(daysRemaining, 0),
      oldCarrier: oldProxy.carrier,
      newCarrier: newProxy.carrier,
    };
  }

  // Rule 1: within the 14-day window, even same-carrier swaps need a heads-up.
  if (pinAgeDays < PROXY_PIN_WINDOW_DAYS) {
    return {
      code: "PIN_WINDOW_ACTIVE",
      message:
        `Account is pinned to current proxy for ${daysRemaining} more day(s). ` +
        `Swapping within the 14-day window is permitted only with force=true.`,
      daysRemaining,
    };
  }

  return null;
}
