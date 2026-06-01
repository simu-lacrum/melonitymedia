// ─────────────────────────────────────────────────────────────
// Proxy Management Routes v3
// CRUD for mobile/static proxies with carrier validation.
//
// v3 changes:
// 1. Proxy type classification (LTE_MOBILE, STATIC_RESIDENTIAL, DATACENTER)
// 2. Carrier/ASN tracking fields
// 3. Rotation cooldown (seconds between IP rotations)
// 4. POST /:id/validate-carrier endpoint
// 5. host/port stored directly (no more compose/decompose)
// ─────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import crypto from 'crypto';

const router = Router();
router.use(authMiddleware);

// ── Input schemas ───────────────────────────────────────────

const createProxySchema = z.object({
  name: z.string().optional(),
  host: z.string().min(1, 'Хост обязателен'),
  port: z.number().int().min(1).max(65535),
  username: z.string().optional(),
  password: z.string().optional(),
  rotationLink: z.string().url().optional().or(z.literal('')),
  type: z.enum(['LTE_MOBILE', 'STATIC_RESIDENTIAL']).optional(),
  country: z.string().optional(),
  carrier: z.string().optional(),
  dma: z.string().optional(),
  rotationCooldown: z.number().int().min(60).max(3600).optional(),
});

// Helper: compose address from parts for DB storage
function composeAddress(host: string, port: number, username?: string, password?: string): string {
  if (username && password) {
    return `${username}:${password}@${host}:${port}`;
  }
  return `${host}:${port}`;
}

// Helper: decompose address back to parts for API response
function decomposeAddress(address: string) {
  let host = '', port = 0, username = '', password = '';
  if (address.includes('@')) {
    const atIdx = address.lastIndexOf('@');
    const auth = address.substring(0, atIdx);
    const hostPort = address.substring(atIdx + 1);
    const colonIdx = auth.indexOf(':');
    username = colonIdx >= 0 ? auth.substring(0, colonIdx) : auth;
    password = colonIdx >= 0 ? auth.substring(colonIdx + 1) : '';
    const hpParts = hostPort.split(':');
    host = hpParts[0];
    port = parseInt(hpParts[1] || '0', 10);
  } else {
    const parts = address.split(':');
    host = parts[0];
    port = parseInt(parts[1] || '0', 10);
  }
  return { host, port, username, password };
}

// Helper: enrich proxy record with decomposed fields for frontend
function enrichProxy(proxy: any) {
  const decomposed = proxy.host && proxy.port
    ? { host: proxy.host, port: proxy.port, username: proxy.username ?? '', password: proxy.password ?? '' }
    : decomposeAddress(proxy.address);
  return {
    ...proxy,
    name: proxy.label || '',
    host: decomposed.host,
    port: decomposed.port,
    username: decomposed.username,
    password: decomposed.password,
    isActive: proxy.status === 'ACTIVE',
    lastCheckedAt: proxy.lastIPAt ?? null,
    lastIP: proxy.lastIP ?? null,
    address: undefined,
  };
}

// ── GET / — list all proxies for current user ───────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const proxies = await prisma.proxy.findMany({
      where: { userId: req.user!.id },
      include: { _count: { select: { accounts: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ proxies: proxies.map(enrichProxy) });
  } catch (err) {
    console.error('[Proxies] List error:', err);
    res.status(500).json({ error: 'Ошибка при загрузке прокси' });
  }
});

// ── POST / — create proxy ───────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = createProxySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { name, host, port, username, password, rotationLink, type, country, carrier, dma, rotationCooldown } = parsed.data;
    const address = composeAddress(host, port, username, password);
    const isRotating = !!rotationLink;

    const proxy = await prisma.proxy.create({
      data: {
        host,
        port,
        username: username || null,
        password: password || null,
        address,
        label: name || null,
        type: type ?? (isRotating ? 'LTE_MOBILE' : 'STATIC_RESIDENTIAL'),
        isRotating,
        rotationLink: rotationLink || null,
        rotationCooldown: rotationCooldown ?? 900,
        country: country ?? 'US',
        carrier: carrier || null,
        dma: dma || null,
        userId: req.user!.id,
      },
    });

    res.status(201).json({ proxy: enrichProxy(proxy) });
  } catch (err) {
    console.error('[Proxies] Create error:', err);
    res.status(500).json({ error: 'Ошибка при создании прокси' });
  }
});

// ── PATCH /:id ──────────────────────────────────────────────
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.proxy.findFirst({
      where: { id: req.params.id as string, userId: req.user!.id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Прокси не найден' });
      return;
    }

    // Build update data from frontend fields
    const updateData: Record<string, unknown> = {};

    // Handle isActive toggle
    if (typeof req.body.isActive === 'boolean') {
      updateData.status = req.body.isActive ? 'ACTIVE' : 'DEAD';
    }

    // Handle full edit (host/port/username/password)
    if (req.body.host && req.body.port) {
      updateData.host = req.body.host;
      updateData.port = req.body.port;
      updateData.username = req.body.username ?? existing.username;
      updateData.password = req.body.password ?? existing.password;
      updateData.address = composeAddress(
        req.body.host, req.body.port,
        req.body.username, req.body.password,
      );
    }
    if (req.body.name !== undefined) updateData.label = req.body.name;
    if (req.body.rotationLink !== undefined) {
      updateData.rotationLink = req.body.rotationLink || null;
      updateData.isRotating = !!req.body.rotationLink;
    }
    if (req.body.type !== undefined) updateData.type = req.body.type;
    if (req.body.country !== undefined) updateData.country = req.body.country;
    if (req.body.carrier !== undefined) updateData.carrier = req.body.carrier;
    if (req.body.rotationCooldown !== undefined) updateData.rotationCooldown = req.body.rotationCooldown;

    const proxy = await prisma.proxy.update({
      where: { id: req.params.id as string },
      data: updateData,
    });
    res.json({ proxy: enrichProxy(proxy) });
  } catch (err) {
    console.error('[Proxies] Update error:', err);
    res.status(500).json({ error: 'Ошибка при обновлении прокси' });
  }
});

// ── POST /bulk-delete — bulk delete proxies ────────────────────
router.post('/bulk-delete', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'Выберите хотя бы один прокси' });
      return;
    }

    const result = await prisma.proxy.deleteMany({
      where: {
        id: { in: ids },
        userId: req.user!.id,
      },
    });

    res.json({ deleted: result.count });
  } catch (err) {
    console.error('[Proxies] Bulk delete error:', err);
    res.status(500).json({ error: 'Ошибка при массовом удалении' });
  }
});

// ── DELETE /:id ─────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.proxy.findFirst({
      where: { id: req.params.id as string, userId: req.user!.id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Прокси не найден' });
      return;
    }

    await prisma.proxy.delete({ where: { id: req.params.id as string } });
    res.json({ success: true });
  } catch (err) {
    console.error('[Proxies] Delete error:', err);
    res.status(500).json({ error: 'Ошибка при удалении прокси' });
  }
});

// ── POST /:id/test — test proxy connectivity ────────────────
router.post('/:id/test', async (req: Request, res: Response) => {
  try {
    const proxy = await prisma.proxy.findFirst({
      where: { id: req.params.id as string, userId: req.user!.id },
    });
    if (!proxy) {
      res.status(404).json({ error: 'Прокси не найден' });
      return;
    }

    // Real connectivity test via HTTP request through the proxy
    let testResult = { reachable: false, latencyMs: 0, externalIp: '' };
    try {
      const proxyUrl = proxy.username && proxy.password
        ? `http://${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@${proxy.host}:${proxy.port}`
        : `http://${proxy.host}:${proxy.port}`;

      const start = Date.now();
      const { ProxyAgent } = await import('undici');
      const agent = new ProxyAgent(proxyUrl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const resp = await fetch('https://api.ipify.org?format=json', {
        signal: controller.signal,
        // @ts-ignore — undici dispatcher
        dispatcher: agent,
      });
      clearTimeout(timeout);

      if (resp.ok) {
        const data = await resp.json() as { ip?: string };
        testResult = {
          reachable: true,
          latencyMs: Date.now() - start,
          externalIp: data.ip ?? '',
        };
      }
    } catch {
      testResult = { reachable: false, latencyMs: 0, externalIp: '' };
    }

    // Update DB with test results
    if (testResult.reachable) {
      await prisma.proxy.update({
        where: { id: proxy.id },
        data: {
          status: 'ACTIVE',
          lastIP: testResult.externalIp || null,
          lastIPAt: new Date(),
        },
      });
    }

    res.json({
      success: testResult.reachable,
      status: testResult.reachable ? 'ACTIVE' : 'DEAD',
      latencyMs: testResult.latencyMs,
      externalIp: testResult.externalIp || null,
    });
  } catch (err) {
    console.error('[Proxies] Test error:', err);
    res.status(500).json({ error: 'Ошибка при проверке прокси' });
  }
});

// ── POST /import — bulk import and proxys.io sync ─────────────
router.post('/import', async (req: Request, res: Response) => {
  try {
    const { mode, data, apiKey, type = 'STATIC_RESIDENTIAL' } = req.body;
    let added = 0;

    if (mode === 'manual') {
      if (!data || typeof data !== 'string') {
        res.status(400).json({ error: 'Data is required for manual import' });
        return;
      }
      const lines = data.split('\n').map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        // expect ip:port:user:pass or host:port
        const parts = line.split(':');
        if (parts.length < 2) continue;
        const host = parts[0];
        const port = parseInt(parts[1], 10);
        if (isNaN(port)) continue;
        const username = parts.length >= 3 ? parts[2] : null;
        const password = parts.length >= 4 ? parts[3] : null;

        await prisma.proxy.create({
          data: {
            userId: req.user!.id,
            host,
            port,
            username,
            password,
            address: composeAddress(host, port, username || undefined, password || undefined),
            type,
          },
        });
        added++;
      }
    } else if (mode === 'proxys_io') {
      if (!apiKey) {
        res.status(400).json({ error: 'API key is required for proxys.io' });
        return;
      }
      
      // Fetch from proxys.io API
      // Since fetch is native in Node 18+:
      const resp = await fetch(`https://proxys.io/ru/api/v2/proxies?key=${apiKey}`);
      if (!resp.ok) {
         res.status(400).json({ error: 'Failed to fetch from Proxys.io' });
         return;
      }
      const json = await resp.json() as any;
      if (json.status !== 'success' || !json.data) {
         res.status(400).json({ error: 'Invalid response from Proxys.io' });
         return;
      }
      
      const proxies = Array.isArray(json.data) ? json.data : Object.values(json.data);
      for (const p of proxies as any[]) {
         const host = p.ip;
         const port = parseInt(p.http_port || p.port, 10);
         const username = p.user;
         const password = p.pass;
         
         // Assuming Proxys.io gives mostly IPv4 static or mobile
         const isMobile = p.type?.toLowerCase().includes('mobile');
         const proxyType = isMobile ? 'LTE_MOBILE' : 'STATIC_RESIDENTIAL';

         await prisma.proxy.create({
           data: {
             userId: req.user!.id,
             host,
             port,
             username,
             password,
             address: composeAddress(host, port, username, password),
             type: proxyType,
             label: `Proxys.io #${p.id || host}`,
           }
         });
         added++;
      }
    } else {
      res.status(400).json({ error: 'Invalid mode' });
      return;
    }

    res.json({ added });
  } catch (err) {
    console.error('[Proxies] Import error:', err);
    res.status(500).json({ error: 'Import failed' });
  }
});

// POST /import-from-provider — bulk import proxies from a provider's API
const providerImportSchema = z.object({
  provider: z.enum(['PROXYS_IO', 'MOBILEPROXIES_ORG', 'PROXYGROW', 'ILLUSORY']),
  apiKey: z.string().min(1),
});

router.post('/import/provider', async (req: Request, res: Response) => {
  try {
    const parsed = providerImportSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0].message }); return; }

    const { provider, apiKey } = parsed.data;

    // Fetch proxy list from provider
    let proxies: Array<{
      externalId: string;
      host: string;
      port: number;
      username?: string;
      password?: string;
      carrier?: string;
      country?: string;
    }> = [];

    if (provider === 'PROXYS_IO') {
      // proxys.io / mobileproxy.space
      const r = await fetch('https://mobileproxy.space/api/v1/proxies', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (!r.ok) { res.status(502).json({ error: `Provider API HTTP ${r.status}` }); return; }
      const data = (await r.json()) as { data?: Array<any> };
      proxies = (data.data ?? []).map(p => ({
        externalId: String(p.proxy_key ?? p.id),
        host: p.hostname ?? p.host,
        port: Number(p.http_port ?? p.port),
        username: p.username,
        password: p.password,
        carrier: p.carrier,
        country: p.country,
      }));
    } else if (provider === 'MOBILEPROXIES_ORG') {
      const r = await fetch('https://buy.mobileproxies.org/api/v1/proxies', {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (!r.ok) { res.status(502).json({ error: `Provider API HTTP ${r.status}` }); return; }
      const data = (await r.json()) as Array<any>;
      proxies = data.map(p => ({
        externalId: String(p.slot_id),
        host: p.hostname,
        port: Number(p.http_port),
        username: p.username,
        password: p.password,
        carrier: p.carrier,
        country: p.country,
      }));
    } else {
      res.status(400).json({ error: `Provider ${provider} bulk-import not yet implemented` });
      return;
    }

    // Encrypt apiKey for storage
    let encApi = '';
    let iv: Buffer | null = null;
    let apiAuthTag: Buffer | null = null;

    if (process.env.MASTER_KEY) {
        const masterKey = Buffer.from(process.env.MASTER_KEY, 'base64');
        iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
        const encBuf = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
        encApi = encBuf.toString('base64');
        apiAuthTag = cipher.getAuthTag();
    }

    const created: string[] = [];
    for (const p of proxies) {
      const proxy = await prisma.proxy.create({
        data: {
          userId: req.user!.id,
          provider,
          providerExternalId: p.externalId,
          providerApiKey: encApi || null,
          providerApiKeyIv: iv ? new Uint8Array(iv) : null,
          providerApiKeyTag: apiAuthTag ? new Uint8Array(apiAuthTag) : null,
          host: p.host,
          port: p.port,
          username: p.username ?? null,
          password: p.password ?? null,
          address: `${p.host}:${p.port}` + (p.username ? `:${p.username}:${p.password}` : ''),
          type: 'LTE_MOBILE',
          isRotating: true,
          carrier: p.carrier ?? null,
          country: p.country ?? 'US',
          rotationMode: 'PER_SESSION',
        },
      });
      created.push(proxy.id);
    }

    res.status(201).json({ created: created.length, ids: created });
  } catch (err) {
    console.error('[Proxies] Provider import error:', err);
    res.status(500).json({ error: 'Ошибка при импорте прокси от провайдера' });
  }
});

// POST /:id/rotate — manual rotation trigger
router.post('/:id/rotate', async (req: Request, res: Response) => {
  try {
    const proxy = await prisma.proxy.findFirst({
      where: { id: req.params.id as string, userId: req.user!.id },
    });
    if (!proxy) { res.status(404).json({ error: 'Прокси не найден' }); return; }

    // Cooldown enforcement
    if (proxy.lastRotatedAt) {
      const elapsed = Date.now() - proxy.lastRotatedAt.getTime();
      if (elapsed < (proxy.rotationCooldown ?? 900) * 1000) {
        const waitSec = Math.ceil(((proxy.rotationCooldown ?? 900) * 1000 - elapsed) / 1000);
        res.status(429).json({ error: `Подождите ${waitSec}s до следующей ротации` });
        return;
      }
    }

    // Decrypt apiKey if needed
    let apiKey: string | null = null;
    if (proxy.providerApiKey && proxy.providerApiKeyIv && proxy.providerApiKeyTag && process.env.MASTER_KEY) {
      try {
        const masterKey = Buffer.from(process.env.MASTER_KEY, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, proxy.providerApiKeyIv);
        decipher.setAuthTag(proxy.providerApiKeyTag);
        const enc = Buffer.from(proxy.providerApiKey, 'base64');
        apiKey = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
      } catch (e) {
        console.error('Failed to decrypt API key', e);
      }
    }

    const { rotateProxy } = await import('../lib/proxy-rotation-bridge.js');
    const result = await rotateProxy({
      provider: proxy.provider as any,
      externalId: proxy.providerExternalId,
      apiKey,
      rotationLink: proxy.rotationLink,
    });

    if (!result.ok) {
      res.status(502).json({ error: result.error ?? 'Rotation failed' });
      return;
    }

    await prisma.proxy.update({
      where: { id: proxy.id },
      data: { lastRotatedAt: new Date() },
    });

    res.json({ ok: true, newIp: result.newIp });
  } catch (err) {
    console.error('[Proxies] Rotate error:', err);
    res.status(500).json({ error: 'Ошибка при ротации' });
  }
});

export default router;
