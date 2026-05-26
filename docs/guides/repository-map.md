# Repository Map — «Что где лежит»

## Структура монорепозитория

```
MelonityMedia/
├── apps/                          # Все приложения
│   ├── api/                       # Express.js Backend
│   ├── web/                       # Next.js 15 Frontend
│   └── worker/                    # BullMQ Worker Pool
├── scripts/                       # Утилитарные скрипты
│   └── rotate-master-key.mjs      # Ротация AES-256-GCM ключа шифрования
├── docs/                          # Документация проекта
│   ├── guides/                    # Руководства для разработчиков
│   └── architecture/              # Архитектурные документы
├── docker-compose.yml             # Оркестрация сервисов
├── design.md                      # Дизайн-система (tokens, typography)
├── instructions.md                # Source of Truth (ТЗ)
├── tsconfig.base.json             # Общая конфигурация TypeScript
├── .env.example                   # Шаблон переменных окружения (включая MASTER_KEY)
└── package.json                   # Root monorepo (workspaces)
```

---

## `apps/api/` — Backend (Express.js + Prisma)

| Путь | Описание |
|------|----------|
| `src/index.ts` | Точка входа: Express + Socket.io + middleware + маршруты |
| `src/routes/auth.ts` | Регистрация, авторизация, JWT выдача/валидация |
| `src/routes/accounts.ts` | CRUD аккаунтов, **импорт cookies** (Netscape/JSON), AES-256-GCM шифрование, auto fingerprint |
| `src/routes/proxies.ts` | CRUD прокси, type/carrier/ASN/rotation cooldown, тест соединения |
| `src/routes/workspace.ts` | Запуск задач BullMQ, управление очередью |
| `src/routes/videos.ts` | Загрузка видео, метаданные, привязка к аккаунтам |
| `src/routes/analytics.ts` | Агрегация метрик: просмотры, подписчики, графики |
| `src/routes/admin.ts` | Управление юзерами, runtime, firewall |
| `src/middleware/jwt-auth.ts` | Верификация JWT из HttpOnly Cookie |
| `src/middleware/rbac-admin.ts` | Проверка роли `ADMIN` |
| `src/middleware/redis-firewall.ts` | IP Blacklist через Redis |
| `src/lib/prisma.ts` | Singleton Prisma Client |
| `src/lib/redis.ts` | Singleton Redis/ioredis |
| `src/lib/bullmq.ts` | Фабрика BullMQ очередей |
| `prisma/schema.prisma` | Схема БД v3: User, SocialAccount (cookie-auth + fingerprint), Proxy (type/carrier/ASN), Video, Task, Preset, AuditLog |

---

## `apps/web/` — Frontend (Next.js 15 App Router)

| Путь | Описание |
|------|----------|
| `src/app/page.tsx` | Landing page (публичная) |
| `src/app/auth/login/page.tsx` | Страница входа |
| `src/app/auth/register/page.tsx` | Страница регистрации |
| `src/app/account/dashboard/page.tsx` | Дашборд аналитики (Recharts) |
| `src/app/account/profiles/page.tsx` | База аккаунтов + массовые действия + cookie import |
| `src/app/account/workspace/page.tsx` | Загрузчик + 4 вкладки + Live Terminal |
| `src/app/account/proxies/page.tsx` | Управление прокси (type/carrier/rotation cooldown) |
| `src/app/admin/runtime/page.tsx` | Здоровье системы |
| `src/app/admin/users/page.tsx` | Управление пользователями |
| `src/app/admin/firewall/page.tsx` | IP Blacklist |
| `src/app/globals.css` | Дизайн-токены, анимации, Tailwind config |
| `src/components/ui/` | 11 переиспользуемых компонентов |
| `src/components/layout/` | Header, Sidebar |
| `src/lib/api.ts` | HTTP-клиент к API |
| `src/lib/socket.ts` | Socket.io клиент |
| `src/lib/utils.ts` | Утилиты (cn, formatDate, formatNumber) |
| `public/logo.svg` | SVG логотип MelonityMedia |

---

## `apps/worker/` — Worker Pool (BullMQ + Patchright)

> ⚠️ **Запрещены**: puppeteer, selenium-webdriver, undetected-chromedriver-js, cheerio.
> ESLint `no-restricted-imports` блокирует их на уровне сборки.

### Core — Ядро антидетект-системы

| Путь | Описание |
|------|----------|
| `src/core/browser/patchright-launcher.ts` | Stealth-браузер на Patchright (patched Playwright CDP) с per-account fingerprint |
| `src/core/browser/fingerprint-manager.ts` | Deterministic `AccountFingerprint` — UA, screen, WebGL, canvas, locale, fonts |
| `src/core/auth/cookie-store.ts` | AES-256-GCM шифрование/дешифрование cookies (MASTER_KEY) |
| `src/core/auth/session-validator.ts` | Pre-flight cookie validation через curl-impersonate |
| `src/core/humanity/biomouse.ts` | ghost-cursor: Bézier-кривые, фиксации, анти-паттерн прямолинейного движения |
| `src/core/humanity/typing-emulator.ts` | Gaussian inter-key delays, 2% typo rate, word-boundary pauses |
| `src/core/proxy/lte-rotation.ts` | LTE mobile proxy IP rotation с 15-min cooldown enforcement |
| `src/core/proxy/carrier-validator.ts` | BGP path + ASN validation (детекция datacenter proxies: AWS, Hetzner, etc.) |
| `src/core/tls/curl-impersonate-client.ts` | Chrome TLS fingerprint impersonation (браузерные JA3/JA4) |
| `src/core/video/uniquifier.ts` | FFmpeg pipeline: pixel shift, hue offset, audio pitch — deterministic per account |

### Handlers — Обработчики задач

| Путь | Описание |
|------|----------|
| `src/index.ts` | Точка входа: подключение **7 BullMQ очередей**, MASTER_KEY валидация |
| `src/handlers/upload.ts` | Залив уникализированного видео через Patchright + ghost-cursor |
| `src/handlers/warmup.ts` | **10-day progressive curriculum**: passive → light → active engagement |
| `src/handlers/cookies.ts` | Export/refresh cookies через Patchright session |
| `src/handlers/edit-profile.ts` | Редактирование профиля (аватар, био) через ghost-cursor |
| `src/handlers/analytics.ts` | **curl-impersonate JSON API** (~200ms/профиль, без браузера) |
| `src/handlers/cleanup.ts` | Очистка временных файлов после загрузки |
| `src/handlers/shadowban-detector.ts` | Детекция шэдоубана: 3+ consecutive видео >=24ч после публикации с <100 views = SHADOWBAN_SUSPECTED + отмена pending uploads |
| `src/handlers/index.ts` | Barrel export всех handlers |

### Инфраструктура

| Путь | Описание |
|------|----------|
| `src/plugins/` | Plugin registry (BasePlugin + extensible) |
| `src/lib/socket-logger.ts` | Отправка логов в Socket.io Terminal |
| `Dockerfile` | Chrome + Xvfb + **ffmpeg** + **curl-impersonate** + Node.js 20 |
| `entrypoint.sh` | Xvfb startup + `DISPLAY=:99` + Node.js |
| `eslint.config.mjs` | **Banned imports** (puppeteer, selenium, cheerio, UC) |

---

## `scripts/` — Утилитарные скрипты

| Путь | Описание |
|------|----------|
| `rotate-master-key.mjs` | Ротация AES-256-GCM ключа: decrypt old → re-encrypt new → update DB |
