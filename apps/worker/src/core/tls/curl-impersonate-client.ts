// ─────────────────────────────────────────────────────────────
// curl-impersonate client — TLS fingerprint impersonation
//
// Wraps the curl-impersonate binary to make HTTP requests that
// look exactly like Chrome/Firefox/Safari at the TLS handshake
// level. This is critical because TikTok/Cloudflare check:
// 1. TLS cipher suite order
// 2. TLS extensions (ALPN, signed cert timestamps)
// 3. HTTP/2 frames (SETTINGS, WINDOW_UPDATE order)
//
// Using Node.js native fetch() or axios reveals a Node.js TLS
// fingerprint = instant block.
//
// Binary: curl_chrome116 (from lexiforest/curl-impersonate)
// Installed in Dockerfile at /usr/local/bin/
// ─────────────────────────────────────────────────────────────

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ── Types ───────────────────────────────────────────────────

export type ImpersonateProfile =
  | 'chrome116' | 'chrome110' | 'chrome107' | 'chrome131'
  | 'ff109' | 'ff133'
  | 'safari17_2_ios' | 'safari18';

export interface ImpersonateRequest {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  cookies?: string;           // formatted as "k1=v1; k2=v2"
  body?: string;              // for POST/PUT
  proxy?: string;             // http://user:pass@host:port
  impersonate?: ImpersonateProfile;
  timeoutMs?: number;
}

export interface ImpersonateResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  setCookies: string[];
}

// ── Constants ───────────────────────────────────────────────

const MAX_BUFFER = 50 * 1024 * 1024; // 50MB stdout buffer

// ── Main ────────────────────────────────────────────────────

/**
 * Make an HTTP request with TLS fingerprint impersonation.
 * Uses curl-impersonate binary — must be installed in PATH.
 *
 * @throws Error if binary not found or request fails
 */
export async function impersonatedFetch(
  req: ImpersonateRequest,
): Promise<ImpersonateResponse> {
  const binary = `curl_${req.impersonate ?? 'chrome131'}`;

  const args: string[] = [
    '-s',                     // silent mode (no progress)
    '-i',                     // include response headers
    '--compressed',           // accept gzip/brotli
    '--max-time', String((req.timeoutMs ?? 30_000) / 1000),
    '-X', req.method ?? 'GET',
  ];

  // Proxy
  if (req.proxy) {
    args.push('-x', req.proxy);
  }

  // Custom headers
  for (const [k, v] of Object.entries(req.headers ?? {})) {
    args.push('-H', `${k}: ${v}`);
  }

  // Cookies via header
  if (req.cookies) {
    args.push('-H', `Cookie: ${req.cookies}`);
  }

  // Request body
  if (req.body) {
    args.push('--data-raw', req.body);
  }

  // URL is always last
  args.push(req.url);

  try {
    const { stdout } = await execFileAsync(binary, args, {
      maxBuffer: MAX_BUFFER,
      timeout: (req.timeoutMs ?? 30_000) + 5_000, // extra 5s for process overhead
    });

    return parseRawResponse(stdout);
  } catch (err: unknown) {
    const error = err as Error & { code?: string };
    if (error.code === 'ENOENT') {
      throw new Error(
        `curl-impersonate binary "${binary}" not found. ` +
        `Install from: https://github.com/lexiforest/curl-impersonate`,
      );
    }
    throw err;
  }
}

// ── Response Parser ─────────────────────────────────────────

/**
 * Parse raw curl -i output into structured response.
 * Handles HTTP/1.1 and HTTP/2 status lines.
 * Handles multiple header blocks (100 Continue, redirects).
 */
function parseRawResponse(raw: string): ImpersonateResponse {
  // Find the last header/body split (handles 100 Continue, redirects)
  let headerBlock = '';
  let body = '';

  const parts = raw.split('\r\n\r\n');
  if (parts.length >= 2) {
    // Find the last HTTP status line index
    let lastStatusIdx = 0;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].match(/^HTTP\/[\d.]+ \d+/)) {
        lastStatusIdx = i;
      }
    }
    headerBlock = parts[lastStatusIdx];
    body = parts.slice(lastStatusIdx + 1).join('\r\n\r\n');
  } else {
    // Fallback — no proper header/body split
    headerBlock = raw;
    body = '';
  }

  const lines = headerBlock.split('\r\n');

  // Parse status
  const statusMatch = lines[0]?.match(/HTTP\/[\d.]+ (\d+)/);
  const status = statusMatch ? parseInt(statusMatch[1]) : 0;

  // Parse headers
  const headers: Record<string, string> = {};
  const setCookies: string[] = [];

  for (const line of lines.slice(1)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;

    const key = line.slice(0, idx).toLowerCase().trim();
    const value = line.slice(idx + 1).trim();

    if (key === 'set-cookie') {
      setCookies.push(value);
    } else {
      headers[key] = value;
    }
  }

  return { status, headers, body, setCookies };
}
