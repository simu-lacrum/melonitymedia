# Узел: Debugging Playbook

**Тип**: Operations / Debugging

## Частые ошибки и их решения

### 1. Prisma P2025 — "No record was found for an update"
**Причина**: Аккаунт удалён/пересоздан между dispatch job и execution.
**Решение**: `safeUpdateAccount()` wrapper (login.ts:70-83). Ловит P2025, логирует warning.
**Файл**: `apps/worker/src/handlers/login.ts`

### 2. TikTok Rate-Limit False Positive
**Причина**: `page.textContent('body')` включает JSON AppContext (~170KB) с "try again later".
**Решение**: Заменить на `page.locator('...:visible').allTextContents()` — только видимые элементы.
**Убрать из regex**: `try again later` (слишком generic).
**Файл**: `apps/worker/src/handlers/login.ts` (строки ~92, ~384)

### 3. Worker контейнер — "Cannot find module 'patchright'"
**Причина**: Скрипт запускается из `/tmp` где нет `node_modules`.
**Решение**: Запускать из `/app`: `docker exec -u worker -w /app container node /app/script.js`

### 4. Worker контейнер — "Executable doesn't exist at /home/worker/.cache/ms-playwright/"
**Причина**: Chrome установлен глобально, не через Playwright manager.
**Решение**: `executablePath: "/opt/google/chrome/chrome"` при adhoc запусках.
Worker process сам знает путь через `patchright-launcher.ts`.

### 5. YouTube Studio — "Произошла ошибка" / 403
**Причина**: VPS IP зафлагован YouTube Studio. Server-side блокировка.
**Решение**: Менять прокси или работать через residential proxy.

### 6. Docker build — "failed to receive status: rpc error: EOF"
**Причина**: Docker daemon timeout при длительных операциях.
**Решение**: Игнорировать — билд завершился успешно. Проверять `docker compose up -d`.

### 7. API/Web Exited после rebuild worker
**Причина**: `docker compose build worker` перезапускает dependency chain.
**Решение**: `docker compose up -d` — запустит все остановленные сервисы.

## Отладочные команды

```bash
# Логи worker (последние 30 строк)
docker logs melonitymedia-worker-1 --tail 30

# Статус всех контейнеров
docker ps -a --format '{{.Names}} {{.Status}}'

# Проверка аккаунта в БД
docker exec melonitymedia-api-1 node -e '
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.socialAccount.findMany({
  select: { id: true, platform: true, username: true, status: true }
}).then(r => console.log(JSON.stringify(r, null, 2)));
'

# Скриншот из контейнера (скопировать файл)
docker cp melonitymedia-worker-1:/tmp/screenshot.png /tmp/screenshot.png
```

## Связи
- `ops_vps_infrastructure.md` — параметры подключения
- `ops_account_operations.md` — работа с аккаунтами
- `apps/worker/src/handlers/login.ts` — основной проблемный файл
