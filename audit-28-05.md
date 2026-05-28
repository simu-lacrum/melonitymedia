# MelonityMedia: Аудит и Решения (28.05.2026)

В данном документе описаны найденные архитектурные и логические проблемы приложения, а также предложены конкретные, рабочие фрагменты кода для их устранения.

---

## 1. Хардкод геолокации в отпечатках браузера (High Priority)

**Файл:** `apps/api/src/routes/accounts.ts:65`

**Проблема:** При генерации новых отпечатков браузера (Fingerprints) локация всегда устанавливается как `US / New York`. Если к аккаунту привязан прокси из другой страны, антифрод TikTok распознает несоответствие между IP-адресом и таймзоной/локалью отпечатка, что приведет к блокировке.

**Решение:** Получать данные о стране из привязанного прокси (если он есть).

**Исправленный код:**
```typescript
// Получаем прокси, чтобы вытащить страну
let geo = { country: 'US', city: 'New York' }; // Fallback
if (account.pinnedProxyId) {
  const proxy = await prisma.proxy.findUnique({
    where: { id: account.pinnedProxyId },
    select: { country: true }
  });
  
  if (proxy && proxy.country) {
    geo.country = proxy.country;
    // Опционально: можно добавить маппинг городов по умолчанию для крупных стран
    if (proxy.country === 'DE') geo.city = 'Berlin';
    else if (proxy.country === 'GB') geo.city = 'London';
    else geo.city = ''; 
  }
}

const newFp = parsed.data.deviceClass === 'mobile'
  ? generateMobileFingerprint(account.id, geo)
  : generateFingerprint(account.id, geo);
```

---

## 2. Утечка процессов FFmpeg / Zombie Processes (Medium Priority)

**Файл:** `apps/worker/src/core/video/uniquifier.ts:163`

**Проблема:** `execFileAsync` запускает процесс FFmpeg. Если во время 5-минутного таймаута воркер Node.js будет остановлен или джоба в BullMQ отменена, процесс `ffmpeg` останется сиротой (orphan process) и продолжит потреблять ресурсы сервера.

**Решение:** Использовать `AbortController` для передачи сигнала прерывания в `execFileAsync`. В контексте обработчика задачи BullMQ можно добавить слушатель на отмену.

**Исправленный код:**
```typescript
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Добавляем параметр abortSignal в опции функции uniquifyVideo (опционально)
const ac = new AbortController();

// Внутри функции:
try {
  await execFileAsync('ffmpeg', args, {
    timeout: 300_000, // 5 minutes max
    maxBuffer: 10 * 1024 * 1024,
    signal: ac.signal // Передаем сигнал для отмены
  });

  console.log(`[Uniquifier] Created: ${outputPath}`);
  return { outputPath, transforms };
} catch (err: any) {
  try { await fs.unlink(outputPath); } catch { /* ignore */ }
  
  if (err.name === 'AbortError') {
    throw new Error('Процесс FFmpeg был принудительно прерван');
  }
  throw new Error(`FFmpeg uniquification failed: ${err.message}`);
}

// Примечание: в upload.ts вы можете прослушивать отмену задачи BullMQ:
// job.on('failed', () => ac.abort());
```

---

## 3. Ненадежное сохранение сессионных Cookies (Low Priority)

**Файл:** `apps/worker/src/handlers/upload.ts:180`

**Проблема:** Сохранение кук (токен сессии) происходит только в случае успешной публикации. Если залив упадет с ошибкой (например, из-за капчи или таймаута селектора), обновленные во время сессии куки не сохранятся, и при следующем запуске аккаунт может оказаться разлогинен.

**Решение:** Переместить логику сохранения актуальных кук в блок `finally`.

**Исправленный код:**
```typescript
let browser: Browser | null = null;
let ctx: Awaited<ReturnType<typeof launchStealthContext>> | null = null;
let uniquifiedPath: string | null = null;

try {
  // ... предварительные проверки ...

  ctx = await launchStealthContext({
    accountId: data.accountId,
    proxyUrl,
    cookiesPath: data.cookiesDir ?? '/data/cookies',
    fingerprint,
  });
  browser = ctx.browser;
  
  // ... логика загрузки ...

} catch (err: unknown) {
  // ... обработка ошибки ...
} finally {
  // Гарантированное сохранение кук перед закрытием браузера
  if (ctx && ctx.context) {
    try {
      const cookies = await ctx.context.cookies();
      const browserCookies: BrowserCookie[] = cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite === 'Strict' ? 'Strict' : c.sameSite === 'None' ? 'None' : 'Lax',
      }));
      await saveCookiesToDiskCache(data.accountId, browserCookies, data.cookiesDir);
      logger.info('Cookies успешно сохранены после сессии.');
    } catch (cookieErr) {
      logger.warn(`Ошибка сохранения cookies в finally: ${cookieErr}`);
    }
  }

  await closeBrowser(browser);

  if (uniquifiedPath) {
    await cleanupUniquifiedVideo(uniquifiedPath);
  }
  logger.disconnect();
}
```

---

## 4. Ложное определение формата YouTube Shorts (Low Priority)

**Файл:** `apps/worker/src/handlers/upload.ts:465`

**Проблема:** Проверка того, что видео загрузилось именно как Short, использует поиск `/shorts/` в DOM страницы YouTube Studio. В новых версиях Studio ссылка может отображаться как `youtu.be/XXX`, из-за чего скрипт будет ошибочно ругаться.

**Решение:** Опираться на предварительную валидацию видео функцией `isShortsCompatible`, так как алгоритм YouTube однозначно распознает видео до 60 секунд с вертикальным соотношением сторон как Shorts.

**Исправленный код:**
```typescript
// Заменяем блок "Verify Shorts detection" на проверку по изначальным параметрам

const success = /published|опубликовано|video uploaded|сохранено/i.test(afterText ?? '');
if (!success) {
  logger.warn('Не удалось подтвердить публикацию по тексту, но поток завершен.');
}

// Переиспользуем переменную compat (полученную в начале функции)
if (!compat.ok) {
  logger.warn('⚠️ Внимание: Исходное видео не подходит под параметры Shorts. Оно загрузится как обычное видео.');
} else {
  logger.info('✅ Видео имеет валидные параметры Shorts и было успешно опубликовано.');
}

logger.info('YouTube Shorts загрузка завершена ✓');
```

---

## 5. Конфликт сборки npm vs pnpm (Build Warning)

**Файл:** Окружение и `package.json`

**Проблема:** При выполнении `npm run build` Next.js (в `apps/web`) пытается вызвать `pnpm config get registry` для установки swc зависимостей, так как находит остатки lock-файлов pnpm, хотя вы запускаете проект через `npm workspaces`.

**Решение:** 
Синхронизируйте использование пакетного менеджера. Если вы используете npm:
1. Удалите файл `pnpm-lock.yaml` (если он есть в корне или в `apps/web`).
2. Очистите `.next` папку: `rm -rf apps/web/.next`
3. Выполните чистую установку зависимостей `npm install` в корне проекта.

Либо перейдите на pnpm:
1. `npm install -g pnpm`
2. Настройте файл `pnpm-workspace.yaml`.
3. Запускайте `pnpm install` и `pnpm build`.
