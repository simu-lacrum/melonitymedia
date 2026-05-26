# ТЗ: MelonityMedia — Antidetect-Refactor v2 (2026)

**Цель документа:** дать нейросети (Codex/Claude/Cursor) рабочую инструкцию по переделке текущего стека (Node.js + Selenium с `undetected-chromedriver.js` + Puppeteer-Stealth) на **реально работающий в 2026 году** антидетект-стек для TikTok и YouTube Shorts.

Этот документ — **дополнение** к существующему `instructions.md`. Он не заменяет SaaS-архитектуру (BullMQ, Prisma, Next.js, Socket.io), а заменяет **только слой автоматизации браузера** (`apps/worker/src/core/browser-automation.ts`) и связанные с ним протоколы.

---

## 0. Что НЕ работает в 2026 (запрещено использовать)

ИИ обязан **удалить из проекта** следующие зависимости и подходы:

| Что | Почему нельзя |
|---|---|
| `puppeteer-extra-plugin-stealth` | Публичен с 2019, его сигнатура давно в детекторах Akamai/Datadome/TikTok BotManager. Любой stealth-плагин = автоматический shadowban на TikTok через 24–72ч. |
| `undetected-chromedriver` (JS-порт) | Патчит ChromeDriver, но не TLS-fingerprint и не CDP-handshake. Детектится по `Runtime.enable` + `Target.setAutoAttach` последовательности на старте. Issue #2194 — сломан с Chrome 136+. |
| `selenium-webdriver` | Самая палевная схема — `cdc_*` строки в CDP + ChromeDriver-specific JS API. |
| `puppeteer` + Stealth для TikTok upload | Akamai BotManager v3 на TikTok видит CDP-handshake Playwright/Puppeteer на уровне протокола до того как JS успеет выполниться. |
| Загрузка видео через `tiktok.com/upload` десктоп без warmup | На новых аккаунтах shadowban 80%+ за первые 24 часа. |
| Импорт `log:pass` без cookies | TikTok принудительно включает 2FA + SMS challenge для login через прокси. Без cookies/session-импорта аккаунты умирают на логине. |
| `headless: 'new'` / `headless: true` для TikTok | Headless detection через Pointer Events API + `navigator.webdriver` через C++ слой (не JS). |
| `cheerio`-парсинг TikTok статистики | TikTok закрыл публичный HTML с 2024. Метрики приходят через GraphQL с подписанным `X-Bogus` / `_signature`. |
| "Нагул кук на сайтах-донорах" (BBC, Reddit и т.п.) | Миф 2020 года из Facebook-Ads схем. TikTok смотрит только свои cookies. Бесполезно. |
| `--proxy-server` + ZIP-расширение для auth | Прокси-расширения детектятся через `chrome.runtime` + установленные extensions в CDP probing. |

---

## 1. Что РАБОТАЕТ в 2026 (обязательно к использованию)

### 1.1. Базовый принцип: правильный слой для каждой задачи

| Задача | Слой автоматизации |
|---|---|
| TikTok upload (web) | **Patchright** + системный Chrome + cookie-only авторизация |
| TikTok account warming | **Реальные мобильные устройства** или **Kameleo** mobile fingerprint |
| TikTok scraping (статистика) | **curl_cffi** (Python) или **wreq**-аналог (Node) с `impersonate=chrome_124` |
| YouTube Shorts upload | **Patchright** + Google account с warmup >=7 дней |
| Прогрев / behaviour | **nodriver** (Python) — без Playwright shim вообще |

**Базовая рекомендация для Melonity:** переходим с Selenium+UC на **Patchright (drop-in Playwright fork) + системный Chrome 148+ + cookie-based авторизация + LTE mobile прокси с привязкой к одному оператору на 14+ дней**.

### 1.2. Технологический стек после миграции

```
apps/worker/
├── src/
│   ├── core/
│   │   ├── browser/
│   │   │   ├── patchright-launcher.ts      # Patchright (channel=chrome)
│   │   │   ├── nodriver-bridge.ts          # Опц. Python subprocess для high-stealth
│   │   │   └── fingerprint-manager.ts      # Per-account fingerprint cache
│   │   ├── tls/
│   │   │   └── curl-impersonate-client.ts  # curl_cffi через child_process
│   │   ├── auth/
│   │   │   ├── cookie-store.ts             # AES-256 encrypted cookie jar per account
│   │   │   └── session-validator.ts        # Pre-flight check на старте задачи
│   │   ├── humanity/
│   │   │   ├── biomouse.ts                 # Pre-recorded human gestures
│   │   │   └── typing-emulator.ts          # Variable keystroke delays + typos
│   │   └── proxy/
│   │       ├── lte-rotation.ts             # API смены IP с stickiness
│   │       └── carrier-validator.ts        # BGP path check
```

---

## 2. Стек миграции — что устанавливать

### 2.1. Замена `undetected-chromedriver.js`

**Установить:**

```bash
# Frontline browser layer
npm install patchright          # Node.js drop-in Playwright fork с CDP-bypass

# Behavior simulation
npm install ghost-cursor        # Bezier-curve human mouse movement
npm install human-typer         # Variable keystroke delays

# TLS impersonation для scraping (через Python subprocess или curl-impersonate binary)
# Скачиваем готовые curl-impersonate бинарники с https://github.com/lwthiker/curl-impersonate/releases
```

**Альтернативно** (если нужен максимальный уровень — для warmup-операций на старых аккаунтах):

```bash
# Python subprocess из Node worker
pip install nodriver            # Без Playwright shim вообще, CDP напрямую
pip install curl_cffi           # TLS-fingerprint impersonation
```

### 2.2. Системный Chrome (обязательно)

Patchright требует **Chrome 148+** установленный в системе (не bundled Chromium). В `apps/worker/Dockerfile`:

```dockerfile
# Установка стабильного Google Chrome (не Chromium!)
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - && \
    echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google.list && \
    apt-get update && apt-get install -y google-chrome-stable

# Xvfb для виртуального дисплея (Patchright всё равно требует non-headless для TikTok)
RUN apt-get install -y xvfb libxi6 libgconf-2-4 fonts-liberation
```

### 2.3. Patchright launcher (замена `BrowserAutomation`)

`apps/worker/src/core/browser/patchright-launcher.ts`:

```typescript
import { chromium } from 'patchright';
import type { Browser, BrowserContext, Page } from 'patchright';

export interface LaunchOptions {
  accountId: string;
  proxyUrl: string;              // http://user:pass@host:port
  cookiesPath: string;           // /data/cookies/<accountId>.json
  userAgent: string;             // Из fingerprint cache, ПОСТОЯННЫЙ per account
  viewport: { width: number; height: number };
  timezoneId: string;            // Должен совпадать с гео прокси
  locale: string;                // Совпадает с гео прокси
}

export async function launchStealthContext(opts: LaunchOptions): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
}> {
  const browser = await chromium.launch({
    channel: 'chrome',           // КРИТИЧНО: используем системный Chrome, не bundled Chromium
    headless: false,             // КРИТИЧНО: TikTok детектит headless даже patched
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-default-browser-check',
      '--no-first-run',
      '--password-store=basic',
      '--use-mock-keychain',
      `--user-agent=${opts.userAgent}`,
    ],
    proxy: {
      server: opts.proxyUrl,     // Patchright поддерживает auth-прокси БЕЗ ZIP-расширения
    },
  });

  const context = await browser.newContext({
    viewport: opts.viewport,
    locale: opts.locale,
    timezoneId: opts.timezoneId,
    userAgent: opts.userAgent,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    geolocation: undefined,      // Не запрашиваем, TikTok этого не любит
  });

  // Загружаем cookies ЕДИНСТВЕННЫМ способом авторизации
  // Никаких log:pass на форму логина — это автоматический бан
  const cookies = await loadCookiesFromEncryptedStore(opts.accountId, opts.cookiesPath);
  await context.addCookies(cookies);

  const page = await context.newPage();
  return { browser, context, page };
}
```

### 2.4. Запреты на уровне кода

ИИ **обязан** реализовать линтер-правило / pre-commit hook, который блокирует следующие импорты в `apps/worker/`:

```yaml
# .eslintrc.json — добавить rule no-restricted-imports
"rules": {
  "no-restricted-imports": ["error", {
    "patterns": [
      "puppeteer",
      "puppeteer-extra",
      "puppeteer-extra-plugin-stealth",
      "selenium-webdriver",
      "undetected-chromedriver*",
      "playwright"
    ]
  }]
}
```

---

## 3. Авторизация — только cookies, никогда log:pass

### 3.1. Cookie-first auth flow

В существующем ТЗ юзер загружает `log:pass` файл и cookies опционально, однако нуно сделать так, чтобы юзеру было понятно - куки важны и при возможности их стоит загрузить

UI-изменения в `/account/profiles`:

1. **Импорт аккаунтов через cookies (Drawer):**
   - Drag-and-Drop зона принимает либо:
     - `cookies.txt` (Netscape format) экспортированный из EditThisCookie/Cookie-Editor
     - `cookies.json` (Playwright/Puppeteer format)
     - ZIP с несколькими `<account>.cookies.json`
   - Парсер автоматически детектит платформу по `domain` поля
   - Поля `log:pass` — опциональные, только для случаев когда cookies протухли

2. **Storage:**
   - Cookies шифруются AES-256-GCM с ключом из `MASTER_KEY` env-переменной
   - Хранятся в БД таблица `AccountCookies` (зашифрованный blob) + кэш на диске worker-контейнера в `/data/cookies/<accountId>.enc.json`
   - **Никогда не логируем содержимое cookies** — даже в DEBUG режиме

3. **Pre-flight validation перед каждой задачей:**
   ```typescript
   async function validateCookies(accountId: string): Promise<'alive' | 'expired' | 'banned'> {
     // Делаем lightweight HTTP GET через curl-impersonate (не Patchright!)
     // На tiktok.com/api/user/detail/?secUid=<self> с подгрузкой cookies
     // Если ответ 200 + есть user data — alive
     // Если 401/403 — expired (требуется реавторизация)
     // Если редирект на /captcha или 403 с user_banned — banned
   }
   ```

### 3.2. Изменение Prisma schema

```prisma
model Account {
  id              String   @id @default(cuid())
  userId          String
  platform        Platform // TIKTOK | YOUTUBE_SHORTS
  nickname        String?
  
  // УДАЛЯЕМ: login, password — больше не храним
  // ДОБАВЛЯЕМ:
  cookiesEncrypted Bytes?  // AES-256-GCM encrypted JSON
  cookiesUpdatedAt DateTime?
  cookiesIv        Bytes?
  cookiesAuthTag   Bytes?
  
  // Per-account stable fingerprint (генерится один раз, никогда не меняется)
  fingerprint     Json     // { userAgent, viewport, timezone, locale, screen, webgl, canvas }
  
  // Proxy stickiness — один аккаунт = один carrier + DMA на 14+ дней
  pinnedProxyId   String?
  proxyPinnedAt   DateTime?
  
  status          AccountStatus
  
  // Warmup tracking
  warmupStartedAt DateTime?
  warmupCompletedAt DateTime?  // null = ещё в warmup, не разрешены коммерческие заливы
}

enum AccountStatus {
  ALIVE
  EXPIRED_COOKIES
  BANNED
  SHADOWBAN_SUSPECTED
  WARMING_UP
}
```

---

## 4. Per-account fingerprint stability (КРИТИЧНО)

Главное правило 2026: **fingerprint аккаунта НИКОГДА не меняется**. Один аккаунт = одна машина в глазах TikTok.

### 4.1. Fingerprint generator

При создании аккаунта в системе **один раз** генерируем и сохраняем:

```typescript
// apps/worker/src/core/browser/fingerprint-manager.ts
import { generateFingerprint } from 'fingerprint-generator';  // browserforge

export interface AccountFingerprint {
  userAgent: string;
  viewport: { width: number; height: number };
  screen: { width: number; height: number; colorDepth: number };
  timezone: string;     // напр. "America/Chicago" — должен совпадать с гео прокси
  locale: string;       // "en-US"
  platform: string;     // "Win32" | "MacIntel"
  webglVendor: string;
  webglRenderer: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  canvasSeed: number;   // Canvas noise seed — фиксированный per account
}
```

### 4.2. Application через CDP

```typescript
async function applyFingerprint(page: Page, fp: AccountFingerprint) {
  const cdp = await page.context().newCDPSession(page);
  
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: fp.userAgent,
    platform: fp.platform,
    acceptLanguage: fp.locale,
  });
  
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: fp.timezone });
  await cdp.send('Emulation.setLocaleOverride', { locale: fp.locale });
  
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: fp.viewport.width,
    height: fp.viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: fp.screen.width,
    screenHeight: fp.screen.height,
  });
  
  // Canvas / WebGL spoofing через addInitScript
  await page.addInitScript(({ canvasSeed, webglVendor, webglRenderer }) => {
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(...args) {
      const ctx = origGetContext.apply(this, args);
      if (args[0] === '2d') {
        const origGetImageData = ctx.getImageData;
        ctx.getImageData = function(...gArgs) {
          const data = origGetImageData.apply(this, gArgs);
          let seed = canvasSeed;
          for (let i = 0; i < data.data.length; i += 4) {
            seed = (seed * 1664525 + 1013904223) >>> 0;
            data.data[i] = (data.data[i] + (seed & 1)) & 0xff;
          }
          return data;
        };
      }
      return ctx;
    };
    
    const origGetParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(param) {
      if (param === 37445) return webglVendor;
      if (param === 37446) return webglRenderer;
      return origGetParameter.call(this, param);
    };
  }, { canvasSeed: fp.canvasSeed, webglVendor: fp.webglVendor, webglRenderer: fp.webglRenderer });
}
```

---

## 5. Мобильные прокси — карьерная стабильность

### 5.1. Изменение модели Proxy

```prisma
model Proxy {
  id              String   @id @default(cuid())
  userId          String
  
  type            ProxyType  // LTE_MOBILE | STATIC_RESIDENTIAL | DATACENTER_DEPRECATED
  
  host            String
  port            Int
  username        String?
  password        String?
  
  // КРИТИЧНО для TikTok 2026:
  carrier         String?   // "T-Mobile" | "Verizon" | "AT&T" | "MTS" | "Beeline"
  country         String
  dma             String?
  asn             Int?
  
  rotationLink    String?
  rotationCooldown Int     @default(900)   // минимум 15 мин между ротациями
  lastRotatedAt   DateTime?
  
  lastValidatedAt DateTime?
  bgpPathValid    Boolean  @default(false)
  
  pinnedAccountsCount Int  @default(0)
}

enum ProxyType {
  LTE_MOBILE           // ОБЯЗАТЕЛЬНО для TikTok account creation/warmup
  STATIC_RESIDENTIAL
  DATACENTER_DEPRECATED
}
```

Однако должна быть возможно добавлять любые мобильные прокси, даже дешевые с ротацией

### 5.2. Привязка прокси к аккаунту (14-day rule)

В UI запрещаем менять прокси у аккаунта чаще чем раз в 14 дней:

```typescript
async function bindProxyToAccount(accountId: string, proxyId: string, force: boolean = false) {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  
  if (account.pinnedProxyId && !force) {
    const daysSincePin = (Date.now() - account.proxyPinnedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSincePin < 14) {
      throw new HttpError(409, 
        `Аккаунт привязан к текущему прокси ${Math.ceil(14 - daysSincePin)} дней. ` +
        `Смена прокси чаще чем раз в 14 дней повышает риск shadowban.`
      );
    }
  }
  
  const newProxy = await prisma.proxy.findUnique({ where: { id: proxyId } });
  const oldProxy = account.pinnedProxyId 
    ? await prisma.proxy.findUnique({ where: { id: account.pinnedProxyId } })
    : null;
  
  if (account.platform === 'TIKTOK' && oldProxy && newProxy.carrier !== oldProxy.carrier && !force) {
    throw new HttpError(409,
      `Смена carrier (${oldProxy.carrier} -> ${newProxy.carrier}) для TikTok аккаунта ` +
      `сбрасывает 14-day correlation window. Аккаунт может попасть в shadowban на 14-21 день.`
    );
  }
  
  await prisma.account.update({
    where: { id: accountId },
    data: { pinnedProxyId: proxyId, proxyPinnedAt: new Date() },
  });
}
```

### 5.3. Carrier-ASN validation

```typescript
// apps/worker/src/core/proxy/carrier-validator.ts
export async function validateProxyCarrierPath(proxy: Proxy): Promise<{
  valid: boolean;
  observedASN: number;
  expectedASN: number;
  warning?: string;
}> {
  // 1. Получаем внешний IP через прокси
  const { stdout: ipResponse } = await execAsync(
    `curl -s -x http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port} https://api.ipify.org`
  );
  const exitIp = ipResponse.trim();
  
  // 2. Lookup ASN через Cymru WHOIS
  const { stdout: whoisResult } = await execAsync(`whois -h whois.cymru.com " -v ${exitIp}"`);
  const observedASN = parseInt(whoisResult.match(/AS(\d+)/)?.[1] || '0');
  
  const expectedASN = proxy.asn;
  
  if (observedASN !== expectedASN) {
    return {
      valid: false,
      observedASN,
      expectedASN,
      warning: `BGP path mismatch: IP ${exitIp} announced from AS${observedASN}, ` +
               `but carrier ${proxy.carrier} expected AS${expectedASN}. ` +
               `This proxy is likely rebrokered. TikTok will shadow-score it.`
    };
  }
  
  return { valid: true, observedASN, expectedASN };
}
```

---

## 6. Human-like behavior (BioMouse + Typing)

### 6.1. Mouse movement через ghost-cursor

```typescript
// apps/worker/src/core/humanity/biomouse.ts
import { createCursor } from 'ghost-cursor';
import type { Page } from 'patchright';

export async function humanClick(page: Page, selector: string) {
  const cursor = createCursor(page, undefined, false, {
    overshootSpread: 10,
    overshootRadius: 120,
  });
  
  await cursor.click(selector, {
    moveDelay: random(50, 200),
    paddingPercentage: 20,
    randomizeMoveDelay: true,
  });
}

export async function humanScroll(page: Page, distance: number) {
  const steps = Math.ceil(Math.abs(distance) / 100);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, distance > 0 ? random(80, 120) : -random(80, 120));
    await page.waitForTimeout(random(50, 150));
  }
}
```

### 6.2. Typing emulator

```typescript
// apps/worker/src/core/humanity/typing-emulator.ts
export async function humanType(page: Page, selector: string, text: string) {
  await page.focus(selector);
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    // 2% шанс опечатки + backspace
    if (Math.random() < 0.02 && i > 0) {
      const wrongChar = String.fromCharCode(char.charCodeAt(0) + random(-2, 2));
      await page.keyboard.type(wrongChar, { delay: random(80, 180) });
      await page.waitForTimeout(random(100, 300));
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(random(100, 200));
    }
    
    await page.keyboard.type(char, { delay: random(80, 180) });
    
    if (char === ' ' && Math.random() < 0.15) {
      await page.waitForTimeout(random(300, 800));
    }
  }
}
```

---

## 7. TikTok upload — обновлённая логика хэндлера

### 7.1. Pre-flight checks

```typescript
export async function processUploadJob(job: Job<UploadJobPayload>) {
  const { accountId, videoPath, title, description, tags } = job.data;
  
  // 1. Аккаунт жив?
  const cookieStatus = await validateCookies(accountId);
  if (cookieStatus !== 'alive') {
    throw new RequeueableError(`Account ${accountId} status: ${cookieStatus}`);
  }
  
  // 2. Аккаунт прошёл warmup?
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account.warmupCompletedAt) {
    throw new BlockedError(`Account ${accountId} still warming up. Skip commercial upload.`);
  }
  
  // 3. Прокси привязан и валиден?
  if (!account.pinnedProxyId) {
    throw new BlockedError(`Account ${accountId} has no pinned proxy.`);
  }
  
  // 4. Rate limit check — не более 3 видео в день, не чаще 2-4 часов
  const recentUploads = await prisma.video.count({
    where: { accountId, uploadedAt: { gte: new Date(Date.now() - 24*60*60*1000) } }
  });
  if (recentUploads >= 3) {
    throw new RateLimitError(`Account ${accountId} reached 3-uploads/day limit.`);
  }
  
  const lastUpload = await prisma.video.findFirst({
    where: { accountId }, orderBy: { uploadedAt: 'desc' }
  });
  if (lastUpload && Date.now() - lastUpload.uploadedAt.getTime() < 2*60*60*1000) {
    throw new RateLimitError(`Too soon after last upload (<2h).`);
  }
  
  // 5. Video uniqueness
  const uniqueVideoPath = await uniquifyVideo(videoPath, accountId);
  
  // 6. Launch + upload
  const { browser, page } = await launchStealthContext({
    accountId,
    proxyUrl: buildProxyUrl(account.pinnedProxy),
    cookiesPath: `/data/cookies/${accountId}.enc.json`,
    userAgent: account.fingerprint.userAgent,
    viewport: account.fingerprint.viewport,
    timezoneId: account.fingerprint.timezone,
    locale: account.fingerprint.locale,
  });
  
  try {
    await uploadViaTikTokWeb(page, uniqueVideoPath, title, description, tags);
  } finally {
    await browser.close();
    await fs.unlink(uniqueVideoPath);
  }
}
```

### 7.2. Video uniqueness через ffmpeg

```typescript
export async function uniquifyVideo(inputPath: string, accountId: string): Promise<string> {
  const outputPath = `/tmp/uniqued_${accountId}_${Date.now()}.mp4`;
  
  const seed = hashCode(accountId);
  const pixelShift = (seed % 5) - 2;
  const audioPitch = 1 + ((seed % 7) - 3) * 0.005;
  const trimMs = (seed % 800) + 100;
  const brightness = ((seed % 21) - 10) * 0.005;
  
  await execFileAsync('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-vf', [
      `crop=iw-${Math.abs(pixelShift)*2}:ih-${Math.abs(pixelShift)*2}:${pixelShift}:${pixelShift}`,
      `scale=iw+${Math.abs(pixelShift)*2}:ih+${Math.abs(pixelShift)*2}`,
      `eq=brightness=${brightness}`,
    ].join(','),
    '-af', `rubberband=pitch=${audioPitch}`,
    '-t', `${(await getDuration(inputPath)) - trimMs / 1000}`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-map_metadata', '-1',
    '-fflags', '+bitexact',
    outputPath
  ]);
  
  return outputPath;
}
```

### 7.3. Upload flow

```typescript
async function uploadViaTikTokWeb(page, videoPath, title, description, tags) {
  await page.goto('https://www.tiktok.com/tiktokstudio/upload?from=upload', {
    waitUntil: 'networkidle',
  });
  
  if (page.url().includes('/login')) {
    throw new SessionExpiredError('TikTok redirected to login. Cookies expired.');
  }
  
  await page.waitForTimeout(random(2000, 5000));
  
  // Upload via file input (НЕ через drag-drop)
  const fileInput = await page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(videoPath);
  
  await page.waitForSelector('[data-e2e="video-preview"]', { timeout: 120_000 });
  await page.waitForTimeout(random(3000, 6000));
  
  // Caption + hashtags
  const captionSelector = '[data-e2e="caption-input"]';
  await humanClick(page, captionSelector);
  await humanType(page, captionSelector, description);
  
  for (const tag of tags) {
    await page.keyboard.type(' #', { delay: random(80, 150) });
    await humanType(page, captionSelector, tag.replace(/^#/, ''));
    await page.waitForTimeout(random(800, 1500));
    
    const suggestion = await page.locator('[data-e2e="hashtag-suggestion"]').first();
    if (await suggestion.isVisible()) {
      await humanClick(page, '[data-e2e="hashtag-suggestion"]');
    }
  }
  
  await page.waitForTimeout(random(2000, 4000));
  await humanClick(page, '[data-e2e="post-button"]');
  await page.waitForSelector('[data-e2e="upload-success"]', { timeout: 60_000 });
}
```

---

## 8. Warmup module (НОВЫЙ — без него аккаунты умирают)

**Обязательный** новый воркер. Без warmup новые аккаунты получают shadowban в 80%+ случаев.

### 8.1. Warmup curriculum

```typescript
const WARMUP_CURRICULUM = [
  // Day 1-3: пассивное смотрение
  { day: 1, actions: [{ type: 'watch_fyp', durationMin: 10, durationMax: 15 }] },
  { day: 2, actions: [{ type: 'watch_fyp', durationMin: 12, durationMax: 18 }, { type: 'follow', count: 3 }] },
  { day: 3, actions: [{ type: 'watch_fyp', durationMin: 15, durationMax: 20 }, { type: 'like', count: 5 }, { type: 'follow', count: 5 }] },
  
  // Day 4-6: первые активные действия
  { day: 4, actions: [{ type: 'watch_fyp', durationMin: 15, durationMax: 25 }, { type: 'like', count: 10 }, { type: 'comment', count: 1 }] },
  { day: 5, actions: [{ type: 'watch_fyp', durationMin: 20, durationMax: 30 }, { type: 'like', count: 12 }, { type: 'save', count: 2 }] },
  { day: 6, actions: [{ type: 'watch_fyp', durationMin: 20, durationMax: 30 }, { type: 'like', count: 15 }] },
  
  // Day 7-10: первый upload (только organic, без promo)
  { day: 7, actions: [{ type: 'upload_organic', count: 1, hashtags: 'broad_only' }, { type: 'watch_fyp', durationMin: 15, durationMax: 25 }] },
  { day: 8, actions: [{ type: 'watch_fyp', durationMin: 20, durationMax: 30 }, { type: 'reply_comments', count: 'all' }] },
  { day: 9, actions: [{ type: 'upload_organic', count: 1 }, { type: 'engage_others', count: 10 }] },
  { day: 10, actions: [{ type: 'watch_fyp', durationMin: 20, durationMax: 30 }] },
  
  // Day 11: warmup complete
];
```

### 8.2. UI изменения

- Колонка "Warmup status" с прогресс-баром (Day X / 10)
- Кнопка "Принудительно завершить warmup" — с warning, для любого юзера
- Запрет на добавление в `upload` очередь аккаунтов с `warmupCompletedAt = null`

---

## 9. Shadowban detection

Новый воркер `shadowban-detector` (Cron, 1 раз в 12 часов):

```typescript
export async function detectShadowban() {
  const aliveAccounts = await prisma.account.findMany({
    where: { status: 'ALIVE', warmupCompletedAt: { not: null } }
  });
  
  for (const account of aliveAccounts) {
    const recentVideos = await prisma.video.findMany({
      where: { accountId: account.id },
      orderBy: { uploadedAt: 'desc' },
      take: 5,
    });
    
    if (recentVideos.length < 3) continue;
    
    // Шадоубан-сигнатура: 3+ видео подряд с <100 views через 24+ часа
    const oldEnough = recentVideos.filter(v => 
      Date.now() - v.uploadedAt.getTime() > 24*60*60*1000
    );
    const lowViewCount = oldEnough.filter(v => v.views < 100).length;
    
    if (oldEnough.length >= 3 && lowViewCount >= 3) {
      await prisma.account.update({
        where: { id: account.id },
        data: { status: 'SHADOWBAN_SUSPECTED' }
      });
      
      await cancelPendingJobs('upload', { accountId: account.id });
      
      await notifyUser(account.userId, 
        `Аккаунт ${account.nickname} попал под подозрение в shadowban. ` +
        `Рекомендация: остановить заливы на 7 дней, опубликовать 1 organic видео вручную с мобильного.`
      );
    }
  }
}
```

---

## 10. UI — что показать пользователю

### 10.1. Новый Dashboard widget — "Здоровье сетки"

| Метрика | Расчёт |
|---|---|
| Аккаунтов в warmup | `COUNT(*) WHERE warmupCompletedAt IS NULL` |
| Готовых к заливу | `COUNT(*) WHERE warmupCompletedAt IS NOT NULL AND status = 'ALIVE'` |
| Подозрение на shadowban | `COUNT(*) WHERE status = 'SHADOWBAN_SUSPECTED'` |
| Cookies истекли | `COUNT(*) WHERE status = 'EXPIRED_COOKIES'` |
| Прокси без BGP-валидации | `COUNT(*) FROM proxies WHERE bgpPathValid = FALSE` |

### 10.2. Warning banners

- Если юзер пытается залить видео на аккаунт ещё в warmup -> modal с объяснением и кнопкой "Хочу нарушить правило" (требует ввод текста "Я понимаю риски")
- Если прокси не LTE_MOBILE для TikTok-аккаунта -> жёлтый warning в `/account/profiles`
- Если у двух аккаунтов одинаковый `fingerprint.canvasSeed` -> красный alert

---

## 11. Что НЕ переделывать (оставить как есть)

- BullMQ архитектура очередей
- Prisma + PostgreSQL
- Next.js 15 фронтенд (только UI-добавки выше)
- Socket.io live terminal
- Дизайн-система `design.md`
- JWT auth + RBAC
- Admin panel

---

## 12. Roadmap миграции (порядок коммитов)

| Lane | Commit | Описание |
|---|---|---|
| 1 | `feat(worker): replace selenium with patchright` | Удаляем `selenium-webdriver`, `undetected-chromedriver`, ставим `patchright`. Новый `patchright-launcher.ts`. |
| 2 | `feat(worker): cookie-based auth, drop log:pass flow` | Prisma migration, удаляем поля login/password. |
| 3 | `feat(worker): per-account stable fingerprint` | `fingerprint-manager.ts` + browserforge. |
| 4 | `feat(worker): human behavior layer` | `biomouse.ts` + `typing-emulator.ts` + ghost-cursor. |
| 5 | `feat(worker): video uniquification pipeline` | `uniquifier.ts` через ffmpeg. |
| 6 | `feat(worker): warmup curriculum` | Новый `warmup.ts` handler, 10-day curriculum. |
| 7 | `feat(worker): shadowban detection cron` | `shadowban-detector.ts`. |
| 8 | `feat(proxy): carrier-ASN + BGP validation` | `carrier-validator.ts`, 14-day pin rule. |
| 9 | `feat(scraping): replace cheerio with curl-impersonate` | Переделываем `analytics.ts`. |
| 10 | `chore: lint rule blocking forbidden imports` | ESLint rule на запрет `puppeteer*`, `selenium*`, `undetected*`. |

---

## 13. Acceptance criteria

ИИ обязан перед закрытием каждого коммита проверить:

1. `npm run typecheck` — без ошибок
2. `npm run lint` — без ошибок (включая no-restricted-imports)
3. `npm test` — все юнит-тесты проходят
4. `npx prisma validate` — схема валидна
5. Интеграционный тест: создать тестовый аккаунт, прогнать warmup день 1, проверить cookies + fingerprint стабильность между запусками
6. Документация в `/docs/` обновлена

---

## 14. Critical reminders для ИИ

1. **НИКОГДА** не использовать `puppeteer-extra-plugin-stealth` под предлогом "оставлю на всякий случай". Удалить полностью.
2. **НИКОГДА** не логировать содержимое cookies/passwords/proxy creds даже в DEBUG.
3. **НИКОГДА** не использовать `headless: true` для TikTok — только `headless: false` + Xvfb.
4. **НИКОГДА** не менять fingerprint аккаунта после создания. Это рандомизация по сессиям = автомат shadowban.
5. **НИКОГДА** не загружать один и тот же файл на два аккаунта без прогона через `uniquifier`. VideoID detection поймает.
6. **НИКОГДА** не игнорировать warmup. Лучше отказаться от залива на новый аккаунт, чем получить shadowban.
7. **ВСЕГДА** делать pre-flight check (validateCookies) перед каждой задачей.
8. **ВСЕГДА** соблюдать rate limits: <=3 видео/день на аккаунт, >=2 часа между заливами.
9. **ВСЕГДА** проверять что прокси LTE_MOBILE для TikTok-аккаунтов младше 30 дней.

---

## 15. Что нельзя автоматизировать совсем (честные ограничения)

1. **Создание новых TikTok-аккаунтов** — требует SMS verification, физический телефон, manual captcha. Покупка готовых аккаунтов с историей предпочтительнее.
2. **Решение TikTok shape-captcha** на login — Roboflow модели работают на 60-70%, но решают только slider. Shape/rotate captcha требует ручного вмешательства или CapSolver API ($).
3. **YouTube account creation** — Google требует SMS + recovery email + 14-day cooldown. Только manual.
4. **TikTok Live / monetization unlocks** — требуют 1000+ органических подписчиков.
5. **Восстановление shadowbanned аккаунтов** — гарантированного метода нет. Recovery rate ~30%.

Если пользователь Melonity хочет реальные показатели роста MAU без вышеуказанных ограничений — это уже **TokPortal-уровень инфраструктуры** (реальные мобильные устройства в фермах с физическими SIM-картами), которая выходит за рамки данного SaaS.

---

**Конец ТЗ v2 (2026).**

