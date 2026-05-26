# Worker Dockerfile — Полная спецификация

> Этот документ описывает точный состав Docker-образа Worker'а и `entrypoint.sh`.
> При воссоздании или аудите Dockerfile — сверяйтесь с этой спецификацией.

---

## Базовый образ

```
node:20-bookworm-slim
```

**Причина:** Patchright (patched Playwright) требует настоящий Google Chrome, не встроенный Chromium.

---

## Системные зависимости

### Google Chrome Stable

```dockerfile
RUN apt-get update && apt-get install -y wget gnupg ca-certificates && \
    wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-linux.gpg && \
    echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-linux.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google.list && \
    apt-get update && apt-get install -y \
        google-chrome-stable \
        xvfb libxi6 libgconf-2-4 fonts-liberation \
        libnss3 libatk-bridge2.0-0 libdrm2 libgbm1 libasound2 \
        ffmpeg whois
```

**Критичные пакеты:**

| Пакет | Зачем |
|-------|-------|
| `google-chrome-stable` | Patchright подключается к нему через CDP |
| `xvfb` | Виртуальный дисплей для headless: false (Patchright не поддерживает headless для TikTok) |
| `libnss3` | Chrome не запустится без NSS (Network Security Services) |
| `libatk-bridge2.0-0` | Accessibility bridge — требуется Chrome |
| `libdrm2`, `libgbm1` | GPU абстракция — без них Chrome падает с `[ERROR:gpu_init.cc]` |
| `libasound2` | Аудио — требуется для video autoplay в TikTok FYP |
| `fonts-liberation` | Шрифты для рендеринга (без них canvas fingerprint будет аномальным) |
| `ffmpeg` | Уникализация видео (metadata rewrite, re-encode) |
| `whois` | BGP/ASN lookup для carrier validation |

### curl-impersonate

```dockerfile
ARG CURL_IMPERSONATE_VERSION=0.9.0
RUN wget -q "https://github.com/lexiforest/curl-impersonate/releases/download/v${CURL_IMPERSONATE_VERSION}/curl-impersonate-v${CURL_IMPERSONATE_VERSION}.x86_64-linux-gnu.tar.gz" \
      -O /tmp/curl.tar.gz && \
    tar -xzf /tmp/curl.tar.gz -C /usr/local/bin/ && \
    rm /tmp/curl.tar.gz && chmod +x /usr/local/bin/curl_chrome* /usr/local/bin/curl_ff* /usr/local/bin/curl_safari*
```

**Форк:** `lexiforest/curl-impersonate` (обновляется чаще оригинала `lwthiker`).
Предоставляет бинарники `curl_chrome116`, `curl_ff117`, `curl_safari17` — имперсонация TLS fingerprint конкретного браузера.

### Patchright

```dockerfile
RUN npx patchright install chromium
```

Скачивает patched-вариант Chromium. **Не заменяет** google-chrome-stable — используется параллельно.

---

## Сборка приложения

```dockerfile
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
```

---

## entrypoint.sh

```bash
#!/bin/bash
set -e

# ── 1. Validate MASTER_KEY before anything else ──────────
node -e "
const k = Buffer.from(process.env.MASTER_KEY || '', 'base64');
if (k.length !== 32) {
  console.error('FATAL: MASTER_KEY invalid (must be 32 bytes base64, got ' + k.length + ')');
  process.exit(1);
}
"

# ── 2. Virtual display for Patchright headless: false ────
Xvfb :99 -screen 0 1920x1080x24 -ac +extension RANDR &
export DISPLAY=:99
sleep 1

# ── 3. Log Chrome version (fingerprint pinning baseline) ─
google-chrome --version

# ── 4. Start worker ──────────────────────────────────────
exec node dist/index.js
```

**Порядок критичен:**
1. `MASTER_KEY` проверяется ДО запуска Xvfb — не тратим ресурсы при невалидном ключе
2. Xvfb стартует в фоне с разрешением 1920×1080 (покрывает все fingerprint viewport'ы)
3. Chrome version логируется для отладки fingerprint stale ситуаций
4. `exec` заменяет bash на node — сигналы (SIGTERM) доходят до Node.js напрямую

---

## Переменные окружения Worker

| Переменная | Обязательна | Описание |
|-----------|-------------|----------|
| `MASTER_KEY` | ✅ | AES-256-GCM ключ (32 bytes base64) |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis для BullMQ + кэш |
| `DISPLAY` | ❌ (set by entrypoint) | `:99` — Xvfb display |

---

## Порты

Worker **не открывает** внешних портов. Всё взаимодействие через:
- **BullMQ** (Redis) — получение задач
- **Prisma** (PostgreSQL) — чтение/запись данных
- **Socket.io** (подключение к API серверу) — отправка логов
