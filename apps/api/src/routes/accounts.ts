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
import { generateFingerprint, generateMobileFingerprint } from '../lib/fingerprint.js';
import { publishVerificationCode, publishResendCommand } from '../lib/redis-pubsub.js';
import { dispatchAccountJob, type DispatchedJob } from '../lib/job-dispatch.js';
import { hasCompletedWarmupMismatch, normalizeWarmupComments, normalizeWarmupDays } from '../lib/warmup-state.js';

const router = Router();
router.use(authMiddleware);

type LoginMode = 'credentials' | 'cookies';
type LoginTaskSource = 'account_import' | 'retry_login';

function buildLoginTaskConfig(
  accountId: string,
  mode: LoginMode,
  source: LoginTaskSource,
  result?: DispatchedJob,
) {
  const dispatchedJobs = result
    ? [{
        accountId: result.accountId,
        jobId: result.jobId,
        ...(result.error ? { error: result.error } : {}),
      }]
    : undefined;

  return {
    mode,
    source,
    accountIds: [accountId],
    threads: 1,
    ...(dispatchedJobs ? { dispatchedJobs } : {}),
  };
}

function loginDispatchErrorMessage(error?: string) {
  if (error === 'NO_PROXY') {
    return 'Не удалось запустить проверку входа: к аккаунту должен быть привязан прокси. Подходит LTE_MOBILE или STATIC_RESIDENTIAL.';
  }
  return `Не удалось запустить верификацию входа: ${error || 'unknown error'}`;
}

async function createLoginMonitorTask(
  userId: string,
  accountId: string,
  mode: LoginMode,
  source: LoginTaskSource,
) {
  return prisma.task.create({
    data: {
      userId,
      type: 'LOGIN',
      accountId,
      config: buildLoginTaskConfig(accountId, mode, source),
    },
  });
}

async function finalizeLoginMonitorTask(
  taskId: string,
  accountId: string,
  mode: LoginMode,
  source: LoginTaskSource,
  result: DispatchedJob,
) {
  const config = buildLoginTaskConfig(accountId, mode, source, result);
  if (result.jobId) {
    await prisma.task.update({
      where: { id: taskId },
      data: {
        bullmqJobId: result.jobId,
        config,
      },
    });
    return;
  }

  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: 'FAILED',
      error: loginDispatchErrorMessage(result.error),
      config,
    },
  });
}

// POST /:id/regenerate-fingerprint
const regenSchema = z.object({
  deviceClass: z.enum(['desktop', 'mobile']),
});

router.post('/:id/regenerate-fingerprint', async (req: Request, res: Response) => {
  try {
    const parsed = regenSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const account = await prisma.socialAccount.findFirst({
      where: { id: (req.params.id as string), userId: req.user!.id },
    });
    if (!account) {
      res.status(404).json({ error: 'Аккаунт не найден' });
      return;
    }

    // GUARD: only allow fingerprint regen on accounts that haven't published yet.
    // Changing fingerprint on a published account resets TikTok's identity correlation
    // and triggers shadowban almost certainly.
    const publishedCount = await prisma.videoPublication.count({
      where: { accountId: account.id, status: 'UPLOADED' },
    });
    if (publishedCount > 0 && req.query.force !== 'true') {
      res.status(409).json({
        error: 'Аккаунт уже публиковал видео. Смена fingerprint после публикации = shadowban. Используйте ?force=true (ADMIN only) для override.',
        code: 'PUBLISHED_VIDEOS_EXIST',
      });
      return;
    }

    // M-2 FIX: Only ADMIN can force fingerprint regen on published accounts
    if (publishedCount > 0 && req.query.force === 'true' && req.user!.role !== 'ADMIN') {
      res.status(403).json({
        error: 'Только администратор может принудительно сменить fingerprint на опубликованном аккаунте',
        code: 'ADMIN_ONLY',
      });
      return;
    }

    let geo = { country: 'US', city: 'New York' };
    if (account.pinnedProxyId) {
      const proxy = await prisma.proxy.findUnique({
        where: { id: account.pinnedProxyId },
        select: { country: true }
      });
      if (proxy && proxy.country) {
        geo.country = proxy.country;
        if (proxy.country === 'DE') geo.city = 'Berlin';
        else if (proxy.country === 'GB') geo.city = 'London';
        else geo.city = '';
      }
    }
    
    const newFp = parsed.data.deviceClass === 'mobile'
      ? generateMobileFingerprint(account.id, geo)
      : generateFingerprint(account.id, geo);

    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { fingerprint: newFp as any, fingerprintStale: false },
    });

    res.json({ success: true, deviceClass: parsed.data.deviceClass });
  } catch (err) {
    console.error('[Accounts] Regenerate fingerprint error:', err);
    res.status(500).json({ error: 'Ошибка при пересоздании fingerprint' });
  }
});

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

// ── GET / — list all accounts for current user ──────────────
router.get('/', async (req: Request, res: Response) => {
  try {
    await prisma.socialAccount.updateMany({
      where: {
        userId: req.user!.id,
        status: 'WARMING_UP',
        warmupCompletedAt: { not: null },
      },
      data: {
        status: 'ALIVE',
        lastError: null,
      },
    });

    // Optional pagination (backwards-compatible: frontend can omit these)
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 200));
    const skip = (page - 1) * limit;

    const accounts = await prisma.socialAccount.findMany({
      where: { userId: req.user!.id },
      include: {
        pinnedProxy: {
          select: { id: true, host: true, port: true, label: true, type: true, carrier: true, country: true },
        },
        _count: { select: { videoPublications: { where: { status: 'UPLOADED' } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip,
    });

    // Strip encrypted cookie data from response (never send to frontend)
    const sanitized = accounts.map((a: typeof accounts[number]) => {
      const warmupDay = a.warmupCompletedAt
        ? a.warmupDays ?? 10
        : a.warmupStartedAt
        ? Math.min(
            a.warmupDays ?? 10,
            Math.ceil((Date.now() - new Date(a.warmupStartedAt).getTime()) / 86_400_000),
          )
        : null;

      // Compute remaining days in the 14-day pin window (frontend uses this for badge)
      const pinDaysRemaining = a.proxyPinnedAt
        ? Math.max(0, Math.ceil(14 - (Date.now() - new Date(a.proxyPinnedAt).getTime()) / 86_400_000))
        : null;

      return {
        ...a,
        status: hasCompletedWarmupMismatch(a) ? 'ALIVE' : a.status,
        login: a.username ?? a.nickname ?? null,
        videos: a._count.videoPublications,
        platform: a.platform,
        // strip secrets — never expose any of these
        cookiesEncrypted: undefined,
        cookiesIv: undefined,
        cookiesAuthTag: undefined,
        loginEncrypted: undefined,
        loginIv: undefined,
        loginAuthTag: undefined,
        password: undefined,
        passwordEncrypted: undefined,
        passwordIv: undefined,
        passwordAuthTag: undefined,
        fingerprint: undefined,
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

const bulkImportSchema = z.object({
  platform: z.enum(['TIKTOK', 'YOUTUBE']),
  data: z.string().min(1, 'Данные обязательны').optional(),
  raw: z.string().min(1).optional(),
  authMode: z.enum(['cookies', 'login_pass', 'auto']).default('auto'),
  method: z.enum(['cookies', 'credentials']).optional(),
  proxyId: z.string().optional(),
}).refine(d => d.data || d.raw, { message: 'Данные обязательны (data или raw)' });


/**
 * Parses bulk import text. Supports three formats per line:
 * 1. login:password
 * 2. login:password:cookies_json_or_netscape
 * 3. {raw cookies JSON or Netscape, one account per import}
 *
 * Returns list of {login?, password?, cookies?} entries.
 */
function parseBulkImport(text: string, mode: 'cookies' | 'login_pass' | 'auto'): Array<{
  login?: string;
  password?: string;
  cookies?: string;
}> {
  const trimmed = text.trim();

  // Try whole-text as cookies JSON first (single account)
  if (mode === 'cookies' || (mode === 'auto' && (trimmed.startsWith('[') || trimmed.startsWith('{')))) {
    try {
      JSON.parse(trimmed);
      return [{ cookies: trimmed }];
    } catch { /* not JSON, fall through */ }
  }

  // Try whole-text as Netscape format
  if (mode === 'cookies' || mode === 'auto') {
    const isNetscape = trimmed.split('\n').some(l => l.includes('\t') && l.split('\t').length >= 7);
    if (isNetscape) {
      return [{ cookies: trimmed }];
    }
  }

  // Line-by-line: login:password OR login:password:cookies
  const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
  const result: Array<{ login?: string; password?: string; cookies?: string }> = [];

  for (const line of lines) {
    if (line.startsWith('#')) continue;  // comment

    // BUG-15 fix: passwords can contain ':' — use indexOf for first split only
    const firstColon = line.indexOf(':');
    if (firstColon === -1) continue; // skip malformed lines

    const login = line.slice(0, firstColon);
    const rest = line.slice(firstColon + 1);

    if (mode === 'login_pass') {
      // In credentials mode, everything after first colon is the password
      result.push({ login, password: rest });
    } else {
      // Auto/cookies mode: try to detect if rest contains cookies (JSON-like)
      // Format: login:password or login:password:cookies_json
      const secondColon = rest.indexOf(':');
      if (secondColon === -1) {
        result.push({ login, password: rest });
      } else {
        const password = rest.slice(0, secondColon);
        const cookiesPart = rest.slice(secondColon + 1);
        // If cookies part looks like JSON, treat as login:pass:cookies
        if (cookiesPart.trim().startsWith('[') || cookiesPart.trim().startsWith('{')) {
          result.push({ login, password, cookies: cookiesPart });
        } else {
          // Otherwise treat entire rest as password (password has ':')
          result.push({ login, password: rest });
        }
      }
    }
  }

  return result;
}

router.post('/import', async (req: Request, res: Response) => {
  try {
    const parsed = bulkImportSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { platform, data, raw, authMode, method, proxyId } = parsed.data;
    const importText = data || raw || '';
    const resolvedAuthMode: 'cookies' | 'login_pass' | 'auto' = method === 'credentials' ? 'login_pass' : method === 'cookies' ? 'cookies' : authMode;
    const entries = parseBulkImport(importText, resolvedAuthMode);

    console.log(`[Accounts] Import: method=${method}, resolvedMode=${resolvedAuthMode}, entries=${entries.length}, raw_lines=${importText.split('\\n').filter(Boolean).length}`);
    if (entries.length > 0) {
      console.log(`[Accounts] First entry keys: ${Object.keys(entries[0]).join(', ')}; has login=${!!entries[0].login}, has password=${!!entries[0].password}, has cookies=${!!entries[0].cookies}`);
    }

    if (entries.length === 0) {
      res.status(400).json({ error: 'Не удалось распарсить ни одной записи (ожидается login:password или login:password:cookies, по одной на строку)' });
      return;
    }
    if (entries.length > 500) {
      res.status(400).json({ error: 'Слишком много записей за раз (максимум 500)' });
      return;
    }
    if (!proxyId || proxyId === 'none') {
      res.status(400).json({
        error: 'Выберите прокси для импорта. Для проверки входа и любых задач к аккаунту должен быть привязан прокси: LTE_MOBILE или STATIC_RESIDENTIAL.',
      });
      return;
    }

    const masterKey = Buffer.from(process.env.MASTER_KEY ?? '', 'base64');
    if (masterKey.length !== 32) {
      console.error(`[Accounts] MASTER_KEY invalid: expected 32 bytes, got ${masterKey.length}`);
      res.status(500).json({ error: 'Ошибка конфигурации сервера: MASTER_KEY не настроен или невалидный (ожидается 32 байта base64)' });
      return;
    }

    function encryptString(plain: string) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
      const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return { encrypted, iv, authTag: cipher.getAuthTag() };
    }

    const created: string[] = [];
    const failed: Array<{ line: number; reason: string }> = [];

    // Resolve geo + device class from proxy so fingerprint matches proxy location & type
    let proxyGeo: { country?: string; city?: string } | undefined;
    let proxyIsMobile = false;
    let proxyRecord: {
      id: string;
      country: string;
      dma: string | null;
      carrier: string | null;
      type: 'LTE_MOBILE' | 'STATIC_RESIDENTIAL' | 'DATACENTER_DEPRECATED';
    } | null = null;
    if (proxyId) {
      proxyRecord = await prisma.proxy.findFirst({
        where: { id: proxyId, userId: req.user!.id },
        select: { id: true, country: true, dma: true, carrier: true, type: true },
      });
      if (!proxyRecord) {
        res.status(404).json({ error: 'Прокси не найден' });
        return;
      }

      const violation = validatePinChange({
        account: {
          id: 'new-import-account',
          platform,
          pinnedProxyId: null,
          proxyPinnedAt: null,
          createdAt: new Date(),
        },
        oldProxy: null,
        newProxy: proxyRecord,
      });
      if (violation) {
        res.status(409).json({
          success: false,
          error: violation.message,
          code: violation.code,
        });
        return;
      }

      proxyGeo = { country: proxyRecord.country ?? undefined, city: proxyRecord.dma ?? undefined };
      proxyIsMobile = proxyRecord.type === 'LTE_MOBILE';
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      try {
        // BUG-L9 fix: Use full UUID (no truncation) to preserve full entropy
        // Prisma @default(cuid()) handles auto-created accounts; imported accounts get UUID format
        const accountId = crypto.randomUUID().replace(/-/g, '');
        // All imported accounts start as VERIFYING — they become ALIVE
        // only after the worker successfully validates them.
        const data_: any = {
          id: accountId,
          userId: req.user!.id,
          platform: platform as 'TIKTOK' | 'YOUTUBE',
          username: entry.login ?? null,
          status: 'VERIFYING',
          pinnedProxyId: proxyRecord?.id ?? null,
          proxyPinnedAt: proxyRecord ? new Date() : null,
        };

        // Track import mode for login job dispatch
        let importMode: 'credentials' | 'cookies' = 'credentials';

        // Generate fingerprint — mobile if LTE_MOBILE proxy, desktop otherwise
        const fingerprint = proxyIsMobile
          ? generateMobileFingerprint(accountId, proxyGeo)
          : generateFingerprint(accountId, proxyGeo);
        data_.fingerprint = fingerprint as any;

        // Encrypt cookies if present
        if (entry.cookies) {
          importMode = 'cookies';
          // Validate cookies format (JSON or Netscape)
          let cookieJson: string;
          try {
            JSON.parse(entry.cookies);
            cookieJson = entry.cookies;
          } catch {
            // Try Netscape
            const lines = entry.cookies.split('\n').filter(l => l.trim() && !l.startsWith('#'));
            const parsedCookies = lines.map(line => {
              const parts = line.split('\t');
              if (parts.length >= 7) {
                return {
                  domain: parts[0], path: parts[2], secure: parts[3] === 'TRUE',
                  expires: parseInt(parts[4]) || 0, name: parts[5], value: parts[6],
                };
              }
              return null;
            }).filter(Boolean);
            if (parsedCookies.length === 0) {
              throw new Error('Невалидный формат cookies');
            }
            cookieJson = JSON.stringify(parsedCookies);
          }

          const { encrypted, iv, authTag } = encryptString(cookieJson);
          data_.cookiesEncrypted = encrypted as any;
          data_.cookiesIv = iv as any;
          data_.cookiesAuthTag = authTag as any;
          data_.cookiesUpdatedAt = new Date();
        } else if (entry.login && entry.password) {
          importMode = 'credentials';
          // login:pass only — store encrypted credentials
          const loginEnc = encryptString(entry.login);
          const passEnc = encryptString(entry.password);
          data_.loginEncrypted = loginEnc.encrypted as any;
          data_.loginIv = loginEnc.iv as any;
          data_.loginAuthTag = loginEnc.authTag as any;
          data_.passwordEncrypted = passEnc.encrypted as any;
          data_.passwordIv = passEnc.iv as any;
          data_.passwordAuthTag = passEnc.authTag as any;
        } else {
          throw new Error('Запись не содержит ни cookies, ни login:password');
        }

        await prisma.socialAccount.create({ data: data_ });
        const loginTask = await createLoginMonitorTask(
          req.user!.id,
          accountId,
          importMode,
          'account_import',
        );

        // Dispatch login verification job to worker
        // This runs in background — frontend tracks via Socket.io
        dispatchAccountJob({
          queueName: 'login',
          userId: req.user!.id,
          accountId,
          extra: { mode: importMode, taskId: loginTask.id },
        }).then(async (result) => {
          await finalizeLoginMonitorTask(
            loginTask.id,
            accountId,
            importMode,
            'account_import',
            result,
          );

          if (result.error) {
            const errMsg = loginDispatchErrorMessage(result.error);
            await prisma.socialAccount.update({
              where: { id: accountId },
              data: { status: 'AUTH_NEEDED', lastError: errMsg },
            });
            console.error(`[Accounts] Login dispatch failed for ${accountId}:`, result.error);
          }
        }).catch(async (err) => {
          const error = err?.message ?? String(err);
          const errMsg = loginDispatchErrorMessage(error);
          await finalizeLoginMonitorTask(
            loginTask.id,
            accountId,
            importMode,
            'account_import',
            { accountId, jobId: null, error },
          ).catch(() => {});
          await prisma.socialAccount.update({
            where: { id: accountId },
            data: { status: 'AUTH_NEEDED', lastError: errMsg },
          }).catch(() => {});
          console.error(`[Accounts] Login dispatch failed for ${accountId}:`, err);
        });
        created.push(accountId);
      } catch (err: any) {
        const reason = err.message ?? String(err);
        console.error(`[Accounts] Import line ${i + 1} failed:`, reason);
        failed.push({ line: i + 1, reason });
      }
    }
    res.status(202).json({
      created: created.length,
      failed: failed.length,
      failedDetails: failed,
      ids: created,
      message: `${created.length} аккаунтов отправлены на верификацию. Следите за статусом в реальном времени.`,
    });
  } catch (err) {
    console.error('[Accounts] Bulk import error:', err);
    res.status(500).json({ error: 'Ошибка при импорте аккаунтов' });
  }
});

// ── POST /:id/verify-code — submit 2FA code from user ────────
// IMPORTANT: Defined before /:id PATCH/DELETE to avoid route shadowing
router.post('/:id/verify-code', async (req: Request, res: Response) => {
  try {
    const { code } = req.body;
    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      res.status(400).json({ error: 'Код подтверждения обязателен' });
      return;
    }

    // Verify account belongs to user
    const account = await prisma.socialAccount.findFirst({
      where: { id: String(req.params.id), userId: req.user!.id },
    });
    if (!account) {
      res.status(404).json({ error: 'Аккаунт не найден' });
      return;
    }

    // Publish code to Redis for the worker to pick up
    await publishVerificationCode(String(req.params.id), code.trim());

    res.json({ success: true, message: 'Код отправлен воркеру' });
  } catch (err) {
    console.error('[Accounts] Verify code error:', err);
    res.status(500).json({ error: 'Ошибка при отправке кода' });
  }
});

// ── POST /:id/resend-code — request code resend from worker ──
router.post('/:id/resend-code', async (req: Request, res: Response) => {
  try {
    // Verify account belongs to user
    const account = await prisma.socialAccount.findFirst({
      where: { id: String(req.params.id), userId: req.user!.id },
    });
    if (!account) {
      res.status(404).json({ error: 'Аккаунт не найден' });
      return;
    }

    // Send RESEND command to worker via Redis
    await publishResendCommand(String(req.params.id));

    res.json({ success: true, message: 'Запрос на повторную отправку кода отправлен' });
  } catch (err) {
    console.error('[Accounts] Resend code error:', err);
    res.status(500).json({ error: 'Ошибка при запросе повторной отправки' });
  }
});

// ── POST /:id/retry-login — retry login verification ─────────
router.post('/:id/retry-login', async (req: Request, res: Response) => {
  try {
    const account = await prisma.socialAccount.findFirst({
      where: { id: String(req.params.id), userId: req.user!.id },
    });
    if (!account) {
      res.status(404).json({ error: 'Аккаунт не найден' });
      return;
    }

    const retryableStatuses = ['AUTH_NEEDED', 'EXPIRED_COOKIES'];
    const isBanned = account.status === 'BANNED';
    const forceRetry = req.query.force === 'true';

    if (isBanned && !forceRetry) {
      res.status(400).json({
        error: 'Аккаунт заблокирован. Повторный вход маловероятно поможет. Добавьте ?force=true для принудительной попытки.',
        status: account.status,
      });
      return;
    }

    if (!isBanned && !retryableStatuses.includes(account.status)) {
      res.status(400).json({ error: 'Повторный вход доступен только для аккаунтов со статусом AUTH_NEEDED или EXPIRED_COOKIES' });
      return;
    }

    // Determine mode: if has encrypted login → credentials, else → cookies
    const hasCredentials = !!account.loginEncrypted;
    const hasCookies = !!account.cookiesEncrypted;
    const mode = hasCredentials ? 'credentials' : hasCookies ? 'cookies' : null;

    if (!mode) {
      res.status(400).json({ error: 'Аккаунт не содержит ни логин:пароль, ни cookies для повторного входа' });
      return;
    }

    const previousStatus = account.status;

    // Set status back to VERIFYING
    await prisma.socialAccount.update({
      where: { id: account.id },
      data: { status: 'VERIFYING' },
    });

    const loginTask = await createLoginMonitorTask(
      req.user!.id,
      account.id,
      mode,
      'retry_login',
    );

    // Dispatch login job
    const result = await dispatchAccountJob({
      queueName: 'login',
      userId: req.user!.id,
      accountId: account.id,
      extra: { mode, taskId: loginTask.id },
    });
    await finalizeLoginMonitorTask(
      loginTask.id,
      account.id,
      mode,
      'retry_login',
      result,
    );

    if (result.error) {
      const errMsg = loginDispatchErrorMessage(result.error);
      await prisma.socialAccount.update({
        where: { id: account.id },
        data: {
          status: previousStatus,
          lastError: errMsg,
        },
      });
      res.status(400).json({ error: errMsg });
      return;
    }

    res.json({
      success: true,
      jobId: result.jobId,
      taskId: loginTask.id,
      workspaceUrl: '/account/workspace',
      message: 'Повторная верификация запущена',
    });
  } catch (err) {
    console.error('[Accounts] Retry login error:', err);
    res.status(500).json({ error: 'Ошибка при повторном входе' });
  }
});

// ── POST /:id/cookies — re-import cookies for existing account
router.post('/:id/cookies', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.socialAccount.findFirst({
      where: { id: (req.params.id as string), userId: req.user!.id },
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
      where: { id: (req.params.id as string) },
      data: {
        cookiesEncrypted: encrypted as any,
        cookiesIv: iv as any,
        cookiesAuthTag: authTag as any,
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

// ── PATCH /bulk — mass update accounts ──────────────────────
// IMPORTANT: Must be defined BEFORE /:id to prevent Express from
// matching 'bulk' as the :id parameter.
const bulkUpdateSchema = z.object({
  accountIds: z.array(z.string()).min(1),
  update: z.object({
    avatarUrl: z.string().optional(),
    bannerUrl: z.string().optional(),
    bio: z.string().optional(),
    status: z.enum(['ALIVE', 'AUTH_NEEDED', 'BANNED', 'EXPIRED_COOKIES', 'SHADOWBAN_SUSPECTED', 'WARMING_UP', 'PAUSED', 'VERIFYING']).optional(),
  }),
});

router.patch('/bulk', async (req: Request, res: Response) => {
  try {
    const parsed = bulkUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { accountIds, update } = parsed.data;
    const force = req.query.force === 'true' && req.user!.role === 'ADMIN';

    if (update.status) {
      const ownedAccounts = await prisma.socialAccount.findMany({
        where: {
          id: { in: accountIds },
          userId: req.user!.id,
        },
        select: { id: true, status: true },
      });

      const dangerousOrigins = ['BANNED', 'SHADOWBAN_SUSPECTED'];
      const safeTargets = ['PAUSED'];
      const bulkStatusBlockers = ownedAccounts.filter(account =>
        dangerousOrigins.includes(account.status)
        && !safeTargets.includes(update.status!)
        && update.status !== account.status,
      );

      if (bulkStatusBlockers.length > 0 && !force) {
        res.status(409).json({
          error: `Cannot bulk change ${bulkStatusBlockers.length} protected account(s) to ${update.status}. ` +
            `Use admin force override (?force=true) or re-verify account cookies first.`,
          code: 'DANGEROUS_STATUS_TRANSITION',
          blockedAccountIds: bulkStatusBlockers.map(account => account.id),
        });
        return;
      }

      if (bulkStatusBlockers.length > 0 && force) {
        await prisma.$transaction(
          bulkStatusBlockers.map(account => prisma.auditLog.create({
            data: {
              userId: req.user!.id,
              action: 'account.status.force_override',
              ip: req.ip ?? null,
              details: {
                entityType: 'SocialAccount',
                entityId: account.id,
                fromStatus: account.status,
                toStatus: update.status,
              },
            },
          })),
        );
      }
    }

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

// ── PATCH /bulk/proxy — dedicated bulk proxy binding ─────────
const bulkProxySchema = z.object({
  accountIds: z.array(z.string()).min(1, 'Выберите хотя бы один аккаунт'),
  proxyId: z.string().min(1, 'Выберите прокси'),
});

router.patch('/bulk/proxy', async (req: Request, res: Response) => {
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

    const blockers = plans.filter(p => p.violation);
    const hardBlockers = blockers.filter(p => !p.violation!.overrideAllowed);
    if (blockers.length > 0 && (!force || hardBlockers.length > 0)) {
      const firstBlocker = hardBlockers[0] ?? blockers[0];
      res.status(409).json({
        success: false,
        code: firstBlocker.violation!.code,
        error: firstBlocker.violation!.message,
        blockedAccountIds: blockers.map(b => b.accountId),
        violations: blockers.map(b => ({
          accountId: b.accountId,
          code: b.violation!.code,
          overrideAllowed: b.violation!.overrideAllowed,
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

    await prisma.$transaction(async (tx: any) => {
      const now = new Date();
      for (const plan of plans) {
        if (plan.violation && force && plan.violation.overrideAllowed) {
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

// ── PATCH /:id — update single account ──────────────────────
const patchAccountSchema = z.object({
  username: z.string().min(1).optional(),
  nickname: z.string().optional(),
  bio: z.string().optional(),
  defaultDescription: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  bannerUrl: z.string().url().optional(),
  pinnedProxyId: z.string().nullable().optional(),
  status: z.enum([
    'ALIVE', 'PAUSED', 'BANNED', 'EXPIRED_COOKIES',
    'WARMING_UP', 'SHADOWBAN_SUSPECTED', 'AUTH_NEEDED', 'VERIFYING',
  ]).optional(),
  secUid: z.string().optional(),
  warmupDays: z.number().int().min(1).max(21).optional(),
}).strict();

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const parsed = patchAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const existing = await prisma.socialAccount.findFirst({
      where: { id: (req.params.id as string), userId: req.user!.id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Аккаунт не найден' });
      return;
    }

    // Build update data from validated fields
    const updateData: Record<string, unknown> = { ...parsed.data };

    // Clamp warmupDays to valid range (1-21)
    if (updateData.warmupDays !== undefined) {
      updateData.warmupDays = Math.max(1, Math.min(21, Math.floor(Number(updateData.warmupDays))));
    }

    // BUG-H5 fix: Guard dangerous status transitions
    // Prevent resetting BANNED/SHADOWBAN_SUSPECTED to ALIVE without admin force
    if (updateData.status) {
      const dangerousOrigins = ['BANNED', 'SHADOWBAN_SUSPECTED'];
      const safeTargets = ['PAUSED']; // Users can pause a banned account
      const currentStatus = existing.status;

      if (
        dangerousOrigins.includes(currentStatus) &&
        !safeTargets.includes(updateData.status as string) &&
        updateData.status !== currentStatus
      ) {
        const isAdminForce = req.query.force === 'true' && req.user!.role === 'ADMIN';
        if (!isAdminForce) {
          res.status(409).json({
            error: `Cannot change status from ${currentStatus} to ${updateData.status}. ` +
              `Use admin force override (?force=true) or re-verify account cookies first.`,
            code: 'DANGEROUS_STATUS_TRANSITION',
          });
          return;
        }
      }
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

      if (violation && (!force || !violation.overrideAllowed)) {
        res.status(409).json({
          success: false,
          error: violation.message,
          code: violation.code,
          overrideAllowed: violation.overrideAllowed,
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

      if (violation && force && violation.overrideAllowed) {
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
      where: { id: (req.params.id as string) },
      data: updateData,
    });

    res.json({
      account: {
        ...account,
        cookiesEncrypted: undefined,
        cookiesIv: undefined,
        cookiesAuthTag: undefined,
        loginEncrypted: undefined,
        loginIv: undefined,
        loginAuthTag: undefined,
        password: undefined,
        passwordEncrypted: undefined,
        passwordIv: undefined,
        passwordAuthTag: undefined,
      },
    });
  } catch (err) {
    console.error('[Accounts] Update error:', err);
    res.status(500).json({ error: 'Ошибка при обновлении аккаунта' });
  }
});

// ── DELETE /bulk — mass delete accounts ─────────────────────
// IMPORTANT: Must be defined BEFORE /:id to prevent Express from
// matching 'bulk' as the :id parameter.
// Also available as POST /bulk-delete for proxies that strip DELETE bodies (M-5)
const bulkDeleteHandler = async (req: Request, res: Response) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'Выберите хотя бы один аккаунт' });
      return;
    }

    // H-5 FIX: Cancel pending tasks for these accounts before deleting
    await prisma.task.updateMany({
      where: {
        userId: req.user!.id,
        accountId: { in: ids },
        status: { in: ['PENDING', 'RUNNING'] },
      },
      data: { status: 'CANCELLED' },
    });

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
};

router.delete('/bulk', bulkDeleteHandler);
router.post('/bulk-delete', bulkDeleteHandler);  // M-5: proxy-safe alternative

// ── DELETE /:id ─────────────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await prisma.socialAccount.findFirst({
      where: { id: (req.params.id as string), userId: req.user!.id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Аккаунт не найден' });
      return;
    }

    await prisma.socialAccount.delete({ where: { id: (req.params.id as string) } });
    res.json({ success: true });
  } catch (err) {
    console.error('[Accounts] Delete error:', err);
    res.status(500).json({ error: 'Ошибка при удалении аккаунта' });
  }
});

// NOTE: PATCH /bulk and PATCH /bulk/proxy are defined above PATCH /:id
// to prevent Express route shadowing.

// ── POST /warmup — start warmup for accounts ────────────────
router.post('/warmup', async (req: Request, res: Response) => {
  try {
    const { ids, warmupDays, hashtags: rawHashtags, comments: rawComments } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'Выберите хотя бы один аккаунт' });
      return;
    }

    // Validate warmupDays if provided (1-21 days, default 10)
    const days = normalizeWarmupDays(warmupDays);
    // Validate hashtags if provided
    const hashtags: string[] = Array.isArray(rawHashtags)
      ? rawHashtags.map((h: string) => String(h).replace(/^#/, '').trim()).filter(Boolean)
      : [];
    const comments = normalizeWarmupComments(rawComments);

    // Create task for BullMQ
    const accountId = ids.length === 1 ? ids[0] : null;
    const task = await prisma.task.create({
      data: {
        userId: req.user!.id,
        type: 'WARMUP',
        config: { accountIds: ids, threads: 3, warmupDays: days, hashtags, comments },
        accountId,
      },
    });

    // Dispatch warmup jobs to BullMQ for each account
    const results = await Promise.all(
      ids.map(async (accountId: string, index: number) =>
        dispatchAccountJob({
          queueName: 'warmup',
          userId: req.user!.id,
          accountId,
          extra: { taskId: task.id, warmupDays: days, hashtags, comments },
          delay: 1000 + index * 5000, // give DB state a moment to persist before worker starts
        }),
      ),
    );

    const dispatched = results.filter(r => r.jobId).length;
    const dispatchedAccountIds = results.filter(r => r.jobId).map(r => r.accountId);
    const failures = results.filter(r => !r.jobId);

    if (dispatched === 0) {
      let error = 'Не удалось запустить прогрев: аккаунты не прошли pre-flight проверки';
      if (failures.some(f => f.error === 'NO_PROXY')) {
        error = 'Не удалось запустить прогрев: у аккаунтов нет привязанного прокси. Подходит LTE_MOBILE или STATIC_RESIDENTIAL.';
      } else if (failures.some(f => f.error === 'NO_COOKIES')) {
        error = 'Не удалось запустить прогрев: нет валидных cookies. Сначала выполните авторизацию или импорт cookies.';
      } else if (failures.some(f => f.error === 'NO_FINGERPRINT')) {
        error = 'Не удалось запустить прогрев: не сгенерирован fingerprint аккаунта.';
      } else if (failures.some(f => f.error?.startsWith('ACCOUNT_BUSY'))) {
        error = 'Аккаунт уже выполняет другую browser-задачу. Дождитесь завершения и повторите запуск.';
      } else if (failures.some(f => f.error?.startsWith('ACCOUNT_'))) {
        error = 'Аккаунт сейчас в статусе, который запрещает прогрев. Проверьте статус и последнюю ошибку аккаунта.';
      }

      const failedTask = await prisma.task.update({
        where: { id: task.id },
        data: {
          status: 'FAILED',
          error,
          completedAt: new Date(),
          config: { accountIds: ids, threads: 3, warmupDays: days, hashtags, comments, dispatchedJobs: results } as any,
        },
      });

      res.status(409).json({ error, task: failedTask, dispatched, skipped: failures.length, failures });
      return;
    }

    if (dispatchedAccountIds.length > 0) {
      await prisma.socialAccount.updateMany({
        where: { id: { in: dispatchedAccountIds }, userId: req.user!.id },
        data: {
          status: 'WARMING_UP',
          warmupDays: days,
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
        bullmqJobId: results.find(r => r.jobId)?.jobId ?? null,
        status: dispatched > 0 ? 'PENDING' : 'FAILED',
        config: { accountIds: ids, threads: 3, warmupDays: days, hashtags, comments, dispatchedJobs: results } as any,
      },
    });

    res.status(201).json({ task, dispatched, skipped: failures.length, failures });
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

    const accountId = ids.length === 1 ? ids[0] : null;
    const task = await prisma.task.create({
      data: {
        userId: req.user!.id,
        type: 'COOKIES',
        config: { accountIds: ids, threads: 3 },
        accountId,
      },
    });

    const results = await Promise.all(
      ids.map(async (accountId: string, index: number) =>
        dispatchAccountJob({
          queueName: 'cookies',
          userId: req.user!.id,
          accountId,
          extra: { taskId: task.id },
          delay: index * 3000,
        }),
      ),
    );

    const dispatched = results.filter(r => r.jobId).length;
    const failures = results.filter(r => !r.jobId);
    if (dispatched === 0) {
      let error = 'Не удалось запустить обновление cookies: аккаунты не прошли pre-flight проверки';
      if (failures.some(f => f.error === 'NO_PROXY')) {
        error = 'Не удалось запустить обновление cookies: к аккаунту должен быть привязан прокси. Подходит LTE_MOBILE или STATIC_RESIDENTIAL.';
      } else if (failures.some(f => f.error === 'NO_FINGERPRINT')) {
        error = 'Не удалось запустить обновление cookies: не сгенерирован fingerprint аккаунта.';
      } else if (failures.some(f => f.error?.startsWith('ACCOUNT_BUSY'))) {
        error = 'Аккаунт уже выполняет другую browser-задачу. Дождитесь завершения и повторите запуск.';
      }

      const failedTask = await prisma.task.update({
        where: { id: task.id },
        data: {
          status: 'FAILED',
          error,
          completedAt: new Date(),
          config: { accountIds: ids, threads: 3, dispatchedJobs: results } as any,
        },
      });
      res.status(409).json({ error, task: failedTask, dispatched, skipped: failures.length, failures });
      return;
    }

    await prisma.task.update({
      where: { id: task.id },
      data: {
        bullmqJobId: results.find(r => r.jobId)?.jobId ?? null,
        status: dispatched > 0 ? 'PENDING' : 'FAILED',
        config: { accountIds: ids, threads: 3, dispatchedJobs: results } as any,
      },
    });

    res.status(201).json({ task, dispatched, skipped: failures.length, failures });
  } catch (err) {
    console.error('[Accounts] Quick cookies error:', err);
    res.status(500).json({ error: 'Ошибка при запуске обновления cookies' });
  }
});

export default router;
