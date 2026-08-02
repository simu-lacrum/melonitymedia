import { describe, expect, it } from 'vitest';
import { proxyLockKey } from '../account-lock.js';

describe('proxy browser lock key', () => {
  it('serializes the same endpoint even when credentials differ', () => {
    const first = proxyLockKey('http://first:secret@80.243.16.231:10000');
    const second = proxyLockKey('http://second:another@80.243.16.231:10000');

    expect(first).toBe(second);
    expect(first).not.toContain('secret');
    expect(first).not.toContain('first');
  });

  it('does not serialize distinct endpoint ports', () => {
    expect(proxyLockKey('http://host.test:10000')).not.toBe(proxyLockKey('http://host.test:10001'));
  });
});
