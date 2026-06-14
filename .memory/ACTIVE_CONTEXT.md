# 🧠 MelonityMedia - ACTIVE CONTEXT (AI Knowledge Graph Entry Point)

**Назначение**: Этот файл является стартовой точкой (корневым узлом) для любого ИИ-ассистента, работающего с проектом MelonityMedia. Он описывает структуру графа памяти и дает инструкции по навигации.

## 🗺️ Как читать граф памяти
Граф памяти физически расположен в директории `.memory/graph/`.
- Файлы в `.memory/graph/entities/` — это узлы графа (описания файлов, компонентов, модулей).
- Файл `.memory/graph/relationships.json` — это реестр связей между компонентами.

### Инструкция для ИИ:
1. Если вам задают вопрос по архитектуре или логике работы, **не гадайте**.
2. Откройте `relationships.json`, чтобы найти связанные узлы.
3. Читайте `.md` файлы конкретных узлов в папке `entities/` через инструмент `view_file` или ищите по ним с помощью `grep_search`.
4. В каждом узле описано: За что отвечает модуль, Какие у него зависимости, С кем он связан.

## 🚀 Основная Архитектура
* **Frontend**: Next.js 15 (в `apps/web`)
* **Backend**: Express.js + Prisma ORM (в `apps/api`)
* **Worker Pool**: BullMQ + Patchright (в `apps/worker`)

Граф автоматически обновляется скриптом `npm run memory:sync`. Если вы вносите существенные изменения в код, вызовите этот скрипт, чтобы обновить граф.

---

## 🖥️ VPS & Infrastructure (Operational Knowledge)

> Этот раздел содержит **операционные знания**, полученные при реальной эксплуатации.
> Перед любым взаимодействием с VPS — **ПРОЧИТАЙ ПОЛНОСТЬЮ**.

### Подключение к VPS

| Параметр | Значение |
|----------|----------|
| **IP** | `31.76.0.144` |
| **User** | `root` |
| **Auth** | Пароль через `SSH_ASKPASS` (файл `%TEMP%\sshpass.bat`) |
| **Проект на VPS** | `/opt/melonitymedia` |

**Команда подключения (PowerShell → SSH):**
```powershell
$env:SSH_ASKPASS="$env:TEMP\sshpass.bat"
$env:SSH_ASKPASS_REQUIRE="force"
$env:DISPLAY="localhost:0"
ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 -o ServerAliveInterval=60 -o ServerAliveCountMax=30 -o PreferredAuthentications=password root@31.76.0.144
```

**⚠️ КРИТИЧНО: Escaping при nested shell:**
- PowerShell → SSH → bash → docker exec → node — **4 уровня escaping**.
- **НЕ передавать JS-код через `-e` с кавычками** — вместо этого `scp` файл на VPS, потом `docker exec node /path/to/file.js`.
- Для передачи файлов в контейнер: `docker cp file.js container:/app/file.js`

### Docker Compose сервисы

| Контейнер | Роль | Healthcheck |
|-----------|------|-------------|
| `melonitymedia-db-1` | PostgreSQL 16 | ✅ Healthy |
| `melonitymedia-redis-1` | Redis 7 | ✅ Healthy |
| `melonitymedia-api-1` | Express.js API | Depends on DB + Redis |
| `melonitymedia-worker-1` | BullMQ + Patchright automation | ✅ Healthy |
| `melonitymedia-web-1` | Next.js 15 frontend | Depends on API |
| `melonitymedia-nginx-1` | Reverse proxy | Depends on Web |

**Rebuild workflow:**
```bash
cd /opt/melonitymedia
git fetch origin main && git reset --hard origin/main
docker compose build --no-cache worker    # ~8 мин (worker самый тяжёлый)
docker compose up -d                      # перезапуск всех сервисов
```

**⚠️ КРИТИЧНО**: При `docker compose build worker` часто возникает `failed to receive status: rpc error: code = Unavailable desc = error reading from server: EOF` — это **НЕ ошибка**, билд завершился успешно. Игнорировать.

**⚠️ POSTGRES_PASSWORD warning**: `The "POSTGRES_PASSWORD" variable is not set` — это warning от compose, **НЕ критично** (пароль задан в `.env`).

### Запуск скриптов внутри Worker контейнера

**Браузер в контейнере:**
- Установлен глобально: `/opt/google/chrome/chrome`
- **НЕ** через Playwright cache (`~/.cache/ms-playwright/`)
- При запуске adhoc скриптов использовать `executablePath: "/opt/google/chrome/chrome"`
- Worker процесс сам знает путь через `patchright-launcher.ts`

**Правильный способ запуска adhoc Node.js скриптов:**
```bash
# 1. Загрузить файл на VPS
scp script.js root@VPS:/tmp/script.js

# 2. Скопировать в контейнер
docker cp /tmp/script.js melonitymedia-worker-1:/app/script.js

# 3. Запустить от пользователя worker в директории /app
docker exec -u worker -w /app melonitymedia-worker-1 node /app/script.js
```

**⚠️ ВАЖНО:**
- `docker exec melonitymedia-worker-1 node -e '...'` — **ЛОМАЕТСЯ** из-за multi-level escaping
- `docker exec -u root` — **НЕ находит Patchright browsers** (установлены для user `worker`)
- `docker exec -u worker` из `/tmp` — **НЕ находит node_modules** (нужен `-w /app`)

---

## 🔐 Работа с аккаунтами (Lessons Learned)

### Платформы и их особенности

#### TikTok
| Аспект | Детали |
|--------|--------|
| **Логин URL** | `https://www.tiktok.com/login/phone-or-email/email` |
| **Rate-limit** | "Maximum number of attempts reached. Try again later." — красный текст под полем пароля |
| **Длительность блокировки** | 24-48 часов при многократных попытках |
| **Капча** | TikTok Puzzle Captcha → решается через CapSolver API |
| **False positive rate-limit** | ⚠️ TikTok embedded JSON (AppContext) в body содержит "try again later" — **НЕЛЬЗЯ** искать по `page.textContent('body')`, только по **видимым элементам** |

**Правильное определение rate-limit:**
```typescript
// ✅ ПРАВИЛЬНО: только видимые элементы
const rateLimitElements = await page.locator(
  '[class*="error" i]:visible, [class*="alert" i]:visible, ...'
).allTextContents();

// ❌ НЕПРАВИЛЬНО: весь body text (включает JSON)
const bodyText = await page.textContent('body');
```

#### YouTube / Google
| Аспект | Детали |
|--------|--------|
| **Логин URL** | `https://accounts.google.com/ServiceLogin` |
| **Verification** | Google часто запрашивает верификацию при входе с нового IP/устройства |
| **YouTube Studio** | `studio.youtube.com` блокирует доступ для VPS IP — показывает "Произошла ошибка" и 403 |
| **Edit Profile** | Через Studio нестабильно. `#textbox` элементы (contenteditable) НЕ рендерятся при блокировке |
| **YouTube DE locale** | Proxy из Германии → YouTube показывает немецкую локаль |

### Прокси система

| Параметр | Значение |
|----------|----------|
| **Тип** | Residential/Mobile proxies (HTTP) |
| **Формат** | `http://host:port` с `username:password` auth |
| **Привязка** | Каждый аккаунт привязан к конкретному proxy через `pinnedProxyId` |
| **Ротация** | LTE rotation через GET-запрос на rotation URL → ждать 12с |

**⚠️ IP флаги**: YouTube Studio и TikTok могут зафлагировать конкретный IP прокси. Если rate-limit не проходит после 48ч — менять прокси.

### Cookie-based Auth (AES-256-GCM)

**Поля в Prisma schema:**
```
cookiesEncrypted  Bytes?   // AES-256-GCM ciphertext
cookiesIv         Bytes?   // 12-byte IV for GCM
cookiesAuthTag    Bytes?   // 16-byte authentication tag
cookiesUpdatedAt  DateTime?
```

**Дешифровка:**
```typescript
const masterKey = Buffer.from(process.env.MASTER_KEY, "base64");
const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, account.cookiesIv);
decipher.setAuthTag(account.cookiesAuthTag);
const decrypted = Buffer.concat([decipher.update(account.cookiesEncrypted), decipher.final()]);
const cookies = JSON.parse(decrypted.toString("utf8"));
```

### Prisma P2025 (Record Not Found)

**Проблема**: Между dispatch job и его execution аккаунт может быть удалён/пересоздан. `prisma.socialAccount.update()` выбрасывает P2025.

**Решение**: Все `update()` в `login.ts` обёрнуты в `safeUpdateAccount()`:
```typescript
async function safeUpdateAccount(accountId: string, data: Record<string, any>): Promise<void> {
  try {
    await prisma.socialAccount.update({ where: { id: accountId }, data });
  } catch (err: any) {
    if (err?.code === 'P2025') {
      console.warn(`[safeUpdateAccount] Account ${accountId} not found — skipping`);
      return;
    }
    throw err;
  }
}
```

---

## 🛡️ Антифрод и безопасность

### Fingerprint Management
- Patchright генерирует fingerprint при создании аккаунта
- Если Chrome обновился (`Chrome 148 != system Chrome 149`), fingerprint помечается `stale`
- Worker логирует warning но **продолжает работу** — регенерация при следующей "безопасной" операции

### Warmup Curriculum
- Новые аккаунты проходят прогрев (scroll, like, comment)
- `warmupDays` отслеживает прогресс
- Не запускать upload на непрогретых аккаунтах

### Критические ошибки (DO NOT REPEAT)
1. **НЕ тестировать один и тот же аккаунт многократно** — каждый retry усугубляет rate-limit
2. **НЕ использовать `page.textContent('body')`** для детекции ошибок на TikTok — ловит JSON AppContext
3. **НЕ запускать `docker exec` без `-u worker -w /app`** — модули не найдутся
4. **НЕ пушить без проверки** — `docker compose build` занимает ~8 мин, ошибка = потеря 16+ мин

---

## 📊 Текущее состояние аккаунтов

| Аккаунт | Платформа | Статус | Примечание |
|---------|-----------|--------|------------|
| rizwansami225@gmail.com | YouTube | ✅ ALIVE | Login OK, cookies saved, feed verified |
| verasava453@gmail.com | YouTube | ✅ ALIVE | — |
| smshanto377@gmail.com | YouTube | ⚠️ AUTH_NEEDED | — |
| user4784160770083 | TikTok | ⚠️ AUTH_NEEDED | Rate-limited, ждать 48ч |
| user1534590705213 | TikTok | ⚠️ AUTH_NEEDED | — |
| user63986528882138 | TikTok | ⚠️ AUTH_NEEDED | — |

> Последнее обновление: 2026-06-14
