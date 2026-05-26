-- Manual migration: rename proxyId -> pinnedProxyId in SocialAccount
-- CRITICAL: Use ALTER TABLE RENAME COLUMN to preserve existing data.
-- DO NOT use DROP COLUMN + ADD COLUMN — that destroys all account-proxy bindings.

-- Step 1: Rename the column (preserves data)
ALTER TABLE "SocialAccount" RENAME COLUMN "proxyId" TO "pinnedProxyId";

-- Step 2: Rename the index (Prisma auto-creates FK index)
-- If index name differs in your DB, adjust accordingly
ALTER INDEX IF EXISTS "SocialAccount_proxyId_idx" RENAME TO "SocialAccount_pinnedProxyId_idx";

-- Step 3: Rename foreign key constraint (optional — Prisma handles this via schema sync)
-- If your FK constraint name differs, adjust:
-- ALTER TABLE "SocialAccount" RENAME CONSTRAINT "SocialAccount_proxyId_fkey" TO "SocialAccount_pinnedProxyId_fkey";
