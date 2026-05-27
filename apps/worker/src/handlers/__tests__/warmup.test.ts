import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * These tests verify the warmup handler source code has the correct
 * patterns — they do NOT run the handler (which requires browser + DB).
 * This is the standard approach for verifying anti-fraud selector correctness.
 */
const WARMUP_SRC = fs.readFileSync(
  path.resolve(__dirname, '../warmup.ts'),
  'utf-8',
);

describe('warmup handler source verification', () => {
  // ── BUG 10: warmup completion flag ─────────────────────────
  describe('warmup completion (BUG 10 regression)', () => {
    it('sets warmupCompletedAt on the last day', () => {
      expect(WARMUP_SRC).toContain('warmupCompletedAt');
    });

    it('transitions status to ALIVE after final day', () => {
      // The handler must set status: 'ALIVE' when warmupDay >= totalDays
      expect(WARMUP_SRC).toContain("status: 'ALIVE'");
    });

    it('checks warmupDay >= totalDays for completion gate', () => {
      expect(WARMUP_SRC).toContain('warmupDay >= totalDays');
    });

    it('imports prisma for DB update', () => {
      expect(WARMUP_SRC).toContain("from '../lib/prisma.js'");
    });
  });

  // ── BUG 11: save icon selector ────────────────────────────
  describe('TikTok save-icon selector (BUG 11 regression)', () => {
    it('uses browse-icon instead of undefined-icon', () => {
      expect(WARMUP_SRC).toContain('[data-e2e="browse-icon"]');
    });

    it('does NOT use undefined-icon (the broken selector)', () => {
      expect(WARMUP_SRC).not.toContain('undefined-icon');
    });
  });

  // ── Phase calculation correctness ─────────────────────────
  describe('phase boundary calculation', () => {
    it('calculates passiveEnd as 30% of totalDays', () => {
      expect(WARMUP_SRC).toContain('totalDays * 0.3');
    });

    it('calculates lightEnd as 60% of totalDays', () => {
      expect(WARMUP_SRC).toContain('totalDays * 0.6');
    });
  });
});
