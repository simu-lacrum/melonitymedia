# Локальная разработка MelonityMedia

## Предварительные требования

| Компонент | Версия | Примечание |
|-----------|--------|------------|
| Node.js | ≥ 20.x | LTS рекомендуется |
| npm | ≥ 10.x | Идёт с Node.js |
| Docker | ≥ 24.x | Для PostgreSQL и Redis |
| Docker Compose | ≥ 2.x | Plugin или standalone |

## 1. Клонирование и настройка

```bash
# Клонировать репозиторий
git clone https://github.com/simu-lacrum/melonitymedia.git
cd melonitymedia

# Создать .env из шаблона
cp .env.example .env
```

### Переменные окружения

Откройте `.env` и установите:

| Переменная | Описание | Обязательно |
|------------|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string | ✅ |
| `REDIS_URL` | Redis connection string | ✅ |
| `JWT_SECRET` | Случайная строка 64+ символов | ✅ |
| `JWT_EXPIRES_IN` | Время жизни токена (по умолчанию `7d`) | ❌ |
| `PORT_API` | Порт API (по умолчанию `4000`) | ❌ |
| `PORT_WEB` | Порт фронтенда (по умолчанию `3000`) | ❌ |
| `UPLOAD_DIR` | Директория для загружаемых видео | ❌ |
| `CORS_ORIGIN` | Разрешённый origin | ❌ |
| `NEXT_PUBLIC_API_URL` | URL API для браузера | ✅ |

> [!IMPORTANT]
> `JWT_SECRET` обязательно замените на сгенерированную строку:
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
> ```

## 2. Запуск инфраструктуры

```bash
# Поднять PostgreSQL 16 и Redis 7
docker-compose up -d db redis

# Проверить что сервисы стартовали
docker-compose ps
```

Ожидаемый вывод:
```
NAME           STATUS       PORTS
mm-db          Up           0.0.0.0:5432->5432/tcp
mm-redis       Up           0.0.0.0:6379->6379/tcp
```

## 3. Установка зависимостей

```bash
# Из корня монорепозитория
npm install
```

Это установит зависимости для всех трёх приложений (`api`, `web`, `worker`).

## 4. Миграции базы данных

```bash
cd apps/api
npx prisma migrate dev --name init
npx prisma generate
cd ../..
```

> [!TIP]
> Для визуального просмотра БД используйте `npx prisma studio` из `apps/api`.

## 5. Запуск сервисов

Откройте **три терминала** и запустите каждый сервис:

### Терминал 1 — API Server
```bash
cd apps/api
npm run dev
# → Listening on http://localhost:4000
```

### Терминал 2 — Web Frontend
```bash
cd apps/web
npm run dev
# → Ready on http://localhost:3000
```

### Терминал 3 — Worker (опционально)
```bash
cd apps/worker
npm run dev
# → Worker listening on queues: upload, warmup, cookies...
```

> [!WARNING]
> Worker требует Chrome/Chromium и Xvfb на Linux. На Windows/macOS он будет работать
> в headless-режиме или потребует установленный Chrome.

## 6. Первый запуск

1. Откройте http://localhost:3000
2. Зарегистрируйтесь через `/auth/register`
3. Авторизуйтесь → перенаправление на `/account/dashboard`

## 7. Полезные команды

| Команда | Описание |
|---------|----------|
| `npx prisma studio` | GUI для просмотра БД |
| `npx prisma migrate reset` | Сбросить БД и заново применить миграции |
| `npx next build` (из `apps/web`) | Проверить production build |
| `docker-compose logs -f worker` | Логи воркера в Docker |
| `docker-compose down -v` | Остановить и удалить volumes |
