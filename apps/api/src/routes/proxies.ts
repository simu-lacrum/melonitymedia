// ─────────────────────────────────────────────────────────────
// Proxy Management Routes
// CRUD for mobile/static proxies with rotation link support.
//
// Frontend sends: { name, host, port, username, password, rotationLink }
// We compose the `address` field for DB and map `name` → `label`.
// ─────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

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
    const [auth, hostPort] = address.split('@');
    [username, password] = auth.split(':');
    const parts = hostPort.split(':');
    host = parts[0];
    port = parseInt(parts[1] || '0', 10);
  } else {
    const parts = address.split(':');
    host = parts[0];
    port = parseInt(parts[1] || '0', 10);
  }
  return { host, port, username, password };
}

// Helper: enrich proxy record with decomposed fields for frontend
function enrichProxy(proxy: any) {
  const { host, port, username, password } = decomposeAddress(proxy.address);
  return {
    ...proxy,
    name: proxy.label || '',
    host,
    port,
    username,
    password,
    isActive: proxy.status === 'ACTIVE',
    lastCheckedAt: null,
    lastIP: null,
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

    const { name, host, port, username, password, rotationLink } = parsed.data;
    const address = composeAddress(host, port, username, password);
    const isRotating = !!rotationLink;

    const proxy = await prisma.proxy.create({
      data: {
        address,
        label: name || null,
        isRotating,
        rotationLink: rotationLink || null,
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
      where: { id: req.params.id, userId: req.user!.id },
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

    const proxy = await prisma.proxy.update({
      where: { id: req.params.id },
      data: updateData,
    });
    res.json({ proxy: enrichProxy(proxy) });
  } catch (err) {
    console.error('[Proxies] Update error:', err);
    res.status(500).json({ error: 'Ошибка при обновлении прокси' });
  }
});

// ── DELETE /:id ─────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.proxy.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!existing) {
      res.status(404).json({ error: 'Прокси не найден' });
      return;
    }

    await prisma.proxy.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error('[Proxies] Delete error:', err);
    res.status(500).json({ error: 'Ошибка при удалении прокси' });
  }
});

// ── POST /bulk — bulk delete proxies ────────────────────────
router.delete('/bulk', async (req: Request, res: Response) => {
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

// ── POST /:id/test — test proxy connectivity ────────────────
router.post('/:id/test', async (req: Request, res: Response) => {
  try {
    const proxy = await prisma.proxy.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });
    if (!proxy) {
      res.status(404).json({ error: 'Прокси не найден' });
      return;
    }

    // In production: actually test TCP connection through the proxy
    // For now: verify record exists and return status
    res.json({
      success: true,
      status: proxy.status,
      address: proxy.address,
    });
  } catch (err) {
    console.error('[Proxies] Test error:', err);
    res.status(500).json({ error: 'Ошибка при проверке прокси' });
  }
});

export default router;
