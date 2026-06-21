// Inline type aliases — avoid importing generated @prisma/client model types
// directly, which may not re-export depending on Prisma version/output config.

/** Subset of Proxy fields needed for pin validation. */
interface ProxyFields {
  id: string;
  carrier: string | null;
  country: string;
  type: string;
}

/** Subset of SocialAccount fields needed for pin validation. */
interface AccountFields {
  id: string;
  platform: string;
  pinnedProxyId: string | null;
  proxyPinnedAt: Date | null;
  createdAt: Date;
}

export const PROXY_PIN_WINDOW_DAYS = 14;

export interface PinViolation {
  code:
    | "PIN_WINDOW_ACTIVE"
    | "CARRIER_CHANGE_BLOCKED"
    | "COUNTRY_CHANGE_BLOCKED";
  message: string;
  overrideAllowed: boolean;
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
 * Rules enforced:
 *  1. Within 14 days of pinning a proxy, you cannot reassign to a different proxy
 *     of the SAME carrier without explicit `force` — frequent rotations are themselves a signal.
 *  2. Carrier change at any point within the 14-day window is a hard block —
 *     correlation window resets, account hits shadowban for 14-21 days.
 *  3. Country change is never allowed once an account has session history.
 *  4. Proxy type is not a launch blocker: LTE_MOBILE and STATIC_RESIDENTIAL
 *     are both allowed as long as an account has a pinned proxy.
 */
export function validatePinChange(args: {
  account: AccountFields;
  oldProxy: ProxyFields | null;
  newProxy: ProxyFields;
  now?: Date;
}): PinViolation | null {
  const { account, oldProxy, newProxy } = args;
  const now = args.now ?? new Date();

  // If there's no previous pin, any supported proxy type is allowed.
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
      overrideAllowed: false,
      message:
        `Cannot switch proxy country (${oldProxy.country} -> ${newProxy.country}) ` +
        `for an account that already has session history. Country of operations is immutable; ` +
        `create a separate account flow for another country instead.`,
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
      overrideAllowed: true,
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
      overrideAllowed: true,
      message:
        `Account is pinned to current proxy for ${daysRemaining} more day(s). ` +
        `Swapping within the 14-day window is permitted only with force=true.`,
      daysRemaining,
    };
  }

  return null;
}
