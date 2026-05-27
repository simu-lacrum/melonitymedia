# PROMPT: MelonityMedia Audit Pack 3 — Critical Fixes After Code Review

**Role.** You are a senior backend engineer. The codebase was audited against the SoT documentation, and 12 concrete issues were found in the `main` branch of `simu-lacrum/melonitymedia` after the "fix/critical-audit-pack-2" merge. Some break compilation outright; some compile but make the antifraud stack non-functional. Fix all of them in a single PR titled `fix/audit-pack-3-12-bugs` split into the commits listed at the end.

**Mandatory pre-flight.**
1. `git checkout -b fix/audit-pack-3-12-bugs`
2. `npm run typecheck && npm run lint` — capture the current baseline of failures. Several of the fixes below are needed for these to even pass.
3. For every fix, add or update a Vitest test that would have caught the bug. Tests live next to the file under `__tests__/`.
4. Do NOT add new runtime dependencies. Dev dependencies (vitest, vitest-mock-extended) are already in `apps/worker/package.json`; add the same to `apps/api/package.json` if not yet present.
5. Use targeted edits — `patch` / find-and-replace per section. Do not rewrite whole files.

---

## BUG 1 — Schema/code split-brain: `proxy` relation vs `pinnedProxy` (Compile-blocker)

**File:** `apps/api/src/routes/accounts.ts`

**Symptom:** `accounts.ts:GET /` does `include: { proxy: ... }`, but `schema.prisma` declares the relation as `pinnedProxy` (foreign key `pinnedProxyId`). The old `proxyId` column was renamed and the audit pack 2 explicitly committed `pinnedProxyId` to schema. This file did not get the corresponding update. Prisma client typing will reject `proxy` and the file won't compile.

The same handler also reads `a.proxy` and `a.warmupDays` for response shaping — `a.proxy` doesn't exist on the new type at all, and the response field naming is inconsistent with what the frontend reads (`account.proxy` in DataTable).

**Fix.** Patch the `GET /` handler:

```typescript
// apps/api/src/routes/accounts.ts — GET / handler
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

    const sanitized = accounts.map(a => {
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
```

Then `grep -r "include: { proxy:" apps/api apps/web` and replace every remaining `proxy:` include with `pinnedProxy:`. Do the same for any `where: { proxyId: ... }`.

**Test:** `apps/api/src/routes/__tests__/accounts-list.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { prisma } from '../../lib/prisma.js';

// Light integration test — requires a running test DB.
// In CI use Testcontainers or docker-compose test profile.
describe('GET /api/accounts shape', () => {
  it('includes pinnedProxy, strips cookies, computes pinDaysRemaining', async () => {
    // arrange: create user + proxy + account with proxyPinnedAt = 5 days ago
    // act: hit the route
    // assert:
    //   - response.account.cookiesEncrypted === undefined
    //   - response.account.pinnedProxy exists
    //   - response.account.pinDaysRemaining === 9
    //   - response.account.hasCookies === true
  });
});
```

---

## BUG 2 — `bulk-update` writes `pinnedProxyId` without 14-day guard (Critical security/correctness)

**File:** `apps/api/src/routes/accounts.ts`

**Symptom:** `bulk-update` accepts `pinnedProxyId` directly into `prisma.socialAccount.updateMany`, completely bypassing `validatePinChange`. A user can bulk-bind 100 TikTok accounts to a Verizon proxy that was just on T-Mobile, with zero validation. The carrier stability rule exists in `bulk-proxy` but NOT in `bulk-update` — this is a silent override path.

**Fix.** Either remove `pinnedProxyId` from `bulkUpdateSchema` (route consumers must use `/bulk-proxy`), or run `validatePinChange` per account inside `bulk-update`. Removal is safer — there's already a dedicated endpoint:

```typescript
// apps/api/src/routes/accounts.ts — bulkUpdateSchema
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
```

**Test:** `apps/api/src/routes/__tests__/accounts-bulk-update.test.ts`

```typescript
import { describe, it, expect } from 'vitest';

describe('POST /api/accounts/bulk-update', () => {
  it('rejects pinnedProxyId field with 400', async () => {
    // POST with { accountIds: ['a1'], update: { pinnedProxyId: 'p2' } }
    // expect 400 VALIDATION_ERROR
  });

  it('accepts avatarUrl/bannerUrl/bio/status', async () => {
    // POST with { accountIds: ['a1'], update: { avatarUrl: 'http://...' } }
    // expect 200
  });
});
```

---

## BUG 3 — `worker→upload.ts` requires `fingerprint` & `proxyUrl` in job payload, but API never sends them (Runtime crash on every upload)

**File:** `apps/worker/src/handlers/upload.ts`

**Symptom:** `UploadJobData` has `fingerprint: AccountFingerprint` and `proxyUrl?: string`. There is no code anywhere in the API that puts a fingerprint into the BullMQ payload — the fingerprint lives in `SocialAccount.fingerprint` (JSONB column). The same problem applies to `warmup.ts` and any other browser-launching handler. As written, every upload job will crash at `launchStealthContext({ ... fingerprint: data.fingerprint })` because `data.fingerprint` is undefined.

**Fix.** Stop passing fingerprint / proxy through the job payload entirely. Resolve them from the DB inside the handler using only `accountId`. Same for `proxyUrl`.

Add a tiny resolver in `apps/worker/src/lib/account-context.ts`:

```typescript
// apps/worker/src/lib/account-context.ts (new file)
import { prisma } from './prisma.js';
import type { AccountFingerprint } from '../core/browser/fingerprint-manager.js';

export interface AccountContext {
  accountId: string;
  userId: string;
  platform: 'TIKTOK' | 'YOUTUBE';
  fingerprint: AccountFingerprint;
  proxyUrl: string | undefined;
  carrier: string | null;
  country: string;
  warmupCompletedAt: Date | null;
  warmupStartedAt: Date | null;
  warmupDays: number;
  status: string;
}

export async function loadAccountContext(accountId: string): Promise<AccountContext> {
  const acc = await prisma.socialAccount.findUniqueOrThrow({
    where: { id: accountId },
    include: {
      pinnedProxy: {
        select: {
          host: true, port: true, username: true, password: true,
          carrier: true, country: true,
        },
      },
    },
  });

  if (!acc.fingerprint) {
    throw new Error(
      `[account-context] Account ${accountId} has no fingerprint — re-import via /accounts/import`,
    );
  }

  const proxyUrl = acc.pinnedProxy
    ? buildProxyUrl(acc.pinnedProxy)
    : undefined;

  return {
    accountId: acc.id,
    userId: acc.userId,
    platform: acc.platform,
    fingerprint: acc.fingerprint as unknown as AccountFingerprint,
    proxyUrl,
    carrier: acc.pinnedProxy?.carrier ?? null,
    country: acc.pinnedProxy?.country ?? 'US',
    warmupCompletedAt: acc.warmupCompletedAt,
    warmupStartedAt: acc.warmupStartedAt,
    warmupDays: acc.warmupDays ?? 10,
    status: acc.status,
  };
}

function buildProxyUrl(p: {
  host: string; port: number;
  username: string | null; password: string | null;
}): string {
  const auth = p.username && p.password
    ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password)}@`
    : '';
  return `http://${auth}${p.host}:${p.port}`;
}
```

Then change `apps/worker/src/handlers/upload.ts`:

```typescript
// apps/worker/src/handlers/upload.ts — replace UploadJobData and the top of uploadHandler

interface UploadJobData {
  userId: string;
  videoId: string;
  videoPath: string;
  title: string;
  description: string;
  hashtags?: string[];
  accountId: string;
  /** Skip warmup check (user acknowledged risk) — admin only */
  forceSkipWarmup?: boolean;
  /** Optional override of cookies dir (testing only) */
  cookiesDir?: string;
}

export async function uploadHandler(job: Job<UploadJobData>): Promise<void> {
  const data = job.data;
  const logger = new SocketLogger(data.userId);
  let browser: Browser | null = null;
  let uniquifiedPath: string | null = null;

  try {
    // ── Resolve account context from DB ──────────────────────
    const ctxAcc = await loadAccountContext(data.accountId);
    const platform = ctxAcc.platform;
    const fingerprint = ctxAcc.fingerprint;
    const proxyUrl = ctxAcc.proxyUrl;

    logger.info(`Начинаю загрузку: "${data.title}" → ${platform}`);

    // ── Pre-flight gate 1: video file exists ────────────────
    if (!fs.existsSync(data.videoPath)) {
      throw new Error(`Видео файл не найден: ${data.videoPath}`);
    }

    // ── Pre-flight gate 2: account warmed up ────────────────
    if (!ctxAcc.warmupCompletedAt && !data.forceSkipWarmup) {
      throw new Error(
        `Account ${data.accountId} not warmed up yet ` +
        `(started ${ctxAcc.warmupStartedAt?.toISOString() ?? 'never'}). ` +
        `Skipping commercial upload — set forceSkipWarmup=true (admin only) to override.`,
      );
    }

    // ── Pre-flight gate 3: proxy pinned ─────────────────────
    if (!proxyUrl) {
      throw new Error(
        `Account ${data.accountId} has no pinned proxy. Refusing upload — ` +
        `pin an LTE_MOBILE proxy via /account/profiles first.`,
      );
    }

    // ── Pre-flight gate 4: rate limit ───────────────────────
    const dayAgo = new Date(Date.now() - 86_400_000);
    const recentUploads = await prisma.video.count({
      where: { accountId: data.accountId, isUploaded: true, uploadedAt: { gte: dayAgo } },
    });
    if (recentUploads >= 3) {
      throw new Error(
        `Account ${data.accountId} hit 3 uploads/day limit. Try tomorrow.`,
      );
    }

    const lastUpload = await prisma.video.findFirst({
      where: { accountId: data.accountId, isUploaded: true },
      orderBy: { uploadedAt: 'desc' },
      select: { uploadedAt: true },
    });
    if (lastUpload?.uploadedAt &&
        Date.now() - lastUpload.uploadedAt.getTime() < 2 * 60 * 60 * 1000) {
      throw new Error(`Less than 2h since previous upload. Wait.`);
    }

    // ── Pre-flight gate 5: cookies valid ────────────────────
    logger.info('Pre-flight проверка cookies...');
    const cookieStatus = await validateCookies(
      data.accountId,
      fingerprint,
      proxyUrl,
      data.cookiesDir,
    );
    if (cookieStatus === 'banned') {
      await prisma.socialAccount.update({
        where: { id: data.accountId }, data: { status: 'BANNED' },
      });
      throw new Error('Аккаунт забанен. Загрузка отменена.');
    }
    if (cookieStatus === 'expired') {
      await prisma.socialAccount.update({
        where: { id: data.accountId }, data: { status: 'EXPIRED_COOKIES' },
      });
      throw new Error('Cookies истекли. Импортируйте новые cookies.');
    }

    await job.updateProgress(10);

    // ... rest of upload flow unchanged, but use `fingerprint`, `proxyUrl`,
    //     `platform` from ctxAcc instead of data.fingerprint / data.proxyUrl / data.platform
```

Apply the same `loadAccountContext` resolution pattern to:
- `apps/worker/src/handlers/warmup.ts` (drop `fingerprint`, `proxyUrl`, `platform`, `warmupDays` from `WarmupJobData` — compute `warmupDay` from `warmupStartedAt` and the rest from the context)
- `apps/worker/src/handlers/cookies.ts`
- `apps/worker/src/handlers/edit-profile.ts`
- `apps/worker/src/handlers/analytics.ts` (still uses curl-impersonate, but it also needs `proxyUrl` from DB)

**Then update the API queue producers** in `apps/api/src/routes/workspace.ts` and `apps/api/src/routes/accounts.ts` so they STOP sending `fingerprint` / `proxyUrl` in payloads. Payload should look like:

```typescript
// API → BullMQ
await uploadQueue.add('upload', {
  userId: req.user!.id,
  videoId: video.id,
  videoPath: video.filepath,
  title: video.description?.split('\n')[0] ?? 'Untitled',
  description: video.description ?? '',
  hashtags: video.hashtags,
  accountId: account.id,
} satisfies UploadJobData);
```

**Test:** `apps/worker/src/handlers/__tests__/upload-preflight.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';

vi.mock('../lib/prisma.js', () => ({ prisma: mockDeep() }));
vi.mock('../core/browser/patchright-launcher.js', () => ({ launchStealthContext: vi.fn() }));

describe('uploadHandler preflight gates', () => {
  it('rejects when warmupCompletedAt is null and forceSkipWarmup is false', async () => { /* ... */ });
  it('rejects when account has no pinnedProxy', async () => { /* ... */ });
  it('rejects when daily 3-upload cap reached', async () => { /* ... */ });
  it('rejects when 2-hour gap not satisfied', async () => { /* ... */ });
  it('marks account BANNED when cookies validate as banned', async () => { /* ... */ });
  it('marks account EXPIRED_COOKIES when cookies validate as expired', async () => { /* ... */ });
});
```

---

## BUG 4 — `shadowban-detector.ts` references non-existent Prisma field `cancelReason` (Compile-blocker)

**File:** `apps/worker/src/handlers/shadowban-detector.ts`

**Symptom:**

```typescript
await prisma.task.updateMany({
  where: { accountId, status: "PENDING", type: "UPLOAD" },
  data: { status: "CANCELLED", cancelReason: "SHADOWBAN_SUSPECTED" },
});
```

`Task` model in `schema.prisma` has NO `cancelReason` field. Also `accountId` is not a column on `Task` — the model has only `config: Json` where account ids live nested. Both `where` and `data` are wrong.

**Fix.** Add a proper `cancelReason` column AND find tasks via their JSON `config.accountIds` (or `config.accountId`). Migration first:

```sql
-- apps/api/prisma/migrations/<timestamp>_task_cancel_reason/migration.sql
ALTER TABLE "Task" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "Task" ADD COLUMN "accountId" TEXT;  -- denormalized for fast cancel lookup
CREATE INDEX "Task_accountId_idx" ON "Task"("accountId");
```

Schema update:

```prisma
model Task {
  // ... existing fields ...
  accountId    String?
  cancelReason String?
  // ...
  @@index([accountId])
}
```

When inserting a Task in the API, set `accountId` if it's an account-scoped task (UPLOAD/WARMUP/COOKIES/EDIT_PROFILE/SHADOWBAN_CHECK). Then the handler becomes:

```typescript
// apps/worker/src/handlers/shadowban-detector.ts — replace the cancel block
await prisma.task.updateMany({
  where: {
    accountId,                  // now a real column
    status: 'PENDING',
    type: 'UPLOAD',
  },
  data: {
    status: 'CANCELLED',
    cancelReason: 'SHADOWBAN_SUSPECTED',
  },
});
```

**Backfill** existing Task rows by parsing `config.accountIds[0]` in a migration script under `scripts/backfill-task-accountid.mjs`.

**Test:** `apps/worker/src/handlers/__tests__/shadowban-detector.test.ts` — already exists per audit pack 2, add one extra case:

```typescript
it('writes cancelReason SHADOWBAN_SUSPECTED on flagged tasks', async () => {
  // arrange: 3 aged videos under 100 views + 2 PENDING upload tasks for this account
  // act
  await detectShadowbanForAccount('acc-1');
  // assert
  expect(prisma.task.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { accountId: 'acc-1', status: 'PENDING', type: 'UPLOAD' },
      data: { status: 'CANCELLED', cancelReason: 'SHADOWBAN_SUSPECTED' },
    }),
  );
});
```

---

## BUG 5 — `cookie-store.ts` imports prisma from wrong path (Compile-blocker)

**File:** `apps/worker/src/core/auth/cookie-store.ts`

**Symptom:**

```typescript
import { prisma } from '../lib/prisma.js';
```

The file lives at `apps/worker/src/core/auth/cookie-store.ts`. To reach `apps/worker/src/lib/prisma.ts` you must go `../../lib/prisma.js`. The current path resolves to `apps/worker/src/core/lib/prisma.js`, which does not exist. TypeScript compile will fail.

**Fix.** Single-line edit:

```typescript
// apps/worker/src/core/auth/cookie-store.ts:line where import lives
import { prisma } from '../../lib/prisma.js';
```

Same audit applied to all `../lib/`-style imports in `apps/worker/src/core/**/*.ts`. Grep before commit:

```bash
grep -rn "from '\\.\\./lib/" apps/worker/src/core/
# Each match must be `../../lib/` if the file is in src/core/<subdir>/file.ts
```

**Test:** No unit test — `npm run typecheck` is the test. Add a CI step.

---

## BUG 6 — `cookie-store.ts` defines two competing cookie loaders, both used (Bug + tech debt)

**File:** `apps/worker/src/core/auth/cookie-store.ts`

**Symptom:** Two functions:
1. `loadCookiesFromEncryptedStore(accountId, cookiesDir)` — reads from disk cache (`/data/cookies/<id>.enc.json`)
2. `loadCookiesForAccount(accountId)` — reads from Prisma directly

`patchright-launcher.ts` calls #1, which silently falls back to `[]` on cache miss (cold start = first launch on a fresh container = always empty cookies = always fail auth). The DB-backed loader exists but isn't used by the launcher.

**Fix.** Make the launcher fall back to DB on disk cache miss, and write back to disk after a successful read. Single source of truth = DB.

```typescript
// apps/worker/src/core/auth/cookie-store.ts — replace loadCookiesFromEncryptedStore
export async function loadCookiesFromEncryptedStore(
  accountId: string,
  cookiesDir: string = '/data/cookies',
): Promise<BrowserCookie[]> {
  const cachePath = path.join(cookiesDir, `${accountId}.enc.json`);

  // Layer 1: disk cache (fast path)
  try {
    const raw = await fs.readFile(cachePath, 'utf8');
    const { encrypted, iv, authTag } = JSON.parse(raw);
    return decryptCookies(
      Buffer.from(encrypted, 'base64'),
      Buffer.from(iv, 'base64'),
      Buffer.from(authTag, 'base64'),
    );
  } catch {
    // Layer 2: DB fallback (single source of truth)
    const fromDb = await loadCookiesForAccount(accountId);
    if (fromDb.length > 0) {
      // Warm the disk cache for next launch
      await saveCookiesToDiskCache(accountId, fromDb, cookiesDir);
    }
    return fromDb;
  }
}
```

**Also update** the launcher to NOT silently swallow empty cookies — if both layers return `[]`, throw, because cookie-only auth means an empty cookie set is a guaranteed login failure:

```typescript
// apps/worker/src/core/browser/patchright-launcher.ts — replace the cookies try/catch
const cookies = await loadCookiesFromEncryptedStore(opts.accountId, opts.cookiesPath);
if (cookies.length === 0) {
  throw new Error(
    `[Patchright] No cookies for account ${opts.accountId} ` +
    `(disk + DB both empty). Refusing to launch — re-import cookies via UI.`,
  );
}
await context.addCookies(cookies);
```

**Test:** `apps/worker/src/core/auth/__tests__/cookie-store.test.ts`

```typescript
describe('loadCookiesFromEncryptedStore', () => {
  it('returns cookies from disk when cache exists', async () => { /* ... */ });
  it('falls back to DB when disk cache missing', async () => { /* ... */ });
  it('warms disk cache after DB fallback', async () => { /* ... */ });
  it('returns empty array when both disk and DB empty (caller decides)', async () => { /* ... */ });
});
```

---

## BUG 7 — Fingerprint generated in TWO places with different shapes (Correctness)

**Files:**
- `apps/api/src/routes/accounts.ts` — `generateFingerprint(accountId)` (inline, lightweight)
- `apps/worker/src/core/browser/fingerprint-manager.ts` — `generateFingerprintForAccount(accountId, geo)` (full, validated)

**Symptom:** The API generates a fingerprint at `POST /accounts/import` using a LOCAL function. It has different fields, different distributions, different UA template, no consistency validation, hardcoded `platform: 'Win32'`, hardcoded Chrome version `1${30 + hash[1]%10}` (literal string `"130..139"`, NOT the real system Chrome). When the worker tries to validate this loaded fingerprint, it will hit `CHROME_VERSION` fatal in `validateFingerprintConsistency()` and refuse to launch the browser → every freshly imported account is dead on first job.

**Fix.** Delete the inline generator. Have the API call into a shared package OR replicate the worker's deterministic generator exactly (preferred — they share nothing else).

Option A (recommended) — extract to a shared module:

1. Create `packages/fingerprint/` workspace (or `apps/api/src/lib/fingerprint.ts` if you don't want to add a workspace).
2. Move `generateFingerprintForAccount` + `validateFingerprintConsistency` + `getSystemChromeMajor` there.
3. Both `apps/api/src/routes/accounts.ts` and `apps/worker/src/core/browser/fingerprint-manager.ts` import from there.

Option B (lighter — given API doesn't have the Docker Chrome at runtime, that's fine, because it just needs to seed the DB with a valid fingerprint):

```typescript
// apps/api/src/lib/fingerprint-stub.ts (new file)
//
// Server-side fingerprint generator. The API doesn't run Chrome,
// but it must seed SocialAccount.fingerprint with a value the worker
// will accept. We use a FIXED expected_chrome_major env var that the
// API and the worker container's Chrome major must agree on.
//
// On Chrome upgrade:
//   1. Bump EXPECTED_CHROME_MAJOR in docker-compose (api + worker)
//   2. Existing accounts get fingerprintStale = true via a one-shot
//      migration; never-published accounts can be regenerated through UI.
//
import { createHash } from 'crypto';

export interface AccountFingerprint {
  userAgent: string;
  platform: 'Win32' | 'MacIntel' | 'Linux x86_64';
  screen: { width: number; height: number; colorDepth: 24 };
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  locale: string;
  timezone: string;
  hardwareConcurrency: 4 | 6 | 8 | 12 | 16;
  deviceMemory: 4 | 8;
  maxTouchPoints: 0 | 1 | 5;
  webgl: { vendor: string; renderer: string };
  canvas: { seed: string };
  fonts: string[];
  chromeMajor: number;
}

export function generateFingerprintForAccount(
  accountId: string,
  geo: { country: string; city: string },
): AccountFingerprint {
  const chromeMajor = parseInt(process.env.EXPECTED_CHROME_MAJOR ?? '148', 10);
  if (chromeMajor < 130) {
    throw new Error(
      `EXPECTED_CHROME_MAJOR=${chromeMajor} too old. Patchright needs Chrome 148+.`,
    );
  }
  // ... PASTE the entire body from apps/worker/src/core/browser/fingerprint-manager.ts
  //     `generateFingerprintForAccount` here, except replace `getSystemChromeMajor()`
  //     with the env-derived `chromeMajor` above.
}
```

Then in `apps/api/src/routes/accounts.ts`:

```typescript
import { generateFingerprintForAccount } from '../lib/fingerprint-stub.js';

// inside POST /import:
const fingerprint = generateFingerprintForAccount(accountId, {
  country: 'US',  // TODO: derive from proxy when proxy is pinned later
  city: 'Chicago',
});
```

DELETE the inline `function generateFingerprint(accountId)` from `accounts.ts`.

**Then add** `.env.example` entry:

```bash
# Must match the major version of google-chrome-stable installed in the worker Dockerfile.
# Bump this AND rebuild the worker image when you upgrade Chrome.
EXPECTED_CHROME_MAJOR=148
```

And in `apps/worker/src/core/browser/fingerprint-manager.ts` `getSystemChromeMajor`, prefer the env var and only fall back to detection in dev:

```typescript
export function getSystemChromeMajor(): number {
  if (cachedChromeMajor !== null) return cachedChromeMajor;

  // 1. Trust the env var if set — it's the contract between api and worker.
  const fromEnv = parseInt(process.env.EXPECTED_CHROME_MAJOR ?? '0', 10);
  if (fromEnv >= 130) {
    cachedChromeMajor = fromEnv;
    // Defence in depth: log a warning if detected Chrome doesn't match.
    try {
      const out = execSync('google-chrome --version', { encoding: 'utf8', timeout: 5_000 });
      const detected = parseInt(out.match(/(\d+)\./)?.[1] ?? '0', 10);
      if (detected !== fromEnv) {
        console.warn(
          `[Fingerprint] EXPECTED_CHROME_MAJOR=${fromEnv} but installed Chrome is ${detected}. ` +
          `Bump EXPECTED_CHROME_MAJOR in .env after rebuilding the worker image.`,
        );
      }
    } catch { /* ignore — dev env */ }
    return fromEnv;
  }

  // 2. Auto-detect (legacy / dev fallback) — unchanged ...
}
```

**Test:** `apps/api/src/lib/__tests__/fingerprint-stub.test.ts` — verify the API generator produces a fingerprint that passes `validateFingerprintConsistency` from the worker. Cross-package import is fine for a test.

---

## BUG 8 — curl-impersonate version pinned to `v0.6.1` from `lwthiker` (Stale TLS fingerprint)

**File:** `apps/worker/Dockerfile`

**Symptom:**

```dockerfile
ARG / hard-coded https://github.com/lwthiker/curl-impersonate/releases/download/v0.6.1/...
```

`lwthiker/curl-impersonate` last release `v0.6.1` was in **2024**. It impersonates Chrome 110. TikTok's edge fingerprints Chrome 124+ as of 2026. Using a 2024 TLS shape is a self-detect — defeats the purpose of curl-impersonate entirely. Switch to the actively maintained fork `lexiforest/curl-impersonate` which ships Chrome 131/133 profiles.

**Fix.**

```dockerfile
# ── Install curl-impersonate (lexiforest fork — actively maintained) ─
# https://github.com/lexiforest/curl-impersonate/releases
ARG CURL_IMPERSONATE_VERSION=1.0.0
RUN wget -q -O /tmp/curl-impersonate.tar.gz \
      "https://github.com/lexiforest/curl-impersonate/releases/download/v${CURL_IMPERSONATE_VERSION}/curl-impersonate-v${CURL_IMPERSONATE_VERSION}.x86_64-linux-gnu.tar.gz" \
    && tar -xzf /tmp/curl-impersonate.tar.gz -C /usr/local/bin/ \
    && rm /tmp/curl-impersonate.tar.gz \
    && chmod +x /usr/local/bin/curl_chrome* /usr/local/bin/curl_ff* /usr/local/bin/curl_safari*

# Smoke test at build time — bake a known-good profile into the assertion.
RUN curl_chrome131 --version || (echo "curl_chrome131 missing — version pin out of date" && exit 1)
```

(If `v1.0.0` doesn't exist at build time, pin to whatever the latest tag from `lexiforest/curl-impersonate/releases` is, and update the smoke-test profile name accordingly.)

And in `apps/worker/src/core/tls/curl-impersonate-client.ts`, change the default impersonate profile:

```typescript
impersonate?: 'chrome131' | 'chrome124' | 'ff117' | 'safari17_2_ios';
// default:
const binary = `curl_${req.impersonate ?? 'chrome131'}`;
```

**Test:** Add a Dockerfile build-time test (just `RUN curl_chrome131 --version`). No unit test required.

---

## BUG 9 — `cleanupReason` typo / wrong types in `index.ts` Worker config (Compile-blocker)

**File:** `apps/worker/src/index.ts`

**Symptom:**

```typescript
{ name: 'analytics-cron', handler: analyticsHandler as (job: Job) => Promise, concurrency: 2 },
```

`Promise` is missing its generic, and the cast is invalid TypeScript. Same applies to every entry in `QUEUE_CONFIGS`. The `Promise` (no `<T>`) compiles to `any` only when `strict` is off — your `tsconfig` declares `strict: true` (verify in `apps/worker/tsconfig.json`). This will not type-check.

Also, `WorkerConfig` is declared with no result generics, so `handler: (job: Job) => Promise<void>` is what you actually want.

**Fix.**

```typescript
// apps/worker/src/index.ts — replace QueueConfig + QUEUE_CONFIGS
interface QueueConfig {
  name: string;
  handler: (job: Job) => Promise<unknown>;
  concurrency: number;
}

const QUEUE_CONFIGS: QueueConfig[] = [
  { name: 'upload',          handler: uploadHandler          as QueueConfig['handler'], concurrency: 3 },
  { name: 'warmup',          handler: warmupHandler          as QueueConfig['handler'], concurrency: 3 },
  { name: 'cookies',         handler: cookiesHandler         as QueueConfig['handler'], concurrency: 3 },
  { name: 'edit-profile',    handler: editProfileHandler     as QueueConfig['handler'], concurrency: 3 },
  { name: 'analytics-cron',  handler: analyticsHandler       as QueueConfig['handler'], concurrency: 2 },
  { name: 'cleanup',         handler: cleanupHandler         as QueueConfig['handler'], concurrency: 1 },
  { name: 'shadowban-check', handler: shadowbanDetectorHandler as QueueConfig['handler'], concurrency: 2 },
];
```

If the upstream handler signatures already return `Promise<void>` or `Promise<ShadowbanResult>`, the `as QueueConfig['handler']` cast is the right shape and accepted by `Worker<DataT, ResultT>`.

**Test:** `npm run typecheck` must pass in `apps/worker` after this fix.

---

## BUG 10 — `warmup.ts` writes `commented = true` but never marks Account warmupCompletedAt (Critical UX bug)

**File:** `apps/worker/src/handlers/warmup.ts`

**Symptom:** Worker counts the day, runs phase-appropriate behaviour, logs "День завершён", and exits. It never updates `SocialAccount.warmupCompletedAt` even when `warmupDay === warmupDays`. This means an account stays in `WARMING_UP` status forever and the upload preflight gate (BUG 3 fix) will reject all uploads even after 10 days of warmup completed.

Also, the cron that dispatches daily warmup jobs is not described anywhere — without it, only Day 1 ever runs.

**Fix.** Two parts:

Part A — mark completion at the end of the last day:

```typescript
// apps/worker/src/handlers/warmup.ts — at the very end of warmupHandler, before logger.disconnect()
if (data.warmupDay >= (data.warmupDays ?? 10)) {
  await prisma.socialAccount.update({
    where: { id: data.accountId },
    data: {
      status: 'ALIVE',
      warmupCompletedAt: new Date(),
    },
  });
  logger.info(`🎉 Прогрев аккаунта ${data.accountId} завершён, статус → ALIVE`);
}
```

Part B — daily cron dispatcher. Add a BullMQ repeatable job that runs once a day at midnight, scans `WARMING_UP` accounts, computes `warmupDay` from `warmupStartedAt`, and enqueues a `warmup` job per account.

```typescript
// apps/api/src/lib/warmup-cron.ts (new file — boot from apps/api/src/index.ts)
import { Queue } from 'bullmq';
import { prisma } from './prisma.js';
import { connection } from './bullmq.js';

const warmupQueue = new Queue('warmup', { connection });

export async function bootWarmupCron(): Promise<void> {
  // Repeatable scheduler at 03:00 UTC every day
  await warmupQueue.upsertJobScheduler(
    'warmup-daily-dispatch',
    { pattern: '0 3 * * *', tz: 'UTC' },
    {
      name: 'warmup-daily-dispatch',
      data: {},
      opts: { removeOnComplete: 50, removeOnFail: 50 },
    },
  );

  console.log('[warmup-cron] daily dispatcher registered (03:00 UTC)');
}

// And a one-off processor that the worker picks up:
// apps/worker/src/handlers/warmup-dispatcher.ts (new handler)
import { prisma } from '../lib/prisma.js';
import { Queue } from 'bullmq';
import { connection } from '../lib/bullmq.js';

const warmupQueue = new Queue('warmup', { connection });

export async function warmupDispatcherHandler(): Promise<void> {
  const accounts = await prisma.socialAccount.findMany({
    where: { status: 'WARMING_UP', warmupStartedAt: { not: null } },
    select: { id: true, warmupStartedAt: true, warmupDays: true, userId: true, platform: true },
  });

  for (const acc of accounts) {
    const day = Math.min(
      acc.warmupDays ?? 10,
      Math.ceil((Date.now() - acc.warmupStartedAt!.getTime()) / 86_400_000),
    );
    await warmupQueue.add('warmup', {
      userId: acc.userId,
      accountId: acc.id,
      warmupDay: day,
      warmupDays: acc.warmupDays ?? 10,
    });
  }

  console.log(`[warmup-cron] dispatched ${accounts.length} warmup jobs`);
}
```

Wire `warmup-dispatcher` into `index.ts` as an 8th queue, OR demultiplex inside the existing `warmup` handler based on payload shape. Either way, dispatcher runs daily.

**Test:** `apps/worker/src/handlers/__tests__/warmup-completion.test.ts`

```typescript
describe('warmup completion', () => {
  it('marks account ALIVE + sets warmupCompletedAt on last day', async () => {
    // mock data: warmupDay=10, warmupDays=10
    // run handler
    // expect prisma.socialAccount.update called with { status:'ALIVE', warmupCompletedAt: any Date }
  });
  it('does not mark complete on intermediate days', async () => {
    // warmupDay=5, warmupDays=10
    // expect no update to status/warmupCompletedAt
  });
});
```

---

## BUG 11 — Save-icon selector is `[data-e2e="undefined-icon"]` (Copy-paste bug)

**File:** `apps/worker/src/handlers/warmup.ts`

**Symptom:**

```typescript
await humanClick(page, cursor, '[data-e2e="undefined-icon"]', { postClickDelay: 500 });
logger.info(`  🔖 Сохранено видео ${i + 1}`);
```

The literal string `"undefined-icon"` is from a developer reading `${something}-icon` where `something` was `undefined`. There is no element matching it on TikTok; every save attempt silently fails inside the `try { } catch { }`. Logger still says "Сохранено", which is a lie.

**Fix.** Actual TikTok save selector is `[data-e2e="video-bookmark"]` (or `[data-e2e="undefined"]` in some experiments — verify via DevTools on the current TikTok UI). Also stop logging "Сохранено" when the click might have failed:

```typescript
if (Math.random() < 0.15 && data.platform === 'TIKTOK') {
  try {
    await humanClick(page, cursor, '[data-e2e="video-bookmark"]', { postClickDelay: 500 });
    logger.info(`  🔖 Сохранено видео ${i + 1}`);
  } catch {
    logger.warn(`  ⚠ Не удалось сохранить видео ${i + 1} (селектор изменился?)`);
  }
}
```

**Test:** Visual / e2e — hard to unit test selector validity. Add a TODO to grep all selectors against a known-good selector snapshot once per quarter (a JSON list in `apps/worker/src/handlers/__selectors__.json`).

---

## BUG 12 — Worker runs as non-root but Chrome inside Xvfb needs DISPLAY (Runtime crash)

**File:** `apps/worker/Dockerfile` + `apps/worker/entrypoint.sh`

**Symptom:** Dockerfile creates user `worker`, switches to `USER worker`, but Xvfb startup logic isn't shown in your repo (the entrypoint is `COPY apps/worker/entrypoint.sh /entrypoint.sh` and not in the file listing audit returned). Without `Xvfb :99` running BEFORE Patchright tries to launch Chrome with `headless: false`, the launch will fail with `error: cannot open display: :99`.

Also, running Chrome as non-root sandboxed user without `--no-sandbox` (which IS in `STEALTH_ARGS` — good) usually works, but Patchright's `channel: 'chrome'` insists on real Chrome which doesn't honour `--no-sandbox` reliably in containers without `--cap-add=SYS_ADMIN`. The current Dockerfile passes neither `SYS_ADMIN` to the container nor uses a seccomp profile.

**Fix.** Replace `entrypoint.sh` with a robust version, and document the docker-compose runtime requirements.

```bash
#!/usr/bin/env bash
# apps/worker/entrypoint.sh
set -euo pipefail

# ── MASTER_KEY fail-fast (echo of cookie-store guard, before anything else) ─
node -e "
const k = Buffer.from(process.env.MASTER_KEY || '', 'base64');
if (k.length !== 32) {
  console.error('[entrypoint] MASTER_KEY invalid (got ' + k.length + ' bytes after base64, need 32)');
  process.exit(1);
}
"

# ── Start Xvfb on :99 ──────────────────────────────────────
# RANDR extension required by Patchright for viewport overrides
Xvfb :99 -screen 0 1920x1080x24 -ac +extension RANDR -nolisten tcp &
XVFB_PID=$!
export DISPLAY=:99

# Give Xvfb a moment to come up, then verify
sleep 1
if ! xdpyinfo -display :99 >/dev/null 2>&1; then
  echo "[entrypoint] Xvfb failed to start" >&2
  kill $XVFB_PID 2>/dev/null || true
  exit 1
fi

# ── Log Chrome version for diagnostics ─────────────────────
google-chrome --version || echo "[entrypoint] google-chrome not installed!"

# ── Hand off to Node worker ────────────────────────────────
exec node dist/index.js
```

Also `apt-get install -y x11-utils` in the Dockerfile so `xdpyinfo` is available, AND add `--cap-add=SYS_ADMIN` to the worker service in `docker-compose.yml`:

```yaml
worker:
  build:
    context: .
    dockerfile: apps/worker/Dockerfile
  depends_on: [db, redis]
  cap_add:
    - SYS_ADMIN
  security_opt:
    - seccomp:unconfined
  shm_size: '2gb'           # Chrome needs > default 64m
  volumes:
    - cookies:/data/cookies
    - uploads:/app/uploads
  env_file: .env
```

**Test:** No unit test — bring the stack up locally and tail `docker-compose logs -f worker`. The startup banner must include both `display: :99` and `Google Chrome <version>`.

---

## Commit plan

Split the PR into these commits, in order. Each commit must individually pass `typecheck` + `lint` + `vitest`:

| # | Commit | What it fixes |
|---|---|---|
| 1 | `fix(api): use pinnedProxy relation, drop legacy proxy include` | BUG 1 |
| 2 | `fix(api): forbid pinnedProxyId via /bulk-update (carrier rule bypass)` | BUG 2 |
| 3 | `refactor(worker): resolve fingerprint+proxy from DB, drop from payload` | BUG 3 |
| 4 | `feat(db): Task.accountId + cancelReason migration; wire shadowban` | BUG 4 |
| 5 | `fix(worker): correct prisma import path in cookie-store` | BUG 5 |
| 6 | `fix(worker): cookie loader falls back to DB; refuse launch on empty` | BUG 6 |
| 7 | `refactor: extract fingerprint stub for API; pin via EXPECTED_CHROME_MAJOR` | BUG 7 |
| 8 | `chore(infra): switch curl-impersonate to lexiforest v1.x` | BUG 8 |
| 9 | `fix(worker): proper QueueConfig types in index.ts` | BUG 9 |
| 10 | `feat(worker): warmup completion + daily dispatcher cron` | BUG 10 |
| 11 | `fix(worker): real TikTok bookmark selector instead of "undefined-icon"` | BUG 11 |
| 12 | `chore(infra): robust entrypoint with Xvfb verification + shm_size` | BUG 12 |

## Acceptance checklist (paste into PR description)

- [ ] `npm run typecheck` green in api, web, worker
- [ ] `npm run lint` green, no `no-restricted-imports` violations
- [ ] `npm test` green; new tests cover BUG 1, 2, 3, 4, 6, 7, 10
- [ ] `docker-compose build worker` succeeds, includes `curl_chrome131`
- [ ] `docker-compose up worker` runs without `cannot open display` errors
- [ ] Manual: import a TikTok account → fingerprint persisted → start warmup → Day 1 job runs → worker doesn't crash on missing `fingerprint` in payload
- [ ] Manual: try `POST /api/accounts/bulk-proxy` with carrier change on 14-day-pinned TikTok account → expect 409 `CARRIER_CHANGE_BLOCKED`
- [ ] Manual: try `POST /api/accounts/bulk-update` with `pinnedProxyId` field → expect 400 VALIDATION_ERROR
- [ ] Manual: simulate 3 aged videos with <100 views → run `shadowbanDetectorHandler` → expect status=`SHADOWBAN_SUSPECTED`, Task cancelled with `cancelReason='SHADOWBAN_SUSPECTED'`

**End of prompt.**

