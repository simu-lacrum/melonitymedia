// ─────────────────────────────────────────────────────────────
// Proxy Management Routes
// CRUD for mobile/static proxies with rotation link support.
// ─────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

const proxySchema = z.object({
  address: z.string().min(1, 'Адрес прокси обязателен'), // ip:port:login:pass
  isRotating: z.boolean().default(false),
  rotationLink: z.string().url().optional().nullable(),
  label: z.string().optional(),
});

// ── GET / — list all proxies for current user ───────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const proxies = await prisma.proxy.findMany({
      where: { userId: req.user!.id },
      include: { _count: { select: { accounts: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ proxies });
  } catch (err) {
    console.error('[Proxies] List error:', err);
    res.status(500).json({ error: 'Ошибка при загрузке прокси' });
  }
});

// ── POST / — create proxy ───────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = proxySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const proxy = await prisma.proxy.create({
      data: { ...parsed.data, userId: req.user!.id },
    });

    res.status(201).json({ proxy });
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

    const proxy = await prisma.proxy.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json({ proxy });
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

// ── POST /check — verify proxy is alive ─────────────────────
router.post('/check', async (req: Request, res: Response) => {
  try {
    const { proxyId } = req.body;
    const proxy = await prisma.proxy.findFirst({
      where: { id: proxyId, userId: req.user!.id },
    });
    if (!proxy) {
      res.status(404).json({ error: 'Прокси не найден' });
      return;
    }

    // Simple check: try to connect through the proxy
    // In production, this would actually test the proxy connection
    // For now, we just verify it exists and return its status
    res.json({ status: proxy.status, address: proxy.address });
  } catch (err) {
    console.error('[Proxies] Check error:', err);
    res.status(500).json({ error: 'Ошибка при проверке прокси' });
  }
});

export default router;
