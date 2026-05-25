# Backend Contracts — API и BullMQ Payloads

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
// Query: ?page=1&limit=50&status=ALIVE&platform=TIKTOK
// Response 200
{
  success: true,
  data: {
    accounts: Account[],
    total: number,
    page: number,
    limit: number
  }
}
```

#### `POST /api/accounts`
```typescript
// Request
{ login: string, password: string, platform: "TIKTOK" | "YOUTUBE_SHORTS" }
// Response 201
{ success: true, data: { account: Account } }
```

#### `POST /api/accounts/import`
```typescript
// Request (multipart/form-data)
// Field: file (text file with login:password per line)
// Field: platform ("TIKTOK" | "YOUTUBE_SHORTS")
// Response 201
{ success: true, data: { imported: number, skipped: number } }
```

#### `PATCH /api/accounts/:id`
```typescript
// Request (partial update)
{ proxyId?: string, nickname?: string, status?: string }
// Response 200
{ success: true, data: { account: Account } }
```

#### `POST /api/accounts/bulk-proxy`
```typescript
// Request — bulk proxy binding
{ accountIds: string[], proxyId: string }
// Response 200
{ success: true, data: { updated: number } }
```

---

### Proxies (`/api/proxies`)

#### `POST /api/proxies`
```typescript
// Request
{
  host: string,
  port: number,
  username?: string,
  password?: string,
  type: "STATIC" | "ROTATING",
  rotationLink?: string    // URL для смены IP у мобильного провайдера
}
// Response 201
{ success: true, data: { proxy: Proxy } }
```

#### `POST /api/proxies/:id/test`
```typescript
// Response 200
{ success: true, data: { reachable: boolean, ip: string, latencyMs: number } }
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
  videoPath: string;
  platform: "TIKTOK" | "YOUTUBE_SHORTS";
  title: string;
  description: string;
  tags: string[];
  proxyStr: string | null;
  rotationLink: string | null;
}
```

### Queue: `warmup`
```typescript
interface WarmupJobPayload {
  accountId: string;
  hashtags: string[];
  likeProbability: number;     // 0–100
  commentProbability: number;  // 0–100
  commentPool: string[];
  viewDurationMin: number;     // секунды
  viewDurationMax: number;
  proxyStr: string | null;
  rotationLink: string | null;
}
```

### Queue: `cookies`
```typescript
interface CookiesJobPayload {
  accountId: string;
  donorUrls: string[];         // Сайты-доноры для нагула
  timePerSite: number;         // секунды на каждый сайт
  sitesCount: number;          // Количество сайтов
  proxyStr: string | null;
  rotationLink: string | null;
}
```

### Queue: `edit-profile`
```typescript
interface EditProfileJobPayload {
  accountId: string;
  avatarPath: string | null;
  bannerPath: string | null;
  bio: string | null;
  proxyStr: string | null;
  rotationLink: string | null;
}
```

### Queue: `analytics-cron`
```typescript
interface AnalyticsJobPayload {
  accountId: string;
  platform: "TIKTOK" | "YOUTUBE_SHORTS";
  proxyStr: string | null;
  rotationLink: string | null;
}
```

### Queue: `cleanup`
```typescript
interface CleanupJobPayload {
  filePaths: string[];         // Пути к временным файлам для удаления
  jobId: string;               // ID завершённой задачи
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
4. **Browser cleanup** — `await browser.close()` гарантированно
5. **No crash** — процесс Worker продолжает слушать следующие задачи
