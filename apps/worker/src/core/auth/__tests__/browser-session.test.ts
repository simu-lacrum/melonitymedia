import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'patchright';
import { confirmBrowserSession, detectBrowserSession } from '../browser-session.js';

function pageStub(options: {
  url?: string;
  signals?: Array<{ authenticated: boolean; loggedOut: boolean }>;
}): Page {
  const signals = [...(options.signals ?? [])];
  return {
    url: vi.fn(() => options.url ?? 'https://www.youtube.com/'),
    evaluate: vi.fn(async () => signals.shift() ?? { authenticated: false, loggedOut: false }),
    waitForTimeout: vi.fn(async () => {}),
    reload: vi.fn(async () => null),
  } as unknown as Page;
}

describe('browser session confirmation', () => {
  it('treats an explicit login redirect as logged out', async () => {
    const result = await detectBrowserSession(
      pageStub({ url: 'https://accounts.google.com/ServiceLogin' }),
      'YOUTUBE',
    );
    expect(result.state).toBe('logged_out');
  });

  it('accepts a positive account control immediately', async () => {
    const page = pageStub({ signals: [{ authenticated: true, loggedOut: false }] });
    await expect(confirmBrowserSession(page, 'YOUTUBE', 2)).resolves.toMatchObject({ state: 'authenticated' });
    expect(page.reload).not.toHaveBeenCalled();
  });

  it('requires two logout observations before declaring a session expired', async () => {
    const page = pageStub({ signals: [
      { authenticated: false, loggedOut: true },
      { authenticated: false, loggedOut: true },
    ] });
    await expect(confirmBrowserSession(page, 'TIKTOK', 2)).resolves.toMatchObject({ state: 'logged_out' });
    expect(page.waitForTimeout).toHaveBeenCalledWith(6_000);
  });

  it('keeps mixed or inconclusive observations out of the expired state', async () => {
    const page = pageStub({ signals: [
      { authenticated: false, loggedOut: false },
      { authenticated: false, loggedOut: true },
    ] });
    await expect(confirmBrowserSession(page, 'TIKTOK', 2)).resolves.toMatchObject({ state: 'unknown' });
  });
});
