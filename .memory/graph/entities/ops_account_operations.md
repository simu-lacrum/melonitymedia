# Узел: Account Operations

**Тип**: Operations / Accounts

## Платформы

### TikTok
- **Login URL**: `https://www.tiktok.com/login/phone-or-email/email`
- **Captcha**: TikTok Puzzle → CapSolver API
- **Rate-limit сообщение**: "Maximum number of attempts reached. Try again later." (красный текст)
- **Rate-limit cooldown**: 24-48 часов, каждый retry продлевает блок
- **False positive**: TikTok вставляет JSON AppContext (~170KB) в body страницы, содержащий "try again later" — нельзя проверять через `page.textContent('body')`

### YouTube / Google
- **Login URL**: `https://accounts.google.com/ServiceLogin`
- **Google Verification**: Часто запрашивает при новом IP/устройстве
- **YouTube Studio**: Блокирует VPS IP — "Произошла ошибка", 403 на видео
- **Edit Profile**: `#textbox` (contenteditable) не рендерятся при блокировке Studio

## Правила работы с аккаунтами
1. **НЕ тестировать один аккаунт повторно** без паузы 24-48ч
2. **Прокси-привязка**: Каждый аккаунт → один постоянный IP через `pinnedProxyId`
3. **Warmup обязателен** перед upload для новых аккаунтов
4. **Cookie auth**: AES-256-GCM encrypted в полях `cookiesEncrypted`, `cookiesIv`, `cookiesAuthTag`

## Антифрод паттерны
- **Fingerprint**: Patchright генерирует при создании, помечается `stale` при обновлении Chrome
- **Human emulation**: `biomouse.ts` (ghost-cursor), `typing-emulator.ts` (keystroke delays)
- **Browser**: headless: false внутри Xvfb — обходит headless-detection
- **TLS**: curl-impersonate для API запросов (Chrome TLS fingerprint)

## Prisma P2025 Safety
Все `socialAccount.update()` в `login.ts` обёрнуты в `safeUpdateAccount()` — graceful handling если запись удалена между dispatch и execution.

## Связи
- `apps/worker/src/handlers/login.ts` — основной обработчик входа
- `apps/worker/src/core/browser/patchright-launcher.ts` — запуск браузера
- `apps/worker/src/core/captcha/tiktok-captcha-handler.ts` — решение капчи
- `apps/worker/src/core/auth/cookie-store.ts` — шифрование/дешифрование cookies
- `apps/worker/src/core/auth/session-validator.ts` — проверка валидности сессии
