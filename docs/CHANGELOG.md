# Changelog

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
