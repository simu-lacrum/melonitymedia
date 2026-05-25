# MelonityMedia — Architecture Memory (Source of Truth)

> This file is the **project memory**. Every agent MUST read it before writing code.
> It contains all locked decisions, patterns, conventions, and constraints.
> Updated as new decisions are made.

---

## 1. Project Identity

- **Name:** MelonityMedia
- **Purpose:** Client-server web panel (SPA) for automating vertical video uploads (TikTok / YouTube Shorts), account warming, cookie farming, and analytics collection.
- **Target Audience:** Russian-speaking traffic arbitrageurs (вебмастера)
- **UI Language:** Russian
- **Code Language:** English (variables, comments, docs)

## 2. Stack (Locked)

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | Next.js (App Router) | 15.x |
| CSS | Tailwind CSS | v4 (`@theme` syntax) |
| Charts | Recharts | 2.x |
| DnD | @dnd-kit | 6.x |
| Icons | lucide-react | latest |
| Backend API | Express.js | 4.x |
| ORM | Prisma | 6.x |
| Database | PostgreSQL | 16 |
| Cache/Queue Broker | Redis | 7 |
| Task Queue | BullMQ | 5.x |
| Realtime | Socket.io | 4.x |
| Browser Automation | undetected-chromedriver-js + selenium-webdriver | latest |
| HTML Parser | cheerio (Node.js bs4) | latest |
| Runtime | Node.js | ≥ 20 |
| Language | TypeScript | 5.7+ |

## 3. Repository Structure (Locked)

```
MelonityMedia/
├── package.json              # npm workspaces root
├── tsconfig.base.json        # shared TS config
├── docker-compose.yml        # all services
├── .env.example
├── .gitignore
├── .memory/                  # project context memory (this dir)
│   └── ARCHITECTURE.md       # THIS FILE
├── docs/                     # documentation
│   ├── guides/
│   └── architecture/
├── apps/
│   ├── web/                  # Next.js 15 frontend
│   │   ├── src/
│   │   │   ├── app/          # App Router pages
│   │   │   ├── components/   # UI + Layout components
│   │   │   ├── lib/          # utils, api client, socket
│   │   │   └── middleware.ts # auth + role guards
│   │   └── ...
│   ├── api/                  # Express.js backend
│   │   ├── prisma/           # schema + migrations
│   │   └── src/
│   │       ├── routes/       # REST endpoints
│   │       ├── middleware/   # auth, admin, firewall
│   │       └── lib/          # prisma, redis, bullmq, socket
│   └── worker/               # UndetectedChrome automation (selenium-webdriver)
│       ├── docker/           # Dockerfile + entrypoint.sh
│       └── src/
│           ├── core/         # BrowserAutomation class
│           ├── handlers/     # Job handlers (upload, warmup, etc.)
│           ├── plugins/      # Future: FFmpeg uniqualization pipeline
│           └── lib/          # socket-logger, helpers
└── uploads/                  # temp video storage (auto-cleaned)
```

## 4. Architectural Decisions (Locked)

### 4.1 Authentication
- JWT stored in HttpOnly cookie named `melonity_token`
- bcrypt with 12 salt rounds
- First registered user → auto role=ADMIN
- All subsequent users → role=USER
- Banned users get 403 immediately

### 4.2 Multitenancy
- STRICT userId isolation on every Prisma query
- Every model has `userId` foreign key
- Admin can see user stats but NEVER account passwords

### 4.3 Video Lifecycle (CRITICAL)
```
Upload via DnD → API saves to uploads/ → path stored in DB (Video model)
  → Worker picks up job → uploads to TikTok/YouTube
  → On success: Video.isUploaded = true, Video.uploadedAt = now()
  → Cleanup cron: deletes physical file from disk for isUploaded=true videos
  → Video record stays in DB for analytics (filepath cleared)
```
- `shouldDelete: true` by default — videos auto-cleaned after upload
- User can set `shouldDelete: false` to keep originals

### 4.4 Worker Architecture
- API server NEVER runs automation — all goes to BullMQ
- Worker runs in Docker with Xvfb (virtual display)
- `headless: false` inside Xvfb — avoids antifraud detection
- Proxy auth via dynamic Chrome extension (manifest v2)
- Mobile proxy IP rotation: GET rotation link → wait 12s → launch browser
- On CAPTCHA: screenshot → Socket.io log → mark job failed → close browser
- Analytics parsing: 1x daily cron via cheerio (NOT per-login)

### 4.5 Plugin Architecture (Scalability)
```
apps/worker/src/plugins/
  ├── index.ts              # plugin registry
  ├── base-plugin.ts        # abstract base class
  └── ffmpeg-uniqualize/    # future: video uniqualization
      └── index.ts
```
- Each plugin implements `BasePlugin { name, process(input) → output }`
- Pipeline: Video → [Plugin1] → [Plugin2] → Upload
- Currently empty, but structure exists for FFmpeg integration

### 4.6 BullMQ Queues
| Queue | Purpose | Concurrency |
|-------|---------|-------------|
| `upload` | Video upload to platforms | user.maxThreads |
| `warmup` | Account warming (scroll, like, comment) | user.maxThreads |
| `cookies` | Cookie farming on donor sites | user.maxThreads |
| `edit-profile` | Change avatar/banner/bio | 1 |
| `analytics-cron` | Nightly stats collection | 1 |
| `cleanup` | Delete uploaded videos from disk | 1 |

### 4.7 Socket.io
- Namespace: `/logs`
- Auth: JWT from handshake
- Rooms: `user:{userId}` — each user sees only their worker logs
- Events: `log` (worker → client), `task:progress`, `task:complete`, `task:failed`

### 4.8 Firewall
- Redis SET `firewall:blocked_ips`
- Express middleware checks on every request
- Admin can add/remove IPs via `/admin/firewall`

## 5. Design System (Locked — from design.md)

### Colors
| Token | Value | Usage |
|-------|-------|-------|
| --color-night-base | #1c2026 | Body, html, main bg |
| --color-header-glass | #1c202666 | Sticky headers + blur(35px) |
| --color-surface-dark | #262a30 | Cards, modals, scrollbar track |
| --color-melon-pink | #ff1469 | CTA buttons, active states |
| --color-pink-alpha | #ff146940 | Scrollbar thumb, soft glows |
| --color-success-green | #00d287 | Alive, active, success |
| --color-alert-red | #f43f5e | Banned, errors, failed |
| --color-warning-amber | #f59e0b | Auth required, captcha, pending |
| --color-pure-white | #ffffff | Primary text |
| --color-muted-gray | #9ca3af | Secondary text, placeholders |

### Typography — ONLY Roboto Flex
- Display/H1: 64px, 700, stretch 150%, full variation-settings
- Heading-md: 32px, 700, stretch 120%
- Button-label: 16px, 600
- Body-sm: 14px, 400
- Caption: 12px, 400

### Layout
- Max content: 1408px centered
- Header: glassmorphic, fixed, blur(35px)
- Scrollbar: 6px, pink-alpha thumb
- Container: padding 0 0 10.5rem, min-height 100vh

## 6. API Contracts

### Auth
```
POST /api/auth/register  { email, password, name }  → 201 + set cookie
POST /api/auth/login     { email, password }         → 200 + set cookie
POST /api/auth/logout                                → 200 + clear cookie
GET  /api/auth/me                                    → 200 { user }
```

### Accounts (userId-scoped)
```
GET    /api/accounts              → 200 [accounts]
POST   /api/accounts/import       → 201 { imported: number }
PATCH  /api/accounts/:id          → 200 { account }
DELETE /api/accounts/:id          → 200
POST   /api/accounts/bulk-update  → 200 { updated: number }
```

### Proxies (userId-scoped)
```
GET    /api/proxies       → 200 [proxies]
POST   /api/proxies       → 201 { proxy }
PATCH  /api/proxies/:id   → 200 { proxy }
DELETE /api/proxies/:id   → 200
POST   /api/proxies/check → 200 { status }
```

### Workspace
```
POST /api/workspace/upload      → 201 { video }      (multipart)
POST /api/workspace/launch      → 201 { task }
POST /api/workspace/queue/add   → 200 { added: true }
GET  /api/workspace/presets     → 200 [presets]
POST /api/workspace/presets     → 201 { preset }
```

### Videos (userId-scoped)
```
GET    /api/videos          → 200 [videos]
PATCH  /api/videos/reorder  → 200
DELETE /api/videos/:id      → 200
```

### Analytics
```
GET /api/analytics/summary     → 200 { totalViews, aliveAccounts, ... }
GET /api/analytics/views-chart → 200 [{ date, views }]
GET /api/analytics/active-tasks → 200 [tasks]
```

### Admin (role=ADMIN only)
```
GET    /api/admin/runtime           → 200 { db, redis, workers, cpu, ram }
GET    /api/admin/users             → 200 [users]
PATCH  /api/admin/users/:id         → 200 { user }
POST   /api/admin/users/:id/ban     → 200
POST   /api/admin/firewall/block    → 201 { ip }
DELETE /api/admin/firewall/unblock  → 200
GET    /api/admin/firewall          → 200 [ips]
```

## 7. Git Workflow

- Remote: `https://github.com/simu-lacrum/melonitymedia`
- Main branch: `main` (protected, no direct pushes)
- Feature branches: `feat/foundation`, `feat/dashboard`, `feat/profiles`, `feat/workspace`, `feat/admin`, `feat/workers`
- Docs branch: `docs/initial`
- Commit lanes: Backend/API, Workers/Core, Admin UI, Account UI
- Never mix backend and frontend in same commit (unless E2E feature)

## 8. Code Style (Karpathy-inspired)

- Every non-trivial block gets a comment explaining WHY
- No magic numbers — named constants
- Error handling is explicit — no silent catches
- Functions are small, focused, testable
- Build from first principles — understand before using
- No fake success — UI shows only real backend states
