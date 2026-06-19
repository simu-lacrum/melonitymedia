# ─────────────────────────────────────────────────────────────
# MelonityMedia API Server — Production Dockerfile
#
# Multi-stage build:
# 1. Install dependencies + generate Prisma client
# 2. Build TypeScript
# 3. Production image with minimal footprint
# ─────────────────────────────────────────────────────────────

FROM node:20-bookworm-slim AS base

# ── Stage 1: Install dependencies ───────────────────────────
FROM base AS deps
WORKDIR /app

# Copy root package files for workspace resolution
COPY package.json package-lock.json tsconfig.base.json ./

# Copy api package and Prisma schema
COPY apps/api/package.json apps/api/tsconfig.json ./apps/api/
COPY apps/api/prisma ./apps/api/prisma/

# Copy other workspace package.json stubs (npm ci needs full workspace tree)
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/

# Install dependencies
RUN npm ci --workspace=apps/api --include-workspace-root

# Generate Prisma client
RUN cd apps/api && npx prisma generate

# ── Stage 2: Build TypeScript ───────────────────────────────
FROM deps AS builder
WORKDIR /app

# Copy api source
COPY apps/api/src ./apps/api/src

# Build TypeScript → dist/
RUN cd apps/api && npm run build

# ── Stage 3: Production image ──────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Prisma requires OpenSSL for PostgreSQL connections
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy root package files
COPY package.json package-lock.json ./

# Copy workspace package.json files (npm needs full workspace tree)
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/

# Install production dependencies only
RUN npm ci --workspace=apps/api --include-workspace-root --omit=dev

# Copy Prisma schema and generated client from builder
COPY apps/api/prisma ./apps/api/prisma/
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy built application
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Create uploads directory
RUN mkdir -p /app/uploads /app/banners && chmod 777 /app/uploads /app/banners

# Run as non-root for security
RUN groupadd -r api && useradd -r -g api api \
    && chown -R api:api /app
USER api

# Set working directory to apps/api so Prisma finds schema.prisma
WORKDIR /app/apps/api

EXPOSE 4000

CMD ["sh", "-c", "set -e; set +e; migrate_output=$(npx prisma migrate deploy 2>&1); migrate_code=$?; set -e; printf '%s\n' \"$migrate_output\"; if [ \"$migrate_code\" -ne 0 ]; then echo \"$migrate_output\" | grep -q 'P3005' || exit \"$migrate_code\"; node prisma/baseline-legacy-migrations.js; npx prisma migrate deploy; fi; node prisma/db-sync.js && exec node dist/index.js"]
