import { describe, it, expect } from 'vitest';
import { generateFingerprint, generateMobileFingerprint } from '../../lib/fingerprint.js';

/**
 * Behavioral tests for generateFingerprint / generateMobileFingerprint.
 * Tests BUG 7 fixes: OS coherence, viewport, chromeMajor, deviceMemory cap.
 *
 * REPLACED: old tests read accounts.ts as text — they broke when the
 * generator was moved to lib/fingerprint.ts. These tests call the actual
 * functions and validate output structure.
 */

describe('generateFingerprint — desktop', () => {
  const fp = generateFingerprint('test-account-001');

  it('produces viewport field with width and height', () => {
    expect(fp.viewport).toBeDefined();
    expect(fp.viewport.width).toBeGreaterThan(0);
    expect(fp.viewport.height).toBeGreaterThan(0);
  });

  it('produces chromeMajor field', () => {
    expect(fp.chromeMajor).toBeDefined();
    expect(typeof fp.chromeMajor).toBe('number');
    expect(fp.chromeMajor).toBeGreaterThanOrEqual(100);
  });

  it('has OS-coherent platform selection', () => {
    // Platform must be one of the valid desktop values
    expect(['Win32', 'MacIntel', 'Linux x86_64']).toContain(fp.platform);
  });

  it('caps deviceMemory at 8 (Chrome limit)', () => {
    // Chrome never reports deviceMemory > 8
    expect(fp.deviceMemory).toBeLessThanOrEqual(8);
    expect(fp.deviceMemory).toBeGreaterThanOrEqual(4);
  });

  it('produces OS-coherent WebGL vendors per platform', () => {
    const validVendors: Record<string, string[]> = {
      Win32: ['Google Inc. (Intel)', 'Google Inc. (NVIDIA)', 'Google Inc. (AMD)'],
      MacIntel: ['Apple Inc.'],
      'Linux x86_64': ['Mesa', 'Mesa/X.org'],
    };
    expect(validVendors[fp.platform]).toContain(fp.webgl.vendor);
  });

  it('generates colorDepth: 24 in screen object', () => {
    expect(fp.screen.colorDepth).toBe(24);
  });

  it('generates deviceClass: desktop', () => {
    expect(fp.deviceClass).toBe('desktop');
  });

  it('generates maxTouchPoints: 0 for desktop', () => {
    expect(fp.maxTouchPoints).toBe(0);
  });

  it('has valid fonts pool for the selected platform', () => {
    expect(fp.fonts.length).toBeGreaterThanOrEqual(6);
    const fontPools: Record<string, string[]> = {
      Win32: ['Arial', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Tahoma'],
      MacIntel: ['Helvetica Neue', 'San Francisco', 'Menlo', 'Monaco', 'Avenir', 'Geneva'],
      'Linux x86_64': ['DejaVu Sans', 'DejaVu Serif', 'Liberation Sans', 'Liberation Mono', 'Ubuntu', 'Noto Sans'],
    };
    const validFonts = fontPools[fp.platform];
    // Every font in the result should be from the platform's pool
    for (const font of fp.fonts) {
      expect(validFonts).toContain(font);
    }
  });

  it('does NOT use 1.25 or 1.5 devicePixelRatio', () => {
    expect(fp.devicePixelRatio).not.toBe(1.25);
    expect(fp.devicePixelRatio).not.toBe(1.5);
  });

  it('viewport height is smaller than screen height (browser chrome)', () => {
    expect(fp.viewport.height).toBeLessThan(fp.screen.height);
  });
});

describe('generateMobileFingerprint', () => {
  const fp = generateMobileFingerprint('test-account-mobile-001');

  it('generates deviceClass: mobile', () => {
    expect(fp.deviceClass).toBe('mobile');
  });

  it('has maxTouchPoints: 5', () => {
    expect(fp.maxTouchPoints).toBe(5);
  });

  it('has valid mobile platform', () => {
    expect(['iPhone', 'Linux armv8l']).toContain(fp.platform);
  });

  it('caps deviceMemory at 8', () => {
    expect(fp.deviceMemory).toBeLessThanOrEqual(8);
  });

  it('has correct UA for the platform', () => {
    if (fp.platform === 'iPhone') {
      expect(fp.userAgent).toContain('iPhone');
      expect(fp.userAgent).toContain('CriOS');
    } else {
      expect(fp.userAgent).toContain('Android');
      expect(fp.userAgent).toContain('Chrome');
    }
  });
});

describe('generateFingerprint determinism', () => {
  it('produces identical output for the same accountId', () => {
    const fp1 = generateFingerprint('determinism-test-123');
    const fp2 = generateFingerprint('determinism-test-123');
    expect(fp1).toEqual(fp2);
  });

  it('produces different output for different accountIds', () => {
    const fp1 = generateFingerprint('account-A');
    const fp2 = generateFingerprint('account-B');
    // At minimum, canvas seed should differ
    expect(fp1.canvas.seed).not.toBe(fp2.canvas.seed);
  });
});
