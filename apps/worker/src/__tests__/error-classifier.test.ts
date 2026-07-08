import { describe, expect, it } from 'vitest';
import { classifyError } from '../lib/error-classifier.js';

describe('classifyError', () => {
  it('explains SOCKS proxy authentication incompatibility without banning proxy types', () => {
    const result = classifyError(
      '[Patchright] SOCKS proxy authentication is not supported by Chromium/Patchright for login jobs.',
      'login',
    );

    expect(result.code).toBe('PROXY_ERROR');
    expect(result.title).toBe('Прокси несовместим с браузером');
    expect(result.message).toContain('SOCKS-прокси');
    expect(result.advice).toContain('любой привязанный прокси');
    expect(result.advice).toContain('HTTP endpoint');
  });
});
