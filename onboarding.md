# MelonityMedia — Onboarding Document

> **Назначение документа:** сопроводительное описание проекта для загрузки в другую нейросеть с целью технического аудита. Содержит полную информацию об архитектуре, стеке, реализации, конвенциях и известных проблемах.

---

## 1. Что делает проект

MelonityMedia — **закрытая enterprise-панель** для компании Melonity, предназначенная для массовой автоматизации работы с аккаунтами TikTok и YouTube Shorts. Целевая аудитория — арбитражники вертикального видеоконтента (вебмастеры).

### Бизнес-функции

| Функция | Описание |
|---------|----------|
| **Массовый залив видео** | Загрузка видео на TikTok/YT Shorts через антидетект-браузер с ротацией мобильных прокси |
| **Уникализация видео** | FFmpeg-пайплайн: изменение bitrate, metadata strip, audio noise, pixel shift для обхода fingerprint |
| **Прогрев аккаунтов** | 10-дневная прогрессивная программа: скроллинг, лайки, комментарии с человекоподобной задержкой |
| **Фарминг cookies** | Нагул сессий на донорских сайтах для поддержания «живых» аккаунтов |
| **Управление прокси** | CRUD, тестирование, LTE-ротация IP через API мобильных ферм |
| **Аналитика** | Cron-сбор подписчиков, просмотров через curl-impersonate (не браузер) |
| **Shadowban-детекция** | Cron-проверка аккаунтов на shadowban через публичные API |
| **Антифрод** | IP firewall (Redis blacklist), RBAC, per-account fingerprints, cookie-only auth |
| **Админка** | Runtime health monitoring, управление пользователями, firewall |

### Ключевой принцип безопасности

Аккаунты авторизуются **исключительно через cookies** (AES-256-GCM шифрование). Прямой ввод login:password в формы TikTok запрещён — это мгновенный сигнал антифроду. Cookies экспортируются из реального браузера пользователя и загружаются в систему.

---

## 2. Стек технологий

| Слой | Технологии | Версия |
|------|-----------|--------|
| **Frontend** | Next.js (App Router), React, Tailwind CSS v4, Lucide Icons | 15.x, 19.x, 4.x |
| **Backend API** | Express.js, Prisma ORM, Socket.io, Zod | 4.x, 5.x |
| **Worker** | BullMQ, **Patchright** (patched Playwright fork), curl-impersonate, FFmpeg | 3.x, latest |
| **Database** | PostgreSQL | 16 |
| **Cache/Queue** | Redis (BullMQ broker + IP firewall + cache) | 7 |
| **Auth** | JWT (HttpOnly Cookies), bcrypt (12 rounds) | — |
| **Encryption** | AES-256-GCM (cookies, API keys), MASTER_KEY (base64, 32 bytes) | — |
| **Infra** | Docker Compose, Xvfb (virtual display :99) | — |
| **Language** | TypeScript (strict mode) | 5.x |

### Важные уточнения по стеку

1. **Patchright, а не Puppeteer/Selenium.** Worker использует `patchright` — форк Playwright, патчащий CDP handshake для обхода Akamai/Datadome/TikTok BotManager. Импорт puppeteer, selenium и undetected-chromedriver **запрещён** (линтер блокирует). Исторически проект прошёл через 3 итерации: Puppeteer+StealthPlugin → undetected-chromedriver-js → Patchright.

2. **curl-impersonate, а не HTTP-клиенты.** Для API-запросов без браузера (аналитика, rotation) используется `curl-impersonate` — бинарник с подменой TLS-fingerprint, чтобы запросы выглядели как запросы из Chrome.

3. **FFmpeg для уникализации.** Перед загрузкой каждое видео проходит через FFmpeg-пайплайн, который делает его уникальным для каждого аккаунта (сдвиг пикселей, шум audio, strip metadata, изменение bitrate).

---

## 3. Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (Next.js 15 SPA)                                   │
│  ┌─────────┐ ┌──────────┐ ┌───────────┐ ┌────────┐         │
│  │Dashboard│ │ Accounts │ │ Workspace │ │ Admin  │         │
│  └────┬────┘ └────┬─────┘ └─────┬─────┘ └───┬────┘         │
└───────┼──────────┼─────────────┼───────────┼───────────────┘
        │          │             │           │
        ▼          ▼             ▼           ▼
┌─────────────────────────────────────────────────────────────┐
│  API Server (Express.js :4000)                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────┐    │
│  │JWT Auth  │ │RBAC Admin│ │ Firewall │ │ Socket.io   │    │
│  │Middleware│ │Middleware│ │Middleware│ │ (Live Term) │    │
│  └──────────┘ └──────────┘ └──────────┘ └─────────────┘    │
│  Routes: auth | accounts | proxies | workspace | admin      │
│          analytics | videos                                 │
└───────┬─────────────────────────────┬──────────────────────┘
        │ Prisma ORM                  │ BullMQ dispatch
        ▼                             ▼
┌──────────────┐              ┌──────────────┐
│ PostgreSQL 16│              │   Redis 7    │
│  (tenant DB) │              │ (queue+cache)│
└──────────────┘              └──────┬───────┘
                                     │ Job dequeue
                                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Worker (Docker: Xvfb + Chrome + Patchright + ffmpeg)       │
│  8 BullMQ queues → 8 handlers                              │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────────┐         │
│  │ Upload │ │ Warmup │ │Cookies │ │Edit Profile  │         │
│  └────────┘ └────────┘ └────────┘ └──────────────┘         │
│  ┌──────────────┐ ┌─────────┐ ┌──────────────────┐         │
│  │Analytics Cron│ │ Cleanup │ │ Shadowban Check  │         │
│  └──────────────┘ └─────────┘ └──────────────────┘         │
│  ┌─────────┐                                               │
│  │  Login  │ (cookie extraction from login forms)           │
│  └─────────┘                                               │
└─────────────────────────────────────────────────────────────┘
```

### Потоки данных

1. **Пользователь → Web → API → Redis (BullMQ)** — dispatch задачи
2. **Worker ← Redis** — dequeue задачи
3. **Worker → Patchright → Chrome → TikTok/YouTube** — браузерная автоматизация
4. **Worker → Socket.io → Web** — real-time логи в Live Terminal
5. **Worker → PostgreSQL** — обновление статуса аккаунтов/видео

---

## 4. Структура кодовой базы

```
MelonityMedia/
├── apps/
│   ├── api/                          # Express.js backend
│   │   ├── prisma/
│   │   │   └── schema.prisma         # БД-схема (325 строк, 7 моделей)
│   │   └── src/
│   │       ├── index.ts              # Server entrypoint (CORS, Helmet, Socket.io)
│   │       ├── routes/
│   │       │   ├── auth.ts           # register, login, logout, me
│   │       │   ├── accounts.ts       # CRUD, import, bulk-proxy, fingerprints (28KB)
│   │       │   ├── proxies.ts        # CRUD, test, rotation, carrier validation (18KB)
│   │       │   ├── workspace.ts      # upload, launch, presets, cookies export (12KB)
│   │       │   ├── admin.ts          # runtime health, users management, firewall
│   │       │   ├── analytics.ts      # stats aggregation
│   │       │   └── videos.ts         # video metadata
│   │       ├── middleware/
│   │       │   ├── auth.ts           # JWT verification (HttpOnly cookie)
│   │       │   ├── admin.ts          # RBAC role=ADMIN check
│   │       │   └── firewall.ts       # Redis IP blacklist
│   │       └── lib/                  # prisma, redis, bullmq singletons
│   │
│   ├── web/                          # Next.js 15 frontend
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── page.tsx          # Landing (21KB — enterprise marketing page)
│   │   │   │   ├── globals.css       # Design system tokens (Strict Corporate Dark)
│   │   │   │   ├── layout.tsx        # Root layout
│   │   │   │   ├── not-found.tsx     # 404 page
│   │   │   │   ├── auth/
│   │   │   │   │   ├── login/page.tsx
│   │   │   │   │   └── register/page.tsx
│   │   │   │   └── account/
│   │   │   │       ├── layout.tsx    # Sidebar + Header layout
│   │   │   │       ├── dashboard/page.tsx  # KPI cards + Recharts + BullMQ status
│   │   │   │       ├── accounts/page.tsx   # DataTable + import + bulk ops
│   │   │   │       ├── workspace/page.tsx  # 4 tabs + DropZone + Terminal
│   │   │   │       ├── proxies/page.tsx    # Proxy management
│   │   │   │       └── settings/page.tsx   # User settings
│   │   │   ├── components/
│   │   │   │   ├── ui/               # 26 reusable components (see §8)
│   │   │   │   └── layout/           # Header, Sidebar
│   │   │   └── lib/                  # utils, api client
│   │   └── public/                   # Logo SVG
│   │
│   └── worker/                       # BullMQ job processor
│       ├── Dockerfile                # Chrome + Xvfb + curl-impersonate + ffmpeg
│       ├── entrypoint.sh             # Xvfb :99 virtual display startup
│       └── src/
│           ├── index.ts              # Worker entrypoint (8 queues, 154 строки)
│           ├── core/
│           │   ├── browser/
│           │   │   ├── patchright-launcher.ts   # ГЛАВНЫЙ: stealth browser launch
│           │   │   └── fingerprint-manager.ts   # Per-account fingerprint generation (26KB)
│           │   ├── auth/
│           │   │   ├── cookie-store.ts          # AES-256-GCM cookie encryption (9.7KB)
│           │   │   └── session-validator.ts     # Cookie validity check
│           │   ├── proxy/
│           │   │   ├── rotation-client.ts       # Multi-provider rotation API
│           │   │   ├── lte-rotation.ts          # LTE modem rotation logic
│           │   │   └── carrier-validator.ts     # ASN/BGP carrier validation
│           │   ├── video/
│           │   │   ├── uniquifier.ts            # FFmpeg uniquification pipeline (7KB)
│           │   │   └── inspector.ts             # Video metadata inspection
│           │   ├── captcha/
│           │   │   ├── capsolver-client.ts       # CapSolver API integration
│           │   │   └── tiktok-captcha-handler.ts # TikTok-specific captcha solving
│           │   ├── humanity/
│           │   │   ├── biomouse.ts              # Human-like mouse movement (Bézier curves)
│           │   │   └── typing-emulator.ts       # Human-like typing with random delays
│           │   └── tls/
│           │       └── curl-impersonate-client.ts # TLS fingerprint impersonation
│           ├── handlers/
│           │   ├── index.ts              # Re-exports all handlers
│           │   ├── upload.ts             # Video upload to TikTok/YT (20KB — самый большой)
│           │   ├── warmup.ts             # 10-day progressive warmup (14KB)
│           │   ├── cookies.ts            # Cookie farming
│           │   ├── edit-profile.ts       # Profile editing automation
│           │   ├── analytics.ts          # Stats parsing via curl-impersonate
│           │   ├── cleanup.ts            # Post-upload file cleanup
│           │   ├── shadowban-detector.ts # Shadowban detection
│           │   └── login.ts             # Cookie extraction from login
│           └── lib/                     # Socket logger, helpers
│
├── docs/
│   ├── CHANGELOG.md
│   ├── guides/
│   │   ├── local-development.md
│   │   ├── repository-map.md
│   │   └── interface-map.md
│   └── architecture/
│       └── backend-contracts.md
│
├── docker-compose.yml          # 5 сервисов: db, redis, api, web, worker
├── design.md                   # Дизайн-система (цвета, типографика, spacing)
├── .env.example                # Шаблон переменных окружения
├── tsconfig.base.json          # Shared TypeScript strict config
└── package.json                # Root monorepo (npm workspaces)
```

---

## 5. База данных (Prisma Schema v3.0)

### Модели

| Модель | Назначение | Ключевые поля |
|--------|-----------|---------------|
| **User** | Вебмастер (арбитражник) | `email`, `role` (USER/ADMIN), `maxThreads`, `isBanned` |
| **SocialAccount** | Аккаунт TikTok/YouTube | `cookiesEncrypted` (AES-256-GCM), `fingerprint` (JSON), `warmupDays`, `pinnedProxyId`, `status` |
| **Proxy** | Прокси-сервер | `host`, `port`, `type` (LTE_MOBILE/STATIC/DC), `rotationLink`, `rotationMode`, `provider`, `carrier`, `asn` |
| **Video** | Загружаемое видео | `filepath`, `status` (QUEUED→PROCESSING→UPLOADED/FAILED), `accountId`, `hashtags[]` |
| **Task** | BullMQ job wrapper | `type` (UPLOAD/WARMUP/COOKIES/...), `status`, `config` (JSON), `bullmqJobId`, `progress` |
| **Preset** | Сохранённый конфиг workspace | `config` (JSON snapshot) |
| **AuditLog** | Логи админ-действий | `action`, `details` (JSON), `ip` |

### Tenant Isolation

Все модели имеют `userId` FK. Каждый запрос к БД фильтруется по `userId` из JWT — пользователь видит только свои данные.

### Enum-ы

```
Role:          USER | ADMIN
Platform:      TIKTOK | YOUTUBE
AccountStatus: ALIVE | AUTH_NEEDED | BANNED | EXPIRED_COOKIES | SHADOWBAN_SUSPECTED | WARMING_UP
ProxyType:     LTE_MOBILE | STATIC_RESIDENTIAL | DATACENTER_DEPRECATED
ProxyProvider: MANUAL | PROXYS_IO | MOBILEPROXIES_ORG | PROXYGROW | ILLUSORY
ProxyStatus:   ACTIVE | DEAD
RotationMode:  MANUAL | PER_SESSION | SCHEDULED
VideoStatus:   QUEUED | PROCESSING | UPLOADED | FAILED
TaskType:      UPLOAD | WARMUP | COOKIES | EDIT_PROFILE | ANALYTICS_CRON | SHADOWBAN_CHECK
TaskStatus:    PENDING | RUNNING | COMPLETED | FAILED | CANCELLED
```

---

## 6. Worker — детали реализации

### 6.1. Browser Launch (patchright-launcher.ts)

```
launchStealthContext(opts) → { browser, context, page }

Поток:
1. Проверка fingerprint consistency (fatal → exception, stale → warning)
2. Если proxy с rotationMode=PER_SESSION → rotateProxy() + 5s delay
3. chromium.launch({ channel: 'chrome', headless: false, proxy })
4. browser.newContext({ viewport, locale, timezone, userAgent })
5. loadCookiesFromEncryptedStore() → context.addCookies()
6. applyFingerprint(page, fingerprint) — CDP overrides (canvas, WebGL, etc.)
7. Return ready page
```

**Критические замечания:**
- `channel: 'chrome'` — используется системный Chrome, НЕ bundled Chromium
- `headless: false` — всегда, TikTok детектирует headless через C++ layer
- Proxy auth — нативная в Patchright (не нужен ZIP-extension hack как в Puppeteer)
- Cookie-only auth — никогда не вводим login:pass в формы

### 6.2. Fingerprint Manager (fingerprint-manager.ts, 26KB)

Генерирует стабильный per-account fingerprint:
- User-Agent (привязан к системному Chrome major)
- Viewport, locale, timezone
- Canvas fingerprint, WebGL vendor/renderer
- Hardware concurrency, device memory
- Battery API spoofing
- Проверка consistency при запуске (fingerprint Chrome version vs system Chrome)

### 6.3. Cookie Store (cookie-store.ts, 9.7KB)

- AES-256-GCM encryption с MASTER_KEY (env variable)
- Хранение: `cookiesEncrypted` + `cookiesIv` + `cookiesAuthTag` в PostgreSQL
- Также: дисковый кэш для горячих cookies (`/data/cookies/`)

### 6.4. Video Uniquification (uniquifier.ts, 7KB)

FFmpeg pipeline:
- Metadata stripping
- Bitrate variance (+/- 5%)
- Audio noise injection
- Pixel shift (1-2px crop + pad)
- Делает каждую копию видео уникальной для антифрод-систем

### 6.5. Human Simulation

- `biomouse.ts` — Bézier curve mouse movements (не линейные)
- `typing-emulator.ts` — Случайные задержки между нажатиями клавиш

### 6.6. Captcha Solving

- `capsolver-client.ts` — API интеграция с CapSolver
- `tiktok-captcha-handler.ts` — Специфичная обработка TikTok captcha (slide, puzzle)

### 6.7. TLS Impersonation

- `curl-impersonate-client.ts` — Обёртка над бинарником `curl-impersonate`
- Используется для API-запросов без браузера (analytics, rotation)
- Имитирует TLS fingerprint Chrome

---

## 7. BullMQ очереди (8 шт.)

| Очередь | Handler | Concurrency | Использует браузер? | Описание |
|---------|---------|-------------|--------------------|----|
| `upload` | upload.ts (20KB) | 3 | ✅ Patchright | Залив видео на TikTok/YT Shorts |
| `warmup` | warmup.ts (14KB) | 3 | ✅ Patchright | 10-дневный прогрессивный прогрев |
| `cookies` | cookies.ts | 3 | ✅ Patchright | Нагул cookies на донорских сайтах |
| `edit-profile` | edit-profile.ts | 3 | ✅ Patchright | Смена аватара, баннера, био |
| `login` | login.ts (8.4KB) | 3 | ✅ Patchright | Извлечение cookies из login-формы |
| `analytics-cron` | analytics.ts (8KB) | 2 | ❌ curl-impersonate | Парсинг статистики через API |
| `shadowban-check` | shadowban-detector.ts | 2 | ❌ curl-impersonate | Детекция shadowban |
| `cleanup` | cleanup.ts | 1 | ❌ нет | Удаление файлов после загрузки |

**Общий concurrency лимит:** до 20 одновременных задач (3+3+3+3+3+2+2+1).
Worker валидирует `MASTER_KEY` (32 bytes base64) при старте — без него процесс не запускается.

---

## 8. API-эндпоинты

### Auth (`/api/auth/`)
| Метод | Path | Описание |
|-------|------|----------|
| POST | `/register` | Регистрация (email, password). Первый user → ADMIN |
| POST | `/login` | JWT → HttpOnly Cookie `melonity_token` (7 дней) |
| POST | `/logout` | Очистка cookie |
| GET | `/me` | Текущий пользователь |

### Accounts (`/api/accounts/`) — требует auth
| Метод | Path | Описание |
|-------|------|----------|
| GET | `/` | Список аккаунтов (с userId scope) |
| POST | `/` | Создание аккаунта |
| POST | `/import` | Массовый импорт (login:pass текст) |
| POST | `/bulk-proxy` | Массовая привязка прокси |
| POST | `/bulk-update` | Массовое обновление |
| POST | `/warmup` | Быстрый старт warmup |
| POST | `/cookies` | Быстрый фарминг cookies |
| PATCH | `/:id` | Обновление аккаунта |
| DELETE | `/:id` | Удаление |
| DELETE | `/bulk` | Массовое удаление |

### Proxies (`/api/proxies/`) — требует auth
| Метод | Path | Описание |
|-------|------|----------|
| GET | `/` | Список прокси |
| POST | `/` | Добавить (host, port, username, password, rotationLink) |
| PATCH | `/:id` | Обновить |
| DELETE | `/:id` | Удалить |
| DELETE | `/bulk` | Массовое удаление |
| POST | `/:id/test` | Проверить коннект |

### Workspace (`/api/workspace/`) — требует auth
| Метод | Path | Описание |
|-------|------|----------|
| POST | `/launch` | Запуск задачи (dispatch в BullMQ) |
| POST | `/upload` | Загрузка видео (multipart/form-data, multer) |
| POST | `/queue/add` | Добавление к работающей задаче |
| GET | `/presets` | Список пресетов |
| POST | `/presets` | Сохранить пресет |
| GET | `/cookies/export` | Скачать cookies (JSON) |
| GET | `/jobs` | Список задач |
| DELETE | `/jobs/:id` | Отмена задачи |

### Admin (`/api/admin/`) — требует auth + role=ADMIN
| Метод | Path | Описание |
|-------|------|----------|
| GET | `/runtime` | Здоровье системы (DB, Redis, BullMQ, CPU/RAM) |
| GET | `/users` | Список вебмастеров |
| PATCH | `/users/:id` | Изменить лимиты / soft-ban |
| GET | `/firewall` | Заблокированные IP |
| POST | `/firewall` | Добавить IP в blacklist |

### Middleware стек (для каждого запроса)
1. **Firewall** → проверка IP в Redis blacklist → 403
2. **JWT Auth** → verification из HttpOnly cookie → `req.user`
3. **RBAC Admin** → `role === 'ADMIN'` для `/admin/*`

---

## 9. Frontend (Next.js 15, App Router)

### Страницы

| Route | Назначение | Ключевые элементы |
|-------|-----------|-------------------|
| `/` | Landing page (21KB) | Hero-секция, фичи, статистика, CTA |
| `/auth/login` | Вход | JWT → HttpOnly Cookie |
| `/auth/register` | Регистрация | |
| `/account/dashboard` | Дашборд | 4 KPI-карточки, Recharts AreaChart (7/30/all), статус BullMQ очередей |
| `/account/accounts` | База аккаунтов | DataTable с чекбоксами, импорт log:pass, bulk proxy bind, bulk warmup/cookies/delete |
| `/account/workspace` | Рабочая область (СЕРДЦЕ) | 4 вкладки (Upload/Warmup/Cookies/Profile), DropZone, Live Terminal (Socket.io) |
| `/account/proxies` | Управление прокси | CRUD, тест, ротация |
| `/account/settings` | Настройки пользователя | |

### UI-компоненты (26 файлов в `components/ui/`)

| Компонент | Назначение |
|-----------|-----------|
| `avatar.tsx` | Аватар пользователя/аккаунта |
| `badge.tsx` | Статус-индикатор (success/error/warning/info) |
| `button.tsx` | Primary/secondary/ghost/danger + иконки |
| `card.tsx` | Контейнер (Strict Corporate Dark style) |
| `checkbox.tsx` | Чекбокс для таблиц |
| `datatable.tsx` | Таблица с сортировкой, чекбоксами, bulk actions (5.5KB) |
| `drawer.tsx` | Right-side sheet для форм |
| `drop-zone.tsx`, `dropzone.tsx` | Drag-and-Drop зона для файлов |
| `empty-state.tsx`, `emptystate.tsx` | Заглушка для пустых таблиц |
| `input.tsx` | Текстовое поле с label + иконкой |
| `label.tsx` | Label элемент |
| `live-terminal.tsx` | Socket.io real-time консоль (5KB) |
| `modal.tsx` | Confirm Dialog для деструктивных действий |
| `progress-bar.tsx` | Прогресс-бар |
| `segmented-control.tsx` | Переключатель сегментов |
| `skeleton.tsx` | Skeleton loader |
| `slider.tsx` | Слайдер |
| `stat-card.tsx` | KPI-карточка для дашборда |
| `stepper.tsx` | Степпер (пошаговый wizard) |
| `table.tsx` | Базовая таблица |
| `tabs.tsx` | Вкладки с animated underline |
| `terminal.tsx` | Базовый терминал |
| `textarea.tsx` | Textarea элемент |
| `toggle.tsx` | Тоггл-переключатель |

---

## 10. Дизайн-система (Strict Corporate Dark)

### Философия
**Без градиентов, без неона, без блёсток.** Строгая корпоративная dark-тема. Ранее использовались градиенты `pink → cyan` и neon glow-эффекты — от них полностью отказались в пользу чистого интерфейса с тонкими `border` / `box-shadow` акцентами.

### Цветовые токены (Tailwind v4 @theme)

| Токен | HEX | Назначение |
|-------|-----|-----------|
| `--color-night-base` | `#1c2026` | Фон приложения |
| `--color-surface-dark` | `#262a30` | Карточки, панели |
| `--color-surface-elevated` | `#2d3139` | Hover-состояния |
| `--color-melon-pink` | `#ff1469` | Основной акцент (из логотипа) — только для иконок и индикаторов |
| `--color-ice-cyan` | `#40D3F5` | Вторичный акцент — ссылки |
| `--color-pure-white` | `#ffffff` | Основной текст, primary-кнопки |
| `--color-muted-gray` | `#9ca3af` | Вторичный текст |
| `--color-success-green` | `#00d287` | Успех |
| `--color-alert-red` | `#f43f5e` | Ошибки |
| `--color-warning-amber` | `#f59e0b` | Предупреждения |

### Типографика
- **Шрифт:** Roboto Flex (variable font, weight 100-1000, stretch 25-151%)
- **Заголовки:** `font-weight: 700, font-stretch: 150%` с кастомным `font-variation-settings`
- **Letter-spacing:** `-0.02em` для display

### CSS-классы

| Класс | Описание |
|-------|---------|
| `.strict-card` | Карточка с `border: 1px solid rgba(255,255,255,0.04)`, hover: `translateY(-2px)` |
| `.btn-primary-strict` | Белый фон + тёмный текст |
| `.btn-accent-strict` | Сплошной `#ff1469` без свечения |
| `.btn-outline-strict` | Прозрачный фон + тонкий border |
| `.animate-enter` | Entrance: slide-up + fade-in (0.7s) |
| `.delay-1` ... `.delay-5` | Каскадные задержки (100ms шаг) |

---

## 11. Docker Deployment

### docker-compose.yml — 5 сервисов

| Сервис | Image / Build | Port | Описание |
|--------|--------------|------|----------|
| `db` | `postgres:16-alpine` | 5432 | PostgreSQL с healthcheck |
| `redis` | `redis:7-alpine` | 6379 | BullMQ broker + firewall + cache |
| `api` | `apps/api/Dockerfile` | 4000 | Express.js API server |
| `web` | `apps/web/Dockerfile` | 3000 | Next.js frontend |
| `worker` | `apps/worker/Dockerfile` | — | Patchright + Chrome + Xvfb + ffmpeg + curl-impersonate |

### Worker контейнер (критические детали)

```yaml
worker:
  cap_add: [SYS_ADMIN]       # Chrome sandbox
  shm_size: '2gb'             # Chrome shared memory (дефолтные 64MB — мало)
  deploy:
    resources:
      limits:
        memory: 4G             # Лимит RAM для Chrome instances
  volumes:
    - uploads:/app/uploads     # Общий volume с API (для видео)
    - cookies:/data/cookies    # Дисковый кэш cookies
```

Worker-контейнер содержит:
- `Xvfb` — виртуальный дисплей `:99` (entrypoint.sh)
- `google-chrome-stable` — реальный Chrome (не Chromium)
- `Patchright` — CDP-based anti-detection
- `curl-impersonate` — TLS fingerprint impersonation
- `ffmpeg` — video uniquification

---

## 12. Безопасность

| Мера | Реализация |
|------|-----------|
| **JWT** | HttpOnly Cookie `melonity_token`, 7d expiry, bcrypt 12 rounds |
| **Encryption** | AES-256-GCM для cookies и API keys, MASTER_KEY (32 bytes base64) |
| **RBAC** | Middleware `requireAdmin` для `/admin/*` |
| **Firewall** | Redis IP blacklist → 403 Forbidden |
| **Tenant Isolation** | Все Prisma-запросы фильтруются по `userId` из JWT |
| **CORS** | Strict origin через `CORS_ORIGIN` env |
| **Helmet** | Security headers на всех API-ответах |
| **Confirm Dialogs** | Все деструктивные действия (удаление) требуют `confirmed: true` |
| **No login forms** | Аккаунты авторизуются только через cookies, не через login:pass |

---

## 13. Переменные окружения

```bash
# Database
DATABASE_URL=postgresql://melonity:melonity@localhost:5432/melonitymedia

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=change-me-to-a-64-char-random-string
JWT_EXPIRES_IN=7d

# Encryption (CRITICAL — worker won't start without this)
MASTER_KEY=<32-bytes-base64>  # node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Server Ports
PORT_API=4000
PORT_WEB=3000

# File Storage
UPLOAD_DIR=./uploads

# CORS
CORS_ORIGIN=http://localhost:3000

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:4000

# Captcha (optional)
CAPSOLVER_API_KEY=<key>
```

---

## 14. Известные проблемы и найденные баги

### 14.1. Хардкод геолокации в fingerprint (High)
**Файл:** `accounts.ts:65`. При генерации fingerprint локация всегда `US / New York`. Если прокси из другой страны — антифрод TikTok детектирует несоответствие IP vs timezone/locale.

### 14.2. Утечка процессов FFmpeg (Medium)
**Файл:** `uniquifier.ts:163`. При отмене BullMQ-задачи процесс FFmpeg остаётся сиротой (orphan). Нужен `AbortController` + signal.

### 14.3. Потеря cookies при ошибке (Low)
**Файл:** `upload.ts:180`. Cookies сохраняются только при успешной загрузке. При ошибке (капча, таймаут) обновлённые cookies теряются. Решение: перенести в `finally`.

### 14.4. Ложное определение YT Shorts (Low)
**Файл:** `upload.ts:465`. Проверка `/shorts/` в DOM YouTube Studio ненадёжна — новые версии Studio могут показывать `youtu.be/XXX`.

### 14.5. npm vs pnpm конфликт (Build Warning)
При `npm run build` Next.js пытается вызвать `pnpm config get registry`. Решение: удалить `pnpm-lock.yaml`, очистить `.next`.

---

## 15. Эволюция стека (хронология)

| Фаза | Browser Stack | Proxy Auth | Account Auth |
|------|--------------|------------|-------------|
| v1.0 | Puppeteer + StealthPlugin | ZIP-extension (Manifest V2) | login:password на формах |
| v2.0 | undetected-chromedriver-js + Selenium WebDriver | ZIP-extension (Manifest V2) | login:password + cookies |
| **v3.0 (текущая)** | **Patchright** (patched Playwright) | **Нативная proxy auth** | **Cookie-only** (AES-256-GCM) |

Каждая итерация решала конкретную проблему:
- v1→v2: Puppeteer-StealthPlugin перестал обходить TikTok BotManager
- v2→v3: Selenium/UC-js медленный + нужен ZIP-extension hack + login:password детектируется антифродом

---

## 16. Конвенции

| Правило | Описание |
|---------|---------|
| **Conventional Commits** | `feat:`, `fix:`, `docs:`, `chore:` |
| **Tenant Isolation** | Все DB-запросы — `WHERE userId = req.user.id` |
| **No Puppeteer** | ESLint `no-restricted-imports` блокирует puppeteer, selenium, UC |
| **Cookie-only auth** | Никогда не вводить login:pass в формы TikTok/YouTube |
| **MASTER_KEY required** | Worker не стартует без 32-байтового MASTER_KEY |
| **Destructive = Confirm** | Все delete-операции требуют modal confirmation |
| **Strict TypeScript** | `strict: true`, `noEmit` проверка в CI |
