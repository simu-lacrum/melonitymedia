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
import {
  analyticsCronQueue,
  cleanupQueue,
  cookiesQueue,
  editProfileQueue,
  loginQueue,
  shadowbanCheckQueue,
  uploadQueue,
  warmupQueue,
} from '../lib/bullmq.js';
import { authMiddleware } from '../middleware/auth.js';
import { authRateLimit } from '../middleware/rate-limit.js';
import { buildNoVncClientUrl, getOwnedVncSession, proxyNoVncHttp } from '../lib/vnc-proxy.js';
import { buildTaskMonitorUrl, sanitizeTaskConfig } from '../lib/task-sanitize.js';
import {
  normalizeWarmupComments,
  normalizeWarmupDays,
  normalizeWarmupHours,
  normalizeWarmupMode,
} from '../lib/warmup-state.js';

const router = Router();
router.use(authMiddleware);

const taskQueues = {
  UPLOAD: uploadQueue,
  WARMUP: warmupQueue,
  COOKIES: cookiesQueue,
  EDIT_PROFILE: editProfileQueue,
  LOGIN: loginQueue,
  ANALYTICS_CRON: analyticsCronQueue,
  SHADOWBAN_CHECK: shadowbanCheckQueue,
  CLEANUP: cleanupQueue,
} as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function collectTaskJobIds(task: {
  bullmqJobId: string | null;
  config: unknown;
}): string[] {
  const jobIds = new Set<string>();
  if (task.bullmqJobId) jobIds.add(task.bullmqJobId);

  const dispatchedJobs = asRecord(task.config).dispatchedJobs;
  if (Array.isArray(dispatchedJobs)) {
    for (const item of dispatchedJobs) {
      const jobId = asRecord(item).jobId;
      if (typeof jobId === 'string' && jobId.length > 0) {
        jobIds.add(jobId);
      }
    }
  }

  return [...jobIds];
}

function collectTaskAccountIds(task: {
  accountId?: string | null;
  config: unknown;
}): string[] {
  const accountIds = new Set<string>();
  if (task.accountId) accountIds.add(task.accountId);

  const configuredIds = asRecord(task.config).accountIds;
  if (Array.isArray(configuredIds)) {
    for (const id of configuredIds) {
      if (typeof id === 'string' && id.length > 0) {
        accountIds.add(id);
      }
    }
  }

  return [...accountIds];
}

async function reconcileTaskStatuses(userId: string) {
  const staleTasks = await prisma.task.findMany({
    where: {
      userId,
      status: { in: ['PENDING', 'RUNNING'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      type: true,
      status: true,
      config: true,
      bullmqJobId: true,
      error: true,
      createdAt: true,
      accountId: true,
    },
  });

  await Promise.all(staleTasks.map(async (task) => {
    const queue = taskQueues[task.type as keyof typeof taskQueues];
    if (!queue) return;

    const jobIds = collectTaskJobIds(task);
    if (jobIds.length === 0) {
      const ageMs = Date.now() - new Date(task.createdAt).getTime();
      if (ageMs < 10 * 60_000) return;

      await prisma.task.update({
        where: { id: task.id },
        data: {
          status: 'FAILED',
          error: task.error ?? 'No worker job was created for this task',
          completedAt: new Date(),
        },
      });
      return;
    }

    const states = await Promise.all(jobIds.map(async (jobId) => {
      const job = await queue.getJob(jobId);
      if (!job) return { state: 'missing', failedReason: null as string | null };
      return {
        state: await job.getState(),
        failedReason: typeof job.failedReason === 'string' ? job.failedReason : null,
      };
    }));

    const hasInFlight = states.some(({ state }) =>
      ['active', 'waiting', 'waiting-children', 'delayed', 'prioritized', 'paused'].includes(state),
    );
    if (hasInFlight) return;

    const hasFailed = states.some(({ state }) => state === 'failed');
    const allCompleted = states.every(({ state }) => state === 'completed');
    if (!hasFailed && !allCompleted) return;

    if (!hasFailed && task.type === 'WARMUP') {
      const accountIds = collectTaskAccountIds(task);
      const warmingAccounts = accountIds.length === 0
        ? 0
        : await prisma.socialAccount.count({
            where: {
              userId,
              id: { in: accountIds },
              status: 'WARMING_UP',
              warmupCompletedAt: null,
            },
          });

      if (warmingAccounts > 0) {
        await prisma.task.update({
          where: { id: task.id },
          data: { status: 'RUNNING' },
        });
        return;
      }
    }

    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: hasFailed ? 'FAILED' : 'COMPLETED',
        progress: hasFailed ? undefined : 100,
        error: hasFailed
          ? states.find(({ failedReason }) => failedReason)?.failedReason ?? task.error ?? 'One or more jobs failed'
          : null,
        completedAt: new Date(),
      },
    });
  }));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Multer Setup ────────────────────────────────────────────
// Videos saved to UPLOAD_DIR with random filename to avoid collisions
// IMPORTANT: must be absolute path to match Docker volume mount at /app/uploads
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || '/app/uploads');

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

// ── Avatar Multer Setup ─────────────────────────────────────
const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const hash = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `avatar_${hash}${ext}`);
  },
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max per avatar
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Только форматы .jpg, .jpeg, .png, .webp, .gif'));
    }
  },
});

// ── Banner Multer Setup ─────────────────────────────────────
const BANNER_DIR = path.resolve(process.env.BANNER_DIR || '/app/banners');
if (!fs.existsSync(BANNER_DIR)) {
  fs.mkdirSync(BANNER_DIR, { recursive: true });
}

const bannerStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, BANNER_DIR),
  filename: (_req, file, cb) => {
    const hash = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname);
    cb(null, `banner_${hash}${ext}`);
  },
});

const bannerUpload = multer({
  storage: bannerStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max per banner
  fileFilter: (_req, file, cb) => {
    const allowed = ['.mp4', '.webm', '.mov'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Допустимые форматы баннера: .mp4, .webm, .mov'));
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

    res.status(201).json({
      video: {
        id: video.id,
        originalName: video.originalName,
        filename: video.filename,
        size: video.size,
        description: video.description,
        hashtags: video.hashtags,
      },
    });
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
    const normalizedConfig = type === 'WARMUP'
      ? {
          ...asRecord(config),
          warmupMode: normalizeWarmupMode(asRecord(config).warmupMode),
          warmupDays: normalizeWarmupDays(asRecord(config).warmupDays),
          warmupHours: normalizeWarmupHours(asRecord(config).warmupHours),
          comments: normalizeWarmupComments(asRecord(config).comments),
        }
      : config;
    const forceRequested = req.query.force === "true";
    if (forceRequested && req.user!.role !== "ADMIN") {
      res.status(403).json({ error: "Force launch override is admin-only" });
      return;
    }
    const force = forceRequested;

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
        config: { ...normalizedConfig, accountIds: targetAccountIds, threads },
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
        const cfg = normalizedConfig as Record<string, unknown>;
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
        const cfg = normalizedConfig as Record<string, unknown>;
        return {
          taskId: task.id,
          hashtags: Array.isArray(cfg.hashtags) ? cfg.hashtags : [],
          comments: normalizeWarmupComments(cfg.comments),
          warmupMode: cfg.warmupMode ?? 'DAYS',
          warmupDays: cfg.warmupDays ?? 10,
          warmupHours: cfg.warmupHours ?? 2,
        };
      }

      // ── UPLOAD: resolve video details from DB
      if (type === 'UPLOAD') {
        const cfg = normalizedConfig as Record<string, unknown>;
        const videoId = cfg.videoId as string | undefined;
        if (!videoId) throw new Error("UPLOAD requires config.videoId");
        const rawBannerId = typeof cfg.bannerId === 'string' ? cfg.bannerId.trim() : '';
        const bannerId = rawBannerId && rawBannerId !== 'none' ? rawBannerId : undefined;

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
          bannerId,
          bannerPath: undefined as string | undefined,
        };
      }

      // ── Default (COOKIES, LOGIN): pass config as-is
      return { taskId: task.id, config: normalizedConfig };
    };

    // Pre-resolve banner path ONCE before iterating accounts (fixes N+1 query)
    let resolvedBannerPath: string | undefined;
    let dispatchAccountIds = targetAccountIds;
    let alreadyUploadedCount = 0;
    // Pre-resolve extra ONCE (fixes N+1 video.findFirstOrThrow inside loop)
    const baseExtra = await buildExtra();
    if (type === 'UPLOAD') {
      const bannerId = (baseExtra as Record<string, unknown>).bannerId as string | undefined;
      if (bannerId) {
        const banner = await prisma.banner.findFirst({
          where: { id: bannerId, userId: req.user!.id },
          select: { filepath: true },
        });
        if (!banner || !fs.existsSync(banner.filepath)) {
          const error = 'Выбранный баннер не найден или файл удалён';
          await prisma.task.update({
            where: { id: task.id },
            data: { status: 'FAILED', error, completedAt: new Date() },
          });
          res.status(400).json({ error });
          return;
        }
        resolvedBannerPath = banner.filepath;
      }

      const videoId = (baseExtra as Record<string, unknown>).videoId as string | undefined;
      if (!videoId) throw new Error("UPLOAD requires resolved videoId");

      const pendingAccountIds = await Promise.all(targetAccountIds.map(async (accountId) => {
        const existing = await prisma.videoPublication.findUnique({
          where: { videoId_accountId: { videoId, accountId } },
          select: { status: true },
        });
        if (existing?.status === 'UPLOADED') return null;

        await prisma.videoPublication.upsert({
          where: { videoId_accountId: { videoId, accountId } },
          create: {
            userId: req.user!.id,
            videoId,
            accountId,
            taskId: task.id,
            status: 'QUEUED',
          },
          update: {
            taskId: task.id,
            status: 'QUEUED',
            error: null,
          },
        });
        return accountId;
      }));
      dispatchAccountIds = pendingAccountIds.filter((id): id is string => Boolean(id));
      alreadyUploadedCount = targetAccountIds.length - dispatchAccountIds.length;

      if (dispatchAccountIds.length === 0) {
        const completedTask = await prisma.task.update({
          where: { id: task.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            config: { ...normalizedConfig, accountIds: targetAccountIds, threads, dispatchedJobs: [] },
          },
        });
        res.status(200).json({
          task: completedTask,
          dispatched: 0,
          skipped: targetAccountIds.length,
          failures: [],
        });
        return;
      }
    }

    const results = await Promise.all(
      dispatchAccountIds.map(async (accountId, index) => {
        // Clone pre-resolved extra for this account (no DB calls here)
        const extra = { ...baseExtra as Record<string, unknown> };
        // Inject per-batch count for upload cleanup.
        if (type === 'UPLOAD') {
          extra.totalAccountsInJob = dispatchAccountIds.length;
        }
        if (type === 'EDIT_PROFILE') {
          extra.jobIndex = index;
          extra.totalAccountsInJob = targetAccountIds.length;
        }
        // Use pre-resolved banner path instead of per-account query
        if (type === 'UPLOAD' && resolvedBannerPath) {
          extra.bannerPath = resolvedBannerPath;
        }
        delete extra.bannerId;
        // Calculate per-account delay: each subsequent account gets additional delay
        const perAccountDelay = delayMin + Math.floor(Math.random() * (delayMax - delayMin + 1));
        const totalDelay = index * perAccountDelay;
        const safeDelay = type === 'WARMUP'
          ? Math.max(1000, totalDelay)
          : totalDelay;

        return dispatchAccountJob({
          queueName,
          userId: req.user!.id,
          accountId,
          extra,
          forceSkipWarmup: force,
          delay: safeDelay > 0 ? safeDelay : undefined,
        });
      }),
    );

    const successCount = results.filter(r => r.jobId).length;
    const failures = results.filter(r => !r.jobId);
    const successfulAccountIds = results.filter(r => r.jobId).map(r => r.accountId);

    // If everything failed pre-flight, no point in keeping the task record.
    if (successCount === 0) {
      await prisma.task.update({
        where: { id: task.id },
        data: { status: 'FAILED', error: 'All accounts failed pre-flight checks' },
      });

      // Build a human-readable error message based on failure reasons
      const BUSY_TASK_LABELS: Record<string, string> = {
        upload: 'залив', warmup: 'прогрев', login: 'логин',
        'edit-profile': 'редактирование профиля', cookies: 'сбор cookies',
      };
      const busyFailures = failures.filter(f => f.error?.startsWith('ACCOUNT_BUSY'));
      let errorMsg: string;
      if (busyFailures.length > 0) {
        const runningTask = busyFailures[0].error?.split(':')[1] || 'задача';
        const label = BUSY_TASK_LABELS[runningTask] || runningTask;
        errorMsg = `Аккаунт(ы) заняты — сейчас выполняется: ${label}. Дождитесь завершения.`;
      } else if (failures.some(f => f.error === 'NO_PROXY')) {
        errorMsg = 'К аккаунту должен быть привязан рабочий прокси перед запуском задачи.';
      } else if (failures.some(f => f.error === 'NO_COOKIES')) {
        errorMsg = 'У аккаунта нет валидных cookies. Выполните вход или импорт cookies, затем повторите запуск.';
      } else if (failures.some(f => f.error === 'NO_FINGERPRINT')) {
        errorMsg = 'У аккаунта нет fingerprint. Переимпортируйте аккаунт или пересоздайте fingerprint до запуска задачи.';
      } else {
        errorMsg = "Все аккаунты заблокированы pre-flight проверками";
      }

      res.status(409).json({
        error: errorMsg,
        task,
        failures,
      });
      return;
    }

    // Persist BullMQ job ids on the task (use first as primary, full list in config)
    if (type === 'WARMUP' && successfulAccountIds.length > 0) {
      const cfg = normalizedConfig as Record<string, unknown>;
      await prisma.socialAccount.updateMany({
        where: { id: { in: successfulAccountIds }, userId: req.user!.id },
        data: {
          status: 'WARMING_UP',
          warmupDays: normalizeWarmupDays(cfg.warmupDays),
          warmupStartedAt: new Date(),
          warmupCompletedAt: null,
          lastWarmupDay: null,
          lastError: null,
        },
      });
    }

    await prisma.task.update({
      where: { id: task.id },
      data: {
        bullmqJobId: results.find(r => r.jobId)!.jobId,
        status: 'PENDING',
        config: { ...normalizedConfig, accountIds: targetAccountIds, threads, dispatchedJobs: results },
      },
    });

    res.status(201).json({
      task: { ...task, bullmqJobId: results[0].jobId },
      dispatched: successCount,
      skipped: failures.length + alreadyUploadedCount,
      alreadyUploaded: alreadyUploadedCount,
      failures,
    });
  } catch (err) {
    console.error('[Workspace] Launch error:', err);
    res.status(500).json({ error: 'Ошибка при запуске задачи' });
  }
});

// GET /jobs/:taskId/monitor/:jobId - owner-scoped noVNC monitor page
router.get('/jobs/:taskId/monitor/:jobId', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.taskId as string;
    const jobId = req.params.jobId as string;
    const session = await getOwnedVncSession(req.user!.id, taskId, jobId);

    if (!session) {
      res.status(404).json({ error: 'Monitor not found' });
      return;
    }

    const noVncUrl = buildNoVncClientUrl(taskId, jobId, session.password);
    if (req.query.embed === '1') {
      res.redirect(noVncUrl);
      return;
    }

    res.type('html').send(`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VNC Monitor</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #050505; color: #f4f4f5; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .shell { display: grid; grid-template-rows: auto 1fr; width: 100%; height: 100%; }
    .bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; padding: 0 14px; border-bottom: 1px solid #27272a; background: #09090b; }
    .title { min-width: 0; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .status { font-size: 12px; color: #a1a1aa; white-space: nowrap; }
    iframe { width: 100%; height: 100%; border: 0; background: #000; }
  </style>
</head>
<body>
  <main class="shell">
    <div class="bar">
      <div class="title">VNC Monitor</div>
      <div class="status">Task ${escapeHtml(taskId.slice(0, 8))} - Job ${escapeHtml(jobId.slice(0, 8))}</div>
    </div>
    <iframe src="${escapeHtml(noVncUrl)}" allow="clipboard-read; clipboard-write; fullscreen; pointer-lock"></iframe>
  </main>
</body>
</html>`);
  } catch (err) {
    console.error('[Workspace] VNC monitor error:', err);
    res.status(500).json({ error: 'Monitor is unavailable' });
  }
});

router.use('/jobs/:taskId/vnc/:jobId', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.taskId as string;
    const jobId = req.params.jobId as string;
    const session = await getOwnedVncSession(req.user!.id, taskId, jobId);

    if (!session) {
      res.status(404).json({ error: 'Monitor not found' });
      return;
    }

    await proxyNoVncHttp(req, res, session.webPort, req.url || '/vnc.html');
  } catch (err) {
    console.error('[Workspace] VNC proxy error:', err);
    res.status(500).json({ error: 'Monitor is unavailable' });
  }
});

// GET /jobs - list recent tasks for the current user
router.get('/jobs', async (req: Request, res: Response) => {
  try {
    await reconcileTaskStatuses(req.user!.id);

    const rawTasks = await prisma.task.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        type: true,
        status: true,
        config: true,
        bullmqJobId: true,
        progress: true,
        error: true,
        accountId: true,
        cancelReason: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        vncSessions: {
          where: { status: 'ACTIVE' },
          orderBy: { startedAt: 'desc' },
          select: {
            id: true,
            jobId: true,
            accountId: true,
            status: true,
            startedAt: true,
            updatedAt: true,
            account: {
              select: {
                username: true,
                nickname: true,
                platform: true,
              },
            },
          },
        },
      },
    });

    const tasks = rawTasks.map(task => ({
      ...task,
      config: sanitizeTaskConfig(task.config),
      vncSessions: task.vncSessions.map(session => ({
        id: session.id,
        jobId: session.jobId,
        accountId: session.accountId,
        status: session.status,
        startedAt: session.startedAt,
        updatedAt: session.updatedAt,
        monitorUrl: buildTaskMonitorUrl(task.id, session.jobId),
        accountLabel:
          session.account.username ||
          session.account.nickname ||
          session.accountId.slice(0, 8),
        platform: session.account.platform,
      })),
    }));

    const active = tasks.filter(t => t.status === 'RUNNING');
    const waiting = tasks.filter(t => t.status === 'PENDING');
    const completed = tasks.filter(t => t.status === 'COMPLETED' || t.status === 'CANCELLED');
    const failed = tasks.filter(t => t.status === 'FAILED');

    res.json({
      success: true,
      tasks,
      data: { active, waiting, completed, failed },
    });
  } catch (err) {
    console.error('[Workspace] Jobs list error:', err);
    res.status(500).json({ error: 'Ошибка при загрузке задач' });
  }
});

// DELETE /jobs/:id — cancel a pending/running task and remove queued BullMQ jobs
router.delete('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const task = await prisma.task.findFirst({
      where: { id: req.params.id as string, userId: req.user!.id },
    });

    if (!task) {
      res.status(404).json({ error: 'Задача не найдена' });
      return;
    }

    if (!['PENDING', 'RUNNING'].includes(task.status)) {
      res.status(409).json({
        error: 'Можно отменить только задачу в очереди или в работе',
        status: task.status,
      });
      return;
    }

    const queue = taskQueues[task.type as keyof typeof taskQueues];
    const jobIds = collectTaskJobIds(task);
    const warnings: string[] = [];
    let removedJobs = 0;

    if (queue) {
      for (const jobId of jobIds) {
        const job = await queue.getJob(jobId);
        if (!job) continue;
        try {
          await job.remove();
          removedJobs += 1;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          warnings.push(`Job ${jobId}: ${message}`);
        }
      }
    }

    if (task.type === 'UPLOAD') {
      await prisma.videoPublication.updateMany({
        where: {
          userId: req.user!.id,
          taskId: task.id,
          status: { in: ['QUEUED', 'PROCESSING'] },
        },
        data: {
          status: 'SKIPPED',
          error: 'Cancelled by user',
        },
      });
    }

    if (task.type === 'WARMUP') {
      const accountIds = collectTaskAccountIds(task);
      if (accountIds.length > 0) {
        await prisma.socialAccount.updateMany({
          where: {
            userId: req.user!.id,
            id: { in: accountIds },
            status: 'WARMING_UP',
            warmupCompletedAt: null,
          },
          data: {
            status: 'ALIVE',
            warmupStartedAt: null,
            lastWarmupDay: null,
            lastError: null,
          },
        });
      }
    }

    const cancelled = await prisma.task.update({
      where: { id: task.id },
      data: {
        status: 'CANCELLED',
        cancelReason: 'USER_CANCELLED',
        completedAt: new Date(),
        error: warnings.length > 0
          ? 'Task cancelled; active browser jobs may finish their current step'
          : null,
      },
    });

    res.json({
      success: true,
      task: cancelled,
      removedJobs,
      warnings,
    });
  } catch (err) {
    console.error('[Workspace] Job cancel error:', err);
    res.status(500).json({ error: 'Ошибка при отмене задачи' });
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
    const rawBannerId = typeof currentConfig.bannerId === 'string' ? currentConfig.bannerId.trim() : '';
    const queueBannerId = rawBannerId && rawBannerId !== 'none' ? rawBannerId : undefined;
    let queueBannerPath: string | undefined;

    if (task.type === 'UPLOAD' && queueBannerId) {
      const banner = await prisma.banner.findFirst({
        where: { id: queueBannerId, userId: req.user!.id },
        select: { filepath: true },
      });
      if (!banner || !fs.existsSync(banner.filepath)) {
        res.status(400).json({ error: 'Выбранный баннер не найден или файл удалён' });
        return;
      }
      queueBannerPath = banner.filepath;
    }

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
      let jobsDispatched = 0;
      for (const videoId of videoIds) {
        const video = await prisma.video.findFirst({
          where: { id: videoId, userId: req.user!.id },
          select: { id: true, filepath: true, originalName: true, description: true, hashtags: true },
        });
        if (video) {
          const pendingAccountIds: string[] = [];
          for (const accId of targetAccountIds) {
            const existing = await prisma.videoPublication.findUnique({
              where: { videoId_accountId: { videoId: video.id, accountId: accId } },
              select: { status: true },
            });
            if (existing?.status === 'UPLOADED') continue;
            pendingAccountIds.push(accId);
          }

          for (const accId of pendingAccountIds) {
            await prisma.videoPublication.upsert({
              where: { videoId_accountId: { videoId: video.id, accountId: accId } },
              create: {
                userId: req.user!.id,
                videoId: video.id,
                accountId: accId,
                taskId,
                status: 'QUEUED',
              },
              update: {
                taskId,
                status: 'QUEUED',
                error: null,
              },
            });

            await dispatchAccountJob({
              queueName: 'upload',
              accountId: accId,
              userId: req.user!.id,
              extra: {
                taskId,
                videoId: video.id,
                videoPath: video.filepath,
                title: video.originalName,
                description: video.description ?? '',
                hashtags: (video.hashtags as string[]) ?? [],
                bannerPath: queueBannerPath,
                totalAccountsInJob: pendingAccountIds.length,
              },
            });
            jobsDispatched++;
          }
        }
      }
      res.json({ added: true, totalVideos: updatedVideos.length, jobsDispatched });
      return;
    }

    res.json({ added: true, totalVideos: updatedVideos.length, jobsDispatched: 0 });
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

// ── POST /upload-avatar ─ upload an avatar file
router.post('/upload-avatar', avatarUpload.single('avatar'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Файл аватара не загружен' });
      return;
    }
    // Just return the absolute path to the saved file
    res.status(201).json({ filepath: req.file.path });
  } catch (err) {
    console.error('[Workspace] Avatar upload error:', err);
    res.status(500).json({ error: 'Ошибка загрузки аватара' });
  }
});

// ── Banner CRUD ─────────────────────────────────────────────

// POST /upload-banner — upload a banner video file
router.post('/upload-banner', bannerUpload.single('banner'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Файл баннера не загружен' });
      return;
    }

    const banner = await prisma.banner.create({
      data: {
        userId: req.user!.id,
        filename: req.file.filename,
        originalName: req.file.originalname,
        filepath: req.file.path,
        mimeType: req.file.mimetype,
        size: req.file.size,
      },
    });

    res.status(201).json({ banner });
  } catch (err) {
    console.error('[Workspace] Banner upload error:', err);
    res.status(500).json({ error: 'Ошибка при загрузке баннера' });
  }
});

// GET /banners — list user's banners
router.get('/banners', async (req: Request, res: Response) => {
  try {
    const banners = await prisma.banner.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        originalName: true,
        filename: true,
        size: true,
        createdAt: true,
      },
    });
    res.json({ banners });
  } catch (err) {
    console.error('[Workspace] Banners list error:', err);
    res.status(500).json({ error: 'Ошибка при получении списка баннеров' });
  }
});

// DELETE /banner/:id — delete a banner
router.delete('/banner/:id', async (req: Request, res: Response) => {
  try {
    const banner = await prisma.banner.findFirst({
      where: { id: req.params.id as string, userId: req.user!.id },
    });
    if (!banner) {
      res.status(404).json({ error: 'Баннер не найден' });
      return;
    }
    // Delete file from disk
    try { fs.unlinkSync(banner.filepath); } catch { /* non-critical */ }
    // Delete DB record
    await prisma.banner.delete({ where: { id: banner.id } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[Workspace] Banner delete error:', err);
    res.status(500).json({ error: 'Ошибка при удалении баннера' });
  }
});

export default router;
