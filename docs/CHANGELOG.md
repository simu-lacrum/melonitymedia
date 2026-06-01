# Changelog

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
