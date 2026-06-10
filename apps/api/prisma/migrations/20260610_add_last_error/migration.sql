-- Add lastError column to SocialAccount
-- Stores human-readable reason when login/verification fails (shown to user in UI)
ALTER TABLE "SocialAccount" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
