import { describe, it, expect, beforeEach } from 'vitest';
import { generateMobileFingerprintForAccount } from '../core/browser/fingerprint-manager.js';

describe('Mobile Fingerprint Generator', () => {
  beforeEach(() => {
    process.env.EXPECTED_CHROME_MAJOR = '125';
  });
  it('generates a stable mobile fingerprint with deviceClass="mobile"', () => {
    const geo = { country: 'US', city: 'New York' };
    const fp = generateMobileFingerprintForAccount('test-acc-123', geo);

    expect(fp.deviceClass).toBe('mobile');
    expect(fp.maxTouchPoints).toBeGreaterThan(0);
    expect(fp.userAgent).toMatch(/Mobile/);
    expect(['iPhone', 'Linux armv8l']).toContain(fp.platform);
  });
});
