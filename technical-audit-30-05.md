# MelonityMedia — Технический аудит (30.05.2026)

Аудит выполнен на основе чтения `README.md`, `design.md`, `docs/` и предыдущего `audit-28-05.md`, с последующей проверкой реального кода, запуском typecheck и тестов по всем пакетам, анализом Docker-конфигурации и сверкой заявленной функциональности с фактической реализацией.

## Что удалось проверить инструментально

| Проверка | Результат |
|---|---|
| `npm install` (монорепо) | ОК с `--ignore-scripts` (нативная сборка `bcrypt` падает — недоступен `nodejs.org`, ограничение окружения) |
| `tsc --noEmit` (web) | Чисто, 0 ошибок |
| `tsc --noEmit` (worker) | Чисто, кроме 3 ошибок импорта `@prisma/client` (Prisma client не сгенерирован — `binaries.prisma.sh` заблокирован) |
| `vitest` (web) | 3/3 passed |
| `vitest` (worker) | 54/54 passed |
| `vitest` (api) | **6 тестов падают** (см. H-1) |
| `next build` (web) | Падает на загрузке Google Fonts (ограничение сети); webpack/типизация в порядке |
| `npm audit` | **1 critical, 3 high, 1 moderate** |

Не удалось выполнить из-за сетевых ограничений окружения (не дефекты проекта): `prisma generate/validate`, нативную сборку `bcrypt`, полный `next build`, `docker build`. Эти пункты оценены статическим анализом кода.

---

## Сводка по критичности

| Severity | Кол-во | Суть |
|---|---|---|
| Critical | 1 | Сломан задокументированный production-деплой через Docker |
| High | 5 | Заявленные фичи не реализованы или нерабочие (UI-моки, отсутствующие роуты, мёртвая очередь login, сломанный экспорт cookies) |
| Medium | 9 | Падающие тесты, утечки/незакрытые фиксы прошлого аудита, проблемы безопасности и неработающие настройки |
| Low | 11 | Расхождения документации и кода, косметика, дубликаты |

---

## CRITICAL

### C-1. Docker-деплой не запускается: отсутствуют Dockerfile для api и web

`docker-compose.yml` ссылается на:

```
api:    dockerfile: apps/api/Dockerfile      ← файла НЕТ
web:    dockerfile: apps/web/Dockerfile      ← файла НЕТ
worker: dockerfile: apps/worker/Dockerfile   ← есть
```

Фактически в репозитории есть только `apps/worker/Dockerfile` (и дубликат `apps/worker/docker/Dockerfile`). Команда из README `docker-compose up -d --build` («Полный деплой одной командой») упадёт сразу на сборке `api`. Это блокирует основной задокументированный путь развёртывания.

**Рекомендация:** добавить `apps/api/Dockerfile` и `apps/web/Dockerfile`, либо убрать `build` и указать готовые образы. Свести два worker-Dockerfile к одному.

---

## HIGH

### H-1. Тесты API падают (6 из 8), `npm test` красный

`apps/api/src/routes/__tests__/accounts-fingerprint.test.ts` читает исходник `accounts.ts` как текст и проверяет наличие строк (`viewport`, `chromeMajor`, `colorDepth: 24`, `'MacIntel'`, `'Mesa'`, `Helvetica Neue` и т. д.). Но генератор отпечатков был вынесен в `apps/api/src/lib/fingerprint.ts`, а в `accounts.ts` остался только импорт. В результате тесты падают, хотя сама реализация корректна.

Это противоречит README (раздел Git Workflow → «Pre-deploy checks: tsc, next build, prisma validate» и Changelog про прохождение сборки). Тесты ещё и хрупкие по своей природе — проверяют текст файла, а не поведение функции.

**Рекомендация:** переписать тест на импорт `generateFingerprint`/`generateMobileFingerprint` из `lib/fingerprint.ts` и проверять результат вызова.

### H-2. Фронтенд почти полностью статичен (моки вместо API)

Большинство страниц рабочей зоны не делают ни одного запроса к API и используют захардкоженные данные:

- `account/dashboard/page.tsx` — массивы `data` и `recentActivity` зашиты в коде (нет вызовов `/api/analytics/*`).
- `account/proxies/page.tsx` — константа `PROXIES` (нет CRUD, теста, ротации).
- `account/accounts/page.tsx` — статические данные (нет импорта cookies, bulk-привязки прокси).
- `account/settings/page.tsx` — без API.

Реально к бэкенду подключены только страницы авторизации и `account/workspace` (3 вызова). То есть богатый бэкенд (accounts, proxies, analytics, admin) к интерфейсу не подключён — это прототип UI, а не рабочая панель, как заявлено в README.

### H-3. Нет ни одной admin-страницы, но на них есть ссылки

Каталог `apps/web/src/app/admin` отсутствует. При этом `Sidebar.tsx` ведёт на `/admin/firewall`, а README документирует `/admin/runtime`, `/admin/users`, `/admin/firewall` как экраны. Все эти маршруты вернут 404. Admin-API при этом реализован, но без UI.

### H-4. Очередь `login` реализована, но не запускается ниоткуда

В воркере есть полноценный `loginHandler` (203 строки, резолвит логин/пароль из БД, сохраняет cookies, ставит статус `ALIVE`), очередь `login` зарегистрирована и в `bullmq.ts`, и в `worker/index.ts`. Но:

- в API нет роута, который кладёт задачу в очередь `login`;
- `launchSchema` в `workspace.ts` допускает только `UPLOAD | WARMUP | COOKIES | EDIT_PROFILE` (нет `LOGIN`);
- `queueMap` не содержит `login`.

Аккаунты, импортированные в формате `login:pass`, получают статус `AUTH_NEEDED` и навсегда в нём остаются — авторизовать их через систему невозможно. Заявленная в README фича «авто-создание профилей по формату login:pass» не доведена до конца.

### H-5. Экспорт cookies сломан (фильтр по устаревшему полю)

`GET /api/workspace/cookies/export` выбирает аккаунты по `cookiesPath: { not: null }`. В схеме `cookiesPath` помечен как `// legacy ... (deprecated)` и **никогда не заполняется** v3-импортом (тот пишет в `cookiesEncrypted/cookiesIv/cookiesAuthTag`). В коде воркеров `cookiesPath` — это локальный параметр запуска браузера, а не поле записи аккаунта.

Итог: эндпоинт всегда возвращает `404 «Нет аккаунтов с cookies»`, а в случае срабатывания отдал бы лишь строку пути, а не сами cookies. Фича из README нерабочая.

---

## MEDIUM

### M-1. Обновлённые session-cookies не сохраняются после загрузки

`apps/worker/src/handlers/upload.ts` импортирует `saveCookiesToDiskCache` и тип `BrowserCookie`, но **нигде их не использует**. Блок `finally` только закрывает браузер и удаляет временный файл. Куки, обновлённые в ходе сессии (`tt_webid`, `s_v_web_id` и т. п.), теряются.

Это ровно проблема №3 из `audit-28-05.md`, и она **не устранена** — предложенный там перенос сохранения в `finally` не применён. Следствие: учащённый разлогин аккаунтов и обязательность отдельной очереди `cookies`.

### M-2. Фикс «осиротевших» ffmpeg-процессов косметический

В `uniquifier.ts` создан `AbortController` и передан в `execFileAsync` (`signal: ac.signal`), но `ac.abort()` **не вызывается нигде**. Привязки к отмене BullMQ-задачи нет. От зависшего процесса спасает только `timeout: 300_000`, а при отмене/остановке воркера процесс по-прежнему может осиротеть. Проблема №2 из прошлого аудита закрыта лишь формально.

### M-3. JWT_SECRET с небезопасным дефолтом, без fail-fast

В `auth.ts` и `middleware/auth.ts`: `const JWT_SECRET = process.env.JWT_SECRET || 'change-me'`. Если переменная не задана, используется общеизвестный секрет — токены становятся подделываемыми. Для `MASTER_KEY` fail-fast реализован, а для `JWT_SECRET` — нет.

**Рекомендация:** падать на старте, если `JWT_SECRET` отсутствует/слишком короткий.

### M-4. Параметры threads / delayMin / delayMax из /launch игнорируются

`launchSchema` валидирует `threads`, `delayMin`, `delayMax`, но:

- concurrency воркеров жёстко зашит (`concurrency: 3` в `worker/index.ts`), `threads` на него не влияет;
- задержки между аккаунтами не используются — `dispatchAccountJob` вызывается через `Promise.all`, все задачи ставятся одновременно;
- нет проверки `delayMax >= delayMin`.

Пользователь настраивает значения в UI, но они ни на что не влияют.

### M-5. Файрвол обходится подделкой X-Forwarded-For

`firewallMiddleware` берёт IP из `req.headers['x-forwarded-for'].split(',')[0]` без доверия только известным прокси. Клиент может прислать произвольный XFF и обойти собственную блокировку. Чёрный список по спуфящемуся заголовку малоэффективен.

### M-6. Нет rate-limiting на /auth/login и /register

Защиты от перебора паролей нет; «Firewall» в README — это ручной IP-блок-лист, не автоматический лимитер. Открыта возможность brute-force.

### M-7. /queue/add фактически no-op

Эндпоинт лишь дописывает `videoIds` в `task.config`. Ничего не читает `config.videoIds` и не диспатчит новые задачи (upload-воркер получает один `videoId` из payload, а не из конфига задачи). Плюс нет валидации: при отсутствии `videoIds` — `500` из-за спреда `undefined`.

### M-8. Уязвимости зависимостей (npm audit)

1 critical + 3 high + 1 moderate. Next.js закреплён в уязвимом диапазоне (множество advisories, включая RCE в React flight protocol, SSRF, cache poisoning), плюс `postcss`, `tar`, `bcrypt`→`@mapbox/node-pre-gyp`. Доступен `npm audit fix` (часть — без breaking changes).

### M-9. PATCH /accounts/:id без zod-валидации тела

Обновление идёт по whitelist-полям без схемы. Поле `status` принимает любую строку и уходит в Prisma; при несоответствии enum — `500`. В отличие от `bulk-update`, где статус валидируется enum-ом.

---

## LOW (документация и консистентность)

### L-1. Несоответствие числа очередей
README и шапка `worker/index.ts` говорят «7 BullMQ queues», фактически их 8 (добавлена `login`).

### L-2. Три источника противоречат о дизайне
`design.md` требует **Roboto Flex** + неоновое свечение + glassmorphism и «не вводить вторичные шрифты вроде Inter». README заявляет «Strict Corporate Dark — без градиентов, без неона, без блёсток». А `layout.tsx` фактически использует **JetBrains Mono**. Три взаимоисключающих описания.

### L-3. README не описывает часть переменных окружения
В README нет `CAPSOLVER_API_KEY`, `CAPSOLVER_API_URL`, `EXPECTED_CHROME_MAJOR`, хотя они есть в `.env.example` и используются в коде.

### L-4. Таблица эндпоинтов в README расходится с кодом
- Файрвол: реально `POST /admin/firewall/block` и `DELETE /admin/firewall/unblock`, а не `POST/GET /admin/firewall`.
- `GET /api/workspace/jobs` и `DELETE /api/workspace/jobs/:id` задокументированы, но **не реализованы** (роутов нет) — нет списка задач и отмены.
- Не задокументированы: `POST /admin/users/:id/ban`, `POST /accounts/:id/regenerate-fingerprint`, `POST /proxies/import`.

### L-5. Устаревшие комментарии в коде
- ASCII-схема в `api/src/index.ts` подписывает воркер как «(Puppeteer)» — вопреки правилу «никакого Puppeteer».
- `bullmq.ts`: комментарий «Farm cookies on donor websites» описывает именно тот deprecated-сценарий, от которого README предостерегает.

### L-6. Дубли и заглушки страниц авторизации
Существуют параллельно `login`+`sign-in`, `register`+`sign-up`, `forgot-password`+`reset-password`. Страницы `forgot-password`/`reset-password` не делают вызовов API (нефункциональные заглушки). Interface-map документирует только `login`/`register`.

### L-7. Два worker-Dockerfile и два entrypoint.sh
`apps/worker/{Dockerfile,entrypoint.sh}` и `apps/worker/docker/{Dockerfile,entrypoint.sh}` — риск расхождения, неясно, какой используется.

### L-8. Рассинхрон версий @next/swc-wasm-nodejs
В `apps/web/package.json` — `^16.2.6`, в корневом — `^15.5.18`, при Next `15.x`. `next build` предупреждает «Lockfile missing swc dependencies, patching».

### L-9. Фингерпринт при импорте — всегда desktop и без geo
В `POST /accounts/import` вызывается `generateFingerprint(accountId)` без geo и без mobile-ветки. На момент импорта прокси ещё не привязан, поэтому это терпимо, но `regenerate-fingerprint` это учитывает, а импорт — нет. Там же `masterKey` не проверяется на длину 32 (в отличие от `encryptCookies`).

### L-10. `next/font/google` требует сеть при сборке
`layout.tsx` тянет JetBrains Mono с Google Fonts на этапе build → offline/airgapped-сборка падает. Частично особенность окружения, но стоит локализовать шрифт (`next/font/local`).

### L-11. Гонка при бутстрапе первого ADMIN
`role = userCount === 0 ? 'ADMIN' : 'USER'` — две одновременные регистрации на пустой БД теоретически дадут двух админов. Малозначимо.

---

## Что сделано хорошо

- TypeScript strict; web и worker проходят typecheck (ошибки worker — только из-за несгенерированного Prisma client в этом окружении).
- Тесты воркера (54) и web (3) зелёные; модуль `proxy-pin-rules` покрыт тестами и реализует carrier/country/14-day/LTE-правила аккуратно.
- Tenant isolation: запросы к БД консистентно скоупятся по `userId`.
- Шифрование cookies AES-256-GCM с fail-fast по `MASTER_KEY` на старте воркера; секреты не уходят на фронтенд (вырезаются в ответах).
- `dispatchAccountJob` намеренно резолвит fingerprint/proxy/platform из БД на момент выполнения, избегая устаревших payload-ов; хорошие pre-flight гейты в upload-хендлере (warmup, proxy, rate-limit, валидность cookies).
- Логика shadowban-детектора соответствует README (cron 12ч, гейт 24ч, порог <100 просмотров, 3 подряд).

---

## Приоритетный план действий

1. Добавить `apps/api/Dockerfile` и `apps/web/Dockerfile` (или убрать `build`) — иначе деплой невозможен (C-1).
2. Подключить UI к API: dashboard/proxies/accounts/settings + создать admin-страницы (H-2, H-3).
3. Реализовать диспетчер очереди `login` и тип `LOGIN`, иначе login:pass-аккаунты мертвы (H-4).
4. Починить экспорт cookies (читать `cookiesEncrypted`, а не `cookiesPath`) или удалить фичу (H-5).
5. Реализовать `GET/DELETE /api/workspace/jobs` или убрать из README (L-4).
6. Перенести сохранение cookies в `finally` upload-хендлера (M-1); довести AbortController до реальной отмены (M-2).
7. Fail-fast по `JWT_SECRET`, добавить rate-limiting на auth, не доверять сырому XFF (M-3, M-5, M-6).
8. Починить API-тесты и `npm audit fix` (H-1, M-8).
9. Привести в соответствие документацию: число очередей, дизайн/шрифт, env, таблицу эндпоинтов (L-1…L-5).
