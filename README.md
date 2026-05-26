<div align="center">

<img src="apps/web/public/logo.svg" width="120" height="120" alt="MelonityMedia Logo" />

# MelonityMedia

**Панель автоматизации для вертикального видеоконтента**

Полнофункциональная SPA-панель для массового залива видео на TikTok и YouTube Shorts,
прогрева аккаунтов, детекции шэдоубана и сбора аналитики.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=next.js)](https://nextjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748?logo=prisma)](https://www.prisma.io/)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)

</div>

---

## 📋 Содержание

- [Обзор](#-обзор)
- [Архитектура](#-архитектура)
- [Стек технологий](#-стек-технологий)
- [Что внутри](#-что-внутри)
- [Быстрый старт](#-быстрый-старт)
- [Docker (Production)](#-docker-production)
- [Карта интерфейса](#-карта-интерфейса)
- [Система очередей](#-система-очередей)
- [Дизайн-система](#-дизайн-система)
- [UI-компоненты](#-ui-компоненты)
- [API-эндпоинты](#-api-эндпоинты)
- [Безопасность](#-безопасность)
- [Переменные окружения](#-переменные-окружения)
- [Git Workflow](#-git-workflow)
- [Документация](#-документация)
- [Лицензия](#-лицензия)

---

## 🎯 Обзор

MelonityMedia — закрытая платформа для арбитражников вертикального видеоконтента. Система автоматизирует полный цикл работы с аккаунтами TikTok и YouTube Shorts:

| Функция | Описание |
|---------|----------|
| 🎬 **Массовый залив** | Загрузка уникализированных видео через Patchright (антидетект-CDP) с per-account fingerprint |
| 🔥 **Прогрев аккаунтов** | 10-дневный progressive curriculum (passive → active engagement) |
| 🍪 **Cookie-based auth** | AES-256-GCM шифрование cookies, pre-flight валидация через curl-impersonate |
| 🔄 **Cookie refresh** | Lightweight продление сессий через Patchright (5-10 мин FYP scrolling), обновляет `tt_webid` / `s_v_web_id` без переавторизации |
| 📊 **Аналитика** | curl-impersonate JSON API (~200ms/профиль вместо ~30s с браузером) |
| 🛡️ **Антидетект** | Patchright (patched Playwright) + ghost-cursor + per-account fingerprints + typing emulator |
| 🔍 **Shadowban detection** | Автоматическая проверка каждые 12 часов (3+ видео <100 views = алерт) |
| 🎥 **Video uniquification** | FFmpeg pipeline с детерминистичными transforms per account (pixel shift, hue, audio pitch) |
| 🌐 **Мобильные прокси** | Ротация IP через API-ссылки + carrier/ASN валидация + BGP path проверка |

---

## 🏗 Архитектура

```mermaid
graph TB
    subgraph Client["🖥️ Frontend (Next.js 15)"]
        LP[Landing Page]
        AUTH[Auth Pages]
        DASH[Dashboard]
        PROF[Profiles]
        WS[Workspace]
        PROX[Proxies]
        ADM[Admin Panel]
    end

    subgraph API["⚡ API Server (Express.js)"]
        MW["Middleware<br/>JWT · RBAC · Firewall"]
        ROUTES["Routes<br/>auth · accounts · proxies<br/>workspace · videos · admin"]
        SOCK["Socket.io<br/>Live Terminal"]
    end

    subgraph Workers["🤖 Worker Pool (BullMQ)"]
        PR[Patchright Launcher]
        FP[Fingerprint Manager]
        CS[Cookie Store AES-256]
        BM[BioMouse ghost-cursor]
        VU[Video Uniquifier ffmpeg]
        CI[curl-impersonate TLS]
        H1[Upload Handler]
        H2[Warmup 10-Day Curriculum]
        H3[Cookies Export]
        H4[Edit Profile]
        H5[Analytics JSON API]
        H6[Cleanup]
        H7[Shadowban Detector]
    end

    subgraph Infra["🗄️ Infrastructure"]
        PG[("PostgreSQL 16")]
        RD[("Redis 7")]
        XVFB[Xvfb Virtual Display]
    end

    Client -->|HTTP/WS| API
    API -->|Prisma ORM| PG
    API -->|BullMQ dispatch| RD
    RD -->|Job Queue| Workers
    Workers -->|Xvfb :99| XVFB
    SOCK -.->|Real-time logs| Client

    style Client fill:#1c2026,stroke:#ff1469,color:#fff
    style API fill:#1c2026,stroke:#40D3F5,color:#fff
    style Workers fill:#1c2026,stroke:#ff1469,color:#fff
    style Infra fill:#1c2026,stroke:#40D3F5,color:#fff
```

### Потоки данных

```mermaid
sequenceDiagram
    participant U as 👤 Пользователь
    participant W as 🖥️ Web (Next.js)
    participant A as ⚡ API (Express)
    participant R as 📦 Redis (BullMQ)
    participant WK as 🤖 Worker
    participant P as 🌐 Proxy Farm

    U->>W: Загрузить видео
    W->>A: POST /api/workspace/launch
    A->>R: bullmq.add('upload', payload)
    A-->>W: 202 Accepted (jobId)

    R->>WK: Dequeue job
    WK->>WK: Pre-flight cookie validation (curl-impersonate)
    WK->>WK: Uniquify video (FFmpeg pipeline)
    WK->>P: GET rotation_link (смена IP)
    Note over WK,P: ⏳ 12 сек ожидание модема
    WK->>WK: Launch Patchright (per-account fingerprint)
    WK->>WK: Upload uniquified video to TikTok
    WK-->>W: Socket.io: [INFO] Загрузка завершена
    WK->>R: Job completed
```

---

## 🛠 Стек технологий

| Слой | Технологии |
|------|-----------|
| **Frontend** | Next.js 15, React 19, Tailwind CSS v4, Lucide Icons |
| **Backend** | Express.js, Prisma ORM, Socket.io |
| **Worker** | BullMQ, **Patchright** (patched Playwright), ghost-cursor, **curl-impersonate**, **ffmpeg** |
| **Database** | PostgreSQL 16 |
| **Cache/Queue** | Redis 7 |
| **Auth** | JWT (HttpOnly Cookies), bcrypt, AES-256-GCM (cookie encryption) |
| **Infra** | Docker Compose, Xvfb |
| **Language** | TypeScript 5.x (strict mode) |

> ⚠️ **Запрещённые зависимости**: puppeteer, selenium-webdriver, undetected-chromedriver-js, cheerio.
> ESLint `no-restricted-imports` блокирует их на уровне сборки.

---

## 📁 Что внутри

```
MelonityMedia/
├── apps/
│   ├── api/                    # Express.js backend
│   │   ├── src/
│   │   │   ├── index.ts        # Server entrypoint
│   │   │   ├── routes/         # auth, accounts, proxies, workspace, videos, analytics, admin
│   │   │   ├── middleware/     # jwt-auth, rbac-admin, redis-firewall
│   │   │   ├── lib/            # prisma, redis, bullmq, proxy-pin-rules
│   │   │   └── types/          # shared TypeScript types
│   │   ├── prisma/
│   │   │   └── schema.prisma   # Database schema v3 (cookie-based auth, fingerprints)
│   │   └── package.json
│   │
│   ├── web/                    # Next.js 15 frontend
│   │   ├── src/
│   │   │   ├── app/            # App Router pages
│   │   │   │   ├── page.tsx           # Landing page
│   │   │   │   ├── auth/              # Login, Register
│   │   │   │   ├── account/           # Dashboard, Profiles, Workspace, Proxies
│   │   │   │   └── admin/             # Runtime, Users, Firewall
│   │   │   ├── components/
│   │   │   │   ├── ui/         # 11 reusable UI components
│   │   │   │   └── layout/     # Header, Sidebar
│   │   │   └── lib/            # utils, api client
│   │   └── public/             # Logo SVG, favicon
│   │
│   └── worker/                 # BullMQ worker pool
│       ├── src/
│       │   ├── index.ts        # Worker entrypoint (7 queues)
│       │   ├── core/
│       │   │   ├── browser/    # patchright-launcher.ts, fingerprint-manager.ts
│       │   │   ├── auth/       # cookie-store.ts (AES-256-GCM), session-validator.ts
│       │   │   ├── humanity/   # biomouse.ts (ghost-cursor), typing-emulator.ts
│       │   │   ├── proxy/      # lte-rotation.ts, carrier-validator.ts
│       │   │   ├── tls/        # curl-impersonate-client.ts
│       │   │   └── video/      # uniquifier.ts (FFmpeg pipeline)
│       │   ├── handlers/       # upload, warmup, cookies, edit-profile, analytics, cleanup, shadowban
│       │   ├── plugins/        # Plugin system (BasePlugin + Registry)
│       │   └── lib/            # prisma singleton, socket-logger
│       ├── Dockerfile          # Chrome + Xvfb + ffmpeg + curl-impersonate + Node.js 20
│       ├── entrypoint.sh       # Xvfb :99 virtual display startup
│       ├── eslint.config.mjs   # Banned imports (puppeteer, selenium, cheerio)
│       └── package.json
│
├── scripts/
│   └── rotate-master-key.mjs   # Master key rotation script
│
├── docs/                       # Project documentation
│   ├── guides/
│   │   ├── local-development.md
│   │   ├── repository-map.md
│   │   └── interface-map.md
│   └── architecture/
│       └── backend-contracts.md
│
├── docker-compose.yml          # PostgreSQL + Redis + API + Web + Worker + Cookies Volume
├── design.md                   # Design system reference
├── instructions.md             # Source of Truth (ТЗ)
├── tsconfig.base.json          # Shared TypeScript config
├── .env.example                # Environment template (includes MASTER_KEY)
└── package.json                # Root monorepo
```

---

## 🚀 Быстрый старт

### Предварительные требования

- **Node.js** ≥ 20.x
- **npm** ≥ 10.x
- **Docker** + **Docker Compose** (для PostgreSQL и Redis)

### Установка

```bash
# 1. Клонировать репозиторий
git clone https://github.com/simu-lacrum/melonitymedia.git
cd melonitymedia

# 2. Установить зависимости
npm install

# 3. Настроить окружение
cp .env.example .env
# Отредактировать .env — установить JWT_SECRET и MASTER_KEY

# 3.1. Сгенерировать MASTER_KEY (AES-256-GCM, 32 байта base64)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 4. Поднять инфраструктуру
docker-compose up -d db redis

# 5. Применить миграции Prisma
cd apps/api && npx prisma migrate dev && cd ../..

# 6. Запустить API сервер
cd apps/api && npm run dev

# 7. Запустить фронтенд (в отдельном терминале)
cd apps/web && npm run dev

# 8. Запустить воркер (в отдельном терминале)
cd apps/worker && npm run dev
```

Панель будет доступна по адресу: **http://localhost:3000**

---

## 🐳 Docker (Production)

Полный деплой одной командой на Ubuntu VPS:

```bash
# Сборка и запуск всех сервисов
docker-compose up -d --build

# Проверка статуса
docker-compose ps

# Просмотр логов воркера
docker-compose logs -f worker
```

### docker-compose.yml — сервисы

```mermaid
graph LR
    subgraph Docker Compose
        DB[("db<br/>PostgreSQL 16<br/>:5432")]
        RD[("redis<br/>Redis 7<br/>:6379")]
        API[api<br/>Express.js<br/>:4000]
        WEB[frontend<br/>Next.js<br/>:3000]
        WK["worker<br/>Patchright + ffmpeg<br/>+ curl-impersonate"]
    end

    WEB -->|HTTP| API
    API -->|Prisma| DB
    API -->|BullMQ| RD
    RD -->|Jobs| WK

    style DB fill:#336791,stroke:#fff,color:#fff
    style RD fill:#DC382D,stroke:#fff,color:#fff
    style API fill:#339933,stroke:#fff,color:#fff
    style WEB fill:#000,stroke:#fff,color:#fff
    style WK fill:#ff1469,stroke:#fff,color:#fff
```

> **⚠️ Worker-контейнер** включает Xvfb + google-chrome-stable + ffmpeg + curl-impersonate. Используется **Patchright** (patched Playwright CDP) — НЕ Puppeteer и НЕ Selenium. Браузер запускается с `headless: false` внутри виртуального дисплея Xvfb `:99`, что позволяет обходить антифрод-детекцию TikTok и YouTube. Все cookies зашифрованы AES-256-GCM и хранятся в отдельном Docker volume `cookies`.

---

## 🗺 Карта интерфейса

```mermaid
graph TD
    ROOT["/"] --> AUTH_Z
    ROOT --> ACCOUNT_Z
    ROOT --> ADMIN_Z

    subgraph AUTH_Z["🔐 /auth"]
        LOGIN["/auth/login<br/>Вход"]
        REG["/auth/register<br/>Регистрация"]
    end

    subgraph ACCOUNT_Z["👤 /account"]
        DASH_P["/account/dashboard<br/>Дашборд аналитики"]
        PROF_P["/account/profiles<br/>База аккаунтов"]
        WS_P["/account/workspace<br/>Загрузчик + Терминал"]
        PROX_P["/account/proxies<br/>Управление прокси"]
    end

    subgraph ADMIN_Z["⚙️ /admin (role=ADMIN)"]
        RT["/admin/runtime<br/>Здоровье системы"]
        USR["/admin/users<br/>Управление юзерами"]
        FW["/admin/firewall<br/>IP Blacklist"]
    end

    LANDING["/ Landing Page<br/>Hero + Features + CTA"]

    style AUTH_Z fill:#262a30,stroke:#ff1469,color:#fff
    style ACCOUNT_Z fill:#262a30,stroke:#40D3F5,color:#fff
    style ADMIN_Z fill:#262a30,stroke:#f59e0b,color:#fff
    style LANDING fill:#1c2026,stroke:#ff1469,color:#fff
```

| Роут | Описание | Доступ |
|------|----------|--------|
| `/` | Лендинг с hero-секцией, фичами, статистикой | Публичный |
| `/auth/login` | JWT-авторизация через HttpOnly Cookie | Публичный |
| `/auth/register` | Регистрация нового вебмастера | Публичный |
| `/account/dashboard` | KPI-карточки, **Recharts AreaChart**, статус BullMQ очередей | Авторизованный |
| `/account/profiles` | DataGrid аккаунтов, импорт cookies (Netscape/JSON), **массовая привязка прокси** | Авторизованный |
| `/account/workspace` | **4 вкладки** (Залив/Прогрев/Cookies/Профиль), DropZone, Terminal | Авторизованный |
| `/account/proxies` | CRUD прокси, тест коннекта, ротация IP, carrier/ASN валидация | Авторизованный |
| `/admin/runtime` | PostgreSQL, Redis, BullMQ, CPU/RAM мониторинг | Администратор |
| `/admin/users` | Таблица вебмастеров, лимиты потоков, soft-ban | Администратор |
| `/admin/firewall` | IP blacklist через Redis Middleware | Администратор |

---

## 📦 Система очередей

Все задачи автоматизации обрабатываются через **BullMQ** (Redis-backed):

```mermaid
graph LR
    subgraph Queues["7 BullMQ Queues"]
        Q1["upload<br/>Залив видео"]
        Q2["warmup<br/>10-day curriculum"]
        Q3["cookies<br/>Export cookies"]
        Q4["edit-profile<br/>Редактирование"]
        Q5["analytics-cron<br/>JSON API stats"]
        Q6["cleanup<br/>Очистка файлов"]
        Q7["shadowban-check<br/>Детекция шэдоубана"]
    end

    API[API Server] -->|dispatch| Queues
    Queues -->|process| WORKER[Worker Pool]
    WORKER -->|logs| SOCKET["Socket.io → Terminal"]

    style Q1 fill:#ff1469,stroke:#fff,color:#fff
    style Q2 fill:#40D3F5,stroke:#1c2026,color:#1c2026
    style Q3 fill:#ff1469,stroke:#fff,color:#fff
    style Q4 fill:#40D3F5,stroke:#1c2026,color:#1c2026
    style Q5 fill:#ff1469,stroke:#fff,color:#fff
    style Q6 fill:#40D3F5,stroke:#1c2026,color:#1c2026
    style Q7 fill:#ff1469,stroke:#fff,color:#fff
```

| Очередь | Хэндлер | Триггер | Описание |
|---------|---------|---------|----------|
| `upload` | `upload.ts` | Кнопка «Запустить» | Patchright upload + video uniquification (FFmpeg) |
| `warmup` | `warmup.ts` | Кнопка / Cron | 10-day progressive curriculum (passive → active) |
| `cookies` | `cookies.ts` | Кнопка / Cron | Refresh сессии: Patchright session → лёгкий FYP scroll 5-10 мин → re-export cookies → re-encrypt → save. **Не путать** с "нагулом кук на сайтах-донорах" (deprecated, не работает с 2024). |
| `edit-profile` | `edit-profile.ts` | Кнопка | Смена аватара, баннера, био (ghost-cursor) |
| `analytics-cron` | `analytics.ts` | Cron (1 раз/ночь) | curl-impersonate JSON API (~200ms/профиль) |
| `cleanup` | `cleanup.ts` | Автоматически | Удаление файлов после загрузки |
| `shadowban-check` | `shadowban-detector.ts` | Cron (каждые 12ч) | 3+ видео <100 views → SHADOWBAN_SUSPECTED |

---

## 🎨 Дизайн-система

> **Strict Corporate Dark** — без градиентов, без неона, без блёсток.

Визуальная система основана на **Roboto Flex** (variable font) с концепцией **строгого пространственного дизайна**. Ранее использовались градиенты `pink → cyan` и neon glow-эффекты — от них полностью отказались в пользу чистого, корпоративного интерфейса с тонкими `border` / `box-shadow` акцентами.

### Цветовая палитра

| Токен | HEX | Назначение |
|-------|-----|------------|
| `--color-night-base` | `#1c2026` | Фон приложения |
| `--color-surface-dark` | `#262a30` | Карточки, панели |
| `--color-surface-elevated` | `#2d3139` | Приподнятые элементы, hover-состояния |
| `--color-melon-pink` | `#ff1469` | Основной акцент (из логотипа) — только для иконок и точечных индикаторов |
| `--color-ice-cyan` | `#40D3F5` | Вторичный акцент — ссылки, вторичные иконки |
| `--color-pure-white` | `#ffffff` | Основной текст, primary-кнопки |
| `--color-muted-gray` | `#9ca3af` | Вторичный текст, подписи |
| `--color-success-green` | `#00d287` | Успех, online-статус |
| `--color-alert-red` | `#f43f5e` | Ошибки, удаление |
| `--color-warning-amber` | `#f59e0b` | Предупреждения |

### Дизайн-принципы (Strict Corporate Dark)

| Принцип | Описание |
|---------|----------|
| **Без градиентов** | Никаких `linear-gradient`. Фоны — сплошные цвета из палитры |
| **Без neon glow** | Никаких `box-shadow` с цветным свечением (`rgba(255,20,105,...)`) |
| **Glassmorphism — exception** | `backdrop-filter: blur(12px)` допустим ТОЛЬКО в `Card.tsx` варианте `header`. Все остальные Card используют сплошной `--color-surface-dark`. |
| **Тонкие бордеры** | `border: 1px solid rgba(255,255,255,0.04)` — еле заметные разделители |
| **Spatial elevation** | Глубина через `box-shadow: 0 8px 30px rgba(0,0,0,0.2)` |
| **Primary = White** | Основная кнопка — белый фон + тёмный текст (не градиент) |
| **Accent = Solid Pink** | Акцентная кнопка — сплошной `#ff1469` без свечения |

### Анимации

| Класс | Эффект | Длительность |
|-------|--------|-------------|
| `.animate-enter` | Появление снизу с fade-in (staggered) | 0.7s |
| `.delay-1` … `.delay-5` | Каскадные задержки (0.1s–0.5s) | — |
| `slide-up-fade` | Базовый keyframe для `.animate-enter` | 0.7s |

> Все анимации отключаются при `prefers-reduced-motion: reduce`.

---

## 🧩 UI-компоненты

Библиотека из **11 переиспользуемых компонентов**:

| Компонент | Файл | Описание |
|-----------|------|----------|
| `Button` | `Button.tsx` | Варианты: primary/secondary/ghost/danger + иконки |
| `Card` | `Card.tsx` | Контейнер с тонкой границей и spatial elevation. **Только в варианте `header`** используется лёгкий backdrop-blur для глобальной шапки. |
| `Badge` | `Badge.tsx` | Статус-индикатор (success/error/warning/info/neutral) |
| `Input` | `Input.tsx` | Текстовое поле с label и иконкой |
| `DataTable` | `DataTable.tsx` | Таблица с сортировкой, чекбоксами, bulk actions |
| `Drawer` | `Drawer.tsx` | Right-side sheet для форм |
| `Modal` | `Modal.tsx` | Confirm Dialog с деструктивными действиями |
| `DropZone` | `DropZone.tsx` | Drag-and-Drop зона для файлов |
| `Tabs` | `Tabs.tsx` | Вкладки с animated underline |
| `Terminal` | `Terminal.tsx` | Live-консоль (Socket.io логи) |
| `EmptyState` | `EmptyState.tsx` | Заглушка для пустых таблиц |

---

## 🔌 API-эндпоинты

### Аутентификация

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| `POST` | `/api/auth/register` | Регистрация (email, password) |
| `POST` | `/api/auth/login` | Вход (JWT → HttpOnly Cookie) |
| `POST` | `/api/auth/logout` | Выход (очистка cookie) |
| `GET` | `/api/auth/me` | Текущий пользователь |

### Аккаунты

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| `GET` | `/api/accounts` | Список аккаунтов (cookies stripped, hasCookies flag) |
| `POST` | `/api/accounts/import` | **Импорт с cookies** (Netscape .txt или JSON) |
| `POST` | `/api/accounts/:id/cookies` | Повторный импорт cookies для аккаунта |
| `POST` | `/api/accounts/bulk-proxy` | Массовая привязка прокси к аккаунтам |
| `POST` | `/api/accounts/bulk-update` | Массовое обновление полей |
| `POST` | `/api/accounts/warmup` | Запуск 10-day warmup curriculum |
| `PATCH` | `/api/accounts/:id` | Обновить (привязать прокси, статус) |
| `DELETE` | `/api/accounts/:id` | Удалить аккаунт |

### Прокси

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| `GET` | `/api/proxies` | Список прокси (с type, carrier, ASN) |
| `POST` | `/api/proxies` | Добавить (host, port, type, rotation link, carrier) |
| `PATCH` | `/api/proxies/:id` | Обновить |
| `DELETE` | `/api/proxies/:id` | Удалить |
| `POST` | `/api/proxies/:id/test` | Проверить коннект |

### Рабочая область

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| `POST` | `/api/workspace/launch` | Запуск задачи (dispatch в BullMQ) |
| `POST` | `/api/workspace/upload` | Загрузка видео (multipart/form-data) |
| `POST` | `/api/workspace/queue/add` | Добавление видео к работающей задаче |
| `GET` | `/api/workspace/presets` | Список пресетов пользователя |
| `POST` | `/api/workspace/presets` | Сохранить пресет |
| `GET` | `/api/workspace/cookies/export` | Скачать cookies аккаунтов (JSON) |
| `GET` | `/api/workspace/jobs` | Список задач |
| `DELETE` | `/api/workspace/jobs/:id` | Отмена задачи |

### Администрирование

| Метод | Эндпоинт | Описание |
|-------|----------|----------|
| `GET` | `/api/admin/runtime` | Здоровье системы (DB, Redis, BullMQ) |
| `GET` | `/api/admin/users` | Список вебмастеров |
| `PATCH` | `/api/admin/users/:id` | Изменить лимиты / soft-ban |
| `GET` | `/api/admin/firewall` | Заблокированные IP |
| `POST` | `/api/admin/firewall` | Добавить IP в blacklist |

---

## 🔒 Безопасность

| Мера | Реализация |
|------|-----------|
| **JWT Auth** | HttpOnly Cookies, 7-day expiry, bcrypt hashing |
| **Cookie Encryption** | AES-256-GCM с MASTER_KEY (32 bytes base64), fail-fast при невалидном ключе |
| **Key Rotation** | `scripts/rotate-master-key.mjs` — zero-downtime ротация шифрования |
| **RBAC** | Middleware `requireAdmin` для `/admin/*` маршрутов |
| **Firewall** | IP blacklist через Redis → 403 Forbidden |
| **Tenant Isolation** | Все модели Prisma имеют `userId` FK — пользователь видит только свои данные |
| **CORS** | Strict origin через `CORS_ORIGIN` переменную |
| **Helmet** | Security headers на всех API-ответах |
| **ESLint Banned Imports** | puppeteer, selenium, cheerio заблокированы на уровне lint |
| **Fingerprint Consistency** | 7 правил валидации: OS↔platform, GPU↔OS, screen≥viewport, locale↔timezone, hardware bounds, Chrome version pinning, touch coherence |
| **Carrier Stability Rule** | 14-day proxy pin window для TikTok: блокировка смены carrier/country, LTE-only для свежих аккаунтов |
| **Shadowban 24h Gate** | Детекция shadowban только по видео старше 24ч (предотвращение ложных срабатываний) |
| **No Secrets in Response** | Encrypted cookies никогда не отправляются на фронтенд |

---

## ⚙️ Переменные окружения

```bash
# ── Database ──────────────────────────────────────────
DATABASE_URL=postgresql://melonity:***@localhost:5432/melonitymedia

# ── Redis (BullMQ + Cache + Firewall) ─────────────────
REDIS_URL=redis://localhost:6379

# ── JWT Auth ──────────────────────────────────────────
JWT_SECRET=replace_me_64_hex_chars
JWT_EXPIRES_IN=7d

# ── Cookie Encryption (AES-256-GCM) ───────────────────
# Generate ONCE per environment with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# 32 bytes -> 44 chars base64. NEVER change after launch — old cookies become unrecoverable.
# Use scripts/rotate-master-key.mjs for safe rotation.
MASTER_KEY=replace_me_44_chars_base64

# ── Server Ports ──────────────────────────────────────
PORT_API=4000
PORT_WEB=3000

# ── File Storage ──────────────────────────────────────
UPLOAD_DIR=./uploads

# ── CORS ──────────────────────────────────────────────
CORS_ORIGIN=http://localhost:3000

# ── Frontend (exposed to browser) ─────────────────────
NEXT_PUBLIC_API_URL=http://localhost:4000
```

---

## 🔀 Git Workflow

Проект следует **Enterprise Git Flow** с изолированными ветками:

```mermaid
gitGraph
    commit id: "init"
    branch feat/foundation
    commit id: "monorepo scaffold"
    checkout main
    merge feat/foundation id: "merge foundation"
    branch feat/phase2-features
    commit id: "full pages"
    commit id: "worker handlers"
    commit id: "landing + proxies"
    commit id: "Recharts + workspace tabs"
    commit id: "docs + Docker + proxy bind"
    checkout main
    merge feat/phase2-features id: "merge phase2"
    branch feat/antidetect-refactor-v2
    commit id: "patchright launcher"
    commit id: "cookie-store AES-256"
    commit id: "fingerprint manager"
    commit id: "ghost-cursor + typing"
    commit id: "video uniquifier"
    commit id: "warmup 10-day curriculum"
    commit id: "shadowban detector"
    commit id: "curl-impersonate analytics"
    commit id: "carrier/ASN validation"
    commit id: "eslint banned imports"
    checkout main
    merge feat/antidetect-refactor-v2 id: "merge v3"
    branch chore/docs-hardening-pass
    commit id: "fix env vars"
    commit id: "first-run flow"
    commit id: "cookie refresh docs"
    commit id: "Card variants"
    commit id: "carrier stability rule"
    commit id: "shadowban 24h gate"
    commit id: "fingerprint consistency"
    commit id: "remove browser-automation"
    checkout main
    merge chore/docs-hardening-pass id: "merge hardening"
```

### Правила

| Правило | Описание |
|---------|----------|
| **Прямые пуши в `master` запрещены** | Работа через `feat/`, `fix/`, `docs/` ветки |
| **Commit Lanes** | Бэкенд, воркеры, UI — раздельные коммиты |
| **Conventional Commits** | `feat:`, `fix:`, `docs:`, `chore:` |
| **Нет секретов в Git** | `.env` в `.gitignore`, только `.env.example` в репо |
| **Pre-deploy checks** | `tsc --noEmit`, `next build`, `prisma validate` |

---

## 📚 Документация

| Документ | Описание |
|----------|----------|
| [`instructions.md`](instructions.md) | Source of Truth — полное ТЗ проекта |
| [`design.md`](design.md) | Дизайн-система: цвета, типографика, отступы |
| [`docs/guides/local-development.md`](docs/guides/local-development.md) | Инструкция по локальному запуску (секции 6.1-6.5: прокси → cookies → pin → warmup → залив) |
| [`docs/guides/repository-map.md`](docs/guides/repository-map.md) | «Что где лежит» — архитектура папок, все модули |
| [`docs/guides/interface-map.md`](docs/guides/interface-map.md) | Карта экранов и роутов с указанием antifraud-гардов |
| [`docs/architecture/backend-contracts.md`](docs/architecture/backend-contracts.md) | API-контракты, BullMQ payloads, Socket.io events, Fingerprint Contract, Proxy Contract |
| [`docs/architecture/antifraud-logic.md`](docs/architecture/antifraud-logic.md) | **Подробная спецификация** всей антифрод-логики: carrier stability, shadowban detection, fingerprint consistency, cookie encryption |

> 📂 Все документы из `/docs/` доступны на GitHub:  
> [`docs/guides/`](https://github.com/simu-lacrum/melonitymedia/tree/main/docs/guides) ·
> [`docs/architecture/`](https://github.com/simu-lacrum/melonitymedia/tree/main/docs/architecture)

---

## 📄 Лицензия

Приватный проект. Все права защищены.

---

<div align="center">

Разработано с 💜 для арбитражников вертикального видео

**MelonityMedia** · [GitHub](https://github.com/simu-lacrum/melonitymedia)

</div>
