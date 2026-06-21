export type ViewsSource = 'studio_total' | 'video_cards' | 'unavailable';

const VIEW_WORD_RE = /(views?|\u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440(?:\u043e\u0432|\u0430)?|\u043f\u0435\u0440\u0435\u0433\u043b\u044f\u0434(?:\u0456\u0432|\u0438)?)/i;

export function parseShortNumber(text: string): number {
  if (!text) return 0;

  const normalized = text
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (!normalized) return 0;

  const multiplier =
    /(?:b|bn|\u043c\u043b\u0440\u0434)/i.test(normalized) ? 1_000_000_000 :
    /(?:m|mln|\u043c\u043b\u043d)/i.test(normalized) ? 1_000_000 :
    /(?:k|\u0442\u044b\u0441)/i.test(normalized) ? 1_000 :
    1;

  const match = normalized.match(/\d+(?:[\s.,]\d+)*/);
  if (!match) return 0;

  let numeric = match[0].replace(/\s/g, '');
  if (multiplier > 1) {
    numeric = numeric.replace(',', '.');
  } else {
    numeric = numeric.replace(/[,.]/g, '');
  }

  const parsed = Number.parseFloat(numeric);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * multiplier)) : 0;
}

function parseBareShortNumber(text: string): number | null {
  const cleaned = text.replace(/\u00a0/g, ' ').trim();
  if (!/^\d+(?:[\s.,]\d+)*(?:\s*(?:k|m|b|\u0442\u044b\u0441|\u043c\u043b\u043d|\u043c\u043b\u0440\u0434))?$/i.test(cleaned)) {
    return null;
  }
  return parseShortNumber(cleaned);
}

export function parseViewCountText(text: string, allowBareNumber = false): number | null {
  const cleaned = text.replace(/\u00a0/g, ' ').trim();
  if (!cleaned) return null;

  if (VIEW_WORD_RE.test(cleaned)) return parseShortNumber(cleaned);
  if (allowBareNumber) return parseBareShortNumber(cleaned);
  return null;
}

export function extractTikTokViewCounts(texts: string[]): number[] {
  return texts
    .map(text => parseViewCountText(text, true))
    .filter((value): value is number => value !== null);
}

export function extractYouTubeViewCounts(texts: string[]): number[] {
  return texts
    .map(text => parseViewCountText(text, false))
    .filter((value): value is number => value !== null);
}

export function sumViewCounts(counts: number[]): number {
  return counts.reduce((sum, count) => sum + count, 0);
}
