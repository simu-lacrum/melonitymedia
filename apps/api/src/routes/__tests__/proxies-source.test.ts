import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const PROXIES_SRC = fs.readFileSync(
  path.resolve(__dirname, '../proxies.ts'),
  'utf-8',
);

const SCHEMA_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../../prisma/schema.prisma'),
  'utf-8',
);

describe('proxy route UX and protocol invariants', () => {
  it('stores an explicit HTTP/SOCKS5 protocol for proxies', () => {
    expect(SCHEMA_SRC).toContain('enum ProxyProtocol');
    expect(SCHEMA_SRC).toContain('protocol     ProxyProtocol @default(HTTP)');
    expect(PROXIES_SRC).toContain("protocol: z.enum(['HTTP', 'SOCKS5'])");
    expect(PROXIES_SRC).toContain('stripProtocolFromHost');
  });

  it('does not persist user-entered carrier or rotation for static residential proxies', () => {
    expect(PROXIES_SRC).toContain("const supportsRotation = normalizedType === 'LTE_MOBILE'");
    expect(PROXIES_SRC).toContain('carrier: null');
    expect(PROXIES_SRC).toContain('rotationLink: supportsRotation ? rotationLink || null : null');
    expect(PROXIES_SRC).toContain('isRotating: supportsRotation && !!rotationLink');
  });

  it('supports per-line protocol overrides during manual bulk import', () => {
    expect(PROXIES_SRC).toContain('parseProxyLine(line, normalizeProtocol(protocol))');
    expect(PROXIES_SRC).toContain('protocol: proxyProtocol');
    expect(PROXIES_SRC).toContain('composeAddress(host, port, username || undefined, password || undefined, proxyProtocol)');
  });
});
