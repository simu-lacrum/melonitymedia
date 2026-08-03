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
import { prisma } from '../../lib/prisma.js';
import {
  normalizeBrowserCookies,
  type NormalizedBrowserCookie,
} from './cookie-normalizer.js';

// ── Types ───────────────────────────────────────────────────

export interface BrowserCookie extends NormalizedBrowserCookie {}

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

  const keyStr = process.env.MASTER_KEY!;
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

  const json = JSON.stringify(normalizeBrowserCookies(cookies));
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

  return normalizeBrowserCookies(JSON.parse(decrypted.toString('utf8')));
}

// ── Cookie File Parsers ─────────────────────────────────────

/**
 * Parse Netscape cookie.txt format.
 * Format: domain\tHTTPOnly\tpath\tsecure\texpires\tname\tvalue
 */
export function parseNetscapeCookies(content: string): BrowserCookie[] {
  const cookies: BrowserCookie[] = [];

  for (const sourceLine of content.split(/\r?\n/)) {
    let trimmed = sourceLine.trim();
    if (!trimmed) continue;

    let httpOnly = false;
    if (/^#HttpOnly_/i.test(trimmed)) {
      trimmed = trimmed.replace(/^#HttpOnly_/i, '');
      httpOnly = true;
    } else if (trimmed.startsWith('#')) {
      continue;
    }

    const parts = trimmed.split('\t');
    if (parts.length < 7) continue;

    const [domain, , cookiePath, secure, expires, name] = parts;

    cookies.push({
      name,
      value: parts.slice(6).join('\t'),
      domain: domain.startsWith('.') ? domain : `.${domain}`,
      path: cookiePath || '/',
      expires: expires === '0' ? undefined : parseInt(expires),
      httpOnly,
      secure: secure?.toUpperCase() === 'TRUE',
    });
  }

  return normalizeBrowserCookies(cookies);
}

/**
 * Parse JSON cookies (Playwright/Puppeteer format or EditThisCookie format).
 * Auto-detects format by examining structure.
 */
export function parseJsonCookies(content: string): BrowserCookie[] {
  const parsed = JSON.parse(content);
  return normalizeBrowserCookies(parsed);
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

  // Layer 1: disk cache (fast path) with M-6 FIX: freshness validation
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    const { encrypted, iv, authTag, updatedAt } = parsed;

    // M-6 FIX: Check if DB has newer cookies than disk cache
    const dbMeta = await prisma.socialAccount.findUnique({
      where: { id: accountId },
      select: { cookiesUpdatedAt: true },
    });

    if (dbMeta?.cookiesUpdatedAt && updatedAt) {
      const diskTime = new Date(updatedAt).getTime();
      const dbTime = new Date(dbMeta.cookiesUpdatedAt).getTime();
      if (dbTime > diskTime) {
        // DB has newer cookies — invalidate disk cache
        const fromDb = await loadCookiesForAccount(accountId);
        if (fromDb.length > 0) {
          await saveCookiesToDiskCache(accountId, fromDb, cookiesDir);
        }
        return fromDb;
      }
    }

    return decryptCookies(
      Buffer.from(encrypted, 'base64'),
      Buffer.from(iv, 'base64'),
      Buffer.from(authTag, 'base64'),
    );
  } catch {
    // Layer 2: DB fallback (single source of truth)
    const fromDb = await loadCookiesForAccount(accountId);
    if (fromDb.length > 0) {
      // Warm the disk cache for next launch
      await saveCookiesToDiskCache(accountId, fromDb, cookiesDir);
    }
    return fromDb;
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
  const normalizedCookies = normalizeBrowserCookies(cookies);
  if (normalizedCookies.length === 0) return;
  const { encrypted, iv, authTag } = encryptCookies(normalizedCookies);

  const cachePath = path.join(cookiesDir, `${accountId}.enc.json`);
  const tempPath = `${cachePath}.${process.pid}.${crypto.randomUUID()}.tmp`;

  // Ensure directory exists
  await fs.mkdir(cookiesDir, { recursive: true });

  try {
    await fs.writeFile(tempPath, JSON.stringify({
      encrypted: encrypted.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      updatedAt: new Date().toISOString(),
    }), { mode: 0o600 });
    await fs.rename(tempPath, cachePath);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

// ── Dual-persist: Disk + DB ─────────────────────────────────

/**
 * Persist cookies to BOTH disk cache AND database.
 *
 * This is the ONLY function handlers should call after a browser session.
 * It ensures cookies survive container restarts (DB) while also being
 * fast to load on next launch (disk cache).
 *
 * login.ts previously did inline crypto for DB persist — that logic is
 * now centralized here (single source of truth for cookie encryption).
 */
export async function persistCookies(
  accountId: string,
  cookies: BrowserCookie[],
  cookiesDir: string = '/data/cookies',
): Promise<void> {
  const normalizedCookies = normalizeBrowserCookies(cookies);
  if (normalizedCookies.length === 0) return;

  const { encrypted, iv, authTag } = encryptCookies(normalizedCookies);
  const updatedAt = new Date();

  // Commit the source of truth first. A cache failure must never make a stale
  // disk entry look newer than a DB write that did not actually succeed.
  await prisma.socialAccount.update({
    where: { id: accountId },
    data: {
      cookiesEncrypted: new Uint8Array(encrypted),
      cookiesIv: new Uint8Array(iv),
      cookiesAuthTag: new Uint8Array(authTag),
      cookiesUpdatedAt: updatedAt,
    },
  });

  try {
    await saveCookiesToDiskCache(accountId, normalizedCookies, cookiesDir);
  } catch (error) {
    console.warn(
      `[CookieStore] DB cookies persisted for ${accountId}, but disk cache refresh failed:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

// ── DB-backed Cookie Loader ─────────────────────────────────

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

