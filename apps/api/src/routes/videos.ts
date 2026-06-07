// ─────────────────────────────────────────────────────────────
// Video Routes — CRUD + reorder for content queue
// ─────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import fs from 'fs';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// ── GET / ───────────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const videos = await prisma.video.findMany({
      where: { userId: req.user!.id, isUploaded: false },
      orderBy: { order: 'asc' },
    });
    res.json({ videos });
  } catch (err) {
    console.error('[Videos] List error:', err);
    res.status(500).json({ error: 'Ошибка при загрузке видео' });
  }
});

// ── PATCH /reorder — update drag-n-drop order ───────────────
router.patch('/reorder', async (req: Request, res: Response) => {
  try {
    const { items } = req.body as { items: { id: string; order: number }[] };

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'items обязателен' });
      return;
    }

    // Verify all videos belong to current user
    const videoIds = items.map(i => i.id);
    const ownedCount = await prisma.video.count({
      where: { id: { in: videoIds }, userId: req.user!.id },
    });
    if (ownedCount !== videoIds.length) {
      res.status(403).json({ error: 'Нет доступа к одному или нескольким видео' });
      return;
    }

    // Transaction: update all orders atomically
    await prisma.$transaction(
      items.map(({ id, order }) =>
        prisma.video.update({
          where: { id },
          data: { order },
        }),
      ),
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[Videos] Reorder error:', err);
    res.status(500).json({ error: 'Ошибка при сортировке' });
  }
});

// ── DELETE /:id — remove video (also deletes from disk) ─────
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const video = await prisma.video.findFirst({
      where: { id: req.params.id as string, userId: req.user!.id },
    });

    if (!video) {
      res.status(404).json({ error: 'Видео не найдено' });
      return;
    }

    // Delete file from disk if it exists
    if (video.filepath && fs.existsSync(video.filepath)) {
      await fs.promises.unlink(video.filepath).catch(err =>
        console.error('[Videos] File delete warning:', err.message)
      );
    }

    await prisma.video.delete({ where: { id: req.params.id as string } });
    res.json({ success: true });
  } catch (err) {
    console.error('[Videos] Delete error:', err);
    res.status(500).json({ error: 'Ошибка при удалении видео' });
  }
});

export default router;
