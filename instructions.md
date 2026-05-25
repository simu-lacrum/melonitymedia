Данный документ является **Главным источником истины (Source of Truth)**. Проект представляет собой клиент-серверную веб-панель (SPA) для автоматизации залива вертикальных видео (TikTok / YouTube Shorts), прогрева аккаунтов, нагула кук и сбора аналитики.

Стек: **Node.js, TypeScript, Next.js (или React+Vite), TailwindCSS, Prisma, PostgreSQL, Redis, BullMQ, Puppeteer (Stealth), Socket.io**.

ИИ обязан строго следовать каждому пункту этого документа. Додумывание функционала за рамками ТЗ запрещено, однако реализация описанного должна быть максимально глубокой и ориентированной на исключительное удобство пользователя (UX).

---

## 1. Документация и Git Workflow (Kinopracticum Reference)

Проект имитирует работу в крупном Enterprise-репозитории. Разработка ведется чисто: маленькие owner-based коммиты, понятные проверки, разделение на логические слои (Lanes). GIT - приватный репозиторий(https://github.com/simu-lacrum/melonitymedia)

### 1.1. База знаний и структура `/docs`
Проект должен быть самодокументируемым. Документация не сваливается в один файл, а строго разделена. ИИ должен создать и поддерживать структуру markdown-файлов в папке `/docs`. Любой новый разработчик должен понять проект за 5 минут:
*   **`README.md` (в корне):** Главный портал. Содержит секции: "Коротко о проекте", "Быстрый старт" (команды `git clone`, `npm install`, `cp .env.example .env`, `docker-compose up -d`), таблицу "Что внутри" (ссылки на папки) и "Карту документации".
*   **`docs/guides/local-development.md`:** Полная инструкция по локальному запуску. Как настроить переменные окружения, как поднять PostgreSQL и Redis через Docker для разработки, как запустить API и Воркеры.
*   **`docs/guides/repository-map.md`:** "Что где лежит". Таблица с архитектурой (какие папки отвечают за API, где лежат скрипты Puppeteer, где UI компоненты).
*   **`docs/guides/interface-map.md`:** Карта пользовательских и админских экранов (какой URL-роут за что отвечает и его роль).
*   **`docs/architecture/backend-contracts.md`:** Техническое описание работы API, обработка ошибок, структура payload'ов для очередей BullMQ.

### 1.2. Стратегия коммитов и слои (Commit Lanes)
Прямые пуши в `main` запрещены. Работа идет в изолированных ветках `feat/`, `fix/`, `docs/`. Изменения делятся на логические пачки (Lanes):
*   `Backend/API`: Эндпоинты, Prisma схема, миграции.
*   `Workers/Core`: Скрипты автоматизации Puppeteer, обработчики BullMQ.
*   `Admin UI` / `Account UI`: Верстка фронтенда.
*   *Категорически запрещено смешивать изменения бэкенда и верстки интерфейса в одном неструктурированном коммите (если это не E2E фича).*

### 1.3. Deploy Readiness и Безопасность
*   Никогда не коммитить секреты, ключи и файлы `.env`.
*   Все деструктивные действия в UI (удаление аккаунтов, бан юзера) требуют `confirmed: true` (вызов модального окна Confirm Dialog).
*   **No Fake Success (Честный UI):** Интерфейс показывает только реальные состояния бэкенда. Запрещено показывать "Успешно сохранено" или убирать состояние загрузки, если API еще не ответило `200 OK`.
*   Перед деплоем ИИ должен убедиться в прохождении команд: `npm test`, `npm run typecheck`, `npm run build`, `npx prisma validate`.

---

## 2. Дизайн-система и UI/UX (`docs/design.md`)

Вся визуальная часть и правила компоновки элементов будут описаны в отдельном файле **`docs/design.md`** (создается владельцем проекта). ИИ обязан **всегда ссылаться** на него при верстке компонентов (использовать описанные там цвета, отступы, типографику).

**Главные принципы удобства (UX), которые должен реализовать ИИ:**
1.  **Драйверы (Drawers/Sheets) и Модалки:** Громоздкие формы настроек не должны занимать весь экран и заставлять пользователя скроллить. Они должны выезжать сбоку (Right Drawer) поверх основного контента.
2.  **Drag-and-Drop:** Все взаимодействия с локальными файлами (загрузка видео, баз аккаунтов, кук) должны поддерживать перетаскивание мышью в специальные зоны (Dropzones).
3.  **Массовые действия (Bulk Actions):** Если перед пользователем таблица аккаунтов, он должен иметь возможность выделить чекбоксами 50 штук и в 1-2 клика привязать к ним один прокси, установить всем одинаковую аватарку или запустить пролив.
4.  **Empty States:** Если у пользователя нет добавленных аккаунтов или задач, экран должен показывать красивую заглушку с иконкой и акцентной кнопкой "Добавить аккаунты", а не голую пустую таблицу.
5.  **Адаптивность:** Строгий запрет на горизонтальный скролл на 390px (Mobile) и огромных мониторах (3840px). На UHD экранах контент не должен разъезжаться по краям, он ограничивается центральным контейнером (`max-w-screen-2xl`).

---

## 3. Детальная логика проекта и Структура страниц (Interface Map)

Приложение разделено на 3 зоны: Авторизация (`/auth`), Панель пользователя (`/account`), Админка (`/admin`).

### 3.1. Зона авторизации (`/auth`)
*   **UX:** Минималистичная карточка по центру экрана.
*   **Логика:** При входе выдается JWT-токен, который сохраняется в безопасную HttpOnly Cookie. При успешном логине -> редирект на `/account/dashboard`.

### 3.2. Пользовательская зона (`/account`) - Панель Вебмастера

#### ЭКРАН 1: Дашборд Аналитики (`/account/dashboard`)
Стартовая точка. Служит для "взгляда сверху" на всю сетку арбитражника.
*   **Блок 1 (Top Cards):** 4 компактные карточки: "Суммарные просмотры", "Живых аккаунтов", "Прирост подписчиков", "Опубликовано".
*   **Блок 2 (Графики - Recharts):** Крупный интерактивный график "Динамика просмотров" (фильтры 7/30 дней/всё время).
*   **Блок 3 (Live-Статус задач):** Виджет текущих задач BullMQ (Например: "Прогрев (3 потока) - В процессе").

#### ЭКРАН 2: База Аккаунтов и Прокси (`/account/profiles`)
Единый инвентарь пользователя.
*   **Таблица аккаунтов (DataGrid):** Чекбокс, Аватар, Платформа (TT/YT), Никнейм, Статус (Alive/Auth Needed/Banned), Привязанный Прокси, Просмотры.
*   **Импорт Аккаунтов (Drawer):** Drag-and-Drop зона для баз (`log:pass`) и файла Cookies. (1 файл куки применяется на выделенную группу аккаунтов).
*   **Менеджер Прокси и Ручная привязка (ВАЖНО):** 
    *   Пользователь **сам вручную** привязывает конкретный прокси к своему аккаунту (или пачке аккаунтов). Без этой привязки скрипты работают с родного IP сервера.
    *   Система должна быть заточена под **Мобильные прокси** (например, покупаемые на `proxys.io`). Прокси могут быть как без ротации (статичные), так и **с ротацией IP**.
    *   При добавлении прокси в систему, помимо классической строки `ip:port:login:pass`, юзер выбирает тип "С ротацией" или "Без". Если выбрано "С ротацией", появляется опциональное текстовое поле **"Ссылка для смены IP (Rotation Link)"**. Пользователь вставляет туда API-ссылку от провайдера, которая при GET-запросе перезагружает модем.

#### ЭКРАН 3: Загрузчик и Рабочая область (`/account/workspace`)
**Это сердце платформы.** Разделено на 3 блока для удобства.

**Блок 1: Глобальные настройки сессии (Top Section)**
*   **Профили (Пресеты):** Dropdown с сохраненными ранее конфигурациями. Кнопка "Применить" мгновенно заполняет все инпуты. "Сохранить профиль" сохраняет стейт в БД.
*   **Потоки:** Инпут (число), сколько аккаунтов одновременно запускать.
*   **Задержка старта:** Инпуты "От" и "До" (сек), чтобы браузеры стартовали рандомно во времени.

**Блок 2: Очередь контента (Content Queue - Левая часть экрана ~50% ширины)**
*   **Медиатека:** Огромная Drag-and-Drop зона для видео (`.mp4`) и drag-and-drop сортировка порядка.
*   **Динамическая очередь (Киллер-фича):** Если задача УЖЕ запущена, юзер может перетащить сюда новые файлы. API моментально добавит их в очередь Redis, и воркер автоматически их подхватит без остановки скрипта.

**Блок 3: Режимы работы (Вкладки / Tabs - Правая часть экрана ~50% ширины)**
Пользователь выбирает, что должен делать бот:
*   **Вкладка А: Залив видео:** Пулы Названий, Описаний и Тегов (бот берет рандомно). Лимиты видео в сутки, задержка между выкладками.
*   **Вкладка Б: Прогрев:** Хештеги, ползунки вероятности лайка/коммента (0-100%), пул комментов, длительность просмотра (От/До сек). Переключатель "Прогревать ежедневно" (создает Cron задачу).
*   **Вкладка В: Нагул куки:** Ссылки на доноров, время на сайте, кол-во сайтов. Кнопка "Скачать куки" (ZIP архив).
*   **Вкладка Г: Редактирование профиля:** Аватар, Баннер, Био. Галочка "Массовое применение" (ставит одинаковый визуал на все выбранные аккаунты).

**Блок 4: Запуск и Live-Терминал (Bottom Section)**
*   Огромная акцентная кнопка "🚀 ЗАПУСТИТЬ ЗАДАЧУ".
*   **Live Терминал:** Черное окно стилизованное под консоль. Сервер через Socket.io транслирует логи воркеров (`[INFO] Поток 1: Вход успешен...`).

---

### 3.3. Зона Администратора (`/admin`)
Изолированная зона (`role === 'ADMIN'`). Строгий стиль "Operator Panel".
*   **`/admin/runtime`:** Дашборд здоровья сервера: БД PostgreSQL, Redis, число активных воркеров BullMQ, нагрузка CPU/RAM (важно для мониторинга утечек от Chrome+Xvfb).
*   **`/admin/users`:** Таблица вебмастеров. Изменение `max_threads_limit`. Просмотр статистики юзера и логов ошибок (**без доступа** к паролям аккаунтов юзера). Soft-Ban (мгновенно отменяет задачи и выкидывает из сессии).
*   **`/admin/firewall`:** IP Blacklist. Заблокированные IP сохраняются в Redis. Node.js Middleware моментально дает `403 Forbidden` нежелательным клиентам.

---

## 4. Архитектура "Под капотом" и Автоматизация (`workers/`)

API-сервер **никогда** не выполняет автоматизацию в главном потоке. Все задачи уходят в брокер BullMQ. Воркеры слушают очередь и делают работу.

1.  **Среда выполнения (Xvfb):** На сервере Ubuntu нет монитора. `headless: 'new'` детектируется антифродом. В Docker-контейнере воркера поднимается **Xvfb**. Puppeteer стартует с `headless: false`, отрисовывая окна внутри невидимого дисплея.
2.  **Мобильные прокси и Ротация (КРИТИЧНО ВАЖНО):** Если юзер привязал к аккаунту мобильный прокси и указал `Rotation Link` (Ссылку смены IP), воркер **ОБЯЗАН** перед запуском браузера сделать HTTP GET запрос по этой ссылке. После запроса скрипт делает `await delay(12000)` (ждет 12 секунд), чтобы дать провайдеру (например, proxys.io) время физически перезагрузить модем на ферме и выдать новый внешний IP. Только после этого запускается сессия Puppeteer.
3.  **Proxy Challenge:** Chrome не умеет авторизовываться в прокси по логину/паролю. Скрипт "на лету" генерирует ZIP-расширение с `manifest.json` и `background.js` (`chrome.webRequest.onAuthRequired`), вшивает туда креды прокси и отдает в Puppeteer через `--load-extension`.
4.  **Оптимизация аналитики:** Парсинг статистики при каждом логине убивает аккаунты. Сбор метрик выполняется фоново через Cron (BullMQ) **1 раз в сутки ночью**. Парсинг идет через **`cheerio`** (скоростной аналог BeautifulSoup).
5.  **Fail-closed контракты:** При капче скрипт не крашит сервер. Он шлет скриншот и ошибку в WebSocket терминал, помечает Job в BullMQ как `failed` и делает `await browser.close()`.

<details>
<summary>Эталонный код ядра браузера (TypeScript) для ИИ:</summary>

```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';
import { Browser, Page } from 'puppeteer';

puppeteer.use(StealthPlugin());

export class BrowserAutomation {
    private proxyStr: string | null;
    private rotationLink: string | null;
    private headless: boolean | 'new';
    private browser: Browser | null = null;
    private page: Page | null = null;

    constructor(proxyStr: string | null = null, rotationLink: string | null = null, headless: boolean | 'new' = false) {
        // На сервере headless = false, работает внутри Xvfb
        this.proxyStr = proxyStr;
        this.rotationLink = rotationLink;
        this.headless = headless;
    }

    private async _rotateMobileProxyIP() {
        if (!this.rotationLink) return;
        try {
            console.log(`[Proxy] Запрос на ротацию IP по ссылке: ${this.rotationLink}`);
            // Выполняем GET запрос по ссылке провайдера для смены IP
            await fetch(this.rotationLink);
            
            // Ожидание 12 секунд, пока мобильная ферма перезагрузит модем и сменит IP
            console.log(`[Proxy] Ожидание 12 сек для смены IP...`);
            await new Promise(r => setTimeout(r, 12000));
            console.log(`[Proxy] IP успешно изменен.`);
        } catch (e) {
            console.error("[Proxy Error] Ошибка при смене IP:", e);
        }
    }

    private _createProxyExtension(proxyStr: string): string {
        let proxyHost = '', proxyPort = '', proxyUsername = '', proxyPassword = '';
        if (proxyStr.includes('@')) {
            const [auth, ipPort] = proxyStr.split('@');
            [proxyUsername, proxyPassword] = auth.split(':');
            [proxyHost, proxyPort] = ipPort.split(':');
        } else {
            [proxyHost, proxyPort] = proxyStr.split(':');
        }

        const manifestJson = {
            version: "1.0.0", manifest_version: 2, name: "Auth Proxy",
            permissions: ["proxy", "tabs", "unlimitedStorage", "storage", "<all_urls>", "webRequest", "webRequestBlocking"],
            background: { scripts: ["background.js"] }, minimum_chrome_version: "22.0.0"
        };

        const backgroundJs = `
            var config = { mode: "fixed_servers", rules: { singleProxy: { scheme: "http", host: "${proxyHost}", port: parseInt(${proxyPort}) }, bypassList: [] } };
            chrome.proxy.settings.set({value: config, scope: "regular"}, function() {});
            chrome.webRequest.onAuthRequired.addListener(
                function(details) { return { authCredentials: { username: "${proxyUsername}", password: "${proxyPassword}" } }; },
                {urls: ["<all_urls>"]}, ["blocking"]
            );
        `;

        const extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puppeteer_proxy_ext_'));
        fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifestJson, null, 2));
        fs.writeFileSync(path.join(extDir, 'background.js'), backgroundJs);
        return extDir;
    }

    async initDriver(): Promise<{ browser: Browser, page: Page }> {
        // Если прокси мобильный с ротацией - ОБЯЗАТЕЛЬНО вызываем смену IP перед запуском инстанса браузера
        await this._rotateMobileProxyIP();

        const args = [
            '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled', '--window-size=1920,1080', '--start-maximized'
        ];

        if (this.proxyStr) {
            if (this.proxyStr.includes('@')) {
                const extPath = this._createProxyExtension(this.proxyStr);
                args.push(`--disable-extensions-except=${extPath}`);
                args.push(`--load-extension=${extPath}`);
            } else {
                args.push(`--proxy-server=http://${this.proxyStr}`);
            }
        }

        this.browser = await puppeteer.launch({
            headless: this.headless, args: args, ignoreHTTPSErrors: true, defaultViewport: null
        });

        const pages = await this.browser.pages();
        this.page = pages.length > 0 ? pages[0] : await this.browser.newPage();
        return { browser: this.browser, page: this.page };
    }

    async getSoup(url: string): Promise<cheerio.CheerioAPI> {
        if (!this.browser || !this.page) await this.initDriver();
        await this.page!.goto(url, { waitUntil: 'domcontentloaded' });
        const html = await this.page!.content();
        return cheerio.load(html);
    }

    async close(): Promise<void> {
        if (this.browser) await this.browser.close();
    }
}
</details>

## 5. Требования к Деплою (Docker Readiness)

Проект должен быть готов к Production-развертыванию на чистой Ubuntu VPS через docker-compose.yml.

Сервисы в compose: db (PostgreSQL), redis (BullMQ + Кэш), api (Node.js бэкенд), frontend (Next.js/Vite), worker (Контейнер автоматизации Node.js).

КРИТИЧЕСКОЕ ТРЕБОВАНИЕ ДЛЯ worker КОНТЕЙНЕРА:
В Dockerfile воркера ИИ обязан прописать установку стабильного google-chrome-stable и системных библиотек: xvfb, libxi6, libgconf-2-4. В файле entrypoint.sh перед запуском Node.js процесса обязательно должен подниматься виртуальный дисплей:

Bash
#!/bin/bash
# Поднимаем виртуальный дисплей (разрешение 1920x1080)
Xvfb :99 -screen 0 1920x1080x24 -ac &
export DISPLAY=:99

# Стартуем процесс обработки задач BullMQ
npm run start:worker