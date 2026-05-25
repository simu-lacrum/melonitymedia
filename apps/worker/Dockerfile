# ─────────────────────────────────────────────────────────────
# MelonityMedia Worker — Production Dockerfile
#
# This container runs BullMQ workers with a real Chrome browser
# inside Xvfb (virtual display) to bypass headless detection.
#
# Stack: Node.js 20 + google-chrome-stable + Xvfb
# ─────────────────────────────────────────────────────────────

FROM node:20-bookworm-slim

# ── System dependencies for Chrome + Xvfb ─────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
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
    && rm -rf /var/lib/apt/lists/*

# ── Install google-chrome-stable ───────────────────────────
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-linux-signing-key.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-linux-signing-key.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# ── App setup ──────────────────────────────────────────────
WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json tsconfig.base.json ./

# Copy worker package
COPY apps/worker/package.json apps/worker/tsconfig.json ./apps/worker/

# Install dependencies
RUN npm ci --workspace=apps/worker --include-workspace-root

# Copy worker source
COPY apps/worker/src ./apps/worker/src

# Build TypeScript
RUN cd apps/worker && npm run build

# ── Entrypoint ─────────────────────────────────────────────
COPY apps/worker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Chrome runs as non-root for security
RUN groupadd -r worker && useradd -r -g worker -G audio,video worker \
    && mkdir -p /home/worker && chown -R worker:worker /home/worker /app

USER worker

ENTRYPOINT ["/entrypoint.sh"]
