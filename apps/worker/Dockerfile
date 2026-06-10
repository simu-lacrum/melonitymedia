# ─────────────────────────────────────────────────────────────
# MelonityMedia Worker v3 — Production Dockerfile
#
# This container runs BullMQ workers with:
# 1. Google Chrome (real, not Chromium) + Xvfb (virtual display)
# 2. Patchright (CDP-based anti-detection, patched Playwright)
# 3. curl-impersonate (TLS fingerprint impersonation)
# 4. ffmpeg (video uniquification pipeline)
#
# headless:false + Xvfb = undetectable browser sessions.
# NEVER install puppeteer, selenium, or chromedriver in this image.
# ─────────────────────────────────────────────────────────────

FROM node:20-bookworm-slim

# ── System dependencies for Chrome + Xvfb + ffmpeg ─────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    curl \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgconf-2-4 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    xvfb \
    x11-utils \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# ── Install google-chrome-stable ───────────────────────────
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-linux-signing-key.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-linux-signing-key.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# ── Install curl-impersonate (Chrome TLS fingerprint) ──────
# Pre-built binary from: https://github.com/lexiforest/curl-impersonate
RUN wget -q -O /tmp/curl-impersonate.tar.gz \
    https://github.com/lexiforest/curl-impersonate/releases/download/v1.1.0/curl-impersonate-v1.1.0.x86_64-linux-gnu.tar.gz \
    && tar -xzf /tmp/curl-impersonate.tar.gz -C /usr/local/bin/ \
    && rm /tmp/curl-impersonate.tar.gz \
    && chmod +x /usr/local/bin/curl_chrome*

# ── App setup ──────────────────────────────────────────────
WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json tsconfig.base.json ./

# Copy worker package and Prisma schema
COPY apps/worker/package.json apps/worker/tsconfig.json ./apps/worker/
COPY apps/api/prisma ./apps/api/prisma/

# Install dependencies (patchright downloads its own browser)
RUN npm ci --workspace=apps/worker --include-workspace-root

# Generate Prisma client from the API schema
RUN cd apps/api && npx prisma generate

# Copy worker source
COPY apps/worker/src ./apps/worker/src

# Build TypeScript
RUN cd apps/worker && npm run build

# ── Cookie storage volume ──────────────────────────────────
RUN mkdir -p /data/cookies && chmod 777 /data/cookies

# ── Entrypoint ─────────────────────────────────────────────
COPY apps/worker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Chrome runs as non-root for security
RUN groupadd -r worker && useradd -r -g worker -G audio,video worker \
    && mkdir -p /home/worker && chown -R worker:worker /home/worker /app /data

USER worker

ENTRYPOINT ["/entrypoint.sh"]
