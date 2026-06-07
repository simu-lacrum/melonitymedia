# ─────────────────────────────────────────────────────────────
# MelonityMedia Web Frontend — Production Dockerfile
#
# Multi-stage build for Next.js 15 standalone output:
# 1. Install dependencies
# 2. Build Next.js (standalone mode)
# 3. Minimal production image
# ─────────────────────────────────────────────────────────────

FROM node:20-bookworm-slim AS base

# ── Stage 1: Install dependencies ───────────────────────────
FROM base AS deps
WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json tsconfig.base.json ./

# Copy web package
COPY apps/web/package.json apps/web/tsconfig.json ./apps/web/
COPY apps/web/next.config.ts apps/web/postcss.config.mjs ./apps/web/

# Install dependencies
RUN npm ci --workspace=apps/web --include-workspace-root

# ── Stage 2: Build Next.js ──────────────────────────────────
FROM deps AS builder
WORKDIR /app

# Copy web source and public assets
COPY apps/web/src ./apps/web/src
COPY apps/web/public ./apps/web/public

# Build environment variables (available at build time)
# NEXT_PUBLIC_API_URL must be the EXTERNAL url (browser calls this directly)
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Build Next.js in standalone mode
RUN cd apps/web && npm run build

# ── Stage 3: Production image ──────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Run as non-root
RUN groupadd -r web && useradd -r -g web web

# Copy standalone output (includes server.js and minimal node_modules)
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

RUN chown -R web:web /app
USER web

EXPOSE 3000

# Next.js standalone server
CMD ["node", "apps/web/server.js"]
