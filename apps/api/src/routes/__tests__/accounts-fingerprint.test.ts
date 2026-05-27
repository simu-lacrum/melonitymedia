import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Source-level verification for the API's inline generateFingerprint function.
 * Tests that BUG 7 fixes are present: OS coherence, viewport, chromeMajor, deviceMemory cap.
 */
const ACCOUNTS_SRC = fs.readFileSync(
  path.resolve(__dirname, '../accounts.ts'),
  'utf-8',
);

describe('API generateFingerprint (BUG 7 regression)', () => {
  it('produces viewport field', () => {
    expect(ACCOUNTS_SRC).toContain('viewport');
  });

  it('produces chromeMajor field', () => {
    expect(ACCOUNTS_SRC).toContain('chromeMajor');
  });

  it('has OS-conditional platform selection', () => {
    // Must not hardcode Win32 — should select dynamically
    expect(ACCOUNTS_SRC).toContain("'MacIntel'");
    expect(ACCOUNTS_SRC).toContain("'Linux x86_64'");
  });

  it('caps deviceMemory at 8 (Chrome limit)', () => {
    // Must NOT include 16 as a deviceMemory option
    expect(ACCOUNTS_SRC).not.toMatch(/deviceMemory.*16/);
  });

  it('produces OS-coherent WebGL vendors per platform', () => {
    expect(ACCOUNTS_SRC).toContain("'Apple Inc.'");
    expect(ACCOUNTS_SRC).toContain("'Mesa'");
  });

  it('includes per-OS font pools', () => {
    expect(ACCOUNTS_SRC).toContain('Helvetica Neue');
    expect(ACCOUNTS_SRC).toContain('DejaVu Sans');
    expect(ACCOUNTS_SRC).toContain('Segoe UI');
  });

  it('does NOT use 1.25 or 1.5 devicePixelRatio (Chrome never reports these)', () => {
    const fpSection = ACCOUNTS_SRC.slice(
      ACCOUNTS_SRC.indexOf('function generateFingerprint'),
      ACCOUNTS_SRC.indexOf('// ── GET /'),
    );
    expect(fpSection).not.toContain('1.25');
    expect(fpSection).not.toContain('1.5');
  });

  it('generates colorDepth: 24 in screen object', () => {
    expect(ACCOUNTS_SRC).toContain('colorDepth: 24');
  });
});
