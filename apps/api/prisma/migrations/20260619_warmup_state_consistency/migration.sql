-- Completed warmup must never stay in WARMING_UP.
-- This repairs legacy rows created before warmup state was normalized.
UPDATE "SocialAccount"
SET "status" = 'ALIVE',
    "lastError" = NULL
WHERE "status" = 'WARMING_UP'
  AND "warmupCompletedAt" IS NOT NULL;
