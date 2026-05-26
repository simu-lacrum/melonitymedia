// ─────────────────────────────────────────────────────────────
// Social Accounts Routes v3
// CRUD + cookie import + bulk operations + warmup tracking
//
// CHANGES in v3:
// 1. POST /import: accepts cookies (Netscape .txt or JSON)
//    instead of login:pass format (cookie-only auth)
// 2. POST /import now encrypts cookies with AES-256-GCM
//    before storing in DB (MASTER_KEY required)
// 3. Per-account fingerprint auto-generated on import
// 4. New status values: EXPIRED_COOKIES, SHADOWBAN_SUSPECTED, WARMING_UP
// 5. POST /warmup calculates warmupDay from warmupStartedAt
// 6. POST /:id/cookies for single account cookie re-import
//
// ALL queries are userId-scoped — strict tenant isolation.
import { validatePinChange } from "../lib/proxy-pin-rules.js";
// ─────────────────────────────────────────────────────────────

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authMiddleware } from '../middleware/auth.js';
import crypto from 'crypto';

const router = Router();
router.use(authMiddleware);

// ── Cookie Encryption ───────────────────────────────────────
// Same AES-256-GCM scheme as cookie-store.ts in worker.
// Key comes from env — validated at startup.

function encryptCookies(jsonStr: string): { encrypted: Buffer; iv: Buffer; authTag: Buffer } {
  const keyBuf = Buffer.from(process.env.MASTER_KEY ?? '', 'base64');
  if (keyBuf.length !== 32) {
    throw new Error('MASTER_KEY invalid — cannot encrypt cookies');
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
  const encrypted = Buffer.concat([
    cipher.update(jsonStr, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return { encrypted, iv, authTag };
}

// ── Fingerprint Generator ───────────────────────────────────
// Lightweight version of worker's fingerprint-manager.ts.
// Generates a deterministic fingerprint from accountId seed.

function generateFingerprint(accountId: string) {
  const hash = crypto.createHash('sha256').update(accountId).digest();

  const screenSizes = [
    { width: 1920, height: 1080 }, { width: 1366, height: 768 },
    { width: 1536, height: 864 }, { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ];

  const locales = ['en-US', 'en-GB', 'pt-BR', 'es-ES', 'fr-FR', 'de-DE', 'ru-RU', 'ja-JP'];
  const webglVendors = ['Google Inc. (NVIDIA)', 'Google Inc. (AMD)', 'Google Inc. (Intel)'];
  const webglRenderers = [
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  ];

  const screenIdx = hash[0] % screenSizes.length;
  const screen = screenSizes[screenIdx];

  return {
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/1${30 + (hash[1] % 10)}.0.0.0 Safari/537.36`,
    screen,
    devicePixelRatio: [1, 1.25, 1.5, 2][hash[2] % 4],
    locale: locales[hash[3] % locales.length],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: 'Win32',
    hardwareConcurrency: [4, 8, 12, 16][hash[4] % 4],
    deviceMemory: [4, 8, 16][hash[5] % 3],
    maxTouchPoints: 0,
    webgl: {
      vendor: webglVendors[hash[6] % webglVendors.length],
      renderer: webglRenderers[hash[6] % webglRenderers.length],
    },
    canvas: {
      seed: hash.subarray(7, 11).toString('hex'),
    },
    fonts: ['Arial', 'Verdana', 'Times New Roman', 'Georgia', 'Trebuchet MS', 'Courier New'],
  };
}

// ── GET / — list all accounts for current user ──────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const accounts = await prisma.socialAccount.findMany({
      where: { userId: req.user!.id },
      include: { proxy: { select: { id: true, address: true, label: true, type: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // Strip encrypted cookie data from response (never send to frontend)
    const sanitized = accounts.map(a => ({
      ...a,
      cookiesEncrypted: undefined,
      cookiesIv: undefined,
      cookiesAuthTag: undefined,
      hasCookies: !!a.cookiesEncrypted,
      warmupDay: a.warmupStartedAt
        ? Math.min(a.warmupDays + 1, Math.ceil((Date.now() - new Date(a.warmupStartedAt).getTime()) / 86400000))
        : null,
      warmupDays: a.warmupDays,
    }));

    res.json({ accounts: sanitized });
  } catch (err) {
    console.error('[Accounts] List error:', err);
    res.status(500).json({ error: 'Ошибка при загрузке аккаунтов' });
  }
});

// ── POST /import — import with cookies (Netscape .txt or JSON)
const importSchema = z.object({
  platform: z.enum(['TIKTOK', 'YOUTUBE']),
  // Each account block: "username\n<cookies>" separated by blank lines
  // Or just cookies (one account per import)
  cookies: z.string().min(10, 'Cookies обязательны'),
  username: z.string().optional(),
  nickname: z.string().optional(),
});

router.post('/import', async (req: Request, res: Response) => {
  try {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { platform, cookies, username, nickname } = parsed.data;

    // Generate account ID early for fingerprint seed
    const accountId = crypto.randomUUID().replace(/-/g, '').substring(0, 25);

    // Parse and validate cookies (Netscape or JSON format)
    let cookieJson: string;
    try {
      // Try JSON first
      JSON.parse(cookies);
      cookieJson = cookies;
    } catch {
      // Try Netscape format: domain\tTRUE\t/\tTRUE\texpiry\tname\tvalue
      const lines = cookies.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      const parsed = lines.map(line => {
        const parts = line.split('\t');
        if (parts.length >= 7) {
          return {
            domain: parts[0],
            path: parts[2],
            secure: parts[3] === 'TRUE',
            expires: parseInt(parts[4]) || 0,
            name: parts[5],
            value: parts[6],
          };
        }
        return null;
      }).filter(Boolean);

      if (parsed.length === 0) {
        res.status(400).json({ error: 'Невалидный формат cookies (ожидается Netscape .txt или JSON)' });
        return;
      }
      cookieJson = JSON.stringify(parsed);
    }

    // Encrypt cookies with AES-256-GCM
    const { encrypted, iv, authTag } = encryptCookies(cookieJson);

    // Generate per-account fingerprint
    const fingerprint = generateFingerprint(accountId);

    const account = await prisma.socialAccount.create({
      data: {
        id: accountId,
        userId: req.user!.id,
        platform: platform as 'TIKTOK' | 'YOUTUBE',
        username: username?.trim() || null,
        nickname: nickname?.trim() || null,
        cookiesEncrypted: encrypted,
        cookiesIv: iv,
        cookiesAuthTag: authTag,
        cookiesUpdatedAt: new Date(),
        fingerprint: fingerprint as any,
        status: 'ALIVE',
      },
    });

    res.status(201).json({
      account: {
        id: account.id,
        platform: account.platform,
        username: account.username,
        nickname: account.nickname,
        hasCookies: true,
        status: account.status,
      },
    });
  } catch (err) {
    console.error('[Accounts] Import error:', err);
    res.status(500).json({ error: 'Ошибка при импорте аккаунта' });
  }
});

// ── POST /:id/cookies — re-import cookies for existing account
router.post('/:id/cookies', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.socialAccount.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Аккаунт не найден' });
      return;
    }

    const { cookies } = req.body;
    if (!cookies || typeof cookies !== 'string') {
      res.status(400).json({ error: 'Cookies обязательны' });
      return;
    }

    // Parse cookies (Netscape or JSON)
    let cookieJson: string;
    try {
      JSON.parse(cookies);
      cookieJson = cookies;
    } catch {
      const lines = cookies.split('\n').filter((l: string) => l.trim() && !l.startsWith('#'));
      const parsed = lines.map((line: string) => {
        const parts = line.split('\t');
        if (parts.length >= 7) {
          return { domain: parts[0], path: parts[2], secure: parts[3] === 'TRUE', expires: parseInt(parts[4]) || 0, name: parts[5], value: parts[6] };
        }
        return null;
      }).filter(Boolean);

      if (parsed.length === 0) {
        res.status(400).json({ error: 'Невалидный формат cookies' });
        return;
      }
      cookieJson = JSON.stringify(parsed);
    }

    const { encrypted, iv, authTag } = encryptCookies(cookieJson);

    await prisma.socialAccount.update({
      where: { id: req.params.id },
      data: {
        cookiesEncrypted: encrypted,
        cookiesIv: iv,
        cookiesAuthTag: authTag,
        cookiesUpdatedAt: new Date(),
        status: 'ALIVE', // reset from EXPIRED_COOKIES
      },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[Accounts] Cookie update error:', err);
    res.status(500).json({ error: 'Ошибка при обновлении cookies' });
  }
});

// ── PATCH /:id — update single account ──────────────────────
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.socialAccount.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Аккаунт не найден' });
      return;
    }

    // Whitelist allowed update fields
    const allowedFields = ['username', 'nickname', 'bio', 'defaultDescription', 'avatarUrl', 'bannerUrl', 'pinnedProxyId', 'status', 'secUid', 'warmupDays'];
    const updateData: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    // Clamp warmupDays to valid range (3-21)
    if (updateData.warmupDays !== undefined) {
      updateData.warmupDays = Math.max(3, Math.min(21, Math.floor(Number(updateData.warmupDays))));
    }

    // If pinning a new proxy, validate against carrier stability rules
    if (updateData.pinnedProxyId && updateData.pinnedProxyId !== existing.pinnedProxyId) {
      const force = req.query.force === "true" && req.user!.role === "ADMIN";

      const newProxy = await prisma.proxy.findUniqueOrThrow({
        where: { id: updateData.pinnedProxyId as string, userId: req.user!.id },
        select: { id: true, carrier: true, country: true, type: true },
      });

      const oldProxy = existing.pinnedProxyId
        ? await prisma.proxy.findUnique({
            where: { id: existing.pinnedProxyId },
            select: { id: true, carrier: true, country: true, type: true },
          })
        : null;

      const violation = validatePinChange({ account: existing, oldProxy, newProxy });

      if (violation && !force) {
        res.status(409).json({
          success: false,
          error: violation.message,
          code: violation.code,
          details: {
            daysRemaining: violation.daysRemaining,
            oldCarrier: violation.oldCarrier,
            newCarrier: violation.newCarrier,
            oldCountry: violation.oldCountry,
            newCountry: violation.newCountry,
          },
        });
        return;
      }

      if (violation && force) {
        await prisma.auditLog.create({
          data: {
            userId: req.user!.id,
            action: "PROXY_PIN_FORCE_OVERRIDE",
            entityType: "SocialAccount",
            entityId: existing.id,
            metadata: {
              violation: violation.code,
              oldProxyId: oldProxy?.id ?? null,
              newProxyId: newProxy.id,
              oldCarrier: violation.oldCarrier,
              newCarrier: violation.newCarrier,
            },
          },
        });
      }

      updateData.proxyPinnedAt = new Date();
    }

    const account = await prisma.socialAccount.update({
      where: { id: req.params.id },
      data: updateData,
    });

    res.json({ account: { ...account, cookiesEncrypted: undefined, cookiesIv: undefined, cookiesAuthTag: undefined } });
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

// ── POST /bulk-update — mass assign proxy, status, etc. ─────
const bulkUpdateSchema = z.object({
  accountIds: z.array(z.string()).min(1),
  update: z.object({
    pinnedProxyId: z.string().optional(),
    avatarUrl: z.string().optional(),
    bannerUrl: z.string().optional(),
    bio: z.string().optional(),
    status: z.enum(['ALIVE', 'AUTH_NEEDED', 'BANNED', 'EXPIRED_COOKIES', 'SHADOWBAN_SUSPECTED', 'WARMING_UP']).optional(),
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

// ── POST /bulk-proxy — dedicated bulk proxy binding ─────────
const bulkProxySchema = z.object({
  accountIds: z.array(z.string()).min(1, 'Выберите хотя бы один аккаунт'),
  proxyId: z.string().min(1, 'Выберите прокси'),
});

router.post('/bulk-proxy', async (req: Request, res: Response) => {
  try {
    const parsed = bulkProxySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { accountIds, proxyId } = parsed.data;
    const force = req.query.force === "true" && req.user!.role === "ADMIN";

    const newProxy = await prisma.proxy.findUniqueOrThrow({
      where: { id: proxyId, userId: req.user!.id },
      select: { id: true, carrier: true, country: true, type: true },
    });

    for (const accountId of accountIds) {
      const account = await prisma.socialAccount.findUniqueOrThrow({
        where: { id: accountId, userId: req.user!.id },
        select: {
          id: true,
          platform: true,
          pinnedProxyId: true,
          proxyPinnedAt: true,
          createdAt: true,
        },
      });

      const oldProxy = account.pinnedProxyId
        ? await prisma.proxy.findUnique({
            where: { id: account.pinnedProxyId },
            select: { id: true, carrier: true, country: true, type: true },
          })
        : null;

      const violation = validatePinChange({ account, oldProxy, newProxy });

      if (violation && !force) {
        res.status(409).json({
          success: false,
          error: violation.message,
          code: violation.code,
          details: {
            daysRemaining: violation.daysRemaining,
            oldCarrier: violation.oldCarrier,
            newCarrier: violation.newCarrier,
            oldCountry: violation.oldCountry,
            newCountry: violation.newCountry,
          },
        });
        return;
      }

      if (violation && force) {
        await prisma.auditLog.create({
          data: {
            userId: req.user!.id,
            action: "PROXY_PIN_FORCE_OVERRIDE",
            entityType: "SocialAccount",
            entityId: account.id,
            metadata: {
              violation: violation.code,
              oldProxyId: oldProxy?.id ?? null,
              newProxyId: newProxy.id,
              oldCarrier: violation.oldCarrier,
              newCarrier: violation.newCarrier,
            },
          },
        });
      }

      await prisma.socialAccount.update({
        where: { id: accountId },
        data: {
          pinnedProxyId: newProxy.id,
          proxyPinnedAt: new Date(),
        },
      });
    }

    res.json({ updated: accountIds.length });
  } catch (err) {
    console.error('[Accounts] Bulk proxy bind error:', err);
    res.status(500).json({ error: 'Ошибка при привязке прокси' });
  }
});

// ── DELETE /bulk — mass delete accounts ─────────────────────
router.delete('/bulk', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'Выберите хотя бы один аккаунт' });
      return;
    }

    const result = await prisma.socialAccount.deleteMany({
      where: {
        id: { in: ids },
        userId: req.user!.id,
      },
    });

    res.json({ deleted: result.count });
  } catch (err) {
    console.error('[Accounts] Bulk delete error:', err);
    res.status(500).json({ error: 'Ошибка при массовом удалении' });
  }
});

// ── POST /warmup — start warmup for accounts ────────────────
router.post('/warmup', async (req: Request, res: Response) => {
  try {
    const { ids, warmupDays } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'Выберите хотя бы один аккаунт' });
      return;
    }

    // Validate warmupDays if provided (3-21 days, default 10)
    const days = warmupDays ? Math.max(3, Math.min(21, Math.floor(Number(warmupDays)))) : 10;

    // Mark accounts as WARMING_UP and set warmupStartedAt
    await prisma.socialAccount.updateMany({
      where: {
        id: { in: ids },
        userId: req.user!.id,
        warmupStartedAt: null, // don't restart already warming accounts
      },
      data: {
        status: 'WARMING_UP',
        warmupDays: days,
        warmupStartedAt: new Date(),
      },
    });

    // Create task for BullMQ
    const task = await prisma.task.create({
      data: {
        userId: req.user!.id,
        type: 'WARMUP',
        config: { accountIds: ids, threads: 3, warmupDays: days },
      },
    });

    res.status(201).json({ task });
  } catch (err) {
    console.error('[Accounts] Quick warmup error:', err);
    res.status(500).json({ error: 'Ошибка при запуске прогрева' });
  }
});

// ── POST /cookies — refresh cookies for accounts ────────────
router.post('/cookies', async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'Выберите хотя бы один аккаунт' });
      return;
    }

    const task = await prisma.task.create({
      data: {
        userId: req.user!.id,
        type: 'COOKIES',
        config: { accountIds: ids, threads: 3 },
      },
    });

    res.status(201).json({ task });
  } catch (err) {
    console.error('[Accounts] Quick cookies error:', err);
    res.status(500).json({ error: 'Ошибка при запуске обновления cookies' });
  }
});

export default router;
