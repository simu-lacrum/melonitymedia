// ─────────────────────────────────────────────────────────────
// Social Accounts Routes
// CRUD + import + bulk operations for TikTok/YouTube accounts.
// ALL queries are userId-scoped — strict tenant isolation.
// ─────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// ── GET / — list all accounts for current user ──────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const accounts = await prisma.socialAccount.findMany({
      where: { userId: req.user!.id },
      include: { proxy: { select: { id: true, address: true, label: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ accounts });
  } catch (err) {
    console.error('[Accounts] List error:', err);
    res.status(500).json({ error: 'Ошибка при загрузке аккаунтов' });
  }
});

// ── POST /import — bulk import from log:pass format ─────────
const importSchema = z.object({
  platform: z.enum(['TIKTOK', 'YOUTUBE']),
  // Each line: "username:password" or "login:password"
  data: z.string().min(1, 'Данные для импорта обязательны'),
});

router.post('/import', async (req: Request, res: Response) => {
  try {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { platform, data } = parsed.data;
    const lines = data.split('\n').map(l => l.trim()).filter(Boolean);
    const accounts = [];

    for (const line of lines) {
      const [username, password] = line.split(':');
      if (username && password) {
        accounts.push({
          userId: req.user!.id,
          platform: platform as 'TIKTOK' | 'YOUTUBE',
          username: username.trim(),
          password: password.trim(),
        });
      }
    }

    if (accounts.length === 0) {
      res.status(400).json({ error: 'Не найдено валидных аккаунтов' });
      return;
    }

    const result = await prisma.socialAccount.createMany({ data: accounts });

    res.status(201).json({ imported: result.count });
  } catch (err) {
    console.error('[Accounts] Import error:', err);
    res.status(500).json({ error: 'Ошибка при импорте аккаунтов' });
  }
});

// ── PATCH /:id — update single account ──────────────────────
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    // Verify ownership before update
    const existing = await prisma.socialAccount.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Аккаунт не найден' });
      return;
    }

    const account = await prisma.socialAccount.update({
      where: { id: req.params.id },
      data: req.body,
    });

    res.json({ account });
  } catch (err) {
    console.error('[Accounts] Update error:', err);
    res.status(500).json({ error: 'Ошибка при обновлении аккаунта' });
  }
});

// ── DELETE /:id ─────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.socialAccount.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Аккаунт не найден' });
      return;
    }

    await prisma.socialAccount.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error('[Accounts] Delete error:', err);
    res.status(500).json({ error: 'Ошибка при удалении аккаунта' });
  }
});

// ── POST /bulk-update — mass assign proxy, avatar, etc. ─────
const bulkUpdateSchema = z.object({
  accountIds: z.array(z.string()).min(1),
  update: z.object({
    proxyId: z.string().optional(),
    avatarUrl: z.string().optional(),
    bannerUrl: z.string().optional(),
    bio: z.string().optional(),
    status: z.enum(['ALIVE', 'AUTH_NEEDED', 'BANNED']).optional(),
  }),
});

router.post('/bulk-update', async (req: Request, res: Response) => {
  try {
    const parsed = bulkUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { accountIds, update } = parsed.data;

    // Only update accounts owned by this user
    const result = await prisma.socialAccount.updateMany({
      where: {
        id: { in: accountIds },
        userId: req.user!.id,
      },
      data: update,
    });

    res.json({ updated: result.count });
  } catch (err) {
    console.error('[Accounts] Bulk update error:', err);
    res.status(500).json({ error: 'Ошибка при массовом обновлении' });
  }
});

export default router;
