# Repository Map — «Что где лежит»

## Структура монорепозитория

```
MelonityMedia/
├── apps/                          # Все приложения
│   ├── api/                       # Express.js Backend
│   ├── web/                       # Next.js 15 Frontend
│   └── worker/                    # BullMQ Worker Pool
├── docs/                          # Документация проекта
│   ├── guides/                    # Руководства для разработчиков
│   └── architecture/              # Архитектурные документы
├── docker-compose.yml             # Оркестрация сервисов
├── design.md                      # Дизайн-система (tokens, typography)
├── instructions.md                # Source of Truth (ТЗ)
├── tsconfig.base.json             # Общая конфигурация TypeScript
├── .env.example                   # Шаблон переменных окружения
└── package.json                   # Root monorepo (workspaces)
```

---

## `apps/api/` — Backend (Express.js + Prisma)

| Путь | Описание |
|------|----------|
| `src/index.ts` | Точка входа: Express + Socket.io + middleware + маршруты |
| `src/routes/auth.ts` | Регистрация, авторизация, JWT выдача/валидация |
| `src/routes/accounts.ts` | CRUD аккаунтов, массовый импорт `log:pass` |
| `src/routes/proxies.ts` | CRUD прокси, тест соединения, ротация IP |
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
| `prisma/schema.prisma` | Схема БД: User, Account, Proxy, Video, AnalyticsSnapshot |

---

## `apps/web/` — Frontend (Next.js 15 App Router)

| Путь | Описание |
|------|----------|
| `src/app/page.tsx` | Landing page (публичная) |
| `src/app/auth/login/page.tsx` | Страница входа |
| `src/app/auth/register/page.tsx` | Страница регистрации |
| `src/app/account/dashboard/page.tsx` | Дашборд аналитики (Recharts) |
| `src/app/account/profiles/page.tsx` | База аккаунтов + массовые действия |
| `src/app/account/workspace/page.tsx` | Загрузчик + 4 вкладки + Live Terminal |
| `src/app/account/proxies/page.tsx` | Управление прокси |
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

## `apps/worker/` — Worker Pool (BullMQ + UndetectedChrome)

| Путь | Описание |
|------|----------|
| `src/index.ts` | Точка входа: подключение 6 BullMQ очередей |
| `src/core/browser-automation.ts` | `BrowserAutomation` — ядро: запуск UC, proxy-расширение, ротация IP |
| `src/handlers/upload.ts` | Залив видео на TikTok / YouTube Shorts |
| `src/handlers/warmup.ts` | Прогрев: скроллинг, лайки, комментарии |
| `src/handlers/cookies.ts` | Нагул cookies на сайтах-донорах |
| `src/handlers/edit-profile.ts` | Редактирование профиля (аватар, био) |
| `src/handlers/analytics.ts` | Cron-парсинг метрик через Cheerio |
| `src/handlers/cleanup.ts` | Очистка временных файлов после загрузки |
| `src/plugins/` | Plugin registry (BasePlugin + extensible) |
| `src/lib/socket-logger.ts` | Отправка логов в Socket.io Terminal |
| `src/types/` | TypeScript declarations (undetected-chromedriver-js) |
| `Dockerfile` | Chrome + Xvfb + Node.js production image |
| `entrypoint.sh` | Xvfb startup + `DISPLAY=:99` + Node.js |
