import { describe, expect, it } from 'vitest';
import {
  createNicheContentState,
  normalizeWarmupHashtags,
  queueNicheResults,
  takeNextNicheVideo,
} from '../niche-content.js';

describe('niche content selection', () => {
  it('normalizes both current arrays and legacy combined hashtag values', () => {
    expect(normalizeWarmupHashtags([
      ' melonity dota 2 ',
      '#читы #дота2 #melonity',
      '#MELONITY',
      null,
    ])).toEqual(['melonity dota 2', 'читы', 'дота2', 'melonity']);
  });

  it('keeps only canonical YouTube video URLs from search results', () => {
    const state = createNicheContentState();
    const count = queueNicheResults(state, 'YOUTUBE', 'dota2', 'https://www.youtube.com/results?search_query=dota2', [
      'https://www.youtube.com/shorts/abc_123?feature=share',
      'https://www.youtube.com/watch?v=xyz-789&list=other',
      'https://www.youtube.com/channel/not-a-video',
      'https://example.com/watch?v=leak',
    ], () => 0.99);

    expect(count).toBe(2);
    expect(takeNextNicheVideo(state)).toBe('https://www.youtube.com/shorts/abc_123');
    expect(takeNextNicheVideo(state)).toBe('https://www.youtube.com/watch?v=xyz-789');
    expect(takeNextNicheVideo(state)).toBeNull();
  });

  it('does not queue a previously watched TikTok video again', () => {
    const state = createNicheContentState();
    queueNicheResults(state, 'TIKTOK', 'gaming', 'https://www.tiktok.com/search?q=gaming', [
      'https://www.tiktok.com/@creator/video/123456789?lang=en',
      'https://www.tiktok.com/tag/gaming',
    ]);
    expect(takeNextNicheVideo(state)).toBe('https://www.tiktok.com/@creator/video/123456789');

    expect(queueNicheResults(state, 'TIKTOK', 'gaming', 'https://www.tiktok.com/tag/gaming', [
      'https://www.tiktok.com/@creator/video/123456789',
    ])).toBe(0);
  });
});
