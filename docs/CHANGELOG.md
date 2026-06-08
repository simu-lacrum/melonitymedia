# Changelog

## [0.3.2] - 2026-06-08

### Fixed (Security Hardening Audit — 33 issues resolved)

#### 🔴 CRITICAL
- **M-1**: `dispatchAccountJob()` теперь отклоняет задачи для BANNED/PAUSED аккаунтов (кроме login queue). Ранее можно было запустить воркер-задачу для забаненного аккаунта.
- **M-2**: `POST /:id/regenerate-fingerprint` с `force=true` теперь требует ADMIN роль. Обычный пользователь не может форсировать смену fingerprint на опубликованном аккаунте.
- **M-5**: Firewall middleware переписан: используется `req.ip` (respects `trust proxy`) вместо сырого `x-forwarded-for` заголовка, который подделывается клиентом.
- **M-8**: Создание прокси `POST /proxies` теперь проверяет дубликаты `host:port` для пользователя (возвращает `409 Conflict`).

#### 🟠 HIGH
- **H-3**: Proxys.io API key отправляется в `Authorization: Bearer` header вместо URL query string (утечка через Referer/логи).
- **H-4**: Workspace cookie export `/cookies/export` теперь пишет `[AUDIT]` лог с userId, email и количеством экспортированных cookies.
- **H-5**: Worker `patchright-launcher.ts` proxy lookup теперь scoped по `userId` через `loadAccountContext()` — предотвращена cross-tenant утечка rotation key.
- **H-6**: Аналитика fan-out переписана на shared `bullmq.ts` singleton — убрана утечка Redis-коннектов при каждом cron цикле.
- **H-2**: Zod-схема для `PATCH /proxies/:id` — блокирует инъекцию произвольных полей в update.

#### 🟡 MEDIUM
- **M-6**: Cookie disk cache теперь сравнивает `updatedAt` с DB `cookiesUpdatedAt` — stale cache автоматически обновляется из DB.
- **M-7**: Warmup engagement probabilities масштабируются пропорционально фазе (proportional) вместо hardcoded phase offsets.
- **M-4**: Upload handler проверяет `isUploaded` перед загрузкой — BullMQ retry не создаёт дубликатов на TikTok/YouTube.
- **M-3**: Upload handler бросает ошибку при обнаружении error text на странице TikTok (вместо silent `isUploaded = true`).

#### 🔵 LOW
- **L-1**: Rate limit для auth endpoints ужесточён: 10 → **5 запросов / 15 мин**, + добавлен общий API rate limit 100 req/min.
- **L-2**: Пароль для Redis вынесен в `.env` переменную `REDIS_PASSWORD`, docker-compose запускает Redis с `--requirepass`.
- **L-3**: Bulk delete аккаунтов (`DELETE /accounts/bulk`) автоматически отменяет все PENDING/RUNNING задачи пользователя.
- **L-5**: Next.js middleware валидирует JWT структуру (3 base64url-encoded части), очищает garbage cookie вместо redirect loop.
- **L-4**: PostgreSQL credentials вынесены из docker-compose в `.env` (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`).

### Fixed (Re-audit — 3 additional issues)
- **FIX-A1**: Bulk import прокси (manual и proxys.io mode) теперь пропускает дубликаты `host:port` вместо создания дублей.
- **FIX-A2**: Nginx security headers: добавлены `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `X-XSS-Protection`.
- **FIX-A3**: Provider import (`POST /proxies/import/provider`) теперь пропускает дубликаты при повторном импорте.

### Added
- **`apps/worker/src/lib/bullmq.ts`**: Singleton BullMQ queue map для worker — предотвращает создание новых Queue instances при каждом fan-out.
- **`apps/api/src/lib/job-dispatch.ts`**: Centralized job dispatch с BANNED/PAUSED guard и cross-tenant validation.
- **Nginx reverse proxy**: `nginx/default.conf` с security headers, WebSocket support, 500MB upload limit.
- **Docker SSL prep**: Порт 443 + SSL certificate volume примонтированы в docker-compose (готово к certbot).
- **Admin unban**: `POST /admin/users/:id/unban` — разбан пользователя с проверками и audit log.
- **IP validation**: `POST /admin/firewall` теперь валидирует IP формат через `net.isIP()`.

### Changed
- **README.md**: Обновлены секции Security (33 меры), Queues (8 вместо 7), Env vars (Redis auth, Postgres credentials), Docker (nginx, Redis auth), API endpoints (rate limits, new endpoints).
- **Rate limits**: Auth 10→5 req/15min, добавлен общий API rate limit 100 req/min.
- **Redis**: Запускается с аутентификацией `--requirepass`, URL содержит пароль.
- **Worker**: Все handlers используют `loadAccountContext()` вместо stale BullMQ payload для proxy/fingerprint resolution.

## [0.3.1] - 2026-06-08

### Fixed (Core Automation Audit — 7 issues resolved)

#### 🔴 CRITICAL
- **CRITICAL-1**: `buildExtra()` in `workspace.ts` was broken for EDIT_PROFILE — frontend sent `{ nickname, bio, avatarUrl }` flat in config, but worker expected `data.changes.name` / `data.changes.bio`. Profile edits silently did nothing. Fixed: `buildExtra()` now maps each task type individually (EDIT_PROFILE, WARMUP, UPLOAD, default).
- **CRITICAL-2**: Avatar upload was never implemented in `edit-profile.ts` — only `name` and `bio` were handled. Added full avatar flow: download from URL → temp file → click avatar area → upload via file input → confirm crop dialog. Supports both TikTok and YouTube Studio selectors.

#### 🟡 HIGH
- **HIGH-3**: Warmup hashtags from workspace UI were nested inside `config` object but worker expected `data.hashtags` at top level. Fixed: `buildExtra()` for WARMUP now flattens hashtags to root payload.
- **HIGH-4**: Warmup was single-day only — user had to manually re-launch each day. Added self-rescheduling: after completing day N (when N < totalDays), warmup handler automatically schedules day N+1 via BullMQ with 20-28h randomized delay. Full 10-day warmup now runs automatically.
- **HIGH-5**: Upload description from workspace UI was ignored — `buildExtra()` used `video.description` from DB record instead of `config.description` from user input. Fixed priority: `config.description → video.description → ""`.

#### 🟢 MEDIUM
- **MEDIUM-6**: Video uniquification used only `accountId` as FFmpeg transform seed — same account uploading different videos got identical transforms (crop, brightness, hue). Changed seed to `accountId:inputPath` for per-video unique transforms.
- **MEDIUM-7**: Identified that YouTube warmup engagement is not yet implemented (TikTok-only). Documented as known limitation.

### Added
- **Cron Scheduler**: `apps/api/src/lib/cron-scheduler.ts` — registers BullMQ repeatable jobs on API startup:
  - Analytics collection every 6 hours (`analytics-cron`)
  - Shadowban detection every 12 hours (`shadowban-check`)
- **Analytics Persistence**: `analyticsHandler` now writes fetched followers/views to `SocialAccount` table via `prisma.socialAccount.update()`. Previously data was only emitted via Socket.io without DB persistence — dashboard charts showed no data.
- **Analytics Fan-Out**: Cron analytics job now fans out to individual per-account jobs with staggered delays (2-5s per account) to prevent API rate limits.
- **Warmup Auto-Continuation**: Self-rescheduling mechanism in `warmup.ts` — after each day completes, next day is auto-queued with 20-28 hour randomized delay to avoid pattern detection.
- **Avatar Upload**: Full avatar upload capability in `editProfileHandler` — downloads image from user-provided URL, clicks avatar edit area, uploads via file input, confirms crop dialog.

### Changed
- **`buildExtra()` rewrite** (`workspace.ts`): Now handles 4 task types individually instead of a single `UPLOAD` vs `default` split:
  - `EDIT_PROFILE` → `{ taskId, changes: { name, bio, avatarUrl } }`
  - `WARMUP` → `{ taskId, hashtags, warmupDays }` (flattened)
  - `UPLOAD` → `{ taskId, videoId, videoPath, title, description, hashtags }` (config.description priority)
  - Default (COOKIES) → `{ taskId, config }` (unchanged)
- **Uniquifier seed** (`uniquifier.ts`): Changed from `createSeededRandom(accountId)` to `createSeededRandom(accountId:inputPath)`.
- **API startup** (`index.ts`): Added `registerCronJobs()` call on server start to initialize repeatable BullMQ jobs.

## [0.3.0] - 2026-06-07

### Added
- **Platform Filter Tabs**: `/account/accounts` now has TikTok / YouTube / Все filter tabs with badge counts.
- **Dual-Format Import**: Account import dialog supports both **cookies (JSON)** and **login:password** methods via tabbed interface.
- **Proxy Binding on Import**: Import dialog includes optional proxy selector for auto-binding on creation.
- **Account Multi-Select in Workspace**: Workspace page now shows scrollable checklist of all accounts with TT/YT badges and select-all/deselect-all toggle.
- **3-Dot Action Menu (Accounts)**: Per-row dropdown menu with: Привязка прокси, Обновление куки, Удаление.
- **Proxy ↔ Account Binding Dialog (Proxies)**: Clickable "Аккаунтов" column opens dialog showing linked accounts with unbind/bind controls.
- **Account Binding on Proxy Creation**: Add Proxy dialog now includes optional multi-select for immediate account binding.
- **shadcn/ui Migration**: All UI components migrated to shadcn/ui (base-ui primitives) with Melonity design system styling.
- **DESIGN-melonity-gg.md**: Added comprehensive design identity document (Emil Kowalski design language).

### Changed
- **Workspace Tabs**: Reduced from 5 to 4 tabs — removed "Логин" (redundant with "Куки" mode). New order: Прогрев → Куки → Профиль → Залив.
- **Launch Endpoint**: `POST /api/workspace/launch` now receives `accountIds[]` array instead of `applyToAll: true`.
- **Import API Schema**: `POST /api/accounts/import` now accepts both `raw`/`method` (new) and `data`/`authMode` (legacy) field names for backward compatibility. Added optional `proxyId` field.
- **Header Component**: Unified header across landing and dashboard with glass effect, Roboto Flex font, and Melonity branding.
- **Design System**: Applied DESIGN-melonity-gg.md identity across all pages: Roboto Flex variable font, strict dark palette, glass morphism cards, micro-animations.
- **Bulk Actions Bar**: Changed from floating pill (`rounded-full`, `liquid-glass`) to card-style bar (`rounded-lg`, `bg-card`).

### Removed
- **Login Tab (Workspace)**: Removed Login tab and `LoginConfig` interface — cookie collection via "Куки" tab covers this functionality.
- **Login BullMQ Queue**: Removed `login` queue from documentation (7 queues total instead of 8).

## [0.2.2] - 2026-06-02

### Fixed (Technical Audit 02-06 — 21 issues resolved)

#### 🔴 CRITICAL
- **BUG-C1**: `cookies.ts` handler now uses `loadAccountContext()` instead of stale BullMQ payload for proxy/fingerprint/platform.
- **BUG-C2**: `edit-profile.ts` handler now uses `loadAccountContext()` — same fix as C1.
- **BUG-C3**: `isShortsCompatible()` threshold tightened from 0.85 to 0.75 (3:4 max aspect ratio for Shorts).
- **BUG-C5**: `warmup.ts` now saves cookies to DB via centralized `persistCookies()` (was disk-only, cookies lost on container restart).

#### 🟠 HIGH
- **BUG-H1**: `upload.ts` now persists cookies to DB via `persistCookies()` (was disk-only).
- **BUG-H2**: `edit-profile.ts` now persists cookies to DB after session close.
- **BUG-H3**: `cookies.ts` handler now persists cookies to DB (ironic — the "cookies" handler wasn't saving cookies to DB).
- **BUG-H4**: `_lightEngagement` comment trigger — `_randomDelay()` now called once outside loop as `commentAtIndex` instead of regenerating each iteration.
- **BUG-H5**: PATCH account status now blocks BANNED/SHADOWBAN_SUSPECTED→ALIVE transitions without admin force-override.
- **BUG-H7**: `buildProxyUrl()` now throws explicit Error on invalid URL construction instead of silent fallback to garbage URL.

#### 🟡 MEDIUM
- **BUG-M1**: Documented fingerprint generator divergence (API vs Worker) with warning header — intentional design, different PRNG strategies.
- **BUG-M3**: Removed hardcoded dota2 hashtags from warmup — now uses only user-provided hashtags.
- **BUG-M6**: `/queue` POST now dispatches BullMQ jobs for added videos (was only updating DB config without creating actual jobs).
- **BUG-M7**: Sequential warmup via `lastWarmupDay` field — prevents phase-skipping when server was offline for multiple days.

#### 🟢 LOW
- **BUG-L1**: curl-impersonate default profile changed from `chrome131` (non-existent) to `chrome116`.
- **BUG-L3**: Shadowban detector video query now includes `userId` scope for consistency with project conventions.
- **BUG-L4**: Fingerprint generator now warns when `geo.country` is not in locale/timezone lookup table.
- **BUG-L5**: TikTok upload now checks for error text on page after publishing (was blindly assuming success).
- **BUG-L8**: YouTube session validator now handles HTTP 302/303 redirects to Google login page.
- **BUG-L9**: Imported account IDs now use full UUID (32 hex chars) instead of truncated 25-char UUID.

### Added
- **`persistCookies()`**: Centralized cookie persistence function in `cookie-store.ts` — writes to disk cache AND encrypted DB in one atomic operation. All handlers now use this instead of ad-hoc disk-only saves.
- **`lastWarmupDay`**: New `Int` field in `SocialAccount` Prisma schema for sequential warmup day tracking.
- **Status Transition Guard**: `accounts.ts` PATCH endpoint now validates status transitions to prevent anti-fraud bypass.

### Changed
- **Prisma schema**: Added `lastWarmupDay Int @default(0)` to `SocialAccount` model.
- **Session validator**: YouTube validation now detects empty body responses and HTTP 302/303 redirects.
- **Fingerprint generator**: Geo-unrecognized countries now produce console warning instead of silent US defaults.

## [0.2.1] - 2026-06-01

### Fixed (Technical Audit — 34 issues resolved)

#### 🔴 CRITICAL
- **CRIT-01**: Removed duplicate header comment in `proxies.ts` (merge artifact).
- **CRIT-02**: `PATCH /proxies/:id` now updates `host`, `port`, `username`, `password` individually (was only updating `address` composite field, leaving worker using stale values).
- **CRIT-03**: Moved `DELETE /bulk` before `DELETE /:id` route and changed to `POST /bulk-delete` to fix Express route ordering collision and HTTP semantics.
- **CRIT-04**: `POST /accounts/warmup` now dispatches BullMQ jobs via `dispatchAccountJob()` (was only creating DB Task without actual queue dispatch).
- **CRIT-05**: `POST /accounts/cookies` now dispatches BullMQ jobs via `dispatchAccountJob()` (same issue as CRIT-04).
- **CRIT-06**: ProxyGrow rotation URL changed from `http://` to `https://` (API key was being sent in plaintext). Removed unused `crypto` import.

#### 🟠 HIGH
- **HIGH-01/02**: Fixed ALIVE/ACTIVE enum mismatch — `patchAccountSchema` now uses `ALIVE` (matching Prisma enum and all handler code).
- **HIGH-03**: Rewrote `decomposeAddress()` to handle passwords containing `:` or `@` using `lastIndexOf('@')` and `indexOf(':')`.
- **HIGH-05**: Replaced proxy test stub with real TCP connectivity test via `undici.ProxyAgent` → `api.ipify.org`. Removes credential leak from response.
- **HIGH-06**: Changed `DELETE /admin/firewall` → `POST /admin/firewall/unblock` (DELETE with body violates HTTP semantics).
- **HIGH-07**: `enrichProxy()` now uses DB values for `lastIP`/`lastIPAt` instead of hardcoding `null`.
- **HIGH-08**: Video reorder endpoint now verifies `userId` ownership before updating order (IDOR fix).
- **HIGH-09**: `warmupDay` clamp fixed — was `warmupDays + 1`, now correctly caps at `warmupDays`.

#### 🟡 MEDIUM
- **MED-01**: PRNG entropy in `uniquifier.ts` — changed `idx % 28` to proper `idx >= 32` check with SHA-256 re-hashing to extend sequence.
- **MED-02**: Video end trim now uses `ffprobe` to get actual duration and calculates `effectiveDuration = duration - trimStart - trimEnd`.
- **MED-04**: Fingerprint timezone now geo-based (11-country lookup map) instead of using server timezone.
- **MED-05**: Session validator now accepts `platform` parameter and uses platform-specific validation URLs (TikTok API vs YouTube /account).
- **MED-06**: Added Zod `updateUserSchema` with `.strict()` to `PATCH /admin/users/:id`.
- **MED-07**: Socket.io cookie parsing now uses `.replace()` instead of `.split('=')[1]` to handle JWT Base64 `=` padding.
- **MED-08**: Warmup handler now saves session cookies in `finally` block before closing browser.
- **MED-09**: Admin self-ban prevention — `POST /users/:id/ban` now rejects if target matches current user.

#### 🔵 LOW
- **LOW-01**: Removed `'change-me'` JWT_SECRET fallback from `auth.ts` middleware and `socket.ts`.
- **LOW-02**: Cookie `maxAge` now synced with `JWT_EXPIRES_IN` via `ms()` instead of hardcoded 7 days.
- **LOW-03**: MASTER_KEY now required at API startup (was optional, causing runtime errors on encrypt/decrypt).
- **LOW-04**: Moved inline `import { buildProxyUrl }` from end of `account-context.ts` to top of file.
- **LOW-05**: Removed unused `_accountId` parameter from `buildExtra()` in `workspace.ts`.
- **LOW-06**: MASTER_KEY validation added to login handler's `decryptField()` function.
- **LOW-07**: Removed `DATACENTER_DEPRECATED` from `createProxySchema` Zod enum.
- **LOW-08**: Removed dead `compat.ok` re-check in YouTube upload handler (already throws on line 349).
- **LOW-09**: `enrichProxy()` now strips `address` field from API responses (was leaking proxy credentials).

### Changed
- **Analytics**: `days` query parameter capped to `1-365` range with NaN protection.
- **Upload handler**: Passes `platform` to `validateCookies()` for platform-aware session validation.
- **Worker index.ts**: MASTER_KEY validation split into existence check + length check for clearer error messages.

## [0.2.0] - 2026-05-30

### Added
- **LOGIN Queue**: New BullMQ queue (`login`) for automated account authorization via `login:pass` through Patchright. Total queues: 7 → 8.
- **Rate Limiting**: Auth endpoints (`/auth/register`, `/auth/login`) rate-limited to 10 requests per 15 minutes (Redis-backed).
- **Admin Panel**: Full admin page with Runtime health (DB/Redis/CPU/RAM), Users management (soft-ban, thread limits), and IP Firewall (Redis blacklist).
- **Docker Production**: Multi-stage Dockerfiles for API and Web services with OpenSSL support for Prisma, workspace stub resolution, and health checks.
- **Prisma Schema**: Added `LOGIN` to `TaskType` enum, `ACTIVE`/`PAUSED` to `AccountStatus` enum, `binaryTargets` for Docker Debian builds.

### Changed
- **REST Naming Convention**: Renamed 6 endpoints to follow RESTful conventions:
  - `POST /accounts/bulk-update` → `PATCH /accounts/bulk`
  - `POST /accounts/bulk-proxy` → `PATCH /accounts/bulk/proxy`
  - `POST /workspace/queue/add` → `POST /workspace/queue`
  - `POST /proxies/import-from-provider` → `POST /proxies/import/provider`
  - `POST /admin/firewall/block` → `POST /admin/firewall`
  - `DELETE /admin/firewall/unblock` → `DELETE /admin/firewall`
- **Docker Ports**: Host ports changed to `5433:5432` (DB) and `6380:6379` (Redis) to avoid conflicts. Configurable via `PORT_DB`/`PORT_REDIS` env vars.
- **Database Hostnames**: `.env` now uses Docker-internal hostnames (`db:5432`, `redis:6379`) instead of `localhost`.
- **Firewall Middleware**: Now uses `req.ip` instead of raw `X-Forwarded-For` header for proper Express trust proxy handling.

### Fixed
- **Security**: JWT_SECRET and MASTER_KEY validated at startup with fail-fast (`process.exit(1)`) if missing or invalid.
- **Cookie Store**: Worker validates MASTER_KEY at init, preventing silent encryption failures.
- **Session Persistence**: Upload handler saves cookies in `finally` block to prevent session loss on errors.
- **FFmpeg Cancellation**: Video uniquifier uses `AbortController` for proper FFmpeg process cleanup.
- **Input Validation**: Zod schemas added for `PATCH /accounts/:id` and workspace queue endpoints.
- **Per-Account Delays**: BullMQ jobs now respect per-account `delayMin`/`delayMax` randomized startup delays.
- **Patchright Reference**: Fixed stale Puppeteer references in worker code comments.
- **TypeScript Build**: Removed `@next/swc-wasm-nodejs` devDependency causing build issues.
- **Duplicate Auth Pages**: Removed duplicate auth page files from old layout.

## [0.1.1] - 2026-05-27

### Fixed
- **UI Architecture**: Fixed casing sensitivity issues breaking the Linux/Vercel build pipelines by normalizing all `components/ui` filenames to fully lowercase.
- **Radix UI Polymorphism**: Resolved `React.Children.only` crash during static prerendering in `Button` by wrapping internal children with `@radix-ui/react-slot`'s `<Slottable>` component when `asChild` is enabled.
- **TypeScript Strict Safety**: Corrected `DragEvent` generic typing conflicts in `DropZone` by refactoring custom handlers to explicitly handle `FileList`.
- **Badge Stability**: Updated `Badge` props to properly handle optional `children` and dynamic injection.
- **Production Build**: Verified that Next.js `npm run build` succeeds and successfully generates all 16 static routes without compiler or type-checker errors.
