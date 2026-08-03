import { describe, expect, it } from 'vitest';
import { parseAndNormalizeCookies } from '../cookie-normalizer.js';

describe('account cookie import normalization', () => {
  it('normalizes JSON exported by browser extensions', () => {
    const cookies = parseAndNormalizeCookies(JSON.stringify({ cookies: [
      { name: 'sid', value: '1', domain: '.tiktok.com', path: '/', sameSite: 'no_restriction' },
      { name: 'aux', value: '2', domain: '.tiktok.com', path: '/', sameSite: 'unspecified' },
    ] }));

    expect(cookies[0].sameSite).toBe('None');
    expect(cookies[1]).not.toHaveProperty('sameSite');
  });

  it('keeps Netscape HttpOnly cookies instead of treating them as comments', () => {
    const input = [
      '# Netscape HTTP Cookie File',
      '#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1900000000\tSID\tvalue',
    ].join('\n');

    expect(parseAndNormalizeCookies(input)).toEqual([{
      name: 'SID',
      value: 'value',
      domain: '.youtube.com',
      path: '/',
      expires: 1_900_000_000,
      httpOnly: true,
      secure: true,
    }]);
  });

  it('normalizes string boolean flags from extension exports', () => {
    const [cookie] = parseAndNormalizeCookies(JSON.stringify([{
      name: 'SID',
      value: 'value',
      domain: '.youtube.com',
      httpOnly: 'FALSE',
      secure: 'TRUE',
    }]));

    expect(cookie.httpOnly).toBe(false);
    expect(cookie.secure).toBe(true);
  });

  it('returns an empty jar for malformed input', () => {
    expect(parseAndNormalizeCookies('not cookies')).toEqual([]);
  });
});
