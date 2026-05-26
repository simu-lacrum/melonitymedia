// ─────────────────────────────────────────────────────────────
// Fingerprint Manager — Per-account stable fingerprint
//
// CRITICAL RULE: fingerprint is generated ONCE per account
// and NEVER changes. One account = one machine in TikTok's eyes.
// Changing fingerprint between sessions = automatic shadowban.
//
// This module:
// 1. Generates internally consistent fingerprints
// 2. Uses weighted distributions matching real-world traffic
// 3. Applies fingerprint via CDP sessions
// 4. Detects system Chrome version for UA consistency
// 5. Validates 7 consistency rules at generation AND load
//
// Forbidden combinations are enforced:
// - Windows UA + MacIntel platform = BLOCKED
// - viewport > screen = BLOCKED
// - hardwareConcurrency:32 + deviceMemory:4 = BLOCKED
// ─────────────────────────────────────────────────────────────

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import type { Page } from 'patchright';

// ── Types ───────────────────────────────────────────────────

export interface AccountFingerprint {
  userAgent: string;
  platform: "Win32" | "MacIntel" | "Linux x86_64";
  screen: { width: number; height: number; colorDepth: 24 };
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  locale: string;          // BCP 47, e.g. "en-US", "ru-RU"
  timezone: string;        // IANA, e.g. "America/Chicago"
  hardwareConcurrency: 4 | 6 | 8 | 12 | 16;
  deviceMemory: 4 | 8;     // Chrome caps reported deviceMemory at 8
  maxTouchPoints: 0 | 1 | 5;
  webgl: { vendor: string; renderer: string };
  canvas: { seed: string }; // hex
  fonts: string[];
  chromeMajor: number;      // must match system Chrome major version
}

// ── Consistency Validation ──────────────────────────────────

/**
 * Consistency rules for AccountFingerprint.
 *
 * Bot-detection systems (Cloudflare, DataDome, TikTok BotManager) flag
 * any internally inconsistent fingerprint within 1 request. Generating
 * a Windows UA with a MacIntel platform is an instant red flag.
 *
 * Throws on first violation with a precise message. Used both at
 * generation time and on load from DB (defence in depth against
 * tampering or schema drift).
 */
export function validateFingerprintConsistency(fp: AccountFingerprint): void {
  // 1. UA OS must match navigator.platform.
  const uaOsMatches: Record<AccountFingerprint["platform"], RegExp> = {
    Win32: /Windows NT \d+\.\d+/,
    MacIntel: /Macintosh; Intel Mac OS X/,
    "Linux x86_64": /X11; Linux x86_64/,
  };
  if (!uaOsMatches[fp.platform].test(fp.userAgent)) {
    throw new FingerprintInconsistencyError(
      `userAgent OS does not match platform=${fp.platform}. UA="${fp.userAgent}"`,
    );
  }

  // 2. WebGL renderer must match OS family.
  const rendererOk =
    (fp.platform === "Win32" && /ANGLE \(.+\)/.test(fp.webgl.renderer)) ||
    (fp.platform === "MacIntel" &&
      /(Apple|AMD Radeon Pro|Intel.+(?:Iris|UHD))/.test(fp.webgl.renderer)) ||
    (fp.platform === "Linux x86_64" &&
      /(Mesa|llvmpipe|NVIDIA)/i.test(fp.webgl.renderer));
  if (!rendererOk) {
    throw new FingerprintInconsistencyError(
      `webgl.renderer "${fp.webgl.renderer}" doesn't match platform=${fp.platform}. ` +
        `Windows must report ANGLE, macOS must report Apple/AMD Radeon Pro/Intel Iris-UHD, ` +
        `Linux must report Mesa/llvmpipe/NVIDIA.`,
    );
  }

  // 3. Screen >= viewport with realistic chrome (>=80px height for taskbar/header).
  if (fp.viewport.width > fp.screen.width) {
    throw new FingerprintInconsistencyError(
      `viewport.width (${fp.viewport.width}) exceeds screen.width (${fp.screen.width}). ` +
        `This is physically impossible.`,
    );
  }
  if (fp.viewport.height > fp.screen.height - 80) {
    throw new FingerprintInconsistencyError(
      `viewport.height (${fp.viewport.height}) leaves <80px for taskbar/header ` +
        `on screen.height ${fp.screen.height}. Real browsers always reserve chrome space.`,
    );
  }

  // 4. Timezone <-> locale country sanity check.
  const localeCountry = fp.locale.split("-")[1]?.toUpperCase();
  const tzRegion = fp.timezone.split("/")[0];
  const validRegions: Record<string, string[]> = {
    US: ["America"],
    GB: ["Europe"],
    DE: ["Europe"],
    FR: ["Europe"],
    RU: ["Europe", "Asia"],
    KZ: ["Asia"],
    UA: ["Europe"],
    JP: ["Asia"],
    BR: ["America"],
    IN: ["Asia"],
    AU: ["Australia"],
  };
  if (localeCountry && validRegions[localeCountry]) {
    if (!validRegions[localeCountry].includes(tzRegion)) {
      throw new FingerprintInconsistencyError(
        `locale ${fp.locale} country ${localeCountry} doesn't match timezone region ${tzRegion}. ` +
          `Expected one of: ${validRegions[localeCountry].join(", ")}.`,
      );
    }
  }

  // 5. hardwareConcurrency and deviceMemory bounds.
  if (![4, 6, 8, 12, 16].includes(fp.hardwareConcurrency)) {
    throw new FingerprintInconsistencyError(
      `hardwareConcurrency must be one of {4,6,8,12,16}, got ${fp.hardwareConcurrency}.`,
    );
  }
  if (![4, 8].includes(fp.deviceMemory)) {
    throw new FingerprintInconsistencyError(
      `deviceMemory must be 4 or 8 (Chrome caps reported value at 8), got ${fp.deviceMemory}.`,
    );
  }

  // 6. Chrome major in UA must match system Chrome.
  const uaChromeMajor = parseInt(
    fp.userAgent.match(/Chrome\/(\d+)/)?.[1] ?? "0",
    10,
  );
  if (uaChromeMajor !== fp.chromeMajor) {
    throw new FingerprintInconsistencyError(
      `Chrome major in userAgent (${uaChromeMajor}) doesn't match fingerprint.chromeMajor ` +
        `(${fp.chromeMajor}). System Chrome version must be reflected in UA.`,
    );
  }

  // 7. maxTouchPoints sanity: desktop UA -> 0; iOS/Android UA -> 5.
  if (
    fp.maxTouchPoints !== 0 &&
    /Windows NT|Macintosh; Intel|X11; Linux/.test(fp.userAgent)
  ) {
    throw new FingerprintInconsistencyError(
      `Desktop userAgent must have maxTouchPoints=0 (got ${fp.maxTouchPoints}). ` +
        `Non-zero touch points on a desktop UA is a top-3 antifraud signal.`,
    );
  }
}

export class FingerprintInconsistencyError extends Error {
  constructor(message: string) {
    super(`[fingerprint-consistency] ${message}`);
    this.name = "FingerprintInconsistencyError";
  }
}

// ── Chrome Version Detection ────────────────────────────────

let cachedChromeMajor: number | null = null;

export function getSystemChromeMajor(): number {
  if (cachedChromeMajor !== null) return cachedChromeMajor;

  try {
    const out = execSync("google-chrome --version", {
      encoding: "utf8",
      timeout: 5_000,
    });
    const major = parseInt(out.match(/(\d+)\./)?.[1] ?? "0", 10);
    if (major < 130) {
      throw new Error(
        `System Chrome too old (major=${major}). Patchright requires Chrome 148+.`,
      );
    }
    cachedChromeMajor = major;
    return major;
  } catch (err) {
    // Fallback for dev environments (Windows/macOS)
    try {
      const raw = execSync('reg query "HKLM\\SOFTWARE\\Google\\Chrome\\BLBeacon" /v version 2>nul', {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const match = raw.match(/(\d+)\./);
      if (match) {
        cachedChromeMajor = parseInt(match[1], 10);
        return cachedChromeMajor;
      }
    } catch {
      // Ignore
    }

    // Last-resort fallback for dev
    console.warn('[Fingerprint] Could not detect Chrome version, using fallback: 148');
    cachedChromeMajor = 148;
    return cachedChromeMajor;
  }
}

// ── Fingerprint Generator ───────────────────────────────────

/**
 * Generate a stable per-account fingerprint. Pure function of accountId
 * (and the live system Chrome major version, captured once at worker boot).
 *
 * Same accountId -> identical fingerprint forever. NEVER regenerate for
 * an existing account; doing so resets TikTok's identity correlation and
 * triggers shadowban.
 */
export function generateFingerprintForAccount(
  accountId: string,
  geo: { country: string; city: string },
): AccountFingerprint {
  const chromeMajor = getSystemChromeMajor();
  const seedHex = createHash("sha256").update(accountId).digest("hex");
  const seed = (n: number) =>
    parseInt(seedHex.slice(n * 4, n * 4 + 8), 16);

  // --- pick OS family (Windows-biased, real-world distribution) ---
  const osRoll = seed(0) % 100;
  const platform: AccountFingerprint["platform"] =
    osRoll < 72 ? "Win32" : osRoll < 92 ? "MacIntel" : "Linux x86_64";

  // --- resolution (top-5 most common per OS) ---
  const winResolutions = [
    { w: 1920, h: 1080 },
    { w: 1366, h: 768 },
    { w: 2560, h: 1440 },
    { w: 1536, h: 864 },
    { w: 1440, h: 900 },
  ];
  const macResolutions = [
    { w: 1440, h: 900 },
    { w: 1680, h: 1050 },
    { w: 1920, h: 1080 },
    { w: 2560, h: 1600 },
  ];
  const linuxResolutions = [
    { w: 1920, h: 1080 },
    { w: 2560, h: 1440 },
    { w: 1366, h: 768 },
  ];
  const pool =
    platform === "Win32"
      ? winResolutions
      : platform === "MacIntel"
        ? macResolutions
        : linuxResolutions;
  const res = pool[seed(1) % pool.length];

  // --- viewport: screen minus realistic chrome ---
  const viewport = {
    width: res.w,
    height: res.h - (80 + (seed(2) % 40)), // 80-119px taskbar+chrome
  };

  // --- WebGL ---
  const winGPUs = [
    { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)" },
    { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)" },
  ];
  const macGPUs = [
    { vendor: "Apple Inc.", renderer: "Apple M1" },
    { vendor: "Apple Inc.", renderer: "Apple M2" },
    { vendor: "ATI Technologies Inc.", renderer: "AMD Radeon Pro 5500M OpenGL Engine" },
    { vendor: "Intel Inc.", renderer: "Intel(R) Iris(TM) Plus Graphics OpenGL Engine" },
  ];
  const linuxGPUs = [
    { vendor: "Mesa", renderer: "Mesa Intel(R) UHD Graphics 620 (KBL GT2)" },
    { vendor: "Mesa/X.org", renderer: "llvmpipe (LLVM 15.0.7, 256 bits)" },
  ];
  const gpuPool =
    platform === "Win32" ? winGPUs : platform === "MacIntel" ? macGPUs : linuxGPUs;
  const webgl = gpuPool[seed(3) % gpuPool.length];

  // --- locale & timezone from proxy geo (NOT from machine) ---
  const localeByCountry: Record<string, string> = {
    US: "en-US", GB: "en-GB", DE: "de-DE", FR: "fr-FR",
    RU: "ru-RU", KZ: "ru-KZ", UA: "uk-UA", JP: "ja-JP",
    BR: "pt-BR", IN: "en-IN", AU: "en-AU",
  };
  const timezoneByCity: Record<string, string> = {
    "New York": "America/New_York", "Chicago": "America/Chicago",
    "Los Angeles": "America/Los_Angeles", "Houston": "America/Chicago",
    "Moscow": "Europe/Moscow", "Almaty": "Asia/Almaty",
    "Berlin": "Europe/Berlin", "London": "Europe/London",
    "Paris": "Europe/Paris", "Tokyo": "Asia/Tokyo",
  };
  const locale = localeByCountry[geo.country] ?? "en-US";
  const timezone = timezoneByCity[geo.city] ?? "America/Chicago";

  // --- userAgent (Chrome version pinned to system) ---
  const osTokens: Record<AccountFingerprint["platform"], string> = {
    Win32: "Windows NT 10.0; Win64; x64",
    MacIntel: "Macintosh; Intel Mac OS X 10_15_7",
    "Linux x86_64": "X11; Linux x86_64",
  };
  const userAgent =
    `Mozilla/5.0 (${osTokens[platform]}) AppleWebKit/537.36 ` +
    `(KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`;

  const fp: AccountFingerprint = {
    userAgent,
    platform,
    screen: { width: res.w, height: res.h, colorDepth: 24 },
    viewport,
    devicePixelRatio: platform === "MacIntel" ? 2 : 1,
    locale,
    timezone,
    hardwareConcurrency: ([4, 6, 8, 8, 8, 12, 16] as const)[seed(4) % 7],
    deviceMemory: ([4, 8, 8, 8] as const)[seed(5) % 4],
    maxTouchPoints: 0, // desktop only in this generator
    webgl,
    canvas: { seed: seedHex.slice(0, 16) },
    fonts: pickFonts(platform, seed(6)),
    chromeMajor,
  };

  // Defence in depth: never return an invalid fingerprint, even by accident.
  validateFingerprintConsistency(fp);
  return fp;
}

function pickFonts(
  platform: AccountFingerprint["platform"],
  seed: number,
): string[] {
  const winFonts = [
    "Arial", "Calibri", "Cambria", "Consolas", "Courier New",
    "Georgia", "Segoe UI", "Tahoma", "Times New Roman", "Verdana",
  ];
  const macFonts = [
    "Helvetica Neue", "San Francisco", "Menlo", "Monaco", "Avenir",
    "Geneva", "Lucida Grande", "Optima", "Palatino", "Times",
  ];
  const linuxFonts = [
    "DejaVu Sans", "DejaVu Serif", "Liberation Sans", "Liberation Mono",
    "Ubuntu", "Noto Sans", "Noto Mono",
  ];
  const pool =
    platform === "Win32"
      ? winFonts
      : platform === "MacIntel"
        ? macFonts
        : linuxFonts;
  // Pick a 6-8 font subset deterministically.
  const count = 6 + (seed % 3);
  return pool.slice(0, count);
}

// ── Apply Fingerprint via CDP ───────────────────────────────

/**
 * Apply per-account fingerprint overrides via Chrome DevTools Protocol.
 * This runs AFTER page creation but BEFORE any navigation.
 *
 * Overrides:
 * - User agent + platform + accept-language
 * - Timezone + locale
 * - Screen metrics
 * - Canvas noise (deterministic per canvas.seed)
 * - WebGL vendor/renderer
 */
export async function applyFingerprint(page: Page, fp: AccountFingerprint): Promise<void> {
  // Validate before applying — defence in depth.
  validateFingerprintConsistency(fp);

  const cdp = await page.context().newCDPSession(page);

  // UA + Platform
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: fp.userAgent,
    platform: fp.platform,
    acceptLanguage: `${fp.locale},en;q=0.9`,
  });

  // Timezone
  await cdp.send('Emulation.setTimezoneOverride', {
    timezoneId: fp.timezone,
  });

  // Locale
  await cdp.send('Emulation.setLocaleOverride', {
    locale: fp.locale,
  });

  // Screen metrics
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: fp.viewport.width,
    height: fp.viewport.height,
    deviceScaleFactor: fp.devicePixelRatio,
    mobile: false,
    screenWidth: fp.screen.width,
    screenHeight: fp.screen.height,
  });

  // Canvas noise + WebGL spoofing via page scripts
  const canvasSeedNum = parseInt(fp.canvas.seed, 16);
  await page.addInitScript(
    ({ canvasSeed, webglVendor, webglRenderer, hwConcurrency, devMemory, screenObj, touchPoints }) => {
      // ── Canvas noise (deterministic per canvasSeed) ──
      const origGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: [string, ...unknown[]]) {
        const ctx = origGetContext.apply(this, args as Parameters<typeof origGetContext>);
        if (args[0] === '2d' && ctx) {
          const origGetImageData = (ctx as CanvasRenderingContext2D).getImageData;
          (ctx as CanvasRenderingContext2D).getImageData = function (...gArgs: Parameters<typeof origGetImageData>) {
            const data = origGetImageData.apply(this, gArgs);
            let seed = canvasSeed;
            for (let i = 0; i < data.data.length; i += 4) {
              seed = (seed * 1664525 + 1013904223) >>> 0;
              data.data[i] = (data.data[i] + (seed & 1)) & 0xff;
            }
            return data;
          };
        }
        return ctx;
      };

      // ── WebGL vendor/renderer ──
      const origGetParam = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (param: number) {
        if (param === 37445) return webglVendor;  // UNMASKED_VENDOR_WEBGL
        if (param === 37446) return webglRenderer; // UNMASKED_RENDERER_WEBGL
        return origGetParam.call(this, param);
      };

      // Also override WebGL2
      if (typeof WebGL2RenderingContext !== 'undefined') {
        const origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function (param: number) {
          if (param === 37445) return webglVendor;
          if (param === 37446) return webglRenderer;
          return origGetParam2.call(this, param);
        };
      }

      // ── Hardware concurrency ──
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => hwConcurrency,
      });

      // ── Device memory ──
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => devMemory,
      });

      // ── Max touch points ──
      Object.defineProperty(navigator, 'maxTouchPoints', {
        get: () => touchPoints,
      });

      // ── Screen dimensions ──
      Object.defineProperty(screen, 'width', { get: () => screenObj.width });
      Object.defineProperty(screen, 'height', { get: () => screenObj.height });
      Object.defineProperty(screen, 'availWidth', { get: () => screenObj.width });
      Object.defineProperty(screen, 'availHeight', { get: () => screenObj.height - 40 });
      Object.defineProperty(screen, 'colorDepth', { get: () => screenObj.colorDepth });
      Object.defineProperty(screen, 'pixelDepth', { get: () => screenObj.colorDepth });
    },
    {
      canvasSeed: canvasSeedNum,
      webglVendor: fp.webgl.vendor,
      webglRenderer: fp.webgl.renderer,
      hwConcurrency: fp.hardwareConcurrency,
      devMemory: fp.deviceMemory,
      screenObj: fp.screen,
      touchPoints: fp.maxTouchPoints,
    },
  );

  await cdp.detach();
}
