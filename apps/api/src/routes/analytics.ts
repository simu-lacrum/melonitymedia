// ─────────────────────────────────────────────────────────────
// Analytics Routes — dashboard data aggregation
// ─────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// ── GET /summary — top-level metrics for dashboard cards ────
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    const [totalViews, aliveAccounts, totalFollowers, uploadedVideos] =
      await Promise.all([
        prisma.socialAccount.aggregate({
          where: { userId },
          _sum: { views: true },
        }),
        prisma.socialAccount.count({
          where: { userId, status: 'ALIVE' },
        }),
        prisma.socialAccount.aggregate({
          where: { userId },
          _sum: { followers: true },
        }),
        prisma.video.count({
          where: { userId, isUploaded: true },
        }),
      ]);

    res.json({
      totalViews: totalViews._sum.views ?? 0,
      aliveAccounts,
      totalFollowers: totalFollowers._sum.followers ?? 0,
      uploadedVideos,
    });
  } catch (err) {
    console.error('[Analytics] Summary error:', err);
    res.status(500).json({ error: 'Ошибка при загрузке аналитики' });
  }
});

// ── GET /views-chart — time-series data for Recharts ────────
router.get('/views-chart', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const rawDays = parseInt(req.query.days as string);
    const days = Number.isNaN(rawDays) ? 30 : Math.max(1, Math.min(rawDays, 365));

    // For now, return account-level data
    // In production, a separate ViewsHistory model would store daily snapshots
    const accounts = await prisma.socialAccount.findMany({
      where: { userId },
      select: { username: true, views: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ data: accounts, days });
  } catch (err) {
    console.error('[Analytics] Views chart error:', err);
    res.status(500).json({ error: 'Ошибка при загрузке графика' });
  }
});

// ── GET /active-tasks — currently running BullMQ jobs ───────
router.get('/active-tasks', async (req: Request, res: Response) => {
  try {
    const tasks = await prisma.task.findMany({
      where: {
        userId: req.user!.id,
        status: { in: ['PENDING', 'RUNNING'] },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    res.json({ tasks });
  } catch (err) {
    console.error('[Analytics] Active tasks error:', err);
    res.status(500).json({ error: 'Ошибка при загрузке задач' });
  }
});

export default router;
