import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('getSystemChromeMajor', () => {
  beforeEach(() => {
    vi.resetModules();
    // Очистка кеша модуля важна — функция кеширует результат в module-scope
  });

  afterEach(() => {
    delete process.env.EXPECTED_CHROME_MAJOR;
  });

  it('throws when system Chrome below expected - 6', async () => {
    process.env.EXPECTED_CHROME_MAJOR = '148';
    vi.doMock('node:child_process', () => ({
      execSync: () => 'Google Chrome 130.0.0.0 \n',
    }));
    const { getSystemChromeMajor } = await import('../core/browser/fingerprint-manager.js');
    expect(() => getSystemChromeMajor()).toThrowError(/too old.*148.*142/);
  });

  it('accepts system Chrome within tolerance', async () => {
    process.env.EXPECTED_CHROME_MAJOR = '148';
    vi.doMock('node:child_process', () => ({
      execSync: () => 'Google Chrome 145.0.0.0 \n',
    }));
    const { getSystemChromeMajor } = await import('../core/browser/fingerprint-manager.js');
    expect(getSystemChromeMajor()).toBe(145);
  });

  it('throws when both detection AND env fail', async () => {
    delete process.env.EXPECTED_CHROME_MAJOR;
    vi.doMock('node:child_process', () => ({
      execSync: () => { throw new Error('not found'); },
    }));
    const { getSystemChromeMajor } = await import('../core/browser/fingerprint-manager.js');
    expect(() => getSystemChromeMajor()).toThrowError(/EXPECTED_CHROME_MAJOR is not set/);
  });
});
