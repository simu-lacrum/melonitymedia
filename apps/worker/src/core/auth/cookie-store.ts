// ─────────────────────────────────────────────────────────────
// Cookie Store — AES-256-GCM encrypted cookie storage
//
// Cookies are the ONLY auth method for TikTok/YouTube.
// They are encrypted at rest with MASTER_KEY (from .env).
// NEVER log cookie contents, even in DEBUG mode.
//
// Flow:
// 1. User uploads cookies (txt/json/zip) via UI
// 2. API parses and encrypts with AES-256-GCM
// 3. Encrypted blob stored in DB (AccountCookies fields)
// 4. Worker decrypts on-demand before each task
// 5. Cookies re-encrypted after session if updated
// ─────────────────────────────────────────────────────────────

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

// ── Types ───────────────────────────────────────────────────

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

interface EncryptedData {
  encrypted: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

// ── Master Key ──────────────────────────────────────────────

let _masterKey: Buffer | null = null;

/**
 * Get the master encryption key from environment.
 * Validates key length on first call — exits process if invalid.
 */
function getMasterKey(): Buffer {
  if (_masterKey) return _masterKey;

  const keyStr = process.env.MASTER_KEY ?? '';
  const key = Buffer.from(keyStr, 'base64');

  if (key.length !== 32) {
    console.error(
      '\n╔══════════════════════════════════════════════════════════════╗\n' +
      '║  FATAL: MASTER_KEY must be 32 bytes (base64 encoded)       ║\n' +
      '║                                                            ║\n' +
      '║  Generate with:                                            ║\n' +
      '║  node -e "console.log(require(\'crypto\').randomBytes(32)   ║\n' +
      '║    .toString(\'base64\'))"                                  ║\n' +
      '║                                                            ║\n' +
      '║  Set in .env:  MASTER_KEY=<your-44-char-base64-string>     ║\n' +
      '╚══════════════════════════════════════════════════════════════╝\n',
    );
    process.exit(1);
  }

  _masterKey = key;
  return _masterKey;
}

// ── Encryption ──────────────────────────────────────────────

/**
 * Encrypt cookies with AES-256-GCM.
 * Each encryption generates a unique IV — same plaintext produces
 * different ciphertext on every call.
 */
export function encryptCookies(cookies: BrowserCookie[]): EncryptedData {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const json = JSON.stringify(cookies);
  const encrypted = Buffer.concat([
    cipher.update(json, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return { encrypted, iv, authTag };
}

/**
 * Decrypt cookies from AES-256-GCM encrypted blob.
 * Throws if auth tag verification fails (tampered data).
 */
export function decryptCookies(
  encrypted: Buffer,
  iv: Buffer,
  authTag: Buffer,
): BrowserCookie[] {
  const key = getMasterKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString('utf8'));
}

// ── Cookie File Parsers ─────────────────────────────────────

/**
 * Parse Netscape cookie.txt format.
 * Format: domain\tHTTPOnly\tpath\tsecure\texpires\tname\tvalue
 */
export function parseNetscapeCookies(content: string): BrowserCookie[] {
  const cookies: BrowserCookie[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split('\t');
    if (parts.length < 7) continue;

    const [domain, , cookiePath, secure, expires, name, value] = parts;

    cookies.push({
      name,
      value,
      domain: domain.startsWith('.') ? domain : `.${domain}`,
      path: cookiePath || '/',
      expires: expires === '0' ? undefined : parseInt(expires),
      httpOnly: parts[1]?.toUpperCase() === 'TRUE',
      secure: secure?.toUpperCase() === 'TRUE',
      sameSite: 'Lax',
    });
  }

  return cookies;
}

/**
 * Parse JSON cookies (Playwright/Puppeteer format or EditThisCookie format).
 * Auto-detects format by examining structure.
 */
export function parseJsonCookies(content: string): BrowserCookie[] {
  const parsed = JSON.parse(content);
  const rawCookies = Array.isArray(parsed) ? parsed : parsed.cookies ?? [];

  return rawCookies.map((c: Record<string, unknown>) => ({
    name: String(c.name ?? ''),
    value: String(c.value ?? ''),
    domain: String(c.domain ?? ''),
    path: String(c.path ?? '/'),
    expires: c.expires ? Number(c.expires) : c.expirationDate ? Number(c.expirationDate) : undefined,
    httpOnly: Boolean(c.httpOnly),
    secure: Boolean(c.secure),
    sameSite: normalizeSameSite(c.sameSite),
  }));
}

function normalizeSameSite(val: unknown): 'Strict' | 'Lax' | 'None' {
  const s = String(val ?? '').toLowerCase();
  if (s === 'strict') return 'Strict';
  if (s === 'none') return 'None';
  return 'Lax';
}

/**
 * Detect platform from cookie domains.
 * Returns 'TIKTOK' | 'YOUTUBE' | null.
 */
export function detectPlatformFromCookies(cookies: BrowserCookie[]): 'TIKTOK' | 'YOUTUBE' | null {
  const domains = cookies.map(c => c.domain.toLowerCase());

  if (domains.some(d => d.includes('tiktok.com'))) return 'TIKTOK';
  if (domains.some(d => d.includes('youtube.com') || d.includes('google.com'))) return 'YOUTUBE';

  return null;
}

// ── Store Operations ────────────────────────────────────────

/**
 * Load cookies from encrypted store for a specific account.
 * First checks disk cache, then falls back to DB.
 *
 * @param accountId - Account ID
 * @param cookiesDir - Directory for cached cookie files (default: /data/cookies/)
 */
export async function loadCookiesFromEncryptedStore(
  accountId: string,
  cookiesDir: string = '/data/cookies',
): Promise<BrowserCookie[]> {
  const cachePath = path.join(cookiesDir, `${accountId}.enc.json`);

  try {
    // Try disk cache first (faster than DB query)
    const raw = await fs.readFile(cachePath, 'utf8');
    const { encrypted, iv, authTag } = JSON.parse(raw);

    return decryptCookies(
      Buffer.from(encrypted, 'base64'),
      Buffer.from(iv, 'base64'),
      Buffer.from(authTag, 'base64'),
    );
  } catch {
    // Cache miss — caller should load from DB and write to cache
    return [];
  }
}

/**
 * Save encrypted cookies to disk cache.
 * Called after successful browser session to persist any cookie updates.
 */
export async function saveCookiesToDiskCache(
  accountId: string,
  cookies: BrowserCookie[],
  cookiesDir: string = '/data/cookies',
): Promise<void> {
  const { encrypted, iv, authTag } = encryptCookies(cookies);

  const cachePath = path.join(cookiesDir, `${accountId}.enc.json`);

  // Ensure directory exists
  await fs.mkdir(cookiesDir, { recursive: true });

  await fs.writeFile(cachePath, JSON.stringify({
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    updatedAt: new Date().toISOString(),
  }));
}

// ── DB-backed Cookie Loader ─────────────────────────────────

import { prisma } from '../lib/prisma.js';

/**
 * Load and decrypt cookies for an account, reading directly from Prisma.
 * DB is single source of truth — use this instead of disk-based store
 * for all new handler code.
 */
export async function loadCookiesForAccount(
  accountId: string,
): Promise<BrowserCookie[]> {
  const acc = await prisma.socialAccount.findUnique({
    where: { id: accountId },
    select: {
      cookiesEncrypted: true,
      cookiesIv: true,
      cookiesAuthTag: true,
    },
  });

  if (!acc?.cookiesEncrypted || !acc.cookiesIv || !acc.cookiesAuthTag) {
    return [];
  }

  return decryptCookies(
    Buffer.from(acc.cookiesEncrypted),
    Buffer.from(acc.cookiesIv),
    Buffer.from(acc.cookiesAuthTag),
  );
}

