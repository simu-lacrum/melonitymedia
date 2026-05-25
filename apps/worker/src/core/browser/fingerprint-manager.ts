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
//
// Forbidden combinations are enforced:
// - Windows UA + MacIntel platform = BLOCKED
// - viewport > screen = BLOCKED
// - hardwareConcurrency:32 + deviceMemory:4 = BLOCKED
// ─────────────────────────────────────────────────────────────

import { execSync } from 'child_process';
import crypto from 'crypto';
import type { Page } from 'patchright';

// ── Types ───────────────────────────────────────────────────

export interface AccountFingerprint {
  userAgent: string;
  viewport: { width: number; height: number };
  screen: { width: number; height: number; colorDepth: number };
  timezone: string;
  locale: string;
  platform: string;
  webglVendor: string;
  webglRenderer: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  canvasSeed: number;
}

// ── Distribution Tables ─────────────────────────────────────
// Based on real-world browser statistics (updated 2026-Q1)

interface Weighted<T> {
  value: T;
  weight: number;
}

const OS_DISTRIBUTION: Weighted<string>[] = [
  { value: 'Windows', weight: 0.72 },
  { value: 'macOS', weight: 0.16 },
  { value: 'Linux', weight: 0.04 },
];

const WINDOWS_RESOLUTIONS: Weighted<{ w: number; h: number }>[] = [
  { value: { w: 1920, h: 1080 }, weight: 0.38 },
  { value: { w: 1366, h: 768 }, weight: 0.18 },
  { value: { w: 2560, h: 1440 }, weight: 0.12 },
  { value: { w: 1536, h: 864 }, weight: 0.09 },
  { value: { w: 1440, h: 900 }, weight: 0.07 },
  { value: { w: 3840, h: 2160 }, weight: 0.05 },
  { value: { w: 1680, h: 1050 }, weight: 0.04 },
  { value: { w: 1280, h: 720 }, weight: 0.04 },
  { value: { w: 1600, h: 900 }, weight: 0.03 },
];

const MACOS_RESOLUTIONS: Weighted<{ w: number; h: number }>[] = [
  { value: { w: 1440, h: 900 }, weight: 0.25 },
  { value: { w: 1680, h: 1050 }, weight: 0.20 },
  { value: { w: 2560, h: 1600 }, weight: 0.20 },
  { value: { w: 1920, h: 1080 }, weight: 0.15 },
  { value: { w: 2560, h: 1440 }, weight: 0.10 },
  { value: { w: 3024, h: 1964 }, weight: 0.10 },
];

const LINUX_RESOLUTIONS: Weighted<{ w: number; h: number }>[] = [
  { value: { w: 1920, h: 1080 }, weight: 0.50 },
  { value: { w: 2560, h: 1440 }, weight: 0.20 },
  { value: { w: 1366, h: 768 }, weight: 0.15 },
  { value: { w: 1680, h: 1050 }, weight: 0.15 },
];

const WINDOWS_WEBGL: Weighted<{ vendor: string; renderer: string }>[] = [
  { value: { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' }, weight: 0.18 },
  { value: { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' }, weight: 0.14 },
  { value: { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)' }, weight: 0.10 },
  { value: { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)' }, weight: 0.08 },
  { value: { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' }, weight: 0.12 },
  { value: { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)' }, weight: 0.10 },
  { value: { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)' }, weight: 0.06 },
  { value: { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)' }, weight: 0.08 },
  { value: { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)' }, weight: 0.07 },
  { value: { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)' }, weight: 0.07 },
];

const MACOS_WEBGL: Weighted<{ vendor: string; renderer: string }>[] = [
  { value: { vendor: 'Apple', renderer: 'Apple M1' }, weight: 0.30 },
  { value: { vendor: 'Apple', renderer: 'Apple M2' }, weight: 0.25 },
  { value: { vendor: 'Apple', renderer: 'Apple M3' }, weight: 0.20 },
  { value: { vendor: 'Apple', renderer: 'Apple M1 Pro' }, weight: 0.15 },
  { value: { vendor: 'Apple', renderer: 'Apple M2 Pro' }, weight: 0.10 },
];

const LINUX_WEBGL: Weighted<{ vendor: string; renderer: string }>[] = [
  { value: { vendor: 'Mesa', renderer: 'Mesa Intel(R) UHD Graphics 630 (CFL GT2)' }, weight: 0.35 },
  { value: { vendor: 'NVIDIA Corporation', renderer: 'NVIDIA GeForce GTX 1080/PCIe/SSE2' }, weight: 0.25 },
  { value: { vendor: 'Mesa', renderer: 'AMD Radeon RX 580 (polaris10, LLVM 15.0.7, DRM 3.49, 6.1.0)' }, weight: 0.20 },
  { value: { vendor: 'NVIDIA Corporation', renderer: 'NVIDIA GeForce RTX 3060/PCIe/SSE2' }, weight: 0.20 },
];

const HW_CORES: Weighted<number>[] = [
  { value: 4, weight: 0.15 },
  { value: 6, weight: 0.15 },
  { value: 8, weight: 0.35 },
  { value: 12, weight: 0.20 },
  { value: 16, weight: 0.15 },
];

// Chrome caps deviceMemory at 8
const DEVICE_MEMORY: Weighted<number>[] = [
  { value: 4, weight: 0.15 },
  { value: 8, weight: 0.70 },
  { value: 16, weight: 0.15 },
];

// ── Timezone & Locale Maps ──────────────────────────────────

const TIMEZONE_BY_COUNTRY: Record<string, string[]> = {
  US: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'],
  GB: ['Europe/London'],
  DE: ['Europe/Berlin'],
  FR: ['Europe/Paris'],
  RU: ['Europe/Moscow', 'Asia/Yekaterinburg', 'Asia/Novosibirsk'],
  UA: ['Europe/Kiev'],
  PL: ['Europe/Warsaw'],
  BR: ['America/Sao_Paulo'],
  JP: ['Asia/Tokyo'],
  KR: ['Asia/Seoul'],
  IN: ['Asia/Kolkata'],
  ID: ['Asia/Jakarta'],
  TH: ['Asia/Bangkok'],
  VN: ['Asia/Ho_Chi_Minh'],
  PH: ['Asia/Manila'],
};

const LOCALE_BY_COUNTRY: Record<string, string> = {
  US: 'en-US', GB: 'en-GB', DE: 'de-DE', FR: 'fr-FR',
  RU: 'ru-RU', UA: 'uk-UA', PL: 'pl-PL', BR: 'pt-BR',
  JP: 'ja-JP', KR: 'ko-KR', IN: 'hi-IN', ID: 'id-ID',
  TH: 'th-TH', VN: 'vi-VN', PH: 'en-PH',
};

// ── Utilities ───────────────────────────────────────────────

function weightedPick<T>(items: Weighted<T>[]): T {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * totalWeight;

  for (const item of items) {
    random -= item.weight;
    if (random <= 0) return item.value;
  }

  return items[items.length - 1].value;
}

function pickFromArray<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Chrome Version Detection ────────────────────────────────

let _cachedChromeVersion: string | null = null;

/**
 * Detect the installed system Chrome version.
 * CRITICAL: UA Chrome version MUST match TLS fingerprint from system Chrome.
 * Mismatch = most detectable signal.
 */
export function getSystemChromeVersion(): string {
  if (_cachedChromeVersion) return _cachedChromeVersion;

  try {
    const raw = execSync('google-chrome --version 2>/dev/null || google-chrome-stable --version 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000,
    });
    const match = raw.match(/[\d.]+/);
    if (match) {
      _cachedChromeVersion = match[0];
      return _cachedChromeVersion;
    }
  } catch {
    // Fallback for dev environments (Windows/macOS)
    try {
      const raw = execSync('reg query "HKLM\\SOFTWARE\\Google\\Chrome\\BLBeacon" /v version 2>nul', {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const match = raw.match(/[\d.]+/);
      if (match) {
        _cachedChromeVersion = match[0];
        return _cachedChromeVersion;
      }
    } catch {
      // Ignore
    }
  }

  // Fallback — current stable as of 2026-Q2
  _cachedChromeVersion = '148.0.7778.168';
  console.warn(`[Fingerprint] Could not detect Chrome version, using fallback: ${_cachedChromeVersion}`);
  return _cachedChromeVersion;
}

// ── Fingerprint Generator ───────────────────────────────────

/**
 * Generate a new fingerprint for an account.
 * Call this ONCE when creating the account, then save to DB.
 * NEVER regenerate — changing fingerprint = shadowban.
 *
 * @param geo - Country code for timezone/locale consistency
 */
export function generateFingerprint(geo: { country: string }): AccountFingerprint {
  const chromeVersion = getSystemChromeVersion();
  const os = weightedPick(OS_DISTRIBUTION);

  let resolution: { w: number; h: number };
  let webgl: { vendor: string; renderer: string };
  let platform: string;
  let userAgent: string;

  switch (os) {
    case 'macOS': {
      resolution = weightedPick(MACOS_RESOLUTIONS);
      webgl = weightedPick(MACOS_WEBGL);
      platform = 'MacIntel';
      userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
      break;
    }
    case 'Linux': {
      resolution = weightedPick(LINUX_RESOLUTIONS);
      webgl = weightedPick(LINUX_WEBGL);
      platform = 'Linux x86_64';
      userAgent = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
      break;
    }
    default: {
      // Windows (72% of traffic)
      resolution = weightedPick(WINDOWS_RESOLUTIONS);
      webgl = weightedPick(WINDOWS_WEBGL);
      platform = 'Win32';
      userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
      break;
    }
  }

  const country = geo.country.toUpperCase();
  const timezones = TIMEZONE_BY_COUNTRY[country] ?? ['America/New_York'];
  const timezone = pickFromArray(timezones);
  const locale = LOCALE_BY_COUNTRY[country] ?? 'en-US';

  const hwCores = weightedPick(HW_CORES);
  const deviceMemory = weightedPick(DEVICE_MEMORY);

  // Viewport is always smaller than screen (taskbar, browser chrome)
  const viewportHeight = resolution.h - (80 + Math.floor(Math.random() * 40)); // 80-120px for chrome + taskbar

  return {
    userAgent,
    viewport: { width: resolution.w, height: viewportHeight },
    screen: { width: resolution.w, height: resolution.h, colorDepth: 24 },
    timezone,
    locale,
    platform,
    webglVendor: webgl.vendor,
    webglRenderer: webgl.renderer,
    hardwareConcurrency: hwCores,
    deviceMemory: Math.min(deviceMemory, 8), // Chrome caps at 8
    canvasSeed: crypto.randomInt(0, 2 ** 32 - 1),
  };
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
 * - Canvas noise (deterministic per canvasSeed)
 * - WebGL vendor/renderer
 */
export async function applyFingerprint(page: Page, fp: AccountFingerprint): Promise<void> {
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
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: fp.screen.width,
    screenHeight: fp.screen.height,
  });

  // Canvas noise + WebGL spoofing via page scripts
  await page.addInitScript(
    ({ canvasSeed, webglVendor, webglRenderer, hwConcurrency, devMemory, screenObj }) => {
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

      // ── Screen dimensions ──
      Object.defineProperty(screen, 'width', { get: () => screenObj.width });
      Object.defineProperty(screen, 'height', { get: () => screenObj.height });
      Object.defineProperty(screen, 'availWidth', { get: () => screenObj.width });
      Object.defineProperty(screen, 'availHeight', { get: () => screenObj.height - 40 });
      Object.defineProperty(screen, 'colorDepth', { get: () => screenObj.colorDepth });
      Object.defineProperty(screen, 'pixelDepth', { get: () => screenObj.colorDepth });
    },
    {
      canvasSeed: fp.canvasSeed,
      webglVendor: fp.webglVendor,
      webglRenderer: fp.webglRenderer,
      hwConcurrency: fp.hardwareConcurrency,
      devMemory: fp.deviceMemory,
      screenObj: fp.screen,
    },
  );

  await cdp.detach();
}
