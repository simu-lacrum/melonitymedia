# MelonityMedia — Технический аудит 02.06.2026

> **Методология**: Bug Hunter + Debugger + Smart Debug (line-by-line audit)
> **Охват**: Все файлы apps/api и apps/worker (routes, handlers, core, lib)
> **Цель**: Найти ВСЕ ошибки, не исправлять — описать максимально подробно

---

## Содержание

- [CRITICAL — Приоритет 1 (блокирующие ошибки)](#critical)
- [HIGH — Приоритет 2 (ведут к фроду или потере данных)](#high)
- [MEDIUM — Приоритет 3 (логические ошибки и race conditions)](#medium)
- [LOW — Приоритет 4 (улучшения и hardening)](#low)

---

<a id="critical"></a>
## 🔴 CRITICAL — Блокирующие ошибки

### BUG-C1: `cookies.ts` handler получает stale данные из BullMQ payload вместо DB

**Файл**: `apps/worker/src/handlers/cookies.ts` (строки 24–31, 44–48)

**Суть**: Handler `cookiesHandler` принимает `platform`, `fingerprint` и `proxyUrl` из `job.data` (BullMQ payload), а **не** из `loadAccountContext()`. Это прямо нарушает архитектурное правило проекта, зафиксированное в `account-context.ts` (строки 3–7):

```
// Resolve everything a handler needs about an account from the DB,
// using only the accountId as input. Handlers must NEVER receive
// fingerprint / proxyUrl / platform in their BullMQ payload —
// those can go stale while the job sits in the queue
```

В отличие от `upload.ts` и `warmup.ts` (которые правильно вызывают `loadAccountContext()`), `cookies.ts` использует:
```ts
interface CookiesJobData {
  platform: 'TIKTOK' | 'YOUTUBE';       // ← stale
  fingerprint: AccountFingerprint;       // ← stale
  proxyUrl?: string;                     // ← stale
}
```

**Последствия**:
- Если пользователь поменял proxy после того как job попал в очередь, cookies handler откроет браузер со **старым** proxy — TikTok увидит смену IP → shadowban.
- Если fingerprint был пересоздан (для аккаунтов без публикаций), handler будет использовать старый → несовпадение fingerprint → банк от антифрода.

**Воспроизведение**: Поставить cookies job в очередь → сменить proxy на аккаунте → дождаться выполнения job.

---

### BUG-C2: `edit-profile.ts` handler тоже получает stale данные из payload

**Файл**: `apps/worker/src/handlers/edit-profile.ts` (строки 19–30, 42–47)

**Суть**: Абсолютно та же проблема, что и BUG-C1. Handler `editProfileHandler` принимает `platform`, `fingerprint`, `proxyUrl` из job payload вместо `loadAccountContext()`.

```ts
interface EditProfileJobData {
  platform: 'TIKTOK' | 'YOUTUBE';       // ← stale
  fingerprint: AccountFingerprint;       // ← stale
  proxyUrl?: string;                     // ← stale
}
```

**Последствия**: Идентичны BUG-C1 — stale proxy/fingerprint ведут к детекту антифродом.

---

### BUG-C3: `isShortsCompatible()` — порог aspect ratio слишком мягкий, пропускает горизонтальное видео

**Файл**: `apps/worker/src/core/video/inspector.ts` (строки 39–40)

**Суть**: Проверка `aspectRatio > 0.85` пропускает видео с соотношением сторон до 0.85 (≈ 5:6). YouTube Shorts требует **вертикальное** видео с aspect ratio ≤ 0.5625 (9:16). Любое видео между 0.5625 и 0.85 будет отклонено YouTube при загрузке, но наш validator его пропустит.

```ts
if (meta.aspectRatio > 0.85) {
  return { ok: false, reason: `...` };  // ← порог 0.85 слишком высок
}
```

**Правильное значение**: `≤ 0.5625` (9:16) — стандартный формат Shorts. Допустимо ≤ 0.75 (3:4) с оговоркой в UI.

**Последствия**: Видео 3:4 (640×480, ratio=1.33) проходит проверку → загрузка → YouTube отклоняет → job FAILED → пользователь думает, что система не работает. Кроме того, функция сравнивает width/height (> 0.85), но для вертикального видео width < height, поэтому ratio < 1, и проверка имеет смысл только если ratio определён как width/height. Однако **комментарий** в коде говорит "нужно ≤ 0.5625", что противоречит фактическому порогу 0.85.

---

### BUG-C4: `saveCookiesToDiskCache()` в login handler вызывается без cookiesDir default

**Файл**: `apps/worker/src/handlers/login.ts` (строка 160)

**Суть**:
```ts
await saveCookiesToDiskCache(data.accountId, browserCookies, data.cookiesDir);
```

`data.cookiesDir` может быть `undefined` (поле optional в `LoginJobData`). Функция `saveCookiesToDiskCache` имеет default `/data/cookies` только для параметра, но при передаче `undefined` напрямую default не сработает — JS передаёт explicit `undefined`, который **не** триггерит default parameter значение.

**Нет!** — Проверка: в TypeScript/JS `undefined` **действительно** триггерит default parameter. Пересматриваю:

Фактически в JS, если `data.cookiesDir` === `undefined`, то `saveCookiesToDiskCache(id, cookies, undefined)` → параметр `cookiesDir` получит `undefined` → default **не сработает**, потому что `undefined` считается "переданным". **НЕТ**, это неверно — в JS `undefined` === отсутствие аргумента для default params.

> **Уточнение**: По спецификации ECMAScript, `f(x, y, undefined)` для функции `f(a, b, c = 'default')` — параметр `c` **получит** значение `'default'`. Default parameter срабатывает когда значение `undefined`.

**Заключение**: Это **не баг** — default parameter работает корректно с `undefined`. Снимаю этот пункт.

---

### BUG-C5: `warmup.ts` НЕ сохраняет обновлённые cookies В БД, только на диск

**Файл**: `apps/worker/src/handlers/warmup.ts` (строки 143–159)

**Суть**: В блоке `finally`, warmup handler сохраняет cookies только на диск через `saveCookiesToDiskCache()`, но **не** обновляет зашифрованные cookies в БД. При этом:

1. `upload.ts` делает то же самое — только disk cache (строка 194). Но upload имеет pre-flight `validateCookies()`, который читает из encrypted store в DB.
2. `login.ts` корректно сохраняет и на диск, и в DB (строки 162–181).

**Последствия**: 
- Если disk cache потеряется (перезапуск контейнера, docker volume очистка), обновлённые cookies будут утеряны.
- Worker на другом узле (при горизонтальном масштабировании) не получит обновлённые cookies из DB.
- Pre-flight `validateCookies()` → `loadCookiesFromEncryptedStore()` → disk fallback → DB → **старые cookies** → может вернуть `expired` для фактически живого аккаунта.

---

<a id="high"></a>
## 🟠 HIGH — Фрод-риск и потеря данных

### BUG-H1: `upload.ts` тоже НЕ сохраняет cookies в DB после сессии

**Файл**: `apps/worker/src/handlers/upload.ts` (строки 190–199)

**Суть**: Аналогично BUG-C5 — `upload.ts` сохраняет cookies только на диск (`saveCookiesToDiskCache`), но не в DB.

```ts
if (ctx?.context) {
  const cookies = await ctx.context.cookies() as BrowserCookie[];
  if (cookies.length > 0) {
    await saveCookiesToDiskCache(data.accountId, cookies, ...);
    // ← Нет prisma.socialAccount.update для cookiesEncrypted/Iv/AuthTag
  }
}
```

**Последствия**: Те же что BUG-C5 — потеря cookies при перезапуске контейнера. При этом именно upload handler используется чаще всего (основной use case продукта).

---

### BUG-H2: `edit-profile.ts` НЕ сохраняет cookies в DB после сессии

**Файл**: `apps/worker/src/handlers/edit-profile.ts` (строки 103–115)

**Суть**: Та же проблема — только disk cache, нет DB-обновления.

---

### BUG-H3: `cookies.ts` handler НЕ сохраняет cookies в DB

**Файл**: `apps/worker/src/handlers/cookies.ts` (строки 86–87)

**Суть**: Парадоксально: handler, **чьё название** — "cookies" (обновление cookies) — не сохраняет обновлённые cookies в DB. Только disk cache. Это handler, который запускается специально для обновления cookies, и он НЕ выполняет свою основную функцию до конца.

---

### BUG-H4: `_lightEngagement` — `_randomDelay` используется для сравнения, а не для задержки

**Файл**: `apps/worker/src/handlers/warmup.ts` (строка 245)

**Суть**:
```ts
if (!commented && data.warmupDay >= 5 && i === _randomDelay(3, watchCount - 2)) {
```

`_randomDelay()` генерирует **новое случайное число** на каждой итерации цикла. Сравнение `i === _randomDelay(3, watchCount - 2)` означает, что на каждой итерации сравнивается текущий `i` с НОВЫМ рандомным числом. Это приводит к непредсказуемому поведению:
- Может вообще не совпасть ни разу (нет комментария).
- Может совпасть несколько раз, но `commented` flag останавливает повторы.

**Правильная логика**: Вынести `_randomDelay(3, watchCount - 2)` за цикл в переменную `commentAtIndex`, и сравнивать `i === commentAtIndex`.

---

### BUG-H5: `accounts.ts` — PATCH /:id позволяет менять status на ALIVE для заблокированного аккаунта

**Файл**: `apps/api/src/routes/accounts.ts` (строки 410–413)

**Суть**: Zod-схема для PATCH разрешает `status: 'ALIVE'` без каких-либо проверок. Если аккаунт имеет status `BANNED` или `SHADOWBAN_SUSPECTED`, пользователь может просто отправить `PATCH /:id { status: "ALIVE" }` и снять флаг без валидации. Это позволяет обойти shadowban detection system.

**Правильное поведение**: Переход из `BANNED` → `ALIVE` должен быть разрешён только ADMIN с `force=true`, или только после re-import cookies. Переход из `SHADOWBAN_SUSPECTED` → `ALIVE` должен иметь cooldown (7 дней рекомендуется по логике shadowban-detector).

---

### BUG-H6: `workspace.ts` — launch UPLOAD отправляет ОДИН videoId на ВСЕ accountIds

**Файл**: `apps/api/src/routes/workspace.ts` (строки 174–191, 195–211)

**Суть**: `buildExtra()` вызывается внутри `map()`, но `config.videoId` — один и тот же для всех аккаунтов. Это значит, что **одно и то же видео** будет загружено на все выбранные аккаунты.

Это **может быть** intended (массовый залив одного ролика на все аккаунты), но тогда уникализация видео (uniquifier) **должна** создавать разные версии для каждого accountId. Проверяя `uniquifyVideo()` — да, оно получает `accountId` как seed, поэтому каждый аккаунт получит уникальную версию. **Это не баг** — это intended behavior.

**Однако**: нет возможности загрузить **разные** видео на **разные** аккаунты через один launch. Это ограничение дизайна, а не баг.

---

### BUG-H7: `proxy-utils.ts` — buildProxyUrl fallback проглатывает ошибку при невалидном URL

**Файл**: `apps/worker/src/lib/proxy-utils.ts` (строки 50–53)

**Суть**:
```ts
try {
  const u = new URL(`${protocol}${auth}${ip}${portStr}`);
  return u.toString().replace(/\/$/, '');
} catch {
  return `${protocol}${ip}`;  // ← возвращает невалидный URL без ошибки
}
```

Если конструктор `new URL()` бросает исключение (невалидный host, плохой port), функция молча возвращает `http://somegarbage` вместо ошибки. Этот URL потом передаётся в Patchright как proxy → browser не может подключиться → timeout → непонятная ошибка.

**Правильное поведение**: Бросить `Error` с описанием проблемы.

---

<a id="medium"></a>
## 🟡 MEDIUM — Логические ошибки и race conditions

### BUG-M1: `fingerprint.ts` (API) vs `fingerprint-manager.ts` (worker) — дублирование кода с расхождением

**Файлы**: 
- `apps/api/src/lib/fingerprint.ts` — `generateFingerprint()` (API side)
- `apps/worker/src/core/browser/fingerprint-manager.ts` — `generateFingerprintForAccount()` (worker side)

**Суть**: Существуют **две** реализации генератора fingerprint:
1. API-side (`fingerprint.ts`) — вызывается при import аккаунта.
2. Worker-side (`fingerprint-manager.ts`) — не вызывается при import, но имеет consistency validation.

API-версия **не** вызывает `validateFingerprintConsistency()` после генерации. Worker-версия **вызывает**. Это значит, что при определённых edge cases API может создать невалидный fingerprint, который worker потом отклонит при launch.

Также API-версия использует `hash[N]` (Buffer byte indexing), а worker-версия использует `seed(N)` (4-byte hex parsing), — разные PRNG-стратегии для одних и тех же данных. Для одинакового `accountId` обе функции **генерируют разные fingerprints**.

**Последствия**: Если когда-либо worker-side generator будет вызван для аккаунта, созданного через API import, fingerprint **изменится** → нарушение правила "один аккаунт = один fingerprint навсегда".

---

### BUG-M2: `cookies.ts` handler — `saveCookiesToDiskCache` вызывается без `cookiesDir` default

**Файл**: `apps/worker/src/handlers/cookies.ts` (строка 87)

**Суть**:
```ts
await saveCookiesToDiskCache(data.accountId, browserCookies, data.cookiesDir);
```

В отличие от `upload.ts` (строка 194: `data.cookiesDir ?? '/data/cookies'`), cookies handler **не** использует fallback `?? '/data/cookies'`. Однако, `saveCookiesToDiskCache` имеет default parameter: `cookiesDir: string = '/data/cookies'`.

Как обсуждалось: `undefined` **триггерит** default parameter в JS/TS. Так что это **не критично**, но **стилистически некорректно** — все остальные handlers используют `?? '/data/cookies'`, а этот нет. Создаёт путаницу при ревью.

---

### BUG-M3: `warmup.ts` — hardcoded базовые хэштеги "dota2" для всех аккаунтов

**Файл**: `apps/worker/src/handlers/warmup.ts` (строки 107–108)

**Суть**:
```ts
const baseHashtags = ['dota2', 'dota', 'dotawtf', 'dota2highlights'];
const mergedHashtags = [...new Set([...baseHashtags, ...userHashtags])];
```

Hardcoded дота-хэштеги используются для **всех** аккаунтов при warmup, независимо от их реальной ниши. Если аккаунт предназначен для кулинарных рецептов, warmup будет проходить по дота-контенту → TikTok сформирует неверную рекомендательную модель для аккаунта → при загрузке реального контента, FYP-алгоритм будет показывать его не той аудитории → низкий engagement → автоматический shadowban detection.

**Правильное поведение**: Хэштеги должны передаваться при создании warmup задачи, без hardcoded значений. Или привязаны к аккаунту/пресету.

---

### BUG-M4: `upload.ts` — пре-post captcha handler не возвращает после solve, а продолжает к POST кнопке

**Файл**: `apps/worker/src/handlers/upload.ts` (строки 270–288, 290–308)

**Суть**: Pre-post captcha check (строки 270–288) проверяет captcha **до** нажатия POST. Если captcha обнаружена и решена — ок. Но потом код безусловно идёт к нажатию POST кнопки (строки 290–308). 

Проблема: если pre-post captcha handler обнаружил, что `CAPSOLVER_API_KEY` не установлен (строка 284), он бросает ошибку, и POST кнопка не будет нажата. Это правильно. **Но** если captcha вообще нет, `handleTikTokCaptcha` catch block (строки 282–288) всё равно выполняет проверку `!process.env.CAPSOLVER_API_KEY` и бросает ошибку. 

**Нет** — перепроверяю: `handleTikTokCaptcha()` возвращает `false` если captcha нет → `capErr` не бросается → catch не вызывается. Если captcha есть и solve failed → catch вызывается → проверяет CAPSOLVER_API_KEY. Это **корректно**.

**Снимаю баг.**

---

### BUG-M5: Race condition в `cleanup.ts` — `readdirSync` + `unlinkSync` без блокировки

**Файл**: `apps/worker/src/handlers/cleanup.ts` (строки 42–50)

**Суть**: Handler использует синхронные файловые операции (`readdirSync`, `unlinkSync`), что блокирует event loop. При concurrency: 1 это не критично (один job за раз). Однако, если другой job (upload) пишет в ту же директорию одновременно, `unlinkSync` может попытаться удалить файл, который ещё пишется.

**Серьёзность**: Низкая, т.к. cleanup concurrency = 1 и файлы в разных поддиректориях.

---

### BUG-M6: `workspace.ts` — /queue POST добавляет videoIds в config, но НЕ создаёт новые BullMQ jobs

**Файл**: `apps/api/src/routes/workspace.ts` (строки 258–291)

**Суть**: Route `POST /queue` обновляет `task.config.videoIds` в БД, но **не** диспатчит новые BullMQ jobs. Это значит, что добавленные видео никогда не будут обработаны — они просто лежат в config как мёртвые данные.

```ts
// Only updates DB config — no dispatchAccountJob() call
await prisma.task.update({
  where: { id: taskId },
  data: { config: { ...currentConfig, videoIds: updatedVideos } },
});
```

**Последствия**: Фича "dynamic queue addition" не работает — видео добавляются в config, но BullMQ их не забирает.

---

### BUG-M7: `warmup.ts` — при warmupDay > totalDays, прогрев отмечается завершённым, но фаза Active может не выполниться

**Файл**: `apps/worker/src/handlers/warmup.ts` (строки 77, 127–133)

**Суть**:
```ts
const warmupDay = data.warmupDay ?? Math.min(ageDays, totalDays);
```

Если аккаунт пропустил несколько дней (сервер был выключен), `ageDays` может быть больше `totalDays`. `Math.min` ограничивает до `totalDays`. Затем на строке 127:
```ts
if (warmupDay >= totalDays) {
  await prisma.socialAccount.update({ data: { warmupCompletedAt: new Date() } });
}
```

Проблема: если `warmupDay === totalDays` (например, 10), аккаунт отмечается как завершивший прогрев. Но `lightEnd` = `ceil(10 * 0.6)` = 6, а `warmupDay` = 10 > 6, так что выполняется `_activeEngagement`. Это **корректно**.

Однако, если `ageDays` = 15 (сервер был выключен 5 дней), `warmupDay` = 10 (clamped), и аккаунт выполнит только **один** день Active engagement вместо 4 дней → прогрев завершён с неполной активной фазой.

**Серьёзность**: Средняя — аккаунт может быть недостаточно прогрет, но формально warm-up пройдёт.

---

<a id="low"></a>
## 🟢 LOW — Улучшения и hardening

### BUG-L1: Отсутствие Helmet / security headers в API

**Файл**: `apps/api/src/index.ts` (предполагается — не видел полностью, но нет import helmet)

**Суть**: API не использует Helmet или ручные security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`). Это стандартная практика для production Express-приложений.

---

### BUG-L2: `rate-limit.ts` — in-memory store не распределён между instances

**Файл**: `apps/api/src/middleware/rate-limit.ts` (строки 17–18)

**Суть**: `const store = new Map<string, RateLimitEntry>()` — in-memory, per-process. В текущей architecture (single instance Docker) это допустимо, но при масштабировании API rate limit не будет работать.

**Комментарий**: Код содержит комментарий об этом (строки 7–8), так что это known limitation, а не баг. Оставляю для полноты.

---

### BUG-L3: `shadowban-detector.ts` — нет userId-scoping в video query

**Файл**: `apps/worker/src/handlers/shadowban-detector.ts` (строки 125–136)

**Суть**: 
```ts
const candidates = await prisma.video.findMany({
  where: {
    accountId,       // ← нет userId filter
    uploadedAt: { ... },
  },
});
```

Query не фильтрует по `userId`. Это не security-проблема (accountId уже уникален), но нарушает принцип "всегда scope по userId" который применяется во всех API routes.

---

### BUG-L4: `fingerprint.ts` (API) — `generateFingerprint` не валидирует что `geo.country` есть в lookup table

**Файл**: `apps/api/src/lib/fingerprint.ts` (строки 73–74)

**Суть**:
```ts
const locale = localeByCountry[geo?.country ?? 'US'] ?? 'en-US';
const timezone = timezoneByCountry[geo?.country ?? 'US'] ?? 'America/New_York';
```

Если `geo.country` = "CN" (Китай) — не в lookup table → locale = 'en-US', timezone = 'America/New_York'. Fingerprint будет иметь US locale/timezone, но proxy может быть в Китае → GEO_COHERENCE violation при запуске worker.

---

### BUG-L5: `upload.ts` — `_uploadToTikTok` не проверяет результат загрузки файла (upload confirmation)

**Файл**: `apps/worker/src/handlers/upload.ts` (строки 310–312)

**Суть**: После нажатия POST кнопки, handler просто ждёт 10–20 секунд (`_randomDelay(10000, 20000)`), затем пытается решить captcha. Но **нет проверки** что видео действительно было загружено:

```ts
// Wait for upload completion
await page.waitForTimeout(_randomDelay(10000, 20000));
```

Нет `page.waitForSelector()` или проверки текста "Your video has been uploaded". Это значит, что если загрузка failed (слишком большой файл, формат не поддерживается), job будет отмечен как UPLOADED.

Для YouTube (строки 457–462) хотя бы есть проверка `afterText`:
```ts
const success = /published|опубликовано/i.test(afterText ?? '');
```

Но для TikTok — **ничего**.

---

### BUG-L6: `curl-impersonate-client.ts` — default profile `chrome131` не существует в binary naming

**Файл**: `apps/worker/src/core/tls/curl-impersonate-client.ts` (строка 63)

**Суть**:
```ts
const binary = `curl_${req.impersonate ?? 'chrome131'}`;
```

Бинарник будет `curl_chrome131`. Но curl-impersonate binaries именуются как `curl_chrome116`, `curl_chrome110`, и т.д. Chrome 131 может не существовать в установленной версии curl-impersonate.

**Проверка**: Dockerfile должен устанавливать curl-impersonate с нужной версией. Если в Docker образе нет `curl_chrome131`, все запросы через `impersonatedFetch()` (без explicit profile) будут фейлиться с ENOENT.

---

### BUG-L7: `_lightEngagement` и `_activeEngagement` — YouTube warmup НЕ реализован

**Файл**: `apps/worker/src/handlers/warmup.ts`

**Суть**: Все три фазы warmup (passive, light, active) содержат TikTok-specific selectors:
- `[data-e2e="like-icon"]` — TikTok only
- `[data-e2e="comment-icon"]` — TikTok only
- `[data-e2e="follow-button"]` — TikTok only

Условия `if (data.platform === 'TIKTOK')` перед действиями (like, comment, save, follow) означают, что для **YouTube** эти действия **просто пропускаются**. YouTube warmup сводится к пассивному просмотру на всех фазах.

Это может быть acceptable (YouTube Shorts менее строг к warmup), но warmup handler обещает "progressive curriculum" для всех платформ.

---

### BUG-L8: `session-validator.ts` — YouTube redirect detection ненадёжна

**Файл**: `apps/worker/src/core/auth/session-validator.ts` (строки 73–76)

**Суть**:
```ts
if (resp.body.includes('accounts.google.com/ServiceLogin')) {
  return 'expired';
}
return 'alive';
```

`curl-impersonate` используется с `-s -i --compressed` flags. Если YouTube/Google возвращает HTTP 302 redirect на login page, curl-impersonate может:
1. Следовать redirect (если нет `-L` flag — его нет в коде) → body будет пустым → `includes('ServiceLogin')` = false → return 'alive' (ложный результат).
2. Не следовать redirect → body = пустой → return 'alive' (ложный результат).

В обоих случаях, expired cookies могут быть определены как alive.

**Исправление**: Добавить `-L` flag в curl args для YouTube validation, или проверять HTTP status 302/303.

---

### BUG-L9: `accounts.ts` import — `accountId` не уникален (коллизии при bulk import)

**Файл**: `apps/api/src/routes/accounts.ts` (строка 263)

**Суть**:
```ts
const accountId = crypto.randomUUID().replace(/-/g, '').substring(0, 25);
```

UUID v4 без дефисов = 32 hex символа. `substring(0, 25)` урезает до 25 символов, что снижает entropy с 128 бит до ~100 бит. Вероятность коллизии всё ещё ничтожна, но обрезка UUID является anti-pattern. 

Кроме того, Prisma schema использует `@default(cuid())` для id — `cuid()` генерирует ID формата `cl...(25 chars)`. Использование обрезанного UUID создаёт **два разных формата ID** в одной таблице — часть аккаунтов будут иметь cuid format, а импортированные — truncated UUID format.

---

### BUG-L10: `accounts.ts` — `password` field в Prisma schema (deprecated) ещё используется

**Файл**: `apps/api/prisma/schema.prisma` (строка 64)

**Суть**:
```prisma
password    String?       // deprecated — kept for migration, not used in v3
```

Поле помечено как deprecated, но никогда не очищается. Если при более ранних версиях туда был записан plaintext пароль, он **навсегда** остаётся в DB незашифрованным.

---

## Итоговая таблица

| # | Серьёзность | Баг | Файл | Тип |
|---|---|---|---|---|
| C1 | 🔴 CRITICAL | cookies.ts: stale payload | worker/handlers/cookies.ts | Architecture |
| C2 | 🔴 CRITICAL | edit-profile.ts: stale payload | worker/handlers/edit-profile.ts | Architecture |
| C3 | 🔴 CRITICAL | isShortsCompatible: порог 0.85 | worker/core/video/inspector.ts | Logic |
| C5 | 🔴 CRITICAL | warmup.ts: cookies не в DB | worker/handlers/warmup.ts | Data Loss |
| H1 | 🟠 HIGH | upload.ts: cookies не в DB | worker/handlers/upload.ts | Data Loss |
| H2 | 🟠 HIGH | edit-profile: cookies не в DB | worker/handlers/edit-profile.ts | Data Loss |
| H3 | 🟠 HIGH | cookies.ts: cookies не в DB | worker/handlers/cookies.ts | Data Loss |
| H4 | 🟠 HIGH | warmup: _randomDelay в сравнении | worker/handlers/warmup.ts | Logic |
| H5 | 🟠 HIGH | accounts PATCH: status bypass | api/routes/accounts.ts | Security |
| H7 | 🟠 HIGH | proxy-utils: silent fallback | worker/lib/proxy-utils.ts | Error Handling |
| M1 | 🟡 MEDIUM | Два fingerprint генератора | api + worker | Architecture |
| M3 | 🟡 MEDIUM | Hardcoded dota2 хэштеги | worker/handlers/warmup.ts | Logic |
| M6 | 🟡 MEDIUM | /queue/add не диспатчит jobs | api/routes/workspace.ts | Feature Broken |
| M7 | 🟡 MEDIUM | Warmup skip при downtime | worker/handlers/warmup.ts | Logic |
| L3 | 🟢 LOW | shadowban: no userId scope | worker/handlers/shadowban.ts | Convention |
| L4 | 🟢 LOW | fingerprint: no geo validation | api/lib/fingerprint.ts | Edge Case |
| L5 | 🟢 LOW | TikTok upload: no confirmation | worker/handlers/upload.ts | Reliability |
| L6 | 🟢 LOW | curl default profile mismatch | worker/core/tls/curl-*.ts | Config |
| L7 | 🟢 LOW | YouTube warmup not implemented | worker/handlers/warmup.ts | Feature Gap |
| L8 | 🟢 LOW | YouTube session validation | worker/core/auth/session-*.ts | Reliability |
| L9 | 🟢 LOW | accountId format inconsistency | api/routes/accounts.ts | Convention |
| L10 | 🟢 LOW | Deprecated password field | prisma schema | Security Debt |

---

## Статистика

- **CRITICAL**: 4 бага
- **HIGH**: 5 багов
- **MEDIUM**: 4 бага
- **LOW**: 8 багов
- **Всего**: **21 баг**

> Аудит выполнен 02.06.2026. Файлы не модифицированы — только чтение и анализ.
