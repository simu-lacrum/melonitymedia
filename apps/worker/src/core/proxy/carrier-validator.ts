// ─────────────────────────────────────────────────────────────
// Carrier Validator — BGP path + ASN verification for proxies
//
// TikTok cross-references the IP's ASN (Autonomous System Number)
// with expected carrier ASNs. A "mobile" proxy coming from a
// datacenter ASN (AWS, Hetzner, OVH) = instant ban.
//
// This validator:
// 1. Resolves the proxy's IP via ipify through the proxy
// 2. Looks up ASN via Team Cymru WHOIS
// 3. Checks if ASN belongs to a known mobile carrier
// 4. Flags datacenter ASNs as risky
// ─────────────────────────────────────────────────────────────

import { execFile } from 'child_process';
import { promisify } from 'util';
import { impersonatedFetch } from '../tls/curl-impersonate-client.js';

const execFileAsync = promisify(execFile);

// ── Types ───────────────────────────────────────────────────

export interface CarrierValidation {
  valid: boolean;
  observedIP: string;
  observedASN: number | null;
  asnOrg: string;
  proxyType: 'LTE_MOBILE' | 'STATIC_RESIDENTIAL' | 'DATACENTER';
  warning?: string;
}

// ── Known Datacenter ASNs ───────────────────────────────────
// These are NEVER legitimate mobile proxy sources

const DATACENTER_ASNS = new Set([
  // Cloud providers
  16509, 14618, // Amazon/AWS
  15169, 396982, // Google Cloud
  8075, 8068,  // Microsoft Azure
  13335,        // Cloudflare
  20473,        // Vultr
  14061,        // DigitalOcean
  24940,        // Hetzner
  16276,        // OVH
  51167,        // Contabo
  // Hosting companies
  46606,        // Unified Layer
  36352,        // ColoCrossing
  62567,        // DigitalOcean NYC
  9370,         // Sakura Internet
]);

// ── Known Mobile Carrier ASNs ───────────────────────────────
// Not exhaustive — used for positive validation

const MOBILE_CARRIER_ASNS = new Set([
  // US
  7922,  // Comcast (MVNO host)
  20001, // TWC
  22394, // Verizon Wireless
  21928, // T-Mobile
  7018,  // AT&T
  // EU
  12389, // Rostelecom (RU)
  8402,  // VEON (RU)
  25490, // MegaFon (RU)
  31261, // PJSC MTS (RU)
  5410,  // T-Mobile (DE)
  6805,  // Telefonica (DE)
  3320,  // Deutsche Telekom
  12322, // Free Mobile (FR)
  15557, // SFR (FR)
  6830,  // Liberty Global (EU)
  // Asia
  4766,  // Korea Telecom
  17858, // LG Uplus (KR)
  9644,  // SK Telecom (KR)
  4788,  // TM Net (MY)
  7470,  // TrueMove (TH)
  132199, // DTAC (TH)
  45899, // VNPT (VN)
  18403, // FPT (VN)
]);

// ── Main ────────────────────────────────────────────────────

/**
 * Validate proxy carrier path via ASN lookup.
 *
 * @param proxyUrl - http://user:pass@host:port format
 * @returns Validation result with ASN info and risk assessment
 */
export async function validateProxyCarrierPath(
  proxyUrl: string,
): Promise<CarrierValidation> {
  // Step 1: Get external IP through the proxy
  let ip: string;
  try {
    const resp = await impersonatedFetch({
      url: 'https://api.ipify.org?format=json',
      proxy: proxyUrl,
      impersonate: 'chrome116',
      timeoutMs: 15_000,
    });
    const data = JSON.parse(resp.body);
    ip = data.ip;
  } catch (err) {
    return {
      valid: false,
      observedIP: 'unknown',
      observedASN: null,
      asnOrg: 'Lookup failed',
      proxyType: 'DATACENTER',
      warning: `Failed to get proxy IP: ${(err as Error).message}`,
    };
  }

  // Step 2: ASN lookup via ip-api.com (no API key needed, 45/min rate limit)
  let asn: number | null = null;
  let asnOrg = 'Unknown';
  let isMobile = false;

  try {
    const resp = await impersonatedFetch({
      url: `http://ip-api.com/json/${ip}?fields=as,org,mobile,proxy,hosting`,
      impersonate: 'chrome116',
      timeoutMs: 10_000,
    });

    if (resp.status === 200) {
      const data = JSON.parse(resp.body);
      const asnMatch = String(data.as ?? '').match(/^AS(\d+)/);
      asn = asnMatch ? parseInt(asnMatch[1]) : null;
      asnOrg = data.org ?? 'Unknown';
      isMobile = data.mobile === true;
    }
  } catch {
    // Fallback: just use the IP without ASN info
  }

  // Step 3: Classify proxy type
  let proxyType: CarrierValidation['proxyType'];
  let warning: string | undefined;
  let valid = true;

  if (asn && DATACENTER_ASNS.has(asn)) {
    proxyType = 'DATACENTER';
    valid = false;
    warning = `Datacenter ASN detected (AS${asn} — ${asnOrg}). TikTok will flag this IP.`;
  } else if (isMobile || (asn && MOBILE_CARRIER_ASNS.has(asn))) {
    proxyType = 'LTE_MOBILE';
    // Ideal for TikTok
  } else {
    proxyType = 'STATIC_RESIDENTIAL';
    if (!isMobile) {
      warning = `Residential but not mobile (AS${asn ?? '?'} — ${asnOrg}). ` +
        'Works for YouTube, risky for TikTok (lower trust score).';
    }
  }

  return {
    valid,
    observedIP: ip,
    observedASN: asn,
    asnOrg,
    proxyType,
    warning,
  };
}
