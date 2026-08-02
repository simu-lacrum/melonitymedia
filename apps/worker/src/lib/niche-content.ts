export type NichePlatform = 'TIKTOK' | 'YOUTUBE';

export interface NicheContentState {
  currentHashtag: string | null;
  sourceUrl: string | null;
  pendingVideoUrls: string[];
  seenVideoUrls: Set<string>;
}

export function createNicheContentState(): NicheContentState {
  return {
    currentHashtag: null,
    sourceUrl: null,
    pendingVideoUrls: [],
    seenVideoUrls: new Set<string>(),
  };
}

export function normalizeWarmupHashtags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (!value) continue;

    // Recover old payloads where several hashtags were stored in one string.
    const parts = value.includes('#')
      ? value.split(/(?=#)/g)
      : [value];

    for (const part of parts) {
      const tag = part.replace(/^#+/, '').trim().replace(/\s+/g, ' ');
      if (!tag) continue;
      const key = tag.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(tag);
    }
  }

  return normalized;
}

function canonicalVideoUrl(platform: NichePlatform, candidate: string): string | null {
  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();

    if (platform === 'YOUTUBE') {
      if (!(hostname === 'youtube.com' || hostname.endsWith('.youtube.com'))) return null;

      const shortMatch = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]+)/);
      if (shortMatch) return `https://www.youtube.com/shorts/${shortMatch[1]}`;

      if (url.pathname === '/watch') {
        const videoId = url.searchParams.get('v');
        if (videoId && /^[A-Za-z0-9_-]+$/.test(videoId)) {
          return `https://www.youtube.com/watch?v=${videoId}`;
        }
      }

      return null;
    }

    if (!(hostname === 'tiktok.com' || hostname.endsWith('.tiktok.com'))) return null;
    const videoMatch = url.pathname.match(/^(\/@[^/]+\/video\/\d+)/);
    return videoMatch ? `https://www.tiktok.com${videoMatch[1]}` : null;
  } catch {
    return null;
  }
}

export function queueNicheResults(
  state: NicheContentState,
  platform: NichePlatform,
  hashtag: string,
  sourceUrl: string,
  candidates: string[],
  random: () => number = Math.random,
): number {
  const unique = new Set<string>();
  const urls: string[] = [];

  for (const candidate of candidates) {
    const canonical = canonicalVideoUrl(platform, candidate);
    if (!canonical || unique.has(canonical) || state.seenVideoUrls.has(canonical)) continue;
    unique.add(canonical);
    urls.push(canonical);
  }

  for (let i = urls.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [urls[i], urls[j]] = [urls[j], urls[i]];
  }

  state.currentHashtag = hashtag;
  state.sourceUrl = sourceUrl;
  state.pendingVideoUrls = urls;
  return urls.length;
}

export function takeNextNicheVideo(state: NicheContentState): string | null {
  const next = state.pendingVideoUrls.shift() ?? null;
  if (next) state.seenVideoUrls.add(next);
  return next;
}
