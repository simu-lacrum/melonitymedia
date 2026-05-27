import { describe, it, expect } from 'vitest';
import {
  inspectFingerprintConsistency,
  generateFingerprintForAccount,
  getSystemChromeMajor,
  type AccountFingerprint,
} from '../fingerprint-manager.js';

process.env.EXPECTED_CHROME_MAJOR = '148';

describe('inspectFingerprintConsistency', () => {
  const systemChrome = getSystemChromeMajor();

  function makeFp(overrides: Partial<AccountFingerprint> = {}): AccountFingerprint {
    return {
      deviceClass: 'desktop',
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${systemChrome}.0.0.0 Safari/537.36`,
      platform: 'Win32',
      screen: { width: 1920, height: 1080, colorDepth: 24 },
      viewport: { width: 1920, height: 980 },
      devicePixelRatio: 1,
      locale: 'en-US',
      timezone: 'America/Chicago',
      hardwareConcurrency: 8,
      deviceMemory: 8,
      maxTouchPoints: 0,
      webgl: { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      canvas: { seed: 'deadbeef01234567' },
      fonts: ['Arial', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia'],
      chromeMajor: systemChrome,
      ...overrides,
    };
  }

  it('returns no issues for a consistent fingerprint', () => {
    const issues = inspectFingerprintConsistency(makeFp(), systemChrome);
    expect(issues).toEqual([]);
  });

  it('flags OS_COHERENCE when platform mismatches UA', () => {
    const issues = inspectFingerprintConsistency(
      makeFp({ platform: 'MacIntel' }), // UA says Windows, platform says Mac
      systemChrome,
    );
    expect(issues.some(i => i.rule === 'OS_COHERENCE')).toBe(true);
  });

  it('flags DISPLAY_GEOMETRY when viewport > screen', () => {
    const issues = inspectFingerprintConsistency(
      makeFp({ viewport: { width: 2560, height: 980 } }), // wider than 1920 screen
      systemChrome,
    );
    expect(issues.some(i => i.rule === 'DISPLAY_GEOMETRY')).toBe(true);
  });

  it('flags HARDWARE_REALISM for deviceMemory outside Chrome cap', () => {
    const issues = inspectFingerprintConsistency(
      makeFp({ deviceMemory: 16 as any }),
      systemChrome,
    );
    expect(issues.some(i => i.rule === 'HARDWARE_REALISM')).toBe(true);
  });

  it('returns stale (not fatal) for Chrome version mismatch with system', () => {
    const oldChrome = systemChrome - 5;
    const fp = makeFp({
      chromeMajor: oldChrome,
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${oldChrome}.0.0.0 Safari/537.36`,
    });
    const issues = inspectFingerprintConsistency(fp, systemChrome);
    expect(issues.some(i => i.rule === 'CHROME_VERSION' && i.severity === 'stale')).toBe(true);
    expect(issues.some(i => i.severity === 'fatal')).toBe(false);
  });
});

describe('generateFingerprintForAccount', () => {
  it('produces a valid fingerprint for a given account + geo', () => {
    const fp = generateFingerprintForAccount('test-acc-123', { country: 'US', city: 'Chicago' });
    const issues = inspectFingerprintConsistency(fp, getSystemChromeMajor());
    const fatal = issues.filter(i => i.severity === 'fatal');
    expect(fatal).toEqual([]);
  });

  it('is deterministic — same input same output', () => {
    const fp1 = generateFingerprintForAccount('seed-1', { country: 'US', city: 'New York' });
    const fp2 = generateFingerprintForAccount('seed-1', { country: 'US', city: 'New York' });
    expect(fp1).toEqual(fp2);
  });

  it('produces different fingerprints for different accounts', () => {
    const fp1 = generateFingerprintForAccount('acc-A', { country: 'US', city: 'Chicago' });
    const fp2 = generateFingerprintForAccount('acc-B', { country: 'US', city: 'Chicago' });
    expect(fp1.chromeMajor).toBe(fp2.chromeMajor); // same Chrome version
    expect(fp1.canvas.seed).not.toBe(fp2.canvas.seed); // different canvas noise
  });

  it('includes viewport and chromeMajor (bug 7 regression)', () => {
    const fp = generateFingerprintForAccount('test-acc', { country: 'US', city: 'Chicago' });
    expect(fp.viewport).toBeDefined();
    expect(fp.viewport.width).toBeGreaterThan(0);
    expect(fp.viewport.height).toBeGreaterThan(0);
    expect(fp.chromeMajor).toBeGreaterThanOrEqual(130);
  });

  it('caps deviceMemory at 8 (Chrome limit)', () => {
    // Test many seeds to ensure none produces >8
    for (let i = 0; i < 50; i++) {
      const fp = generateFingerprintForAccount(`stress-${i}`, { country: 'US', city: 'Chicago' });
      expect(fp.deviceMemory).toBeLessThanOrEqual(8);
    }
  });
});
