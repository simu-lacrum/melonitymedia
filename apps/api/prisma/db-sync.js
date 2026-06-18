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
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'User' AND column_name = 'isApproved'
        ) THEN
          ALTER TABLE "User" ADD COLUMN "isApproved" BOOLEAN NOT NULL DEFAULT false;
          ALTER TABLE "User" ADD COLUMN "approvedAt" TIMESTAMP(3);
        END IF;
      END $$;
    `);

    // Always approve existing users that were never approved (safety net)
    // This handles the case where a previous deploy added the column but crashed
    // before running the UPDATE. Safe to run every time — only touches unapproved users.
    await prisma.$executeRawUnsafe(`
      UPDATE "User" SET "isApproved" = true, "approvedAt" = NOW()
      WHERE "isApproved" = false AND "role" = 'ADMIN'
    `);
    // Create DailySnapshot table for real analytics time-series
    // One row per account per day, upserted by analytics cron
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "DailySnapshot" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "accountId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "date" DATE NOT NULL,
        "views" INTEGER NOT NULL DEFAULT 0,
        "followers" INTEGER NOT NULL DEFAULT 0,
        "likes" INTEGER NOT NULL DEFAULT 0,
        "videos" INTEGER NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "DailySnapshot_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "DailySnapshot_accountId_date_key" UNIQUE ("accountId", "date"),
        CONSTRAINT "DailySnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE,
        CONSTRAINT "DailySnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
      );
    `);
    // Create indexes if they don't exist
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "DailySnapshot_userId_date_idx" ON "DailySnapshot"("userId", "date");
    `);

    // Create Banner table for video overlay banners
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Banner" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "userId" TEXT NOT NULL,
        "filename" TEXT NOT NULL,
        "originalName" TEXT NOT NULL,
        "filepath" TEXT NOT NULL,
        "mimeType" TEXT NOT NULL,
        "size" INTEGER NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Banner_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "Banner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "Banner_userId_idx" ON "Banner"("userId");
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
