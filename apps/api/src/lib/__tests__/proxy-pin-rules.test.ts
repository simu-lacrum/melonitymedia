import { describe, it, expect } from "vitest";
import { validatePinChange } from "../proxy-pin-rules.js";

const day = 86_400_000;

const mkAccount = (overrides: Partial<Parameters<typeof validatePinChange>[0]["account"]> = {}) => ({
  id: "acc-1",
  platform: "TIKTOK" as const,
  pinnedProxyId: "prx-old",
  proxyPinnedAt: new Date("2026-05-10T00:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"), // 4+ months old
  ...overrides,
});

const proxy = (overrides: Partial<Parameters<typeof validatePinChange>[0]["newProxy"]> = {}) => ({
  id: "prx-new",
  carrier: "T-Mobile",
  country: "US",
  type: "LTE_MOBILE" as const,
  ...overrides,
});

const now = new Date("2026-05-15T00:00:00Z"); // 5 days after pin

describe("validatePinChange", () => {
  it("returns null when no previous pin", () => {
    const result = validatePinChange({
      account: mkAccount({ pinnedProxyId: null, proxyPinnedAt: null }),
      oldProxy: null,
      newProxy: proxy(),
      now,
    });
    expect(result).toBeNull();
  });

  it("returns null when reassigning to same proxy", () => {
    const result = validatePinChange({
      account: mkAccount(),
      oldProxy: { id: "prx-old", carrier: "T-Mobile", country: "US", type: "LTE_MOBILE" },
      newProxy: proxy({ id: "prx-old" }),
      now,
    });
    expect(result).toBeNull();
  });

  it("blocks carrier change for TikTok account", () => {
    const result = validatePinChange({
      account: mkAccount(),
      oldProxy: { id: "prx-old", carrier: "T-Mobile", country: "US", type: "LTE_MOBILE" },
      newProxy: proxy({ carrier: "Verizon" }),
      now,
    });
    expect(result?.code).toBe("CARRIER_CHANGE_BLOCKED");
    expect(result?.oldCarrier).toBe("T-Mobile");
    expect(result?.newCarrier).toBe("Verizon");
    expect(result?.daysRemaining).toBe(9);
  });

  it("blocks country change with priority over carrier change", () => {
    const result = validatePinChange({
      account: mkAccount(),
      oldProxy: { id: "prx-old", carrier: "T-Mobile", country: "US", type: "LTE_MOBILE" },
      newProxy: proxy({ carrier: "Vodafone", country: "DE" }),
      now,
    });
    expect(result?.code).toBe("COUNTRY_CHANGE_BLOCKED");
  });

  it("warns within 14-day window for same-carrier swap", () => {
    const result = validatePinChange({
      account: mkAccount(),
      oldProxy: { id: "prx-old", carrier: "T-Mobile", country: "US", type: "LTE_MOBILE" },
      newProxy: proxy({ id: "prx-other-tmobile", carrier: "T-Mobile" }),
      now,
    });
    expect(result?.code).toBe("PIN_WINDOW_ACTIVE");
    expect(result?.daysRemaining).toBe(9);
  });

  it("allows same-carrier swap after 14 days", () => {
    const result = validatePinChange({
      account: mkAccount({ proxyPinnedAt: new Date(now.getTime() - 15 * day) }),
      oldProxy: { id: "prx-old", carrier: "T-Mobile", country: "US", type: "LTE_MOBILE" },
      newProxy: proxy({ id: "prx-other-tmobile" }),
      now,
    });
    expect(result).toBeNull();
  });

  it("rejects datacenter proxy for TikTok account younger than 30 days", () => {
    const result = validatePinChange({
      account: mkAccount({
        createdAt: new Date(now.getTime() - 10 * day),
        pinnedProxyId: null,
        proxyPinnedAt: null,
      }),
      oldProxy: null,
      newProxy: proxy({ type: "DATACENTER_DEPRECATED" }),
      now,
    });
    expect(result?.code).toBe("PROXY_NOT_LTE_FOR_TIKTOK");
  });

  it("allows residential proxy for TikTok account older than 30 days", () => {
    const result = validatePinChange({
      account: mkAccount({
        createdAt: new Date(now.getTime() - 60 * day),
        pinnedProxyId: null,
        proxyPinnedAt: null,
      }),
      oldProxy: null,
      newProxy: proxy({ type: "STATIC_RESIDENTIAL" }),
      now,
    });
    expect(result).toBeNull();
  });

  it("does not enforce carrier rule on YouTube accounts", () => {
    const result = validatePinChange({
      account: mkAccount({ platform: "YOUTUBE" as any }),
      oldProxy: { id: "prx-old", carrier: "T-Mobile", country: "US", type: "LTE_MOBILE" },
      newProxy: proxy({ carrier: "Verizon" }),
      now,
    });
    // Only the within-window soft-warn applies.
    expect(result?.code).toBe("PIN_WINDOW_ACTIVE");
  });
});
