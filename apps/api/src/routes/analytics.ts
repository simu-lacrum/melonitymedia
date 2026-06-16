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

// ── GET /views-chart — real time-series from DailySnapshot ──
router.get('/views-chart', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const rawDays = parseInt(req.query.days as string);
    const days = Number.isNaN(rawDays) ? 7 : Math.max(1, Math.min(rawDays, 365));

    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    startDate.setDate(startDate.getDate() - days + 1);

    // Fetch real snapshots aggregated by day across all accounts
    const snapshots = await prisma.dailySnapshot.groupBy({
      by: ['date'],
      where: {
        userId,
        date: { gte: startDate },
      },
      _sum: {
        views: true,
        followers: true,
        likes: true,
      },
      orderBy: { date: 'asc' },
    });

    // Build a complete date series (fill gaps with zeros)
    const snapshotMap = new Map<string, { views: number; followers: number; likes: number }>();
    for (const s of snapshots) {
      const key = new Date(s.date).toISOString().slice(0, 10);
      snapshotMap.set(key, {
        views: s._sum.views ?? 0,
        followers: s._sum.followers ?? 0,
        likes: s._sum.likes ?? 0,
      });
    }

    const data: { date: string; views: number; followers: number; likes: number }[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(startDate.getTime() + i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      const snap = snapshotMap.get(key);
      data.push({
        date: key,
        views: snap?.views ?? 0,
        followers: snap?.followers ?? 0,
        likes: snap?.likes ?? 0,
      });
    }

    res.json({ data, days });
  } catch (err) {
    console.error('[Analytics] Views chart error:', err);
    res.status(500).json({ error: 'Ошибка при загрузке графика' });
  }
});

// ── GET /active-tasks — currently running BullMQ jobs ───────
router.get('/active-tasks', async (req: Request, res: Response) => {
  try {
    // Only show tasks that are actually active:
    // - RUNNING: currently being processed by worker
    // - PENDING: queued recently (last 2 hours) — older PENDING = stuck/stale
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const tasks = await prisma.task.findMany({
      where: {
        userId: req.user!.id,
        OR: [
          { status: 'RUNNING' },
          { status: 'PENDING', createdAt: { gte: twoHoursAgo } },
        ],
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
