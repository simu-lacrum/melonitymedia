# 🔍 MelonityMedia — Technical Audit Report

**Дата:** 01.06.2026  
**Версия проекта:** v0.2.0 (REST API + 8 queues)  
**Методология:** bug-hunter, debugger, debugging-toolkit-smart-debug  
**Статус:** REPORT ONLY — исправления НЕ применены  

---

## Оглавление

1. [🔴 CRITICAL — Критические баги (требуют немедленного исправления)](#1--critical--критические-баги)
2. [🟠 HIGH — Серьёзные проблемы (влияют на функциональность)](#2--high--серьёзные-проблемы)
3. [🟡 MEDIUM — Умеренные проблемы (потенциальные баги и DX)](#3--medium--умеренные-проблемы)
4. [🔵 LOW — Мелкие проблемы и code quality](#4--low--мелкие-проблемы-и-code-quality)
5. [📊 Сводная таблица](#5--сводная-таблица)

---

## 1. 🔴 CRITICAL — Критические баги

---

### CRIT-01: Дублированный header-комментарий в `proxies.ts`

**Файл:** `apps/api/src/routes/proxies.ts`, строки 1–18  
**Категория:** Code corruption / merge artifact  

**Описание:**  
Файл содержит два идентичных header-комментария подряд — один с `\r\n` (Windows line endings), второй с `\n` (Unix). Это артефакт неаккуратного мерджа или copy-paste. Сами строки безвредны, но второй блок (строки 9–18) содержит расширенный список v3-changes, который отсутствует в первом (строки 1–8). Это говорит о том, что обновление header'а произошло неверно.

```
строки 1-8:  // Proxy Management Routes v3 (с \r\n)
строки 9-18: // Proxy Management Routes v3 (с \n, расширенный)
```

**Воздействие:** Косметическое, но сигнализирует о проблемах с процессом merge. При наличии линтеров с `no-duplicate-comments` правилом — сборка сломается.

**Как воспроизвести:** Открыть файл и посмотреть строки 1–18.

---

### CRIT-02: PATCH /:id в `proxies.ts` — обновление `host`/`port` без обновления полей `host`/`port` в DB

**Файл:** `apps/api/src/routes/proxies.ts`, строки 140–181  
**Категория:** Data inconsistency / logic bug  

**Описание:**  
При PATCH-запросе с `host` и `port`, код обновляет только поле `address` (составное), но НЕ обновляет отдельные поля `host`, `port`, `username`, `password` в записи Proxy. Схема Prisma имеет и `address`, и отдельные `host`/`port`/`username`/`password`. После PATCH данные расходятся:

```typescript
// строки 160-164: Обновляется только address
if (req.body.host && req.body.port) {
  updateData.address = composeAddress(
    req.body.host, req.body.port,
    req.body.username, req.body.password,
  );
}
// НО host, port, username, password в updateData НЕ обновляются!
```

Worker использует `account.pinnedProxy.host/port/username/password` для `buildProxyUrl()` (через `account-context.ts` → `proxy-utils.js`). После PATCH через API, worker продолжит использовать СТАРЫЕ `host`/`port` — прокси не подключится.

**Воздействие:** **КРИТИЧЕСКОЕ.** Пользователь редактирует прокси через UI, видит новый адрес, но worker продолжает слать трафик через старые host:port. Все задачи на этом прокси могут падать с connection refused.

**Как воспроизвести:**
1. Создать прокси host=1.1.1.1, port=8080
2. PATCH с host=2.2.2.2, port=9090
3. Проверить DB: `address` = "2.2.2.2:9090", но `host` = "1.1.1.1", `port` = 8080

---

### CRIT-03: Route ordering конфликт — `DELETE /bulk` vs `DELETE /:id` в `proxies.ts`

**Файл:** `apps/api/src/routes/proxies.ts`, строки 183–223  
**Категория:** Routing bug / incorrect HTTP method  

**Описание:**  
`DELETE /:id` зарегистрирован на строке 184 ПЕРЕД `DELETE /bulk` на строке 203. Express обрабатывает роуты в порядке регистрации. Запрос `DELETE /api/proxies/bulk` будет пойман роутом `DELETE /:id` с `req.params.id = "bulk"`. Prisma попытается найти proxy с id="bulk", не найдёт, и вернёт 404.

**Усугубление:** Даже если переставить роуты, `DELETE /bulk` ожидает `req.body.ids` в DELETE-запросе. Многие HTTP-клиенты (и некоторые прокси/CDN) **не передают body в DELETE-запросах**. Express с `express.json()` может распарсить body, но это не гарантировано при прохождении через reverse proxy.

**Воздействие:** Bulk delete прокси **полностью не работает**. Пользователь видит ошибку "Прокси не найден" при попытке массового удаления.

**Как воспроизвести:**
```bash
curl -X DELETE http://localhost:4000/api/proxies/bulk \
  -H "Content-Type: application/json" \
  -d '{"ids": ["proxy1", "proxy2"]}'
# → 404: "Прокси не найден" (поймано /:id с id="bulk")
```

---

### CRIT-04: Warmup endpoint `/warmup` не диспатчит BullMQ job

**Файл:** `apps/api/src/routes/accounts.ts`, строки 714–756  
**Категория:** Missing implementation / dead feature  

**Описание:**  
`POST /api/accounts/warmup` создаёт `Task` запись в DB, но **не вызывает `dispatchAccountJob()`** и **не вызывает `addJob('warmup', ...)`**. Task создаётся со статусом PENDING, но ни один BullMQ job никогда не попадает в очередь `warmup`. Worker никогда не получит задание на прогрев.

```typescript
// строки 742-749: Создаётся только Task в DB, без dispatch в BullMQ
const task = await prisma.task.create({
  data: {
    userId: req.user!.id,
    type: 'WARMUP',
    config: { accountIds: ids, threads: 3, warmupDays: days },
    accountId,
  },
});
// НЕТ: await dispatchAccountJob({ queueName: 'warmup', ... })
```

**Сравнение:** `POST /api/workspace/launch` правильно вызывает `dispatchAccountJob()` (строки 195-211). Warmup и cookies эндпоинты — нет.

**Воздействие:** **КРИТИЧЕСКОЕ.** Прогрев аккаунтов через быстрый endpoint **не работает**. Пользователь нажимает "Прогрев", видит "Task создан", но прогрев никогда не начинается. Аккаунты остаются в статусе WARMING_UP навечно.

---

### CRIT-05: Cookies endpoint `/cookies` не диспатчит BullMQ job

**Файл:** `apps/api/src/routes/accounts.ts`, строки 758–782  
**Категория:** Missing implementation / dead feature  

**Описание:**  
Идентичная проблема с `POST /api/accounts/cookies`. Создаётся Task, но BullMQ job не диспатчится. Worker никогда не получит задание на обновление cookies.

**Воздействие:** **КРИТИЧЕСКОЕ.** Обновление cookies через быстрый endpoint **не работает**.

---

### CRIT-06: `proxy-rotation-bridge.ts` — unused `crypto` import, но главное: `PROXYGROW` использует HTTP (не HTTPS)

**Файл:** `apps/api/src/lib/proxy-rotation-bridge.ts`, строка 1, строка 64  
**Категория:** Security vulnerability / data leak  

**Описание:**  
PROXYGROW rotation URL на строке 64 использует `http://` вместо `https://`:
```typescript
const url = `http://api.proxygrow.com/rotate?key=${encodeURIComponent(input.apiKey)}&modem=${encodeURIComponent(input.externalId)}`;
```

API key передаётся в открытом виде по HTTP. Любой промежуточный узел (ISP, VPN, Docker bridge) может перехватить API key.

Также: `import crypto from 'crypto'` на строке 1 нигде не используется (dead import).

**Воздействие:** API key пользователя для ProxyGrow утекает при каждой ротации.

---

## 2. 🟠 HIGH — Серьёзные проблемы

---

### HIGH-01: `patchAccountSchema` включает `status: 'ACTIVE'`, но в Prisma enum `AccountStatus` `ACTIVE` — это отдельное значение от `ALIVE`

**Файл:** `apps/api/src/routes/accounts.ts`, строки 409-411  
**Категория:** Enum mismatch / silent data corruption  

**Описание:**  
Zod-схема разрешает `status: 'ACTIVE'`, но НЕ разрешает `status: 'ALIVE'`:
```typescript
status: z.enum([
  'ACTIVE', 'PAUSED', 'BANNED', 'EXPIRED_COOKIES',
  'WARMING_UP', 'SHADOWBAN_SUSPECTED', 'AUTH_NEEDED',
]).optional(),
```

В Prisma enum `AccountStatus` есть и `ALIVE`, и `ACTIVE`. Но фактически по коду:
- Warmup handler ставит `status: 'ALIVE'` по завершении (warmup.ts:130)
- Login handler ставит `status: 'ALIVE'` (login.ts:174)
- ShadowbanDetector проверяет `status !== 'ALIVE'` (shadowban-detector.ts:111)

Если пользователь через PATCH выставит `status: 'ACTIVE'`, аккаунт не будет проверяться shadowban-детектором (он ожидает `ALIVE`), и прогрев пометит его как "не в нормальном состоянии".

**Воздействие:** Путаница между ALIVE/ACTIVE может привести к тому, что shadowban-детектор пропускает shadowban'ённые аккаунты.

---

### HIGH-02: `bulkUpdateSchema` разрешает `status: 'ALIVE'`, а `patchAccountSchema` — нет

**Файл:** `apps/api/src/routes/accounts.ts`, строки 533-545 vs 409-415  
**Категория:** Schema inconsistency  

**Описание:**  
Bulk update Zod-схема разрешает `ALIVE`:
```typescript
status: z.enum(['ALIVE', 'AUTH_NEEDED', 'BANNED', ...]).optional(),
```
Но single PATCH (`patchAccountSchema`) — НЕ разрешает `ALIVE`. Пользователь может выставить ALIVE через bulk, но не через single edit. Непоследовательно.

---

### HIGH-03: `decomposeAddress()` в `proxies.ts` парсит адрес некорректно при наличии `:` в пароле

**Файл:** `apps/api/src/routes/proxies.ts`, строки 54–68  
**Категория:** Parsing bug  

**Описание:**  
`decomposeAddress()` использует `address.split('@')` → `auth.split(':')`. Если пароль содержит символ `@` или `:`, парсинг ломается:
- Пароль `p@ss` → `split('@')` вернёт 3 части вместо 2
- Пароль `p:ss:123` → `split(':')` вернёт 4 части вместо 2

Это legacy-функция, используемая в `enrichProxy()` для обратной совместимости с фронтендом. `composeAddress()` не экранирует спецсимволы.

**Воздействие:** Прокси с паролями, содержащими `:` или `@`, будут показывать некорректные данные на фронтенде.

---

### HIGH-04: `POST /import` в `proxies.ts` — дублирование функциональности с `POST /import/provider`

**Файл:** `apps/api/src/routes/proxies.ts`, строки 249–338 и 340–444  
**Категория:** Architecture / dead code path  

**Описание:**  
Существуют **два** эндпоинта для импорта прокси от провайдера:
1. `POST /import` (mode: `proxys_io`) — строки 284-327, использует старый API URL `https://proxys.io/ru/api/v2/proxies?key=...`
2. `POST /import/provider` — строки 346-443, использует новый URL `https://mobileproxy.space/api/v1/proxies`

Оба работают с `PROXYS_IO`, но используют разные API endpoints, разную структуру ответа, и разную логику сохранения. `POST /import/provider` дополнительно шифрует API key и сохраняет provider-метаданные. `POST /import` — нет.

**Воздействие:** Конфликт логики. Если фронтенд вызывает `/import` вместо `/import/provider`, провайдерские метаданные не сохраняются, ротация через `/rotate` не будет работать (нет `providerExternalId`).

---

### HIGH-05: `POST /:id/test` — stub, не тестирует прокси реально

**Файл:** `apps/api/src/routes/proxies.ts`, строки 225–247  
**Категория:** Missing implementation  

**Описание:**  
Эндпоинт `POST /:id/test` не выполняет реальную TCP-проверку прокси. Он просто проверяет, что запись существует в DB, и возвращает текущий статус:
```typescript
// In production: actually test TCP connection through the proxy
// For now: verify record exists and return status
res.json({
  success: true,
  status: proxy.status,
  address: proxy.address,  // ← LEAKS full address with credentials!
});
```

**Дополнительная проблема:** Ответ включает `proxy.address`, который содержит логин:пароль в открытом виде. Это утечка credentials через API response.

**Воздействие:** "Тест прокси" на UI всегда показывает "OK", даже если прокси мёртв. Утечка credentials.

---

### HIGH-06: `DELETE /firewall` принимает body в DELETE-запросе

**Файл:** `apps/api/src/routes/admin.ts`, строки 186–195  
**Категория:** HTTP semantics violation  

**Описание:**  
```typescript
router.delete('/firewall', async (req: Request, res: Response) => {
  const { ip } = req.body;  // ← body в DELETE
```
Не все HTTP-клиенты и reverse proxy передают body в DELETE. RFC 7231 не запрещает body в DELETE, но многие реализации его игнорируют.

**Воздействие:** Разблокировка IP через фронтенд может не работать, если фронт отправляет DELETE с body через определённые HTTP-библиотеки.

---

### HIGH-07: `enrichProxy()` всегда возвращает `lastCheckedAt: null, lastIP: null`

**Файл:** `apps/api/src/routes/proxies.ts`, строки 71–84  
**Категория:** Data loss in response  

**Описание:**  
`enrichProxy()` хардкодит `lastCheckedAt: null` и `lastIP: null`, перезатирая реальные значения из DB (`lastIP`, `lastIPAt` из Prisma schema). Фронтенд никогда не увидит реальный lastIP.

```typescript
function enrichProxy(proxy: any) {
  return {
    ...proxy,           // включает proxy.lastIP и proxy.lastIPAt
    lastCheckedAt: null, // ← ПЕРЕЗАТИРАЕТ
    lastIP: null,        // ← ПЕРЕЗАТИРАЕТ proxy.lastIP
  };
}
```

---

### HIGH-08: Video reorder endpoint не проверяет userId

**Файл:** `apps/api/src/routes/videos.ts`, строки 28–46  
**Категория:** Authorization bypass / IDOR  

**Описание:**  
`PATCH /api/videos/reorder` принимает массив `items: [{id, order}]` и обновляет порядок видео без проверки, что видео принадлежат текущему пользователю:
```typescript
await prisma.$transaction(
  items.map(({ id, order }) =>
    prisma.video.update({
      where: { id },  // ← нет where: { userId: req.user!.id }
      data: { order },
    }),
  ),
);
```

Пользователь A может изменить порядок видео пользователя B, зная ID их видео.

**Воздействие:** IDOR (Insecure Direct Object Reference). Любой авторизованный пользователь может менять порядок чужих видео.

---

### HIGH-09: `warmupDay` clamp в accounts GET неправильно вычисляет «завершённый» день

**Файл:** `apps/api/src/routes/accounts.ts`, строки 130–135  
**Категория:** Logic bug  

**Описание:**  
```typescript
const warmupDay = a.warmupStartedAt
  ? Math.min(
      (a.warmupDays ?? 10) + 1,  // ← clamp к warmupDays + 1
      Math.ceil((Date.now() - new Date(a.warmupStartedAt).getTime()) / 86_400_000),
    )
  : null;
```

Clamp к `warmupDays + 1` означает, что после завершения прогрева фронтенд покажет "День 11/10". Это контринтуитивно. Должно быть `warmupDays` (т.е. 10/10), а не `warmupDays + 1`.

---

## 3. 🟡 MEDIUM — Умеренные проблемы

---

### MED-01: `createSeededRandom()` в `uniquifier.ts` имеет ограниченную энтропию

**Файл:** `apps/worker/src/core/video/uniquifier.ts`, строки 58–67  
**Категория:** Algorithm flaw  

**Описание:**  
PRNG читает 4 байта за раз из 32-байтного SHA-256 хеша, но `idx` сбрасывается по модулю 28 (не 32):
```typescript
const val = hash.readUInt32BE(idx % 28);  // 32 bytes, 4 bytes per read = 7 reads
idx = (idx + 4) % 28;
```

`idx % 28` означает, что последние 4 байта хеша (offset 28-31) НИКОГДА не используются. При 7 вызовах PRNG начнёт повторяться. Для функции, которая вызывается ~8 раз подряд (cropPx, cropSide, brightness, contrast, hue, pitchShift, trimStart, trimEnd), это означает, что `trimEnd` получит то же значение, что `cropPx`.

**Воздействие:** Видео уникализация менее разнообразна, чем задумано. Для одного accountId transforms будут частично повторяться.

---

### MED-02: `uniquifyVideo()` не обрезает конец видео

**Файл:** `apps/worker/src/core/video/uniquifier.ts`, строки 131–158  
**Категория:** Missing implementation  

**Описание:**  
Комментарий и transforms говорят о trim end:
```typescript
const trimEnd = seededRange(rng, 0.05, 0.3);
transforms.push(`trim: start=${trimStart.toFixed(2)}s, end=-${trimEnd.toFixed(2)}s`);
```
Но FFmpeg-аргументы НЕ используют `trimEnd`:
```typescript
'-t', `99999`,  // We'll handle end trim via filter if needed
```

`-t 99999` — это 27 часов, т.е. весь файл. Конец видео никогда не обрезается. Комментарий `"We'll handle end trim via filter if needed"` — TODO, который не реализован.

**Воздействие:** Видео менее уникально, чем заявлено. End trim не применяется, хотя фронтенд может показывать "trim: end=-0.15s" в логах.

---

### MED-03: `composeAddress()` в `proxies.ts` создаёт формат, несовместимый с import/manual парсером

**Файл:** `apps/api/src/routes/proxies.ts`, строки 46–51 vs строки 261-269  
**Категория:** Format inconsistency  

**Описание:**  
- `composeAddress()` создаёт формат: `user:pass@host:port`
- Manual import parser (строки 261-269) ожидает формат: `host:port:user:pass`
- Provider import (строка 428) создаёт: `host:port:user:pass`

Три разных формата address в одной системе. `decomposeAddress()` умеет парсить только `user:pass@host:port`. Если provider import сохранил `host:port:user:pass`, `enrichProxy()` распарсит это неверно.

---

### MED-04: `fingerprint.ts` использует `Intl.DateTimeFormat().resolvedOptions().timeZone` — серверный timezone

**Файл:** `apps/api/src/lib/fingerprint.ts`, строки 60 и 144  
**Категория:** Logic bug  

**Описание:**  
```typescript
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
```

Это возвращает timezone **сервера** (Docker контейнера), а не timezone, соответствующий geo-данным аккаунта. Если сервер в UTC, все fingerprints будут иметь `timezone: "UTC"`. TikTok видит, что аккаунт якобы из USA с carrier T-Mobile, но timezone UTC — подозрительно.

**Воздействие:** Все fingerprints имеют одинаковый timezone, что является антифрод-сигналом.

---

### MED-05: Session validator (`session-validator.ts`) хардкодит TikTok API URL

**Файл:** `apps/worker/src/core/auth/session-validator.ts`, строка 38  
**Категория:** Platform support gap  

**Описание:**  
```typescript
const resp = await impersonatedFetch({
  url: 'https://www.tiktok.com/api/user/detail/?aid=1988',
```

Этот endpoint используется для валидации cookies, но функция `validateCookies()` вызывается и для YouTube-аккаунтов (через upload handler). YouTube cookies никогда не пройдут валидацию по TikTok URL.

**Воздействие:** Все YouTube-аккаунты будут помечены как `expired` при pre-flight проверке.

---

### MED-06: `admin.ts` — PATCH /users/:id не валидирует входные данные

**Файл:** `apps/api/src/routes/admin.ts`, строки 94–110  
**Категория:** Input validation gap  

**Описание:**  
```typescript
const { maxThreads, role } = req.body;
const user = await prisma.user.update({
  data: {
    ...(maxThreads !== undefined && { maxThreads }),
    ...(role !== undefined && { role }),
  },
});
```

Нет Zod-валидации. `maxThreads` может быть любым типом (string, negative number, float). `role` может быть невалидным enum-значением — Prisma выбросит необработанную ошибку.

---

### MED-07: Cookie token extraction в `socket.ts` — уязвимость к cookie injection

**Файл:** `apps/api/src/lib/socket.ts`, строки 35–40  
**Категория:** Security / weak parsing  

**Описание:**  
```typescript
const token =
  socket.handshake.auth?.token ||
  socket.handshake.headers?.cookie
    ?.split(';')
    .find((c: string) => c.trim().startsWith('melonity_token='))
    ?.split('=')[1];
```

Если cookie value содержит `=` (Base64-encoded JWT часто содержит `=` padding), `split('=')[1]` обрежет токен. Нужно `split('=').slice(1).join('=')`.

---

### MED-08: Warmup handler не сохраняет session cookies после закрытия

**Файл:** `apps/worker/src/handlers/warmup.ts`, строки 141–143  
**Категория:** Session loss  

**Описание:**  
Upload handler на строках 189-198 сохраняет cookies после сессии:
```typescript
if (ctx?.context) {
  const cookies = await ctx.context.cookies();
  await saveCookiesToDiskCache(data.accountId, cookies, ...);
}
```

Warmup handler (`warmup.ts`) **не сохраняет cookies** в finally-блоке (строки 141-143). Каждый warmup-сеанс может обновлять session cookies (tt_webid, s_v_web_id и др.), но эти обновления теряются.

**Воздействие:** TikTok refresh'ит session cookies каждый визит. Без сохранения, аккаунт может быть помечен как suspicious из-за устаревших cookies.

---

### MED-09: `POST /api/admin/users/:id/ban` не проверяет target userId

**Файл:** `apps/api/src/routes/admin.ts`, строки 113–145  
**Категория:** Logic bug / self-ban risk  

**Описание:**  
Нет проверки, что admin не банит самого себя:
```typescript
await prisma.user.update({
  where: { id: req.params.id as string },
  data: { isBanned: true, bannedAt: new Date() },
});
```

Если admin случайно вызовет ban на свой ID, он заблокирует себя без возможности recovery через UI (auth middleware проверяет `isBanned`).

---

### MED-10: `proxy-rotation-bridge.ts` не проверяет HTTPS для MOBILEPROXIES_ORG

**Файл:** `apps/api/src/lib/proxy-rotation-bridge.ts`, строка 50  
**Категория:** Security consideration  

**Описание:**  
`https://buy.mobileproxies.org/api/v1/proxies/${input.externalId}/switch` — HTTPS здесь корректно, но API key передаётся в Authorization header. При MITM на Docker bridge или localhost развернутом reverse proxy, header может быть перехвачен. Рекомендуется TLS certificate pinning для production.

---

## 4. 🔵 LOW — Мелкие проблемы и code quality

---

### LOW-01: `JWT_SECRET` fallback to 'change-me' в middleware, но validated at startup

**Файл:** `apps/api/src/middleware/auth.ts`, строка 16 и `apps/api/src/lib/socket.ts`, строка 14  
**Категория:** Code smell  

**Описание:**  
```typescript
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
```
`index.ts` валидирует JWT_SECRET на старте и делает `process.exit(1)` если невалидный. Но middleware и socket имеют свой fallback `'change-me'`. Если по каким-то причинам startup-проверка обойдена (например, при unit-тестировании), в production может использоваться 'change-me'.

---

### LOW-02: `unused import crypto` в `proxy-rotation-bridge.ts`

**Файл:** `apps/api/src/lib/proxy-rotation-bridge.ts`, строка 1  
**Категория:** Dead code  

**Описание:** `import crypto from 'crypto'` не используется нигде в файле.

---

### LOW-03: `MASTER_KEY` validation в API — не required

**Файл:** `apps/api/src/index.ts`, строки 49–62  
**Категория:** Configuration gap  

**Описание:**  
API валидирует MASTER_KEY только если он **установлен**. Если MASTER_KEY отсутствует, API стартует нормально. Но encrypt/decrypt функции в accounts.ts выбросят runtime error при попытке шифрования cookies (Buffer.from('', 'base64').length === 0 !== 32).

Worker, в отличие от API, делает hard fail (`process.exit(1)`) если MASTER_KEY невалиден.

---

### LOW-04: `import { buildProxyUrl } from './proxy-utils.js'` в конце файла

**Файл:** `apps/worker/src/lib/account-context.ts`, строка 71  
**Категория:** Code style / non-standard  

**Описание:**  
Import размещён в самом конце файла (строка 71), после всех export'ов. Хотя ESM hoists imports, это нарушает конвенцию "imports at top" и может запутать линтеры.

---

### LOW-05: `workspace.ts` — buildExtra не использует `_accountId` параметр

**Файл:** `apps/api/src/routes/workspace.ts`, строка 174  
**Категория:** Unused parameter  

**Описание:**  
```typescript
const buildExtra = async (_accountId: string) => {
```
Параметр `_accountId` не используется внутри функции. Вызов `buildExtra(accountId)` передаёт accountId, но функция его игнорирует. Для UPLOAD-типа видео берётся через `config.videoId`, а не через accountId.

---

### LOW-06: Inconsistent error responses — смесь русского и английского

**Категория:** DX / Localization  

**Описание:**  
API ошибки непоследовательно на русском и английском:
- `proxies.ts:329`: `'Invalid mode'` (English)
- `proxies.ts:97`: `'Ошибка при загрузке прокси'` (Russian)
- `workspace.ts:178`: `"UPLOAD requires config.videoId"` (English)
- `accounts.ts:239`: `'Не удалось распарсить...'` (Russian)

---

### LOW-07: `DATACENTER_DEPRECATED` enum value in ProxyType

**Файл:** `apps/api/prisma/schema.prisma`, строка 191  
**Категория:** Dead enum value  

**Описание:**  
`DATACENTER_DEPRECATED` — deprecated proxy type, но он всё ещё принимается в `createProxySchema` (`proxies.ts:38`). Рекомендуется убрать из Zod schema и добавить migration, чтобы заменить существующие записи.

---

### LOW-08: `views-chart` endpoint возвращает неструктурированные данные

**Файл:** `apps/api/src/routes/analytics.ts`, строки 48–66  
**Категория:** API design / stub  

**Описание:**  
Комментарий говорит "In production, a separate ViewsHistory model would store daily snapshots". Текущая реализация возвращает raw account data, непригодное для time-series визуализации (Recharts). Нет daily snapshots, нет date bucketing.

---

### LOW-09: `address` field в proxy response утекает credentials

**Файл:** `apps/api/src/routes/proxies.ts`, строки 238-240 и `enrichProxy()` строки 71-84  
**Категория:** Information leak  

**Описание:**  
`enrichProxy()` копирует все поля прокси включая `address` (который содержит `user:pass@host:port`). `POST /:id/test` возвращает `address` напрямую. Credentials прокси утекают в API response.

---

## 5. 📊 Сводная таблица

| ID | Severity | Файл | Описание | Тип |
|-----|----------|------|----------|-----|
| CRIT-01 | 🔴 CRITICAL | proxies.ts:1-18 | Дублированный header-комментарий | Code corruption |
| CRIT-02 | 🔴 CRITICAL | proxies.ts:140-181 | PATCH не обновляет host/port в DB | Data inconsistency |
| CRIT-03 | 🔴 CRITICAL | proxies.ts:183-223 | Route ordering: DELETE /bulk → /:id | Routing bug |
| CRIT-04 | 🔴 CRITICAL | accounts.ts:714-756 | Warmup не диспатчит BullMQ job | Dead feature |
| CRIT-05 | 🔴 CRITICAL | accounts.ts:758-782 | Cookies refresh не диспатчит BullMQ job | Dead feature |
| CRIT-06 | 🔴 CRITICAL | proxy-rotation-bridge.ts:64 | HTTP вместо HTTPS для ProxyGrow API key | Security |
| HIGH-01 | 🟠 HIGH | accounts.ts:409-411 | ACTIVE vs ALIVE enum mismatch | Logic bug |
| HIGH-02 | 🟠 HIGH | accounts.ts:533-545 | Schema inconsistency ALIVE в bulk vs single | Inconsistency |
| HIGH-03 | 🟠 HIGH | proxies.ts:54-68 | decomposeAddress breaks on `:` in password | Parsing bug |
| HIGH-04 | 🟠 HIGH | proxies.ts:249-444 | Дублированный import endpoint | Architecture |
| HIGH-05 | 🟠 HIGH | proxies.ts:225-247 | Proxy test — stub + credential leak | Missing impl |
| HIGH-06 | 🟠 HIGH | admin.ts:186-195 | DELETE body для firewall unblock | HTTP semantics |
| HIGH-07 | 🟠 HIGH | proxies.ts:71-84 | enrichProxy hardcodes lastIP: null | Data loss |
| HIGH-08 | 🟠 HIGH | videos.ts:28-46 | Reorder без проверки userId (IDOR) | Authorization |
| HIGH-09 | 🟠 HIGH | accounts.ts:130-135 | warmupDay clamp к +1 (UI показывает 11/10) | Logic bug |
| MED-01 | 🟡 MEDIUM | uniquifier.ts:58-67 | Ограниченная энтропия PRNG (idx%28) | Algorithm |
| MED-02 | 🟡 MEDIUM | uniquifier.ts:131-158 | End trim не реализован | Missing impl |
| MED-03 | 🟡 MEDIUM | proxies.ts:46-51 | 3 разных формата address | Inconsistency |
| MED-04 | 🟡 MEDIUM | fingerprint.ts:60,144 | Серверный timezone вместо geo | Logic bug |
| MED-05 | 🟡 MEDIUM | session-validator.ts:38 | Хардкод TikTok URL для YouTube | Platform gap |
| MED-06 | 🟡 MEDIUM | admin.ts:94-110 | Нет валидации input в PATCH users | Input validation |
| MED-07 | 🟡 MEDIUM | socket.ts:35-40 | Cookie parsing обрезает JWT с `=` | Security |
| MED-08 | 🟡 MEDIUM | warmup.ts:141-143 | Cookies не сохраняются после warmup | Session loss |
| MED-09 | 🟡 MEDIUM | admin.ts:113-145 | Admin может забанить самого себя | Logic bug |
| MED-10 | 🟡 MEDIUM | proxy-rotation-bridge.ts | Нет TLS pinning для provider APIs | Security |
| LOW-01 | 🔵 LOW | auth.ts:16, socket.ts:14 | JWT_SECRET fallback 'change-me' | Code smell |
| LOW-02 | 🔵 LOW | proxy-rotation-bridge.ts:1 | Unused crypto import | Dead code |
| LOW-03 | 🔵 LOW | index.ts:49-62 | MASTER_KEY не required в API | Config gap |
| LOW-04 | 🔵 LOW | account-context.ts:71 | Import в конце файла | Code style |
| LOW-05 | 🔵 LOW | workspace.ts:174 | Unused `_accountId` parameter | Dead code |
| LOW-06 | 🔵 LOW | Various | Смешанные русский/английский ошибки | DX |
| LOW-07 | 🔵 LOW | schema.prisma:191 | DATACENTER_DEPRECATED всё ещё принимается | Dead enum |
| LOW-08 | 🔵 LOW | analytics.ts:48-66 | views-chart — stub, не time-series | API design |
| LOW-09 | 🔵 LOW | proxies.ts:238-240 | address field утекает credentials | Info leak |

---

## Итого

| Severity | Количество |
|----------|-----------|
| 🔴 CRITICAL | 6 |
| 🟠 HIGH | 9 |
| 🟡 MEDIUM | 10 |
| 🔵 LOW | 9 |
| **ВСЕГО** | **34** |

---

## Рекомендуемый приоритет исправления

1. **Немедленно:** CRIT-02, CRIT-03, CRIT-04, CRIT-05 (proxy PATCH data loss, bulk delete broken, warmup/cookies dead)
2. **До первого production deploy:** CRIT-06, HIGH-08, MED-04, MED-05, MED-07
3. **Следующий спринт:** HIGH-01..HIGH-09, MED-01..MED-03, MED-06, MED-08, MED-09
4. **Backlog:** LOW-01..LOW-09
