import { describe, expect, it } from 'vitest';
import { normalizeBrowserCookies } from '../cookie-normalizer.js';

describe('worker cookie normalizer', () => {
  it('repairs extension-style SameSite values used by existing accounts', () => {
    const cookies = normalizeBrowserCookies([
      { name: 'a', value: '1', domain: '.tiktok.com', path: '/', sameSite: 'no_restriction' },
      { name: 'b', value: '2', domain: '.tiktok.com', path: '/', sameSite: 'unspecified' },
      { name: 'c', value: '3', domain: '.tiktok.com', path: '/', sameSite: 'null' },
      { name: 'd', value: '4', domain: '.tiktok.com', path: '/', sameSite: 'lax' },
    ]);

    expect(cookies.map((cookie) => cookie.sameSite)).toEqual(['None', undefined, undefined, 'Lax']);
  });

  it('normalizes millisecond expiration and removes fields Patchright cannot accept', () => {
    const [cookie] = normalizeBrowserCookies([{
      name: 'sessionid',
      value: 'secret',
      url: 'https://www.tiktok.com/',
      path: 'account',
      expirationDate: 1_900_000_000_000,
      storeId: '0',
      hostOnly: true,
    }]);

    expect(cookie).toEqual({
      name: 'sessionid',
      value: 'secret',
      domain: 'www.tiktok.com',
      path: '/account',
      expires: 1_900_000_000,
    });
  });

  it('does not treat string false flags as truthy', () => {
    const [cookie] = normalizeBrowserCookies([{
      name: 'sid',
      value: '1',
      domain: '.youtube.com',
      httpOnly: 'FALSE',
      secure: 'false',
    }]);

    expect(cookie.httpOnly).toBe(false);
    expect(cookie.secure).toBe(false);
  });

  it('drops malformed cookies and deterministically keeps the latest duplicate', () => {
    const cookies = normalizeBrowserCookies([
      { name: '', value: 'bad', domain: '.tiktok.com' },
      { name: 'sid', value: 'old', domain: '.tiktok.com', path: '/' },
      { name: 'sid', value: 'new', domain: '.tiktok.com', path: '/' },
    ]);

    expect(cookies).toHaveLength(1);
    expect(cookies[0].value).toBe('new');
  });
});
