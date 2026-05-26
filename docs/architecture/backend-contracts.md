# Backend Contracts v3 — API и BullMQ Payloads

## Общие принципы

### Формат ответов API

Все ответы возвращают JSON. Успешные ответы имеют HTTP 2xx. Ошибки — 4xx/5xx.

**Успешный ответ:**
```json
{
  "success": true,
  "data": { ... }
}
```

**Ответ с ошибкой:**
```json
{
  "success": false,
  "error": "Human-readable error message",
  "code": "VALIDATION_ERROR"
}
```

### Коды ошибок

| HTTP | Код | Описание |
|------|-----|----------|
| 400 | `VALIDATION_ERROR` | Невалидные данные в запросе |
| 401 | `UNAUTHORIZED` | JWT отсутствует или истёк |
| 403 | `FORBIDDEN` | Нет прав (не админ) или IP заблокирован |
| 404 | `NOT_FOUND` | Ресурс не найден |
| 409 | `CONFLICT` | Дублирование (email уже занят) |
| 429 | `RATE_LIMITED` | Слишком много запросов |
| 500 | `INTERNAL_ERROR` | Серверная ошибка |

### Аутентификация

JWT передаётся через **HttpOnly Cookie** (`token`). Middleware `jwt-auth` извлекает токен, верифицирует и добавляет `req.user` с полями `id`, `email`, `role`.

---

## API Endpoints

### Auth (`/api/auth`)

#### `POST /api/auth/register`
```typescript
// Request
{ email: string, password: string }

// Response 201
{ success: true, data: { user: { id, email, role }, token: string } }

// Cookie set: token=<jwt>; HttpOnly; Secure; SameSite=Strict
```

#### `POST /api/auth/login`
```typescript
// Request
{ email: string, password: string }

// Response 200
{ success: true, data: { user: { id, email, role } } }
```

#### `POST /api/auth/logout`
```typescript
// Response 200 — clears cookie
{ success: true }
```

#### `GET /api/auth/me`
```typescript
// Response 200
{ success: true, data: { user: { id, email, role, createdAt } } }
```

---

### Accounts (`/api/accounts`)

#### `GET /api/accounts`
```typescript
// Response 200
// NOTE: cookiesEncrypted/cookiesIv/cookiesAuthTag are NEVER sent to frontend.
//       Instead, `hasCookies: boolean` and `warmupDay: number | null` are computed.
{
  accounts: Array<{
    id: string;
    platform: "TIKTOK" | "YOUTUBE";
    username: string | null;
    nickname: string | null;
    status: "ALIVE" | "AUTH_NEEDED" | "BANNED" | "EXPIRED_COOKIES" | "SHADOWBAN_SUSPECTED" | "WARMING_UP";
    hasCookies: boolean;        // true if cookiesEncrypted is set
    warmupDay: number | null;   // 1-11, null if warmup not started
    proxy: { id, address, label, type } | null;
    proxyPinnedAt: string | null;
    warmupStartedAt: string | null;
    warmupCompletedAt: string | null;
    fingerprint: object | null; // AccountFingerprint JSON (read-only)
    views: number;
    followers: number;
    createdAt: string;
  }>
}
```

#### `POST /api/accounts/import`
```typescript
// Request — cookie-based import (NOT login:password!)
{
  platform: "TIKTOK" | "YOUTUBE";
  cookies: string;          // Netscape .txt format OR JSON array of cookie objects
  username?: string;        // optional display name
  nickname?: string;        // optional @handle
}

// Server-side:
// 1. Parses cookies (Netscape or JSON)
// 2. Encrypts with AES-256-GCM (MASTER_KEY)
// 3. Generates per-account fingerprint from accountId seed
// 4. Stores encrypted cookies + fingerprint in DB

// Response 201
{
  account: {
    id: string;
    platform: string;
    username: string | null;
    nickname: string | null;
    hasCookies: true;
    status: "ALIVE";
  }
}
```

#### `POST /api/accounts/:id/cookies`
```typescript
// Request — re-import cookies for existing account
{ cookies: string }   // Netscape .txt or JSON

// Response 200
{ success: true }
// Resets status from EXPIRED_COOKIES → ALIVE
```

#### `PATCH /api/accounts/:id`
```typescript
// Request (partial update, whitelisted fields only)
{
  username?: string;
  nickname?: string;
  bio?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  proxyId?: string;    // auto-sets proxyPinnedAt if changed
  status?: string;
  secUid?: string;
}
// Response 200
{ account: Account }  // cookiesEncrypted stripped
```

#### `POST /api/accounts/bulk-proxy`
```typescript
// Request — bulk proxy binding
{ accountIds: string[], proxyId: string }
// Sets proxyPinnedAt = now() for all accounts
// Response 200
{ updated: number }
```

#### `POST /api/accounts/warmup`
```typescript
// Request — start 10-day warmup curriculum
{ ids: string[] }
// Sets status = WARMING_UP, warmupStartedAt = now()
// Dispatches WARMUP task to BullMQ
// Response 201
{ task: Task }
```

---

### Proxies (`/api/proxies`)

#### `POST /api/proxies`
```typescript
// Request
{
  name?: string;                     // display label
  host: string;
  port: number;
  username?: string;
  password?: string;
  rotationLink?: string;             // URL для смены IP
  type?: "LTE_MOBILE" | "STATIC_RESIDENTIAL" | "DATACENTER_DEPRECATED";
  country?: string;                  // default "US"
  carrier?: string;                  // e.g., "T-Mobile", "MTS"
  dma?: string;                      // Designated Market Area (US only)
  rotationCooldown?: number;         // seconds between rotations (60-3600, default 900)
}
// If type not specified: auto-detected from rotationLink presence
// Response 201
{ proxy: ProxyWithEnriched }
```

#### `POST /api/proxies/:id/test`
```typescript
// Response 200
{ success: true, status: string, address: string }
```

---

### Workspace (`/api/workspace`)

#### `POST /api/workspace/launch`
```typescript
// Request — dispatch job to BullMQ
{
  mode: "upload" | "warmup" | "cookies" | "edit-profile",
  accountIds: string[],
  config: UploadConfig | WarmupConfig | CookiesConfig | EditProfileConfig,
  threads: number,          // Количество параллельных потоков
  delayMin: number,         // Минимальная задержка старта (сек)
  delayMax: number          // Максимальная задержка старта (сек)
}

// Response 202
{ success: true, data: { jobIds: string[] } }
```

#### `GET /api/workspace/jobs`
```typescript
// Response 200
{
  success: true,
  data: {
    active: Job[],
    waiting: Job[],
    completed: Job[],
    failed: Job[]
  }
}
```

---

## BullMQ Job Payloads

### Queue: `upload`
```typescript
interface UploadJobPayload {
  accountId: string;
  videoPath: string;          // path to original video
  platform: "TIKTOK" | "YOUTUBE";
  title: string;
  description: string;
  tags: string[];

  // Worker internally:
  // 1. Loads encrypted cookies from DB → decrypts with MASTER_KEY
  // 2. Validates cookies via curl-impersonate pre-flight
  // 3. Generates uniquified video via FFmpeg (deterministic per accountId)
  // 4. Launches Patchright with per-account fingerprint
  // 5. Uses ghost-cursor + typing emulator for human behavior
}
```

### Queue: `warmup`
```typescript
interface WarmupJobPayload {
  accountId: string;

  // Worker internally calculates warmupDay from account.warmupStartedAt:
  // Day 1-3: Passive (scroll FYP, watch 5-8 videos, no interactions)
  // Day 4-6: Light (like 3-5 videos, leave 1 comment per session)
  // Day 7-10: Active (like 5-10, comment 2-3, save 1, follow 1)
  // Day 11+: Ready for upload

  // All actions use:
  // - Patchright with per-account fingerprint
  // - ghost-cursor for mouse movement
  // - typing emulator for comments
  // - randomized session durations (5-15 min)
}
```

### Queue: `cookies`
```typescript
interface CookiesJobPayload {
  accountId: string;

  // Worker internally:
  // 1. Loads and decrypts existing cookies
  // 2. Launches Patchright, navigates to TikTok
  // 3. Refreshes session (scroll, interact lightly)
  // 4. Exports updated cookies
  // 5. Re-encrypts and saves to DB
}
```

### Queue: `edit-profile`
```typescript
interface EditProfileJobPayload {
  accountId: string;
  avatarPath: string | null;
  bannerPath: string | null;
  bio: string | null;

  // Worker uses ghost-cursor for all interactions
}
```

### Queue: `analytics-cron`
```typescript
interface AnalyticsJobPayload {
  accountId: string;
  platform: "TIKTOK" | "YOUTUBE";

  // Worker uses curl-impersonate (no browser!):
  // 1. Fetches /api/user/detail/?secUid=... with Chrome TLS fingerprint
  // 2. Parses JSON response (~200ms per profile)
  // 3. Updates followers/views in DB
}
```

### Queue: `cleanup`
```typescript
interface CleanupJobPayload {
  filePaths: string[];         // Пути к временным файлам для удаления
  jobId: string;               // ID завершённой задачи
}
```

### Queue: `shadowban-check` (NEW in v3)

```typescript
interface ShadowbanCheckPayload {
  accountId: string;
}

// Worker logic (apps/worker/src/handlers/shadowban-detector.ts):
//
// THRESHOLDS:
//   SHADOWBAN_MIN_VIDEO_AGE_HOURS = 24
//   SHADOWBAN_VIEW_THRESHOLD = 100
//   SHADOWBAN_CONSECUTIVE_VIDEOS = 3
//   SHADOWBAN_LOOKBACK_DAYS = 14
//
// ALGORITHM:
//   1. Skip if account.status !== "ALIVE" OR warmupCompletedAt is null.
//   2. Fetch the most recent N videos that satisfy BOTH:
//        - uploadedAt <= now - 24h    (CRITICAL: 24h post-publish gate;
//                                       TikTok ramps distribution over hours)
//        - uploadedAt >= now - 14d    (older videos aren't representative)
//   3. If fewer than SHADOWBAN_CONSECUTIVE_VIDEOS aged videos exist, exit silently.
//   4. If ALL of them have views < SHADOWBAN_VIEW_THRESHOLD:
//        - account.status -> SHADOWBAN_SUSPECTED
//        - cancel all PENDING upload tasks for this account
//        - emit Socket.io warning to frontend
//
// WHY THE 24-HOUR GATE MATTERS:
//   A 30-minute-old video with 50 views is statistically normal.
//   Without this gate, every fresh upload would briefly satisfy the "low views"
//   criterion and prematurely flag the account, blocking its entire queue.
//
// RECOVERY (manual):
//   Owner reviews the flagged account in /account/profiles, decides whether to:
//     (a) pause uploads 7+ days then resume with organic content, OR
//     (b) discard the account.
//   Status reverts to ALIVE only via manual user action — never automatically.
```

---

## Socket.io Events

### Server → Client

| Event | Payload | Описание |
|-------|---------|----------|
| `log` | `{ timestamp, level, message }` | Лог воркера в Live Terminal |
| `job:progress` | `{ jobId, progress, status }` | Прогресс выполнения задачи |
| `job:completed` | `{ jobId, result }` | Задача завершена |
| `job:failed` | `{ jobId, error }` | Задача провалена |

### Client → Server

| Event | Payload | Описание |
|-------|---------|----------|
| `subscribe` | `{ userId }` | Подписка на логи своих задач |
| `unsubscribe` | — | Отписка |

---

## Fail-Closed Contract

При возникновении ошибки (капча, таймаут, сетевой сбой) воркер выполняет:

1. **Скриншот** — сохраняется для отладки
2. **Socket.io error** — `[ERROR] Обнаружена капча, прерывание...`
3. **BullMQ status** — Job помечается как `failed` с error message
4. **Browser cleanup** — `await context.close(); await browser.close()` гарантированно
5. **Cookie re-export** — если сессия изменилась, cookies сохраняются перед закрытием
6. **No crash** — процесс Worker продолжает слушать следующие задачи

---

## Security Contracts

### Cookie Encryption (AES-256-GCM)

```typescript
// Encryption: cookie-store.ts
// Input: JSON string of cookies
// Output: { encrypted: Buffer, iv: Buffer(12), authTag: Buffer(16) }

// All three fields stored in Prisma:
// SocialAccount.cookiesEncrypted (Bytes)
// SocialAccount.cookiesIv (Bytes)
// SocialAccount.cookiesAuthTag (Bytes)

// MASTER_KEY: 32 bytes from env (base64 encoded, 44 chars)
// Validated at startup: if invalid → process.exit(1)
```

### Fingerprint Contract

Per-account stable fingerprint. Generated ONCE per account from `accountId` seed.
**NEVER changes after creation.** Stored in `SocialAccount.fingerprint` (JSON).
Validated at generation and on every load.

```typescript
interface AccountFingerprint {
  userAgent: string;
  platform: "Win32" | "MacIntel" | "Linux x86_64";
  screen: { width: number; height: number; colorDepth: 24 };
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  locale: string;          // BCP 47 (en-US, ru-RU, ...)
  timezone: string;        // IANA (America/Chicago, Europe/Moscow, ...)
  hardwareConcurrency: 4 | 6 | 8 | 12 | 16;
  deviceMemory: 4 | 8;     // Chrome caps reported value at 8
  maxTouchPoints: 0 | 1 | 5;
  webgl: { vendor: string; renderer: string };
  canvas: { seed: string }; // 16-char hex
  fonts: string[];
  chromeMajor: number;     // must match installed system Chrome major
}
```

**Consistency Rules (enforced in `validateFingerprintConsistency`):**

1. **OS coherence.** `userAgent` OS token must match `platform`:
   - `Windows NT 10.0` -> `platform = "Win32"`
   - `Macintosh; Intel Mac OS X` -> `platform = "MacIntel"`
   - `X11; Linux` -> `platform = "Linux x86_64"`
2. **GPU coherence.** `webgl.renderer` must match the OS:
   - Windows -> must contain `ANGLE (...)`.
   - macOS -> must contain `Apple`, `AMD Radeon Pro`, or `Intel ... Iris/UHD`.
   - Linux -> must contain `Mesa`, `llvmpipe`, or `NVIDIA`.
3. **Display geometry.** `screen.width >= viewport.width` AND
   `screen.height - viewport.height >= 80` (chrome/taskbar space).
4. **Geo coherence.** `locale` country must match `timezone` region
   (e.g. `en-US` requires `America/*`; `ru-RU` requires `Europe/*` or `Asia/*`).
5. **Hardware realism.** `hardwareConcurrency in {4,6,8,12,16}`,
   `deviceMemory in {4,8}` (Chrome doesn't report higher values).
6. **Chrome version pinning.** UA Chrome major **must equal** `chromeMajor`,
   which is captured from the live system Chrome at worker startup
   via `getSystemChromeMajor()`. A UA claiming Chrome 100 while the
   container ships Chrome 148 is a top-tier antifraud signal.
7. **Touch coherence.** Desktop UAs (Windows / macOS / Linux) require
   `maxTouchPoints = 0`. Non-zero touch points on desktop UA is one of
   the strongest "synthetic browser" signals TikTok looks for.

A `FingerprintInconsistencyError` is thrown on the first violation —
generation aborts; load aborts with a worker-level log so the operator
can decide to regenerate (allowed only for accounts that have never
published — see UI warning in `/account/profiles`).

**Why this matters:** rotating or randomising fingerprint per session is
the #1 cause of TikTok shadowban in 2026. A stable, internally consistent
fingerprint correlates with the proxy IP over the 14-day window and
keeps the account in "real user" cluster of TikTok's ML classifier.

### Proxy Contract — Carrier Stability Rule (TikTok 2026)

Pinning policy: один аккаунт = один прокси на 14+ дней. `SocialAccount.proxyPinnedAt` фиксируется при первой привязке и при каждой смене.

```typescript
// Enforced server-side in apps/api/src/lib/proxy-pin-rules.ts
// (function `validatePinChange`)

// HARD BLOCKS (returns HTTP 409 unless ?force=true is passed by ADMIN):

// 1. PROXY_NOT_LTE_FOR_TIKTOK
//    TikTok account younger than 30 days requires `type === "LTE_MOBILE"`.
//    Residential / datacenter on fresh accounts triggers BGP path scoring.

// 2. COUNTRY_CHANGE_BLOCKED
//    Cannot swap proxy across countries on an account with existing
//    session history. TikTok geo-correlates carrier with country.
//    Full re-warm required if you proceed.

// 3. CARRIER_CHANGE_BLOCKED (TikTok-only)
//    Cannot swap to a different carrier (T-Mobile -> Verizon, etc.).
//    Resets the 14-day correlation window. Expected shadowban 14-21 days.

// SOFT WARN (still requires force, but lower-risk):

// 4. PIN_WINDOW_ACTIVE
//    Same-carrier, same-country swap within 14 days of last pin.
//    Frequent rotations within window are themselves a signal.

// Override mechanism:
//   POST /api/accounts/bulk-proxy?force=true       (ADMIN role only)
//   PATCH /api/accounts/:id?force=true             (ADMIN role only)
// Every force-override writes an AuditLog row with the violation code.

// LTE rotation cooldown:
//   Proxy.rotationCooldown — minimum seconds between IP rotations (default 900 = 15 min).
//   Worker enforces: if (now - lastRotatedAt) < rotationCooldown → reject rotation request.
```

**Frontend handling:**
- В `/account/profiles` при попытке bulk-bind показывается modal с человекочитаемой причиной из `error.message` и кнопкой «Override (admin only)» если у текущего юзера `role === ADMIN`.
- В `/account/proxies` при добавлении нового прокси индикатор `bgpPathValid: false` рисует ⚠️ жёлтый бейдж.
