-- Custom warmup duration + account descriptions + video hashtags
ALTER TABLE "SocialAccount" ADD COLUMN "warmupDays" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "SocialAccount" ADD COLUMN "defaultDescription" TEXT;
ALTER TABLE "Video" ADD COLUMN "description" TEXT;
ALTER TABLE "Video" ADD COLUMN "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[];
