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
import { dispatchAccountJob } from '../lib/job-dispatch.js';
import { authMiddleware } from '../middleware/auth.js';
import { authRateLimit } from '../middleware/rate-limit.js';

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

    // Extract description and hashtags from form body
    const description = typeof req.body.description === 'string' ? req.body.description.trim() || null : null;
    const rawHashtags = req.body.hashtags;
    const hashtags: string[] = Array.isArray(rawHashtags)
      ? rawHashtags.map((h: string) => String(h).replace(/^#/, '').trim()).filter(Boolean)
      : typeof rawHashtags === 'string'
        ? rawHashtags.split(',').map((h: string) => h.replace(/^#/, '').trim()).filter(Boolean)
        : [];

    const video = await prisma.video.create({
      data: {
        userId: req.user!.id,
        filename: req.file.filename,
        originalName: req.file.originalname,
        filepath: req.file.path,
        mimeType: req.file.mimetype,
        size: req.file.size,
        description,
        hashtags,
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
  type: z.enum(['UPLOAD', 'WARMUP', 'COOKIES', 'EDIT_PROFILE', 'LOGIN']),
  accountIds: z.array(z.string()),
  applyToAll: z.boolean().optional().default(false),
  config: z.any(),
  threads: z.number().int().min(1).max(50),
  delayMin: z.number().int().min(0),
  delayMax: z.number().int().min(0),
}).refine(data => data.delayMax >= data.delayMin, {
  message: 'delayMax должен быть >= delayMin',
  path: ['delayMax'],
});

router.post('/launch', async (req: Request, res: Response) => {
  try {
    const parsed = launchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { type, config, threads, delayMin, delayMax } = parsed.data;
    const force = req.query.force === "true" && req.user!.role === "ADMIN";

    let targetAccountIds = parsed.data.accountIds;
    if (parsed.data.applyToAll) {
      const all = await prisma.socialAccount.findMany({
        where: { userId: req.user!.id, status: 'ALIVE' },
        select: { id: true },
      });
      targetAccountIds = all.map((a: { id: string }) => a.id);
    }
    if (targetAccountIds.length === 0) {
      res.status(400).json({ error: 'Не выбрано ни одного аккаунта' });
      return;
    }

    // Verify thread limit (existing behaviour)
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

    // Derive accountId for single-account dispatches (shadowban-detector uses this)
    const accountId =
      targetAccountIds.length === 1 ? targetAccountIds[0] : null;

    // Create parent task record
    const task = await prisma.task.create({
      data: {
        userId: req.user!.id,
        type,
        config: { ...config, accountIds: targetAccountIds, threads },
        accountId,
      },
    });

    // Map task type -> queue
    const queueMap = {
      UPLOAD: 'upload',
      WARMUP: 'warmup',
      COOKIES: 'cookies',
      EDIT_PROFILE: 'edit-profile',
      LOGIN: 'login',
    } as const;
    const queueName = queueMap[type];

    // Build per-job extras — maps frontend config → worker payload shapes
    const buildExtra = async () => {
      // ── EDIT_PROFILE: worker expects { changes: { name, bio, avatarUrl } }
      if (type === 'EDIT_PROFILE') {
        const cfg = config as Record<string, unknown>;
        return {
          taskId: task.id,
          changes: {
            name: cfg.nickname || undefined,
            bio: cfg.bio || undefined,
            avatarUrl: cfg.avatarUrl || undefined,
          },
        };
      }

      // ── WARMUP: flatten hashtags to top-level for worker
      if (type === 'WARMUP') {
        const cfg = config as Record<string, unknown>;
        return {
          taskId: task.id,
          hashtags: Array.isArray(cfg.hashtags) ? cfg.hashtags : [],
          warmupDays: cfg.warmupDays ?? 10,
        };
      }

      // ── UPLOAD: resolve video details from DB
      if (type === 'UPLOAD') {
        const cfg = config as Record<string, unknown>;
        const videoId = cfg.videoId as string | undefined;
        if (!videoId) throw new Error("UPLOAD requires config.videoId");

        const video = await prisma.video.findFirstOrThrow({
          where: { id: videoId, userId: req.user!.id },
        });

        return {
          taskId: task.id,
          videoId: video.id,
          videoPath: video.filepath,
          title: (cfg.title as string) || video.originalName,
          description: (cfg.description as string) || video.description || "",
          hashtags: (cfg.hashtags as string[]) ?? video.hashtags ?? [],
        };
      }

      // ── Default (COOKIES, LOGIN): pass config as-is
      return { taskId: task.id, config };
    };

    // Dispatch one job per account with staggered delay (M-4)
    const results = await Promise.all(
      targetAccountIds.map(async (accountId, index) => {
        const extra = await buildExtra();
        // Calculate per-account delay: each subsequent account gets additional delay
        const perAccountDelay = delayMin + Math.floor(Math.random() * (delayMax - delayMin + 1));
        const totalDelay = index * perAccountDelay;

        return dispatchAccountJob({
          queueName,
          userId: req.user!.id,
          accountId,
          extra,
          forceSkipWarmup: force,
          delay: totalDelay > 0 ? totalDelay : undefined,
        });
      }),
    );

    const successCount = results.filter(r => r.jobId).length;
    const failures = results.filter(r => !r.jobId);

    // If everything failed pre-flight, no point in keeping the task record.
    if (successCount === 0) {
      await prisma.task.update({
        where: { id: task.id },
        data: { status: 'FAILED', error: 'All accounts failed pre-flight checks' },
      });
      res.status(409).json({
        error: "Все аккаунты заблокированы pre-flight проверками",
        task,
        failures,
      });
      return;
    }

    // Persist BullMQ job ids on the task (use first as primary, full list in config)
    await prisma.task.update({
      where: { id: task.id },
      data: {
        bullmqJobId: results.find(r => r.jobId)!.jobId,
        status: 'PENDING',
        config: { ...config, accountIds: targetAccountIds, threads, dispatchedJobs: results },
      },
    });

    res.status(201).json({
      task: { ...task, bullmqJobId: results[0].jobId },
      dispatched: successCount,
      skipped: failures.length,
      failures,
    });
  } catch (err) {
    console.error('[Workspace] Launch error:', err);
    res.status(500).json({ error: 'Ошибка при запуске задачи' });
  }
});

// ── POST /queue/add — dynamically add videos to running task ─
const queueAddSchema = z.object({
  taskId: z.string().min(1, 'taskId обязателен'),
  videoIds: z.array(z.string().min(1)).min(1, 'videoIds не может быть пустым'),
});

router.post('/queue', async (req: Request, res: Response) => {
  try {
    const parsed = queueAddSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }
    const { taskId, videoIds } = parsed.data;

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

    // BUG-M6 + BUG-3 fix: Dispatch BullMQ jobs for the newly added videos.
    // Use accountIds (array) from config — launch stores them as accountIds, not accountId.
    // For single-account tasks, task.accountId is also available as fallback.
    const targetAccountIds: string[] =
      (currentConfig.accountIds as string[] | undefined) ??
      (task.accountId ? [task.accountId] : []);

    if (targetAccountIds.length > 0 && task.type === 'UPLOAD') {
      for (const videoId of videoIds) {
        const video = await prisma.video.findFirst({
          where: { id: videoId, userId: req.user!.id },
          select: { id: true, filepath: true, description: true, hashtags: true },
        });
        if (video) {
          for (const accId of targetAccountIds) {
            await dispatchAccountJob({
              queueName: 'upload',
              accountId: accId,
              userId: req.user!.id,
              extra: {
                taskId,
                videoId: video.id,
                videoPath: video.filepath,
                title: video.description ?? '',
                description: video.description ?? '',
                hashtags: (video.hashtags as string[]) ?? [],
              },
            });
          }
        }
      }
    }

    res.json({ added: true, totalVideos: updatedVideos.length, jobsDispatched: videoIds.length });
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
      data: { ...parsed.data, config: parsed.data.config as any, userId: req.user!.id as string },
    });

    res.status(201).json({ preset });
  } catch (err) {
    console.error('[Workspace] Preset create error:', err);
    res.status(500).json({ error: 'Ошибка при сохранении пресета' });
  }
});

// ── GET /cookies/export — download decrypted cookies as JSON ─
// C-6 FIX: Rate-limited and audit-logged — this is the most sensitive endpoint
router.get('/cookies/export', authRateLimit, async (req: Request, res: Response) => {
  try {
    // Fetch all accounts with encrypted cookies for this user
    const accounts = await prisma.socialAccount.findMany({
      where: {
        userId: req.user!.id,
        cookiesEncrypted: { not: null },
      },
      select: {
        username: true,
        platform: true,
        cookiesEncrypted: true,
        cookiesIv: true,
        cookiesAuthTag: true,
      },
    });

    if (accounts.length === 0) {
      res.status(404).json({ error: 'Нет аккаунтов с cookies' });
      return;
    }

    const masterKeyBuf = Buffer.from(process.env.MASTER_KEY!, 'base64');
    if (masterKeyBuf.length !== 32) {
      res.status(500).json({ error: 'MASTER_KEY невалиден — расшифровка невозможна' });
      return;
    }

    // Decrypt and build JSON manifest
    const cookiesData = accounts.map((a: typeof accounts[number]) => {
      let decryptedCookies: unknown = null;
      try {
        if (a.cookiesEncrypted && a.cookiesIv && a.cookiesAuthTag) {
          const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            masterKeyBuf,
            Buffer.from(a.cookiesIv),
          );
          decipher.setAuthTag(Buffer.from(a.cookiesAuthTag));
          const decrypted = Buffer.concat([
            decipher.update(Buffer.from(a.cookiesEncrypted)),
            decipher.final(),
          ]);
          decryptedCookies = JSON.parse(decrypted.toString('utf8'));
        }
      } catch {
        decryptedCookies = null; // skip corrupted entries
      }
      return {
        username: a.username,
        platform: a.platform,
        cookies: decryptedCookies,
      };
    }).filter((a: { cookies: unknown }) => a.cookies !== null);

    if (cookiesData.length === 0) {
      res.status(500).json({ error: 'Не удалось расшифровать ни одного набора cookies' });
      return;
    }

    const jsonPayload = JSON.stringify(cookiesData, null, 2);
    const filename = `cookies_${Date.now()}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // Audit log for sensitive operation
    console.log(`[AUDIT] Cookies exported by userId=${req.user!.id} email=${req.user!.email} count=${cookiesData.length} at=${new Date().toISOString()}`);

    res.send(jsonPayload);
  } catch (err) {
    console.error('[Workspace] Cookies export error:', err);
    res.status(500).json({ error: 'Ошибка при экспорте cookies' });
  }
});

export default router;
