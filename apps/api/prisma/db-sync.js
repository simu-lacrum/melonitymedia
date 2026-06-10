/**
 * Startup DB sync — runs before the API server starts.
 * Applies schema changes that need to be done at runtime
 * (e.g. adding new enum values) using raw SQL through Prisma Client.
 * 
 * This avoids needing the `prisma` CLI in the production image.
 */
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log('[db-sync] Checking schema...');

    // Add VERIFYING to AccountStatus enum if it doesn't exist
    // IF NOT EXISTS is safe to run multiple times (idempotent)
    await prisma.$executeRawUnsafe(
      `ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'VERIFYING'`
    );
    console.log('[db-sync] Schema synced OK');
  } catch (err) {
    // Non-fatal: log but don't crash the server
    console.error('[db-sync] WARNING:', err.message || err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
