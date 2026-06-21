import { describe, expect, it } from 'vitest';
import {
  extractTikTokViewCounts,
  extractYouTubeViewCounts,
  parseShortNumber,
  sumViewCounts,
} from '../lib/view-stats.js';

describe('view stats parsing', () => {
  it('parses compact platform counters without turning decimal comma into thousands', () => {
    expect(parseShortNumber('1.2K')).toBe(1200);
    expect(parseShortNumber('1,2K')).toBe(1200);
    expect(parseShortNumber('3 \u043c\u043b\u043d')).toBe(3_000_000);
    expect(parseShortNumber('1,234')).toBe(1234);
  });

  it('extracts TikTok card views from bare overlay counters', () => {
    const counts = extractTikTokViewCounts(['1.2K', '345', 'Pinned', '2M']);
    expect(counts).toEqual([1200, 345, 2_000_000]);
    expect(sumViewCounts(counts)).toBe(2_001_545);
  });

  it('extracts YouTube views only from metadata that says views', () => {
    const counts = extractYouTubeViewCounts(['1.2K views', '3 days ago', '456 \u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440\u043e\u0432']);
    expect(counts).toEqual([1200, 456]);
  });
});
