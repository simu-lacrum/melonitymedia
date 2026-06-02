// ─────────────────────────────────────────────────────────────
// Fingerprint Generator (API-side) — lightweight variant
//
// ⚠️ BUG-M1 NOTE: This generator uses a DIFFERENT seeding algorithm
// than the worker's fingerprint-manager.ts:
//   - API: hash[n] (raw byte at index n)
//   - Worker: parseInt(seedHex.slice(n*4, n*4+8), 16) (4-byte hex slices)
//
// Both produce valid, deterministic fingerprints for a given accountId,
// but they will NOT produce IDENTICAL outputs for the same accountId.
//
// This is safe because fingerprints are generated ONCE at account
// creation time and stored in DB. The worker always loads from DB
// via loadAccountContext() — it never regenerates.
//
// DO NOT use the worker's generateFingerprintForAccount() from the API
// or vice versa. If you need to change the algorithm, create a migration.
// ─────────────────────────────────────────────────────────────
import crypto from 'crypto';

const timezoneByCountry: Record<string, string> = {
  US: 'America/New_York',
  GB: 'Europe/London',
  DE: 'Europe/Berlin',
  FR: 'Europe/Paris',
  RU: 'Europe/Moscow',
  KZ: 'Asia/Almaty',
  UA: 'Europe/Kyiv',
  JP: 'Asia/Tokyo',
  BR: 'America/Sao_Paulo',
  IN: 'Asia/Kolkata',
  AU: 'Australia/Sydney',
};

export function generateFingerprint(accountId: string, geo?: { country?: string; city?: string }) {
  const hash = crypto.createHash('sha256').update(accountId).digest();

  // --- OS selection (weighted like real traffic) ---
  const osRoll = hash[0] % 100;
  const platform: 'Win32' | 'MacIntel' | 'Linux x86_64' =
    osRoll < 72 ? 'Win32' : osRoll < 92 ? 'MacIntel' : 'Linux x86_64';

  // --- Screen resolutions per OS ---
  const resolutions: Record<string, Array<{ w: number; h: number }>> = {
    Win32: [
      { w: 1920, h: 1080 }, { w: 1366, h: 768 },
      { w: 2560, h: 1440 }, { w: 1536, h: 864 }, { w: 1440, h: 900 },
    ],
    MacIntel: [
      { w: 1440, h: 900 }, { w: 1680, h: 1050 },
      { w: 1920, h: 1080 }, { w: 2560, h: 1600 },
    ],
    'Linux x86_64': [
      { w: 1920, h: 1080 }, { w: 2560, h: 1440 }, { w: 1366, h: 768 },
    ],
  };

  const pool = resolutions[platform];
  const screen = pool[hash[1] % pool.length];

  // --- Viewport: screen minus realistic chrome (80-119px) ---
  const viewport = {
    width: screen.w,
    height: screen.h - (80 + (hash[2] % 40)),
  };

  // --- WebGL per OS (must be coherent) ---
  const gpus: Record<string, Array<{ vendor: string; renderer: string }>> = {
    Win32: [
      { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    ],
    MacIntel: [
      { vendor: 'Apple Inc.', renderer: 'Apple M1' },
      { vendor: 'Apple Inc.', renderer: 'Apple M2' },
    ],
    'Linux x86_64': [
      { vendor: 'Mesa', renderer: 'Mesa Intel(R) UHD Graphics 620 (KBL GT2)' },
      { vendor: 'Mesa/X.org', renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' },
    ],
  };
  const webgl = gpus[platform][hash[3] % gpus[platform].length];

  // --- Locale / timezone from geo ---
  const localeByCountry: Record<string, string> = {
    US: 'en-US', GB: 'en-GB', DE: 'de-DE', FR: 'fr-FR',
    RU: 'ru-RU', KZ: 'ru-KZ', UA: 'uk-UA', JP: 'ja-JP',
    BR: 'pt-BR', IN: 'en-IN', AU: 'en-AU',
  };
  const locale = localeByCountry[geo?.country ?? 'US'] ?? 'en-US';
  const timezone = timezoneByCountry[geo?.country ?? 'US'] ?? 'America/New_York';

  // BUG-L4 fix: Warn if geo.country is not in our lookup tables.
  // This prevents silent GEO_COHERENCE violations at worker launch time.
  const country = geo?.country ?? 'US';
  if (!localeByCountry[country]) {
    console.warn(
      `[fingerprint] Country "${country}" not in locale lookup table. ` +
      `Defaulting to en-US/America/New_York. Add this country to avoid GEO_COHERENCE violations.`,
    );
  }

  // --- UA (Chrome version from env, with sane default) ---
  const chromeMajor = parseInt(process.env.EXPECTED_CHROME_MAJOR ?? '148', 10);
  const osTokens: Record<string, string> = {
    Win32: 'Windows NT 10.0; Win64; x64',
    MacIntel: 'Macintosh; Intel Mac OS X 10_15_7',
    'Linux x86_64': 'X11; Linux x86_64',
  };
  const userAgent =
    `Mozilla/5.0 (${osTokens[platform]}) AppleWebKit/537.36 ` +
    `(KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`;

  // --- Hardware (deviceMemory capped at 8 by Chrome) ---
  const hwConcurrency = ([4, 6, 8, 8, 8, 12, 16] as const)[hash[4] % 7];
  const deviceMemory = ([4, 8, 8, 8] as const)[hash[5] % 4];

  // --- Fonts per OS ---
  const fontPools: Record<string, string[]> = {
    Win32: ['Arial', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Tahoma'],
    MacIntel: ['Helvetica Neue', 'San Francisco', 'Menlo', 'Monaco', 'Avenir', 'Geneva'],
    'Linux x86_64': ['DejaVu Sans', 'DejaVu Serif', 'Liberation Sans', 'Liberation Mono', 'Ubuntu', 'Noto Sans'],
  };
  const fonts = fontPools[platform].slice(0, 6 + (hash[6] % 3));

  return {
    deviceClass: 'desktop' as const,
    userAgent,
    platform,
    screen: { width: screen.w, height: screen.h, colorDepth: 24 as const },
    viewport,
    devicePixelRatio: platform === 'MacIntel' ? 2 : 1,
    locale,
    timezone,
    hardwareConcurrency: hwConcurrency,
    deviceMemory,
    maxTouchPoints: 0 as const,
    webgl,
    canvas: { seed: hash.subarray(7, 15).toString('hex') },
    fonts,
    chromeMajor,
  };
}

export function generateMobileFingerprint(accountId: string, geo?: { country?: string; city?: string }) {
  const hash = crypto.createHash('sha256').update(accountId + ':mobile').digest();
  
  // 60% iOS / 40% Android
  const isIOS = (hash[0] % 100) < 60;
  const platform = isIOS ? 'iPhone' : 'Linux armv8l';

  const iosViewports = [
    { w: 393, h: 852 }, { w: 390, h: 844 }, { w: 430, h: 932 },
    { w: 428, h: 926 }, { w: 375, h: 812 }, { w: 414, h: 896 },
    { w: 360, h: 780 },
  ];
  const androidViewports = [
    { w: 412, h: 915 }, { w: 360, h: 800 }, { w: 393, h: 873 },
    { w: 384, h: 854 }, { w: 412, h: 892 },
  ];
  const vpPool = isIOS ? iosViewports : androidViewports;
  const vp = vpPool[hash[1] % vpPool.length];

  const screen = { width: vp.w, height: vp.h, colorDepth: 24 as const };
  const viewport = { width: vp.w, height: vp.h };

  const devicePixelRatio = isIOS ? 3 : (hash[2] % 2 === 0 ? 2.625 : 3);

  const iosGPUs = [{ vendor: 'Apple Inc.', renderer: 'Apple GPU' }];
  const androidGPUs = [
    { vendor: 'Qualcomm', renderer: 'Adreno (TM) 740' },
    { vendor: 'Qualcomm', renderer: 'Adreno (TM) 730' },
    { vendor: 'ARM', renderer: 'Mali-G715' },
    { vendor: 'ARM', renderer: 'Mali-G710' },
  ];
  const gpuPool = isIOS ? iosGPUs : androidGPUs;
  const webgl = gpuPool[hash[3] % gpuPool.length];

  const localeByCountry: Record<string, string> = {
    US: 'en-US', GB: 'en-GB', DE: 'de-DE', FR: 'fr-FR',
    RU: 'ru-RU', KZ: 'ru-KZ', UA: 'uk-UA', JP: 'ja-JP',
    BR: 'pt-BR', IN: 'en-IN', AU: 'en-AU',
  };
  const locale = localeByCountry[geo?.country ?? 'US'] ?? 'en-US';
  const timezone = timezoneByCountry[geo?.country ?? 'US'] ?? 'America/New_York';

  const chromeMajor = parseInt(process.env.EXPECTED_CHROME_MAJOR ?? '148', 10);
  const iosUA =
    `Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) ` +
    `AppleWebKit/605.1.15 (KHTML, like Gecko) ` +
    `CriOS/${chromeMajor}.0.0.0 Mobile/15E148 Safari/604.1`;
  const androidUA =
    `Mozilla/5.0 (Linux; Android 14; Pixel 8) ` +
    `AppleWebKit/537.36 (KHTML, like Gecko) ` +
    `Chrome/${chromeMajor}.0.0.0 Mobile Safari/537.36`;

  const iosFonts = ['-apple-system', 'BlinkMacSystemFont', 'San Francisco', 'Helvetica Neue', 'Helvetica'];
  const androidFonts = ['Roboto', 'sans-serif', 'Droid Sans', 'Noto Sans'];

  return {
    deviceClass: 'mobile' as const,
    userAgent: isIOS ? iosUA : androidUA,
    platform,
    screen,
    viewport,
    devicePixelRatio,
    locale,
    timezone,
    hardwareConcurrency: ([6, 8, 8] as const)[hash[4] % 3],
    deviceMemory: ([4, 8] as const)[hash[5] % 2],
    maxTouchPoints: 5 as const,
    webgl,
    canvas: { seed: hash.subarray(6, 14).toString('hex') },
    fonts: isIOS ? iosFonts : androidFonts,
    chromeMajor,
  };
}
