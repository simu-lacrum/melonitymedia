-- Per-account publication history for source videos.
-- Keeps existing Video rows as source files and moves per-account upload state
-- into VideoPublication so one source can safely target many accounts.

CREATE TYPE "VideoPublicationStatus" AS ENUM ('QUEUED', 'PROCESSING', 'UPLOADED', 'FAILED', 'SKIPPED');

CREATE TABLE "VideoPublication" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "videoId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "taskId" TEXT,
  "status" "VideoPublicationStatus" NOT NULL DEFAULT 'QUEUED',
  "uploadedAt" TIMESTAMP(3),
  "views" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VideoPublication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VideoPublication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VideoPublication_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "VideoPublication_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "VideoPublication_videoId_accountId_key" ON "VideoPublication"("videoId", "accountId");
CREATE INDEX "VideoPublication_userId_idx" ON "VideoPublication"("userId");
CREATE INDEX "VideoPublication_accountId_uploadedAt_idx" ON "VideoPublication"("accountId", "uploadedAt");
CREATE INDEX "VideoPublication_videoId_status_idx" ON "VideoPublication"("videoId", "status");
CREATE INDEX "VideoPublication_taskId_idx" ON "VideoPublication"("taskId");

INSERT INTO "VideoPublication" (
  "id",
  "userId",
  "videoId",
  "accountId",
  "status",
  "uploadedAt",
  "views",
  "createdAt",
  "updatedAt"
)
SELECT
  'vp_' || md5(random()::text || clock_timestamp()::text || v."id"),
  v."userId",
  v."id",
  v."accountId",
  CASE
    WHEN v."isUploaded" = true THEN 'UPLOADED'::"VideoPublicationStatus"
    WHEN v."status" = 'FAILED' THEN 'FAILED'::"VideoPublicationStatus"
    WHEN v."status" = 'PROCESSING' THEN 'PROCESSING'::"VideoPublicationStatus"
    ELSE 'QUEUED'::"VideoPublicationStatus"
  END,
  v."uploadedAt",
  v."views",
  v."createdAt",
  CURRENT_TIMESTAMP
FROM "Video" v
WHERE v."accountId" IS NOT NULL
ON CONFLICT ("videoId", "accountId") DO NOTHING;
