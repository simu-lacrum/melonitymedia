# Антифрод-логика MelonityMedia v3.3 — Техническая спецификация

> Этот документ описывает ВСЮ бизнес-логику системы антифрода, детекции шэдоубана и управления fingerprint'ами. Предназначен для верификации кода другой нейросетью.

---

## 1. Carrier Stability Rule (TikTok 2026)

**Файл:** `apps/api/src/lib/proxy-pin-rules.ts`  
**Точка входа:** функция `validatePinChange()`  
**Вызывается из:** `apps/api/src/routes/accounts.ts` — обработчики `POST /api/accounts/bulk-proxy` и `PATCH /api/accounts/:id`

### 1.1. Контекст проблемы

TikTok с 2025 года коррелирует IP-адрес, carrier (оператора связи) и geo-регион аккаунта в рамках 14-дневного окна. Если за это время:
- Меняется carrier (T-Mobile → Verizon) — аккаунт попадает в shadowban на 14-21 день
- Меняется страна — аккаунт может быть заблокирован навсегда
- Слишком частая ротация IP в рамках одного carrier — сигнал "прокси-ферма"

### 1.2. Модель данных

```prisma
model SocialAccount {
  pinnedProxyId   String?   // FK на Proxy — текущий прокси аккаунта
  proxyPinnedAt   DateTime? // Дата последней привязки
  // ...
}

model Proxy {
  type     ProxyType  // LTE_MOBILE | STATIC_RESIDENTIAL | DATACENTER_DEPRECATED
  carrier  String?    // Оператор: T-Mobile, Verizon, MTS, Beeline...
  country  String?    // ISO 3166-1 alpha-2: US, RU, DE...
  // ...
}
```

### 1.3. Четыре кода нарушений

| Код | Тип | Условие | Последствие |
|-----|-----|---------|-------------|
| `PROXY_NOT_LTE_FOR_TIKTOK` | Hard block | TikTok-аккаунт < 30 дней + прокси НЕ `LTE_MOBILE` | BGP path scoring на свежих аккаунтах |
| `COUNTRY_CHANGE_BLOCKED` | Hard block | Смена страны прокси у аккаунта с историей сессий | Geo-корреляция ломается, нужен полный re-warm |
| `CARRIER_CHANGE_BLOCKED` | Hard block (TikTok only) | Смена carrier (напр. T-Mobile → Verizon) | Сброс 14-дневного окна, shadowban 14-21 день |
| `PIN_WINDOW_ACTIVE` | Soft warn | Любая смена прокси в рамках 14 дней с последнего pin | Частые ротации сами по себе — сигнал |

### 1.4. Алгоритм `validatePinChange()`

```
Вход: account (с pinnedProxyId, proxyPinnedAt, platform, createdAt),
      oldProxy (carrier, country, type),
      newProxy (carrier, country, type)

1. IF account.platform === TIKTOK AND account.age < 30 дней:
   IF newProxy.type !== LTE_MOBILE → return PROXY_NOT_LTE_FOR_TIKTOK

2. IF oldProxy === null OR proxyPinnedAt === null → return null (первая привязка)

3. IF oldProxy.id === newProxy.id → return null (идемпотентность)

4. pinAgeDays = (now - proxyPinnedAt) / 86400000
   daysRemaining = ceil(14 - pinAgeDays)

5. IF oldProxy.country !== newProxy.country → return COUNTRY_CHANGE_BLOCKED

6. IF platform === TIKTOK AND oldProxy.carrier !== newProxy.carrier
   → return CARRIER_CHANGE_BLOCKED

7. IF pinAgeDays < 14 → return PIN_WINDOW_ACTIVE

8. return null (всё ок)
```

### 1.5. Механизм override

- API принимает query-параметр `?force=true`
- Доступен ТОЛЬКО для роли `ADMIN`
- При каждом override создаётся запись в `AuditLog` с кодом нарушения
- Ответ 409 Conflict при блокировке, 200 OK при force-override

---

## 2. Shadowban Detection (24-Hour Post-Publish Gate)

**Файл:** `apps/worker/src/handlers/shadowban-detector.ts`  
**Функция:** `detectShadowbanForAccount(accountId: string)`  
**Расписание:** BullMQ cron каждые 12 часов

### 2.1. Контекст проблемы

TikTok "shadowban" — теневой бан, при котором видео получают 0 охвата, но создатель об этом не знает. Ранняя детекция позволяет:
- Остановить загрузку контента (сохранить видео)
- Начать cooldown-период (7+ дней)
- Предотвратить полный бан аккаунта

**Критическая проблема без 24h gate:** Свежее видео (30 мин назад) с 50 просмотрами — это НОРМАЛЬНО. TikTok рампит дистрибуцию постепенно (часы, не минуты). Без gate каждый свежий залив ложно срабатывал бы как shadowban.

### 2.2. Пороги

| Константа | Значение | Смысл |
|-----------|----------|-------|
| `SHADOWBAN_MIN_VIDEO_AGE_HOURS` | 24 | Минимальный возраст видео для анализа |
| `SHADOWBAN_VIEW_THRESHOLD` | 100 | Порог просмотров — ниже = подозрительно |
| `SHADOWBAN_CONSECUTIVE_VIDEOS` | 3 | Количество подряд идущих видео для срабатывания |
| `SHADOWBAN_LOOKBACK_DAYS` | 14 | Окно анализа (старые видео не репрезентативны) |

### 2.3. Алгоритм

```
1. Загрузить аккаунт из БД
2. IF status !== "ALIVE" → exit (уже помечен или на прогреве)
3. IF warmupCompletedAt === null → exit (ещё на прогреве, нет данных)
4. Вычислить пороги:
   ageGateThreshold = now - 24h
   lookbackThreshold = now - 14d
5. Запрос к video:
   WHERE accountId = X
     AND uploadedAt <= ageGateThreshold   ← КРИТИЧЕСКИ ВАЖНО
     AND uploadedAt >= lookbackThreshold
   ORDER BY uploadedAt DESC
   LIMIT 3
6. IF candidates.length < 3 → exit (недостаточно данных)
7. IF ALL candidates.views < 100:
   → account.status = SHADOWBAN_SUSPECTED
   → task.updateMany: PENDING→CANCELLED для UPLOAD задач
   → Socket.io warn пользователю
   → return { flagged: true, matchedVideos: [...ids] }
8. ELSE → return { flagged: false }
```

### 2.4. Подход в коде

Система использует **исключительно DB-backed подход (v3.1)**:
Обработчик `shadowbanDetectorHandler` вызывает `detectShadowbanForAccount(accountId)`, который анализирует уже сохранённые данные из БД (Prisma).

Преимущества:
- Не требует cookies (не палит сессию)
- Не создаёт никаких запросов к TikTok API (используются исторические данные)
- Работает за ~5ms вместо ~30s
- Live-проверка реальных views вынесена в отдельную независимую очередь `analytics-cron`

> Legacy-путь с `curl-impersonate` был полностью удален.

### 2.5. Восстановление

Статус `SHADOWBAN_SUSPECTED` сбрасывается ТОЛЬКО вручную пользователем:
- Пауза загрузок на 7+ дней
- Органический контент с мобильного устройства
- Ручная смена статуса на `ALIVE` в UI

**Автоматическое восстановление отсутствует** — это сознательное решение, т.к. ложное "восстановление" приведёт к повторному shadowban.

### 2.6. Status Transition Guard (v3.2)

**Файл:** `apps/api/src/routes/accounts.ts` — PATCH /:id

Для предотвращения обхода shadowban detection, PATCH account status теперь имеет guard:
- `BANNED` → `ALIVE`: запрещено без `?force=true` и роли ADMIN
- `SHADOWBAN_SUSPECTED` → `ALIVE`: запрещено без `?force=true` и роли ADMIN
- Любые другие переходы: разрешены (например, WARMING_UP → ALIVE)

Это закрывает вектор атаки, где пользователь мог вручную снять shadowban flag через API.

---

## 3. Fingerprint Consistency (7 правил валидации)

**Файл:** `apps/worker/src/core/browser/fingerprint-manager.ts`  
**Валидатор:** `validateFingerprintConsistency(fp: AccountFingerprint)`  
**Генератор:** `generateFingerprintForAccount(accountId, geo)`  
**Вызывается из:** `patchright-launcher.ts` (при каждом запуске браузера)

### 3.1. Контекст проблемы

Антифрод-системы (Cloudflare, DataDome, TikTok BotManager) детектируют ботов по **внутренней несогласованности fingerprint** за 1 запрос:
- Windows UA + MacIntel platform = мгновенный бан
- Viewport шире экрана = физически невозможно
- Chrome 100 в UA при установленном Chrome 149 = top-tier сигнал

### 3.2. Интерфейс AccountFingerprint

```typescript
interface AccountFingerprint {
  userAgent: string;                              // Chrome UA с версией из системы
  platform: "Win32" | "MacIntel" | "Linux x86_64"; // navigator.platform
  screen: { width: number; height: number; colorDepth: 24 };
  viewport: { width: number; height: number };     // Меньше screen на 80-119px
  devicePixelRatio: number;                        // 2 для Mac, 1 для Win/Linux
  locale: string;          // BCP 47: "en-US", "ru-RU"
  timezone: string;        // IANA: "America/Chicago"
  hardwareConcurrency: 4 | 6 | 8 | 12 | 16;       // Реалистичные значения
  deviceMemory: 4 | 8;     // Chrome ограничивает видимое значение 8
  maxTouchPoints: 0 | 1 | 5;                      // 0 для desktop
  webgl: { vendor: string; renderer: string };     // GPU identifier
  canvas: { seed: string }; // 16-char hex для детерминированного шума
  fonts: string[];           // 6-8 шрифтов, зависящих от ОС
  chromeMajor: number;       // Обязан совпадать с установленным Chrome
}
```

### 3.3. Семь правил валидации

| # | Правило | Что проверяет | Пример ошибки |
|---|---------|---------------|---------------|
| 1 | **OS coherence** | UA OS token = platform | `Windows NT 10.0` + `MacIntel` = 🚫 |
| 2 | **GPU coherence** | webgl.renderer соответствует ОС | Win→ANGLE, Mac→Apple, Linux→Mesa |
| 3 | **Display geometry** | screen ≥ viewport + 80px | viewport.height > screen.height - 80 = 🚫 |
| 4 | **Geo coherence** | locale country ↔ timezone region | `en-US` + `Europe/Moscow` = 🚫 |
| 5 | **Hardware realism** | CPU/RAM в реальных пределах | hardwareConcurrency: 32 = 🚫 |
| 6 | **Chrome version** | UA Chrome major = chromeMajor | UA:Chrome/100 + system:148 = 🚫 |
| 7 | **Touch coherence** | Desktop UA → maxTouchPoints = 0 | Desktop + touch:5 = 🚫 |

### 3.4. Детерминизм генерации

**КРИТИЧЕСКИ ВАЖНО:** Fingerprint генерируется ОДИН раз и НИКОГДА не меняется.

Механизм:
1. `seedHex = SHA-256(accountId)` — 64 символа hex
2. Каждый параметр выбирается из seed:
   - `seed(0) % 100` → выбор ОС (72% Win, 20% Mac, 8% Linux)
   - `seed(1) % pool.length` → разрешение экрана
   - `seed(2) % 40 + 80` → высота taskbar/chrome
   - И т.д.
3. Один accountId → одинаковый fingerprint навсегда
4. Валидация запускается после генерации (defence in depth)

### 3.5. Chrome Version Pinning и Upgrade Strategy

Функция `getSystemChromeMajor()` определяет версию установленного Chrome:
1. `google-chrome --version` (Linux)
2. `reg query HKLM\SOFTWARE\Google\Chrome\BLBeacon /v version` (Windows)
3. Переменная окружения `EXPECTED_CHROME_MAJOR` (Docker)
4. Fallback: 149 (с предупреждением)

Результат кэшируется на весь процесс. UA Chrome major ОБЯЗАН совпадать с реальной версией, иначе TLS fingerprint (JA3/JA4) не совпадёт с заявленным UA.

#### Chrome Upgrade — что происходит при обновлении Docker-образа

**Проблема:** Если worker обновили (Chrome 149 → 150), а fingerprint в БД старый (`chromeMajor=149`), валидация при загрузке обнаружит несоответствие.

**Решение (двухуровневая валидация):**

| Контекст | Поведение |
|----------|----------|
| **Генерация** (новый аккаунт) | `throw FingerprintInconsistencyError` — hard stop |
| **Загрузка из БД** (существующий аккаунт) | **Soft warn**: лог + флаг `fingerprintStale: true` в БД, продолжаем работу |

Это предотвращает блокировку всей продакшен-сетки при обновлении Docker-образа.

UI показывает badge "⚙️ Fingerprint stale" на затронутых аккаунтах с рекомендацией:
- Для аккаунтов без публикаций (`warmupCompletedAt === null`): кнопка "Перегенерировать"
- Для активных аккаунтов: tooltip "Не меняйте fingerprint — TikTok потеряет корреляцию"

### 3.6. Применение через CDP

Функция `applyFingerprint(page, fp)` применяет fingerprint к Patchright-странице:

```
1. CDP: Emulation.setUserAgentOverride → UA, platform, accept-language
2. CDP: Emulation.setTimezoneOverride → timezone
3. CDP: Emulation.setLocaleOverride → locale
4. CDP: Emulation.setDeviceMetricsOverride → viewport, screen, DPR
5. page.addInitScript → Canvas noise, WebGL vendor/renderer, hardwareConcurrency,
                        deviceMemory, maxTouchPoints, screen dimensions
```

Canvas noise — детерминированный (на основе canvas.seed), обеспечивает уникальный canvas fingerprint без рандомизации между сессиями.

### 3.7. Auto Device Class (автоматический выбор mobile/desktop, v3.3)

**Контекст:** TikTok/YouTube коррелируют тип устройства с типом IP-адреса. Mobile IP (LTE/4G) + desktop UA — подозрительно. Residential/datacenter IP + mobile UA — ещё подозрительнее.

**Механизм:**

| Тип прокси | Device Class | Пример |
|-------------|-------------|--------|
| `LTE_MOBILE` | `mobile` | Mobile UA, touch=5, small screen, DPR=2-3 |
| `STATIC_RESIDENTIAL` | `desktop` | Desktop UA, touch=0, large screen, DPR=1-2 |
| Нет прокси | `desktop` | Default |

**Реализация:**
- При импорте аккаунта (`POST /accounts/import`) geo прокси передаётся в `generateFingerprintForAccount(accountId, geo)`
- `geo.proxyType` определяет device class автоматически
- Результат сохраняется в fingerprint навсегда (не меняется)

---

## 4. Cookie Encryption & Persistence (AES-256-GCM)

**Файл:** `apps/worker/src/core/auth/cookie-store.ts`  
**Ключ:** переменная окружения `MASTER_KEY` (32 bytes base64)

### 4.1. Процесс

```
Шифрование:
1. Cookies → JSON string
2. Генерация IV (12 bytes random)
3. AES-256-GCM encrypt с MASTER_KEY
4. Сохранение: { cookiesEncrypted, cookiesIv, cookiesAuthTag }

Дешифрование:
1. Загрузка из БД: { cookiesEncrypted, cookiesIv, cookiesAuthTag }
2. AES-256-GCM decrypt с MASTER_KEY
3. JSON parse → массив cookies
```

### 4.2. Centralized Persistence (v3.2)

**Функция:** `persistCookies(accountId, cookies, cookiesDir?)`

Все handlers (login, upload, warmup, cookies, edit-profile) используют единую функцию для сохранения cookies:

```
persistCookies(accountId, cookies):
  1. JSON serialize cookies
  2. Encrypt: AES-256-GCM
  3. Promise.all([
       saveCookiesToDiskCache(accountId, cookies),  // Fast path
       prisma.socialAccount.update({                 // Source of truth
         cookiesEncrypted: new Uint8Array(encrypted),
         cookiesIv: new Uint8Array(iv),
         cookiesAuthTag: new Uint8Array(authTag),
         cookiesUpdatedAt: new Date(),
       })
     ])
```

**Ранее** handlers сохраняли cookies только на диск (`saveCookiesToDiskCache`), что приводило к потере cookies при перезапуске контейнера.

### 4.3. Безопасность

- `cookiesEncrypted`, `cookiesIv`, `cookiesAuthTag` **НИКОГДА** не отправляются на фронтенд
- Вместо них API отдаёт `hasCookies: boolean`
- При старте worker'а проверяется MASTER_KEY:
  - Пустой → `process.exit(1)` с понятной ошибкой
  - < 32 байт после base64-декодирования → `process.exit(1)`
  - Нет fallback'а на дефолтный ключ

### 4.4. Ротация ключа

Скрипт `scripts/rotate-master-key.mjs`:
1. Считывает все записи с encrypted cookies
2. Расшифровывает старым ключом
3. Зашифровывает новым ключом
4. Обновляет в БД в транзакции

---

## 5. Proxy Pin Model

### 5.1. Поля в схеме (Prisma)

```prisma
model SocialAccount {
  pinnedProxyId       String?   @map("pinnedProxyId")
  proxyPinnedAt       DateTime?
  pinnedProxy         Proxy?    @relation(fields: [pinnedProxyId], references: [id])
}
```

Ранее поле называлось `proxyId`. Переименовано в `pinnedProxyId` для семантической точности:
- `proxyId` подразумевает "текущий прокси" (может часто меняться)
- `pinnedProxyId` подразумевает "закреплённый прокси" (14-day contract)

Миграция: `ALTER TABLE "SocialAccount" RENAME COLUMN "proxyId" TO "pinnedProxyId"`

---

## 6. Warmup Curriculum (10-Day)

**Файл:** `apps/worker/src/handlers/warmup.ts`

| Дни | Фаза | Действия |
|-----|-------|----------|
| 1-3 | Passive | Scroll FYP, без взаимодействий |
| 4-6 | Light | Лайки, 1 комментарий |
| 7-10 | Active | Лайки, комментарии, сохранения, подписки |

Гард:
- Аккаунт с `warmupCompletedAt === null` НЕ допускается в очередь `upload`
- Статус `WARMING_UP` → `ALIVE` автоматически при `warmupDay >= 10`

### 6.1. Sequential Day Tracking (v3.2)

**Поле:** `SocialAccount.lastWarmupDay` (Int, default 0)

Решает проблему пропуска дней при offline-сервере:
- Ранее `warmupDay` вычислялся как `Math.min(ageDays, totalDays)`, что пропускало дни.
- Теперь каждый вызов warmup handler делает `lastWarmupDay + 1` → гарантирует прохождение всех фаз.
- Если сервер был offline 5 дней, аккаунт продолжит с того же дня, а не перескочит.

### 6.2. Self-Rescheduling (Автопродолжение, v3.3)

**Механизм:** После завершения дня N (когда N < totalDays), warmup handler автоматически ставит в очередь BullMQ задачу на следующий день с рандомизированной задержкой 20-28 часов.

```
Алгоритм:
1. Handler завершает день N
2. IF N >= totalDays:
   - status → ALIVE
   - warmupCompletedAt → now()
   - Прогрев завершён
3. ELSE:
   - Вычисляется задержка: 20h + random(0-8h) = 20-28 часов
   - BullMQ.add('warmup', { accountId, warmupDays }, { delay })
   - Лог: "Следующий день запланирован через Xh Ym"
```

**Почему 20-28ч:** Реальный пользователь не заходит в TikTok ровно каждые 24 часа. Рандомизация предотвращает детекцию паттерна "точно раз в сутки".

### 6.3. Human-Like Search (v3.3)

Warmup v4 набирает запросы в строку поиска вместо перехода по прямым URL (например `tiktok.com/tag/gaming`). Это имитирует поведение реального пользователя, который ищет контент по интересам.

### 6.4. Хэштеги

Warmup использует **только** пользовательские хэштеги из `data.hashtags`. Hardcoded хэштеги удалены (ранее были dota2-специфичные), чтобы warmup формировал правильную рекомендательную модель для ниши аккаунта.

> **Важно (v3.3):** Хэштеги из workspace UI теперь передаются в top-level payload (`data.hashtags`), а не внутри `config`. `buildExtra()` в `workspace.ts` флэттенит их при сборке payload.

---

## 7. Card Component (UI Constraint)

**Файл:** `apps/web/src/components/ui/Card.tsx`  
**Варианты:** `surface | elevated | header`

| Вариант | `backdrop-filter` | `background` | Где используется |
|---------|-------------------|--------------|------------------|
| `surface` | ❌ нет | `--color-surface-dark` | Все обычные карточки |
| `elevated` | ❌ нет | `--color-surface-elevated` | Hover-состояния, приподнятые панели |
| `header` | ✅ `blur(12px)` | `rgba(28,32,38,0.72)` | **ТОЛЬКО** глобальный Header |

Glassmorphism (`backdrop-filter`) запрещён вне Header — это сознательное ограничение дизайн-системы.

---

## 8. Тесты (Vitest)

### 8.1. proxy-pin-rules.test.ts (9 тестов)

| Тест | Ожидание |
|------|----------|
| Нет предыдущего pin | null (разрешено) |
| Тот же прокси | null (идемпотентность) |
| Смена carrier (TikTok) | CARRIER_CHANGE_BLOCKED |
| Смена страны | COUNTRY_CHANGE_BLOCKED (приоритет) |
| Тот же carrier в окне 14д | PIN_WINDOW_ACTIVE |
| Тот же carrier после 14д | null (разрешено) |
| Datacenter для молодого TikTok | PROXY_NOT_LTE_FOR_TIKTOK |
| Residential для старого TikTok | null (разрешено) |
| YouTube + смена carrier | PIN_WINDOW_ACTIVE (не CARRIER, т.к. YouTube) |

### 8.2. shadowban-detector.test.ts (5 тестов)

| Тест | Ожидание |
|------|----------|
| Аккаунт на прогреве | flagged: false, video не запрашивается |
| < 3 старых видео | flagged: false |
| Свежие видео (24h gate) | flagged: false (Prisma filter исключает) |
| 3+ старых видео < 100 views | flagged: true, статус SHADOWBAN_SUSPECTED |
| Одно видео ≥ 100 views | flagged: false |

### 8.3. fingerprint-manager.test.ts (10 тестов)

| Тест | Ожидание |
|------|----------|
| Сгенерированный FP валиден | Не бросает исключение |
| Windows UA + MacIntel | FingerprintInconsistencyError |
| Viewport > screen | Ошибка viewport.width |
| Viewport без chrome space | Ошибка taskbar |
| Locale/timezone mismatch | Ошибка locale |
| deviceMemory: 32 | Ошибка deviceMemory |
| Chrome major mismatch | Ошибка Chrome major |
| Desktop + touch:5 | Ошибка maxTouchPoints |
| Детерминизм (один ID) | a === b |
| Уникальность (разные ID) | a.canvas.seed !== b.canvas.seed |

### 8.4. Card.test.tsx (3 теста)

| Тест | Ожидание |
|------|----------|
| surface вариант | Нет backdrop-filter |
| header вариант | Есть backdrop-filter: blur(12px) |
| className передаётся | Пользовательские классы сохраняются |

---

## 9. YouTube Studio Anti-Fraud (v3.3)

**Файл:** `apps/worker/src/handlers/edit-profile.ts`

### 9.1. Session Warmup

Перед навигацией в YouTube Studio worker сначала заходит на `youtube.com` и выполняет лёгкий скролл страницы (300-500px), что создаёт natural browsing session перед переходом в Studio.

### 9.2. `waitUntil: 'load'` вместо `networkidle`

YouTube Studio генерирует бесконечные background XHR-запросы, поэтому `networkidle` никогда не срабатывает. Все Google Account и YouTube pages используют `waitUntil: 'load'`.

### 9.3. Human-Like Delays

Между каждым действием в Studio (click → wait → select → wait → type) добавляются задержки 500-2000ms. Время ожидания рендера Studio: 8-12 секунд.

### 9.4. Error Recovery

| Ситуация | Действие |
|---------|----------|
| Страница "Произошла ошибка" | Retry: перезагрузка youtube.com → повторный переход в Studio |
| Welcome modal / Cookie consent | Автоматическое закрытие перед навигацией |
| Новый канал без sidebar | Прямой переход по URL `/editing/basic_info` |

### 9.5. Contenteditable селекторы

YouTube Studio использует `contenteditable` поля (не стандартные `<input>`). Очистка поля: `Control+A` → `Delete`. Ввод текста: `humanType()` через typing emulator.

Селекторы по приоритету:
1. `#textbox[contenteditable]` (основной)
2. `[contenteditable="plaintext-only"]` (fallback)
3. `#description-container [contenteditable]` (описание)

---

## 10. TikTok 2FA / Login Anti-Fraud (v3.3)

**Файл:** `apps/worker/src/handlers/login.ts`

### 10.1. Rate-Limit Detection

При обнаружении страницы rate-limit (по ключевым словам в тексте: "too many attempts", "try again later" и т.д.) handler:
- Не считает это ошибкой пароля
- Не ложно детектирует 2FA
- Возвращает ошибку с понятным текстом и сохраняет в `lastError`

### 10.2. Email Verification как 2FA

TikTok иногда просит подтвердить email при логине. Ранее это ложно считалось ошибкой пароля. Теперь обнаруживается как 2FA и отправляет запрос кода пользователю.

### 10.3. Ghost-Cursor Patchright Shim

`ghost-cursor` ожидает Puppeteer API, но worker использует Patchright (fork Playwright). Добавлены shim-методы:
- `page.browser()` → возвращает browser instance
- `page._client` → shim CDP session
- `page.target()` → stub с `createCDPSession`

