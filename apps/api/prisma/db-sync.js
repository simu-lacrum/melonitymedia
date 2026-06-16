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

    // Add lastError column if it doesn't exist
    // Stores human-readable reason when login/verification fails (shown in UI)
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'SocialAccount' AND column_name = 'lastError'
        ) THEN
          ALTER TABLE "SocialAccount" ADD COLUMN "lastError" TEXT;
        END IF;
      END $$;
    `);

    // Add isApproved + approvedAt columns for admin approval system
    // New users default to false (need admin approval before they can login)
    // All existing users are auto-approved to prevent lockout
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'User' AND column_name = 'isApproved'
        ) THEN
          ALTER TABLE "User" ADD COLUMN "isApproved" BOOLEAN NOT NULL DEFAULT false;
          ALTER TABLE "User" ADD COLUMN "approvedAt" TIMESTAMP(3);
          -- Approve all existing users (they were registered before this feature)
          UPDATE "User" SET "isApproved" = true, "approvedAt" = NOW();
        END IF;
      END $$;
    `);

    console.log('[db-sync] Schema synced OK');
  } catch (err) {
    // Non-fatal: log but don't crash the server
    console.error('[db-sync] WARNING:', err.message || err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
