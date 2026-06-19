export const MIN_WARMUP_DAYS = 3;
export const MAX_WARMUP_DAYS = 21;
export const DEFAULT_WARMUP_DAYS = 10;
export const MIN_WARMUP_HOURS = 1;
export const MAX_WARMUP_HOURS = 24;
export const DEFAULT_WARMUP_HOURS = 2;
export const MAX_WARMUP_COMMENTS = 50;
export const MAX_WARMUP_COMMENT_LENGTH = 240;

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function normalizeWarmupDays(value: unknown): number {
  return clampInt(value, MIN_WARMUP_DAYS, MAX_WARMUP_DAYS, DEFAULT_WARMUP_DAYS);
}

export function normalizeWarmupHours(value: unknown): number {
  return clampInt(value, MIN_WARMUP_HOURS, MAX_WARMUP_HOURS, DEFAULT_WARMUP_HOURS);
}

export function normalizeWarmupMode(value: unknown): 'DAYS' | 'HOURS' {
  return value === 'HOURS' ? 'HOURS' : 'DAYS';
}

export function normalizeWarmupComments(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const comments: string[] = [];

  for (const item of value) {
    if (typeof item !== 'string') continue;
    const comment = String(item).replace(/\s+/g, ' ').trim().slice(0, MAX_WARMUP_COMMENT_LENGTH);
    if (!comment || seen.has(comment)) continue;

    seen.add(comment);
    comments.push(comment);
    if (comments.length >= MAX_WARMUP_COMMENTS) break;
  }

  return comments;
}

export function hasCompletedWarmupMismatch(account: {
  status: string;
  warmupCompletedAt: Date | string | null;
}): boolean {
  return account.status === 'WARMING_UP' && account.warmupCompletedAt !== null;
}
