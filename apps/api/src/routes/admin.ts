// ─────────────────────────────────────────────────────────────
// Admin Routes — Operator Panel
//
// All endpoints require ADMIN role.
// Provides: server health, user management, IP firewall.
// Admin can see user stats but NEVER their account passwords.
// ─────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import os from 'os';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { authMiddleware } from '../middleware/auth.js';
import { adminMiddleware } from '../middleware/admin.js';

const router = Router();
router.use(authMiddleware, adminMiddleware);

const BLOCKED_IPS_KEY = 'firewall:blocked_ips';

// ── GET /runtime — server health dashboard ──────────────────
router.get('/runtime', async (_req: Request, res: Response) => {
  try {
    // Check PostgreSQL
    let dbStatus = 'ok';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'error';
    }

    // Check Redis
    let redisStatus = 'ok';
    try {
      await redis.ping();
    } catch {
      redisStatus = 'error';
    }

    // System metrics
    const cpuUsage = os.loadavg();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    // Active tasks count
    const activeTasks = await prisma.task.count({
      where: { status: { in: ['PENDING', 'RUNNING'] } },
    });

    res.json({
      db: dbStatus,
      redis: redisStatus,
      activeTasks,
      system: {
        cpuLoad: cpuUsage,
        memoryUsed: Math.round(usedMem / 1024 / 1024), // MB
        memoryTotal: Math.round(totalMem / 1024 / 1024),
        memoryPercent: Math.round((usedMem / totalMem) * 100),
        uptime: Math.round(os.uptime()),
      },
    });
  } catch (err) {
    console.error('[Admin] Runtime error:', err);
    res.status(500).json({ error: 'Ошибка при получении статуса' });
  }
});

// ── GET /users — list all webmasters ────────────────────────
router.get('/users', async (_req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        maxThreads: true,
        isBanned: true,
        bannedAt: true,
        createdAt: true,
        _count: { select: { accounts: true, tasks: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ users });
  } catch (err) {
    console.error('[Admin] Users list error:', err);
    res.status(500).json({ error: 'Ошибка при загрузке пользователей' });
  }
});

// ── PATCH /users/:id — update user settings ─────────────────
router.patch('/users/:id', async (req: Request, res: Response) => {
  try {
    const { maxThreads, role } = req.body;
    const user = await prisma.user.update({
      where: { id: req.params.id as string },
      data: {
        ...(maxThreads !== undefined && { maxThreads }),
        ...(role !== undefined && { role }),
      },
      select: { id: true, email: true, name: true, role: true, maxThreads: true },
    });
    res.json({ user });
  } catch (err) {
    console.error('[Admin] User update error:', err);
    res.status(500).json({ error: 'Ошибка при обновлении пользователя' });
  }
});

// ── POST /users/:id/ban — soft-ban (cancel tasks + kick) ────
router.post('/users/:id/ban', async (req: Request, res: Response) => {
  try {
    // Ban user
    await prisma.user.update({
      where: { id: req.params.id as string },
      data: { isBanned: true, bannedAt: new Date() },
    });

    // Cancel all pending/running tasks for this user
    await prisma.task.updateMany({
      where: {
        userId: req.params.id as string,
        status: { in: ['PENDING', 'RUNNING'] },
      },
      data: { status: 'CANCELLED' },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'user.ban',
        details: { targetUserId: req.params.id as string },
        ip: req.ip,
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[Admin] Ban error:', err);
    res.status(500).json({ error: 'Ошибка при блокировке' });
  }
});

// ── GET /firewall — list blocked IPs ────────────────────────
router.get('/firewall', async (_req: Request, res: Response) => {
  try {
    const ips = await redis.smembers(BLOCKED_IPS_KEY);
    res.json({ ips });
  } catch (err) {
    console.error('[Admin] Firewall list error:', err);
    res.status(500).json({ error: 'Ошибка при загрузке IP' });
  }
});

// ── POST /firewall — add IP to blacklist ──────────────────
router.post('/firewall', async (req: Request, res: Response) => {
  try {
    const { ip } = req.body;
    if (!ip) {
      res.status(400).json({ error: 'IP обязателен' });
      return;
    }

    await redis.sadd(BLOCKED_IPS_KEY, ip);

    await prisma.auditLog.create({
      data: {
        userId: req.user!.id,
        action: 'firewall.block',
        details: { ip },
        ip: req.ip,
      },
    });

    res.status(201).json({ ip });
  } catch (err) {
    console.error('[Admin] Firewall block error:', err);
    res.status(500).json({ error: 'Ошибка при блокировке IP' });
  }
});

// ── DELETE /firewall — remove IP from blacklist ─────────
router.delete('/firewall', async (req: Request, res: Response) => {
  try {
    const { ip } = req.body;
    await redis.srem(BLOCKED_IPS_KEY, ip);
    res.json({ success: true });
  } catch (err) {
    console.error('[Admin] Firewall unblock error:', err);
    res.status(500).json({ error: 'Ошибка при разблокировке IP' });
  }
});

export default router;
