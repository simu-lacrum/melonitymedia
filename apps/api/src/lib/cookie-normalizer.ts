export interface ImportedCookie {
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

function normalizeCookie(raw: CookieLike): ImportedCookie | null {
  const name = String(raw.name ?? '').trim();
  let domain = String(raw.domain ?? '').trim().replace(/^#HttpOnly_/i, '');
  if (!domain && raw.url) {
    try { domain = new URL(String(raw.url)).hostname; } catch { /* invalid URL */ }
  }
  if (!name || !domain) return null;

  const pathValue = String(raw.path ?? '/').trim();
  const expires = normalizeExpiry(raw);
  const sameSite = normalizeSameSite(raw.sameSite);
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

function parseNetscapeCookies(content: string): CookieLike[] {
  const cookies: CookieLike[] = [];
  for (const sourceLine of content.split(/\r?\n/)) {
    let line = sourceLine.trim();
    if (!line) continue;

    let httpOnly = false;
    if (/^#HttpOnly_/i.test(line)) {
      line = line.replace(/^#HttpOnly_/i, '');
      httpOnly = true;
    } else if (line.startsWith('#')) {
      continue;
    }

    const parts = line.split('\t');
    if (parts.length < 7) continue;
    cookies.push({
      domain: parts[0],
      path: parts[2] || '/',
      secure: parts[3]?.toUpperCase() === 'TRUE',
      expires: parts[4],
      name: parts[5],
      value: parts.slice(6).join('\t'),
      httpOnly,
    });
  }
  return cookies;
}

export function parseAndNormalizeCookies(content: string): ImportedCookie[] {
  let rawCookies: unknown;
  try {
    const parsed = JSON.parse(content);
    rawCookies = Array.isArray(parsed) ? parsed : parsed?.cookies;
  } catch {
    rawCookies = parseNetscapeCookies(content);
  }

  const input = Array.isArray(rawCookies) ? rawCookies : [];
  const deduplicated = new Map<string, ImportedCookie>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const cookie = normalizeCookie(raw as CookieLike);
    if (!cookie) continue;
    deduplicated.set(`${cookie.domain}\n${cookie.path}\n${cookie.name}`, cookie);
  }
  return [...deduplicated.values()];
}
