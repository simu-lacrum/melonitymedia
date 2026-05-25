# ─────────────────────────────────────────────────────────────
# MelonityMedia Worker Dockerfile
# Runs Puppeteer with Chrome inside Xvfb (virtual display)
# This is the anti-detection approach: headless:false + Xvfb
# means Chrome behaves exactly like a real browser session,
# bypassing headless detection from platforms like TikTok.
# ─────────────────────────────────────────────────────────────

FROM node:20-slim

# System dependencies for Chrome + Xvfb
# Each package serves a specific purpose:
# - xvfb: virtual framebuffer (fake display for Chrome)
# - google-chrome-stable: the actual browser
# - fonts-*: proper text rendering (prevents tofu characters)
# - lib*: Chrome runtime dependencies
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    xvfb \
    libxi6 \
    libgconf-2-4 \
    fonts-liberation \
    fonts-noto-color-emoji \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libdrm2 \
    libgbm1 \
    libxshmfence1 \
    && wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use system Chrome, not download its own
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app

# Copy package files first (Docker layer caching)
COPY apps/worker/package*.json ./
RUN npm ci --only=production

# Copy worker source
COPY apps/worker/ ./

# Copy Prisma schema (needed for @prisma/client generation)
COPY apps/api/prisma ./prisma
RUN npx prisma generate

# Make entrypoint executable
COPY apps/worker/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
