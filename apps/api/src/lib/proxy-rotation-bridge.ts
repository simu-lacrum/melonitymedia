import crypto from 'crypto';

export type ProxyProvider = 'MANUAL' | 'PROXYS_IO' | 'MOBILEPROXIES_ORG' | 'PROXYGROW' | 'ILLUSORY';

export interface RotateProxyInput {
  provider: ProxyProvider;
  externalId: string | null;
  apiKey: string | null;
  rotationLink: string | null;
}

export interface RotateProxyResult {
  ok: boolean;
  newIp?: string;
  error?: string;
}

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

export async function rotateProxy(input: RotateProxyInput): Promise<RotateProxyResult> {
  try {
    switch (input.provider) {
      case 'MANUAL': {
        if (!input.rotationLink) {
          return { ok: false, error: 'No rotation link configured for MANUAL provider' };
        }
        const res = await fetch(input.rotationLink, {
          method: 'GET',
          headers: { 'User-Agent': DEFAULT_UA },
        });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        return { ok: true };
      }

      case 'PROXYS_IO': {
        if (!input.externalId) return { ok: false, error: 'externalId (proxy_key) missing' };
        const url = `https://changeip.mobileproxy.space/?proxy_key=${encodeURIComponent(input.externalId)}&format=json`;
        const res = await fetch(url, { headers: { 'User-Agent': DEFAULT_UA } });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        const json = (await res.json()) as { status?: string; new_ip?: string; error?: string };
        if (json.status !== 'ok' && json.status !== 'OK') {
          return { ok: false, error: json.error ?? `Unexpected response: ${JSON.stringify(json)}` };
        }
        return { ok: true, newIp: json.new_ip };
      }

      case 'MOBILEPROXIES_ORG': {
        if (!input.apiKey) return { ok: false, error: 'apiKey missing' };
        if (!input.externalId) return { ok: false, error: 'externalId (slotId) missing' };
        const res = await fetch(`https://buy.mobileproxies.org/api/v1/proxies/${input.externalId}/switch`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${input.apiKey}`,
            'User-Agent': DEFAULT_UA,
          },
        });
        if (res.status !== 204 && !res.ok) return { ok: false, error: `HTTP ${res.status}` };
        return { ok: true };
      }

      case 'PROXYGROW': {
        if (!input.apiKey) return { ok: false, error: 'apiKey missing' };
        if (!input.externalId) return { ok: false, error: 'externalId (modemId) missing' };
        const url = `http://api.proxygrow.com/rotate?key=${encodeURIComponent(input.apiKey)}&modem=${encodeURIComponent(input.externalId)}`;
        const res = await fetch(url, { headers: { 'User-Agent': DEFAULT_UA } });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        const json = (await res.json()) as { status?: string; new_ip?: string; error?: string };
        if (json.status !== 'ok') return { ok: false, error: json.error ?? 'Unknown error' };
        return { ok: true, newIp: json.new_ip };
      }

      case 'ILLUSORY': {
        if (!input.apiKey) return { ok: false, error: 'apiKey missing' };
        if (!input.externalId) return { ok: false, error: 'externalId (proxyName) missing' };
        const res = await fetch(`https://cmd.illusory.io/v1/proxies/changeip/${input.externalId}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${input.apiKey}`,
            'User-Agent': DEFAULT_UA,
          },
        });
        if (res.status !== 202 && !res.ok) return { ok: false, error: `HTTP ${res.status}` };
        return { ok: true };
      }

      default:
        return { ok: false, error: `Unknown provider: ${input.provider}` };
    }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}
