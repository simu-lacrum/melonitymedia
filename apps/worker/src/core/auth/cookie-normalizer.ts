export interface NormalizedBrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

type CookieLike = Record<string, unknown>;

function normalizeSameSite(value: unknown): 'Strict' | 'Lax' | 'None' | undefined {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[-\s]/g, '_');
  if (normalized === 'strict') return 'Strict';
  if (normalized === 'lax') return 'Lax';
  if (normalized === 'none' || normalized === 'no_restriction') return 'None';
  return undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return undefined;
}

function normalizeExpiry(raw: CookieLike): number | undefined {
  const candidate = raw.expires ?? raw.expirationDate;
  if (candidate === null || candidate === undefined || candidate === '') return undefined;

  let expires = Number(candidate);
  if (!Number.isFinite(expires) || expires <= 0) return undefined;
  if (expires > 10_000_000_000) expires /= 1000;
  return expires;
}

function normalizeDomain(raw: CookieLike): string {
  const direct = String(raw.domain ?? '').trim();
  if (direct) return direct.replace(/^#HttpOnly_/i, '');

  const url = String(raw.url ?? '').trim();
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

export function normalizeBrowserCookie(raw: CookieLike): NormalizedBrowserCookie | null {
  const name = String(raw.name ?? '').trim();
  const domain = normalizeDomain(raw);
  if (!name || !domain) return null;

  const pathValue = String(raw.path ?? '/').trim();
  const sameSite = normalizeSameSite(raw.sameSite);
  const expires = normalizeExpiry(raw);
  const httpOnly = normalizeBoolean(raw.httpOnly);
  const secure = normalizeBoolean(raw.secure);

  return {
    name,
    value: String(raw.value ?? ''),
    domain,
    path: pathValue.startsWith('/') ? pathValue : `/${pathValue}`,
    ...(expires !== undefined ? { expires } : {}),
    ...(httpOnly !== undefined ? { httpOnly } : {}),
    ...(secure !== undefined ? { secure } : {}),
    ...(sameSite ? { sameSite } : {}),
  };
}

export function normalizeBrowserCookies(input: unknown): NormalizedBrowserCookie[] {
  const rawCookies = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray((input as CookieLike).cookies)
      ? (input as CookieLike).cookies as unknown[]
      : [];

  const deduplicated = new Map<string, NormalizedBrowserCookie>();
  for (const raw of rawCookies) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const cookie = normalizeBrowserCookie(raw as CookieLike);
    if (!cookie) continue;
    deduplicated.set(`${cookie.domain}\n${cookie.path}\n${cookie.name}`, cookie);
  }
  return [...deduplicated.values()];
}
