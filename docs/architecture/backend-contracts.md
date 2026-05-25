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

### Queue: `shadowban-check` *(NEW in v3)*
```typescript
interface ShadowbanCheckPayload {
  accountId: string;

  // Worker internally:
  // 1. Fetches recent videos via curl-impersonate
  // 2. Checks for shadowban pattern: 3+ consecutive videos with <100 views
  // 3. If detected → sets account status = SHADOWBAN_SUSPECTED
  // 4. Emits Socket.io warning to frontend
}
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

```typescript
// Generated ONCE per account from accountId seed.
// NEVER changes after creation.
// Stored in SocialAccount.fingerprint (JSON).

interface AccountFingerprint {
  userAgent: string;
  screen: { width: number; height: number };
  devicePixelRatio: number;
  locale: string;
  timezone: string;
  platform: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  maxTouchPoints: number;
  webgl: { vendor: string; renderer: string };
  canvas: { seed: string };
  fonts: string[];
}
```

### Proxy Contract

```typescript
// Proxy pinning: one proxy per account, stable for 14+ days.
// SocialAccount.proxyPinnedAt tracks when proxy was assigned.
// Worker checks: if (now - proxyPinnedAt) < 14 days → reuse same proxy.

// LTE rotation: minimum 15 min cooldown between IP rotations.
// Proxy.rotationCooldown (seconds, default 900)
// Proxy.lastRotatedAt — last successful rotation timestamp

// Carrier validation (carrier-validator.ts):
// Checks ASN against known datacenter ranges (AWS, Hetzner, OVH, etc.)
// If ASN matches datacenter → proxy.bgpPathValid = false → WARNING in UI
```
