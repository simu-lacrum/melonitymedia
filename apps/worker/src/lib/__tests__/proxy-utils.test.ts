import { describe, it, expect } from 'vitest';
import { buildProxyUrl } from '../proxy-utils.js';

describe('buildProxyUrl', () => {
  it('handles standard input with discrete fields', () => {
    const res = buildProxyUrl({ host: '1.2.3.4', port: 8080, username: 'usr', password: 'pwd' });
    expect(res).toBe('http://usr:pwd@1.2.3.4:8080');
  });

  it('handles user:pass@ip:port inside host field', () => {
    const res = buildProxyUrl({ host: 'usr:pwd@1.2.3.4:8080', username: 'ignored', password: 'ignored' });
    expect(res).toBe('http://usr:pwd@1.2.3.4:8080');
  });

  it('handles ip:port:user:pass inside host field', () => {
    const res = buildProxyUrl({ host: '1.2.3.4:8080:usr:pwd' });
    expect(res).toBe('http://usr:pwd@1.2.3.4:8080');
  });

  it('preserves existing protocols like socks5', () => {
    const res = buildProxyUrl({ host: 'socks5://1.2.3.4', port: 1080 });
    expect(res).toBe('socks5://1.2.3.4:1080');
  });

  it('uses explicit SOCKS5 protocol from proxy metadata', () => {
    const res = buildProxyUrl({ host: '1.2.3.4', port: 1080, protocol: 'SOCKS5', username: 'usr', password: 'pwd' });
    expect(res).toBe('socks5://usr:pwd@1.2.3.4:1080');
  });

  it('handles URL-encoded special characters in username/password', () => {
    const res = buildProxyUrl({ host: '1.2.3.4', port: 8080, username: 'user@name', password: 'pass:word' });
    expect(res).toBe('http://user%40name:pass%3Aword@1.2.3.4:8080');
  });

  it('handles already-encoded user:pass@ string inside host', () => {
    const res = buildProxyUrl({ host: 'user%40name:pass%3Aword@1.2.3.4:8080' });
    expect(res).toBe('http://user%40name:pass%3Aword@1.2.3.4:8080');
  });
});
