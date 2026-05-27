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
// Output MUST be valid AccountFingerprint (worker validates at load time).

function generateFingerprint(accountId: string, geo?: { country?: string; city?: string }) {
  const hash = crypto.createHash('sha256').update(accountId).digest();

  // --- OS selection (weighted like real traffic) ---
  const osRoll = hash[0] % 100;
  const platform: 'Win32' | 'MacIntel' | 'Linux x86_64' =
    osRoll < 72 ? 'Win32' : osRoll < 92 ? 'MacIntel' : 'Linux x86_64';

  // --- Screen resolutions per OS ---
  const resolutions: Record<string, Array<{ w: number; h: number }>> = {
    Win32: [
      { w: 1920, h: 1080 }, { w: 1366, h: 768 },
      { w: 2560, h: 1440 }, { w: 1536, h: 864 }, { w: 1440, h: 900 },
    ],
    MacIntel: [
      { w: 1440, h: 900 }, { w: 1680, h: 1050 },
      { w: 1920, h: 1080 }, { w: 2560, h: 1600 },
    ],
    'Linux x86_64': [
      { w: 1920, h: 1080 }, { w: 2560, h: 1440 }, { w: 1366, h: 768 },
    ],
  };

  const pool = resolutions[platform];
  const screen = pool[hash[1] % pool.length];

  // --- Viewport: screen minus realistic chrome (80-119px) ---
  const viewport = {
    width: screen.w,
    height: screen.h - (80 + (hash[2] % 40)),
  };

  // --- WebGL per OS (must be coherent) ---
  const gpus: Record<string, Array<{ vendor: string; renderer: string }>> = {
    Win32: [
      { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
      { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)' },
    ],
    MacIntel: [
      { vendor: 'Apple Inc.', renderer: 'Apple M1' },
      { vendor: 'Apple Inc.', renderer: 'Apple M2' },
    ],
    'Linux x86_64': [
      { vendor: 'Mesa', renderer: 'Mesa Intel(R) UHD Graphics 620 (KBL GT2)' },
      { vendor: 'Mesa/X.org', renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' },
    ],
  };
  const webgl = gpus[platform][hash[3] % gpus[platform].length];

  // --- Locale / timezone from geo ---
  const localeByCountry: Record<string, string> = {
    US: 'en-US', GB: 'en-GB', DE: 'de-DE', FR: 'fr-FR',
    RU: 'ru-RU', KZ: 'ru-KZ', UA: 'uk-UA', JP: 'ja-JP',
    BR: 'pt-BR', IN: 'en-IN', AU: 'en-AU',
  };
  const locale = localeByCountry[geo?.country ?? 'US'] ?? 'en-US';
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // --- UA (Chrome version pinned to 148 — stable default) ---
  const chromeMajor = 148;
  const osTokens: Record<string, string> = {
    Win32: 'Windows NT 10.0; Win64; x64',
    MacIntel: 'Macintosh; Intel Mac OS X 10_15_7',
    'Linux x86_64': 'X11; Linux x86_64',
  };
  const userAgent =
    `Mozilla/5.0 (${osTokens[platform]}) AppleWebKit/537.36 ` +
    `(KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`;

  // --- Hardware (deviceMemory capped at 8 by Chrome) ---
  const hwConcurrency = ([4, 6, 8, 8, 8, 12, 16] as const)[hash[4] % 7];
  const deviceMemory = ([4, 8, 8, 8] as const)[hash[5] % 4];

  // --- Fonts per OS ---
  const fontPools: Record<string, string[]> = {
    Win32: ['Arial', 'Calibri', 'Cambria', 'Consolas', 'Courier New', 'Georgia', 'Segoe UI', 'Tahoma'],
    MacIntel: ['Helvetica Neue', 'San Francisco', 'Menlo', 'Monaco', 'Avenir', 'Geneva'],
    'Linux x86_64': ['DejaVu Sans', 'DejaVu Serif', 'Liberation Sans', 'Liberation Mono', 'Ubuntu', 'Noto Sans'],
  };
  const fonts = fontPools[platform].slice(0, 6 + (hash[6] % 3));

  return {
    userAgent,
    platform,
    screen: { width: screen.w, height: screen.h, colorDepth: 24 as const },
    viewport,
    devicePixelRatio: platform === 'MacIntel' ? 2 : 1,
    locale,
    timezone,
    hardwareConcurrency: hwConcurrency,
    deviceMemory,
    maxTouchPoints: 0 as const,
    webgl,
    canvas: { seed: hash.subarray(7, 15).toString('hex') },
    fonts,
    chromeMajor,
  };
}

// ── GET / — list all accounts for current user ──────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    const accounts = await prisma.socialAccount.findMany({
      where: { userId: req.user!.id },
      include: {
        pinnedProxy: {
          select: { id: true, address: true, label: true, type: true, carrier: true, country: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Strip encrypted cookie data from response (never send to frontend)
    const sanitized = accounts.map((a: typeof accounts[number]) => {
      const warmupDay = a.warmupStartedAt
        ? Math.min(
            (a.warmupDays ?? 10) + 1,
            Math.ceil((Date.now() - new Date(a.warmupStartedAt).getTime()) / 86_400_000),
          )
        : null;

      // Compute remaining days in the 14-day pin window (frontend uses this for badge)
      const pinDaysRemaining = a.proxyPinnedAt
        ? Math.max(0, Math.ceil(14 - (Date.now() - new Date(a.proxyPinnedAt).getTime()) / 86_400_000))
        : null;

      return {
        ...a,
        // strip secrets — never expose any of these
        cookiesEncrypted: undefined,
        cookiesIv: undefined,
        cookiesAuthTag: undefined,
        // computed flags
        hasCookies: !!a.cookiesEncrypted,
        warmupDay,
        warmupDays: a.warmupDays,
        pinDaysRemaining,
        // expose proxy under both names so frontend doesn't break during rename
        proxy: a.pinnedProxy,        // kept for legacy frontend
        pinnedProxy: a.pinnedProxy,  // canonical
      };
    });

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
            action: "proxy.pin.force_override",
            ip: req.ip ?? null,
            details: {
              entityType: "SocialAccount",
              entityId: existing.id,
              violation: violation.code,
              oldProxyId: oldProxy?.id ?? null,
              newProxyId: newProxy.id,
              oldCarrier: violation.oldCarrier ?? null,
              newCarrier: violation.newCarrier ?? null,
              oldCountry: violation.oldCountry ?? null,
              newCountry: violation.newCountry ?? null,
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
    // NOTE: pinnedProxyId is intentionally REMOVED here. Proxy reassignment
    // must go through POST /bulk-proxy which enforces the carrier stability
    // rule (validatePinChange). Allowing it here would silently bypass the
    // 14-day pin window and carrier/country guards.
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

    // Phase 1: validate ALL accounts before mutating anything.
    type Plan = {
      accountId: string;
      violation: ReturnType<typeof validatePinChange>;
      oldProxyId: string | null;
    };
    const plans: Plan[] = [];

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
      plans.push({ accountId, violation, oldProxyId: oldProxy?.id ?? null });
    }

    // If any violation exists and force is false, reject the WHOLE batch.
    const blockers = plans.filter(p => p.violation);
    if (blockers.length > 0 && !force) {
      res.status(409).json({
        success: false,
        code: blockers[0].violation!.code,
        error: `${blockers.length} аккаунт(ов) заблокированы Carrier Stability Rule. ` +
               `Используйте force=true (только ADMIN) для override.`,
        blockedAccountIds: blockers.map(b => b.accountId),
        violations: blockers.map(b => ({
          accountId: b.accountId,
          code: b.violation!.code,
          message: b.violation!.message,
          details: {
            daysRemaining: b.violation!.daysRemaining,
            oldCarrier: b.violation!.oldCarrier,
            newCarrier: b.violation!.newCarrier,
            oldCountry: b.violation!.oldCountry,
            newCountry: b.violation!.newCountry,
          },
        })),
      });
      return;
    }

    // Phase 2: atomic write + AuditLog for every force-overridden violation.
    await prisma.$transaction(async (tx: typeof prisma) => {
      const now = new Date();
      for (const plan of plans) {
        if (plan.violation && force) {
          await tx.auditLog.create({
            data: {
              userId: req.user!.id,
              action: "proxy.pin.force_override",
              ip: req.ip ?? null,
              details: {
                entityType: "SocialAccount",
                entityId: plan.accountId,
                violation: plan.violation.code,
                oldProxyId: plan.oldProxyId,
                newProxyId: newProxy.id,
                oldCarrier: plan.violation.oldCarrier ?? null,
                newCarrier: plan.violation.newCarrier ?? null,
                oldCountry: plan.violation.oldCountry ?? null,
                newCountry: plan.violation.newCountry ?? null,
              },
            },
          });
        }
        await tx.socialAccount.update({
          where: { id: plan.accountId },
          data: { pinnedProxyId: newProxy.id, proxyPinnedAt: now },
        });
      }
    });

    res.json({
      updated: plans.length,
      forcedOverrides: plans.filter(p => p.violation).length,
    });
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
