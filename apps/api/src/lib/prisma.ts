// ─────────────────────────────────────────────────────────────
// Prisma Client Singleton
// Why singleton? In dev mode, hot-reload creates new PrismaClient
// instances on every file change, exhausting DB connections.
// This pattern ensures exactly one client per Node.js process.
// ─────────────────────────────────────────────────────────────

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
