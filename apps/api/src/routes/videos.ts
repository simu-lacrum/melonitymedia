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
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!video) {
      res.status(404).json({ error: 'Видео не найдено' });
      return;
    }

    // Delete file from disk if it exists
    if (video.filepath && fs.existsSync(video.filepath)) {
      fs.unlinkSync(video.filepath);
    }

    await prisma.video.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error('[Videos] Delete error:', err);
    res.status(500).json({ error: 'Ошибка при удалении видео' });
  }
});

export default router;
