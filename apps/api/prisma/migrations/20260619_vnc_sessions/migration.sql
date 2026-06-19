CREATE TYPE "VncSessionStatus" AS ENUM ('ACTIVE', 'CLOSED');

CREATE TABLE "VncSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "display" INTEGER NOT NULL,
  "vncPort" INTEGER NOT NULL,
  "webPort" INTEGER NOT NULL,
  "password" TEXT NOT NULL,
  "status" "VncSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "VncSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VncSession_taskId_jobId_key" ON "VncSession"("taskId", "jobId");
CREATE INDEX "VncSession_userId_status_idx" ON "VncSession"("userId", "status");
CREATE INDEX "VncSession_taskId_status_idx" ON "VncSession"("taskId", "status");
CREATE INDEX "VncSession_accountId_idx" ON "VncSession"("accountId");

ALTER TABLE "VncSession"
  ADD CONSTRAINT "VncSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VncSession"
  ADD CONSTRAINT "VncSession_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VncSession"
  ADD CONSTRAINT "VncSession_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
