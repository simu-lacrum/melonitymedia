import { describe, it, expect } from 'vitest';
import { validatePinChange, PROXY_PIN_WINDOW_DAYS } from '../proxy-pin-rules.js';

const DAY_MS = 86_400_000;

const mkAccount = (overrides: Partial<Parameters<typeof validatePinChange>[0]['account']> = {}) => ({
  id: 'acc-1',
  platform: 'TIKTOK' as const,
  pinnedProxyId: null as string | null,
  proxyPinnedAt: null as Date | null,
  createdAt: new Date(Date.now() - 60 * DAY_MS), // 60 days old by default
  ...overrides,
});

const mkProxy = (overrides: Partial<Parameters<typeof validatePinChange>[0]['newProxy']> = {}) => ({
  id: 'proxy-1',
  carrier: 'T-Mobile',
  country: 'US',
  type: 'LTE_MOBILE',
  ...overrides,
});

describe('validatePinChange', () => {
  it('allows first pin with no previous proxy', () => {
    const result = validatePinChange({
      account: mkAccount(),
      oldProxy: null,
      newProxy: mkProxy(),
    });
    expect(result).toBeNull();
  });

  it('blocks young accounts from non-LTE proxies across platforms', () => {
    const result = validatePinChange({
      account: mkAccount({
        platform: 'YOUTUBE',
        createdAt: new Date(Date.now() - 5 * DAY_MS),
      }),
      oldProxy: null,
      newProxy: mkProxy({ type: 'STATIC_RESIDENTIAL' }),
    });
    expect(result).not.toBeNull();
    expect(result!.code).toBe('PROXY_NOT_LTE_FOR_YOUNG_ACCOUNT');
    expect(result!.overrideAllowed).toBe(false);
  });

  it('blocks country change within pin window', () => {
    const now = new Date();
    const result = validatePinChange({
      account: mkAccount({
        pinnedProxyId: 'proxy-1',
        proxyPinnedAt: new Date(now.getTime() - 5 * DAY_MS),
      }),
      oldProxy: mkProxy({ id: 'proxy-1', country: 'US' }),
      newProxy: mkProxy({ id: 'proxy-2', country: 'DE' }),
      now,
    });
    expect(result).not.toBeNull();
    expect(result!.code).toBe('COUNTRY_CHANGE_BLOCKED');
    expect(result!.overrideAllowed).toBe(false);
  });

  it('blocks country change even after the pin window expires', () => {
    const now = new Date();
    const result = validatePinChange({
      account: mkAccount({
        pinnedProxyId: 'proxy-1',
        proxyPinnedAt: new Date(now.getTime() - 60 * DAY_MS),
      }),
      oldProxy: mkProxy({ id: 'proxy-1', country: 'US' }),
      newProxy: mkProxy({ id: 'proxy-2', country: 'DE' }),
      now,
    });
    expect(result).not.toBeNull();
    expect(result!.code).toBe('COUNTRY_CHANGE_BLOCKED');
    expect(result!.overrideAllowed).toBe(false);
  });

  it('blocks carrier change for TikTok', () => {
    const now = new Date();
    const result = validatePinChange({
      account: mkAccount({
        pinnedProxyId: 'proxy-1',
        proxyPinnedAt: new Date(now.getTime() - 5 * DAY_MS),
      }),
      oldProxy: mkProxy({ id: 'proxy-1', carrier: 'T-Mobile' }),
      newProxy: mkProxy({ id: 'proxy-2', carrier: 'Verizon' }),
      now,
    });
    expect(result).not.toBeNull();
    expect(result!.code).toBe('CARRIER_CHANGE_BLOCKED');
    expect(result!.overrideAllowed).toBe(true);
  });

  it('blocks same-carrier swap within 14-day window', () => {
    const now = new Date();
    const result = validatePinChange({
      account: mkAccount({
        pinnedProxyId: 'proxy-1',
        proxyPinnedAt: new Date(now.getTime() - 5 * DAY_MS),
      }),
      oldProxy: mkProxy({ id: 'proxy-1' }),
      newProxy: mkProxy({ id: 'proxy-2' }),
      now,
    });
    expect(result).not.toBeNull();
    expect(result!.code).toBe('PIN_WINDOW_ACTIVE');
    expect(result!.overrideAllowed).toBe(true);
    expect(result!.daysRemaining).toBe(PROXY_PIN_WINDOW_DAYS - 5);
  });

  it('allows swap after 14-day window expires', () => {
    const now = new Date();
    const result = validatePinChange({
      account: mkAccount({
        pinnedProxyId: 'proxy-1',
        proxyPinnedAt: new Date(now.getTime() - 15 * DAY_MS),
      }),
      oldProxy: mkProxy({ id: 'proxy-1' }),
      newProxy: mkProxy({ id: 'proxy-2' }),
      now,
    });
    expect(result).toBeNull();
  });

  it('allows re-pinning same proxy (idempotent)', () => {
    const now = new Date();
    const result = validatePinChange({
      account: mkAccount({
        pinnedProxyId: 'proxy-1',
        proxyPinnedAt: new Date(now.getTime() - 2 * DAY_MS),
      }),
      oldProxy: mkProxy({ id: 'proxy-1' }),
      newProxy: mkProxy({ id: 'proxy-1' }),
      now,
    });
    expect(result).toBeNull();
  });
});
