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
| `MASTER_KEY` | AES-256-GCM ключ (32 байта base64) для шифрования cookies | ✅ |
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

> [!IMPORTANT]
> `MASTER_KEY` обязателен для работы воркера и API. Сгенерируйте ONCE:
> ```bash
> node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
> ```
> Если ключ невалиден (не 32 байта), воркер завершится с `process.exit(1)`.

## 2. Запуск инфраструктуры

```bash
# Поднять PostgreSQL 16 и Redis 7
docker-compose up -d db redis

# Проверить что сервисы стартовали
docker-compose ps
```

Ожидаемый вывод:
```
NAME                    STATUS              PORTS
melonitymedia-db-1      Up (healthy)        0.0.0.0:5433->5432/tcp
melonitymedia-redis-1   Up (healthy)        0.0.0.0:6380->6379/tcp
```

> [!NOTE]
> Host-порты настраиваются через `PORT_DB` и `PORT_REDIS` в `.env` (по умолчанию 5433 и 6380).
> Внутри Docker-сети сервисы всегда используют стандартные порты (5432, 6379).

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
> Worker использует **Patchright** (patched Playwright CDP), который сам устанавливает браузер.
> На Linux требуется Xvfb для `headless: false` режима.
> Для видео уникализации требуется **ffmpeg** в PATH.
> **НЕ устанавливайте** puppeteer, selenium или undetected-chromedriver.

## 6. Первый запуск

Регистрация владельца панели и первый прогон end-to-end:

1. Откройте http://localhost:3000
2. Зарегистрируйтесь через `/auth/register` — это **владелец панели MelonityMedia**, не TikTok-аккаунт.
3. После авторизации вы попадёте на `/account/dashboard`.

### Полный first-run путь (~30 минут)

> Секции 6.1–6.5 описывают **единый пошаговый путь**: прокси → cookies → pin → warmup → залив.
> Каждый шаг — обязательный gate; пропуск любого шага блокирует следующий.

### 6.1. Добавление первого прокси

> Без прокси воркер не запустит ни одну задачу — это hard gate.

1. Перейдите в `/account/proxies` → **«Добавить прокси»**.
2. Заполните поля:
   - **Type:** `LTE_MOBILE` (для TikTok — обязательно; `STATIC_RESIDENTIAL` допустим для YouTube Shorts).
   - **Host / Port / Login / Pass:** из дашборда вашего proxy-провайдера.
   - **Rotation Link:** URL для смены IP (если есть). Cooldown минимум 900 сек (15 мин).
   - **Carrier:** реальный оператор (T-Mobile, Verizon, MTS, Beeline, ...). Это критично — антифрод TikTok коррелирует ASN с заявленным carrier.
   - **Country / DMA:** должны совпадать с регионом, который carrier реально обслуживает.
3. Нажмите **«Тест»** — система проверит соединение и сохранит `bgpPathValid` флаг.

### 6.2. Импорт первого TikTok-аккаунта

> Система поддерживает импорт как через `cookies` (JSON/Netscape), так и форматы `login:pass` / `login:pass:cookies`. Все они обрабатываются автоматически.

1. Установите расширение Cookie-Editor / EditThisCookie в обычный Chrome.
2. Залогиньтесь вручную в TikTok с **того же региона**, что и купленный прокси (если прокси US — VPN/RDP в US, иначе TikTok сразу выставит challenge).
3. Экспортируйте cookies → `JSON` или `Netscape .txt`.
4. В панели: `/account/profiles` → **«Импорт аккаунтов»** → перетащите файл cookies в DropZone.
5. Дождитесь сообщения «Аккаунт импортирован, fingerprint сгенерирован». Cookies моментально шифруются AES-256-GCM перед записью в БД.

### 6.3. Привязка прокси к аккаунту (14-day pin)

1. В таблице `/account/profiles` выберите аккаунт чекбоксом.
2. **Bulk Actions** → **«Привязать прокси»** → выберите тот, что добавили в 6.1.
3. После привязки `proxyPinnedAt = now()`. Менять прокси у этого аккаунта в течение 14 дней нельзя без `force=true` (см. `backend-contracts.md` → Carrier Stability Rule).

### 6.4. Прогрев аккаунта (обязательно перед первым заливом)

1. В таблице `/account/profiles` выберите аккаунт → **«Запустить прогрев»**.
2. Статус сменится на `WARMING_UP`. Worker автоматически запустит 10-day curriculum:
   - Day 1-3: passive FYP scroll
   - Day 4-6: light engagement (likes, 1 comment)
   - Day 7-10: active engagement (likes, comments, saves, follows)
3. Колонка **«Warmup Day»** покажет прогресс `X / 10`.
4. Когда `warmupCompletedAt != null` → аккаунт допускается в очередь `upload`.

### 6.5. Первый залив

1. `/account/workspace` → выберите готовый аккаунт.
2. Перетащите .mp4 в **«Медиатеку»**. Видео автоматически уникализируется per account (FFmpeg detereministic transforms).
3. Заполните пулы названий/описаний/тегов, нажмите **«ЗАПУСТИТЬ ЗАДАЧУ»**.
4. Следите за **Live Terminal** — Socket.io транслирует логи воркера в реальном времени.

> **Не запускайте заливы на аккаунтах со статусом `WARMING_UP` или `SHADOWBAN_SUSPECTED`** — система их отфильтрует, но если форс-пушите через API, риск перманентной потери аккаунта возрастает кратно.

## 7. Полезные команды

| Команда | Описание |
|---------|----------|
| `npx prisma studio` | GUI для просмотра БД |
| `npx prisma migrate reset` | Сбросить БД и заново применить миграции |
| `npx next build` (из `apps/web`) | Проверить production build |
| `docker-compose logs -f worker` | Логи воркера в Docker |
| `docker-compose down -v` | Остановить и удалить volumes |
