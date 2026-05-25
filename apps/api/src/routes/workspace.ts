// ─────────────────────────────────────────────────────────────
// Workspace Routes — the heart of the platform
//
// Handles: video upload, task launch, dynamic queue addition,
// and preset management. This is where the webmaster sets up
// and triggers automation jobs.
// ─────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { addJob } from '../lib/bullmq.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// ── Multer Setup ────────────────────────────────────────────
// Videos saved to UPLOAD_DIR with random filename to avoid collisions
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // Random hash + original extension — prevents filename collisions
    const hash = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `${hash}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max per video
  fileFilter: (_req, file, cb) => {
    const allowed = ['.mp4', '.webm', '.mov', '.avi'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Допустимые форматы: .mp4, .webm, .mov, .avi'));
    }
  },
});

// ── POST /upload — upload video file ────────────────────────
router.post('/upload', upload.single('video'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Файл не загружен' });
      return;
    }

    // Get current max order for this user's videos
    const maxOrder = await prisma.video.aggregate({
      where: { userId: req.user!.id },
      _max: { order: true },
    });

    const video = await prisma.video.create({
      data: {
        userId: req.user!.id,
        filename: req.file.filename,
        originalName: req.file.originalname,
        filepath: req.file.path,
        mimeType: req.file.mimetype,
        size: req.file.size,
        order: (maxOrder._max.order ?? -1) + 1,
      },
    });

    res.status(201).json({ video });
  } catch (err) {
    console.error('[Workspace] Upload error:', err);
    res.status(500).json({ error: 'Ошибка при загрузке видео' });
  }
});

// ── POST /launch — start automation task ────────────────────
const launchSchema = z.object({
  type: z.enum(['UPLOAD', 'WARMUP', 'COOKIES', 'EDIT_PROFILE']),
  accountIds: z.array(z.string()).min(1, 'Выберите хотя бы один аккаунт'),
  config: z.record(z.unknown()), // mode-specific config
  threads: z.number().int().min(1).max(20).default(3),
});

router.post('/launch', async (req: Request, res: Response) => {
  try {
    const parsed = launchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { type, accountIds, config, threads } = parsed.data;

    // Verify user doesn't exceed their thread limit
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { maxThreads: true },
    });

    if (threads > (user?.maxThreads ?? 3)) {
      res.status(400).json({
        error: `Максимум ${user?.maxThreads} потоков. Обратитесь к администратору.`,
      });
      return;
    }

    // Create task record in DB
    const task = await prisma.task.create({
      data: {
        userId: req.user!.id,
        type,
        config: { ...config, accountIds, threads },
      },
    });

    // Map task type to BullMQ queue name
    const queueMap: Record<string, string> = {
      UPLOAD: 'upload',
      WARMUP: 'warmup',
      COOKIES: 'cookies',
      EDIT_PROFILE: 'edit-profile',
    };

    // Dispatch to BullMQ
    const jobId = await addJob(
      queueMap[type] as any,
      {
        taskId: task.id,
        userId: req.user!.id,
        accountIds,
        config,
        threads,
      },
    );

    // Link BullMQ job ID back to task record
    await prisma.task.update({
      where: { id: task.id },
      data: { bullmqJobId: jobId, status: 'PENDING' },
    });

    res.status(201).json({ task: { ...task, bullmqJobId: jobId } });
  } catch (err) {
    console.error('[Workspace] Launch error:', err);
    res.status(500).json({ error: 'Ошибка при запуске задачи' });
  }
});

// ── POST /queue/add — dynamically add videos to running task ─
router.post('/queue/add', async (req: Request, res: Response) => {
  try {
    const { taskId, videoIds } = req.body;

    // Verify task belongs to user
    const task = await prisma.task.findFirst({
      where: { id: taskId, userId: req.user!.id },
    });

    if (!task) {
      res.status(404).json({ error: 'Задача не найдена' });
      return;
    }

    // Add new videos to the task's config
    const currentConfig = task.config as Record<string, unknown>;
    const currentVideos = (currentConfig.videoIds as string[]) || [];
    const updatedVideos = [...currentVideos, ...videoIds];

    await prisma.task.update({
      where: { id: taskId },
      data: { config: { ...currentConfig, videoIds: updatedVideos } },
    });

    res.json({ added: true, totalVideos: updatedVideos.length });
  } catch (err) {
    console.error('[Workspace] Queue add error:', err);
    res.status(500).json({ error: 'Ошибка при добавлении в очередь' });
  }
});

// ── GET /presets — list user presets ─────────────────────────
router.get('/presets', async (req: Request, res: Response) => {
  try {
    const presets = await prisma.preset.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ presets });
  } catch (err) {
    console.error('[Workspace] Presets list error:', err);
    res.status(500).json({ error: 'Ошибка при загрузке пресетов' });
  }
});

// ── POST /presets — save new preset ─────────────────────────
const presetSchema = z.object({
  name: z.string().min(1, 'Название пресета обязательно'),
  config: z.record(z.unknown()),
});

router.post('/presets', async (req: Request, res: Response) => {
  try {
    const parsed = presetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const preset = await prisma.preset.create({
      data: { ...parsed.data, userId: req.user!.id },
    });

    res.status(201).json({ preset });
  } catch (err) {
    console.error('[Workspace] Preset create error:', err);
    res.status(500).json({ error: 'Ошибка при сохранении пресета' });
  }
});

// ── GET /cookies/export — download cookies as ZIP ───────────
router.get('/cookies/export', async (req: Request, res: Response) => {
  try {
    // Fetch all accounts with cookies for this user
    const accounts = await prisma.socialAccount.findMany({
      where: {
        userId: req.user!.id,
        cookiesPath: { not: null },
      },
      select: {
        username: true,
        platform: true,
        cookiesPath: true,
      },
    });

    if (accounts.length === 0) {
      res.status(404).json({ error: 'Нет аккаунтов с cookies' });
      return;
    }

    // Build JSON manifest for cookie files
    const cookiesData = accounts.map(a => ({
      username: a.username,
      platform: a.platform,
      cookiesPath: a.cookiesPath,
    }));

    const jsonPayload = JSON.stringify(cookiesData, null, 2);
    const filename = `cookies_${Date.now()}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(jsonPayload);
  } catch (err) {
    console.error('[Workspace] Cookies export error:', err);
    res.status(500).json({ error: 'Ошибка при экспорте cookies' });
  }
});

export default router;
