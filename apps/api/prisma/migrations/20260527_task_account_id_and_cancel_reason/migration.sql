-- AlterTable: add accountId and cancelReason to Task for shadowban cancel queries
ALTER TABLE "Task" ADD COLUMN "accountId" TEXT;
ALTER TABLE "Task" ADD COLUMN "cancelReason" TEXT;

-- CreateIndex: fast lookup by accountId (shadowban-detector cancels PENDING uploads)
CREATE INDEX "Task_accountId_idx" ON "Task"("accountId");
