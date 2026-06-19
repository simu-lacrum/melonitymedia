-- Completed warmup rows should report full progress even if legacy workers
-- finished before lastWarmupDay was written.
UPDATE "SocialAccount"
SET "lastWarmupDay" = "warmupDays"
WHERE "warmupCompletedAt" IS NOT NULL
  AND ("lastWarmupDay" IS NULL OR "lastWarmupDay" < "warmupDays");
