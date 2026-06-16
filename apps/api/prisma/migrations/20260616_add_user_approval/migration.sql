-- AlterTable: Add isApproved and approvedAt columns to User
ALTER TABLE "User" ADD COLUMN "isApproved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "approvedAt" TIMESTAMP(3);

-- Approve all existing users (they were registered before this feature existed)
UPDATE "User" SET "isApproved" = true, "approvedAt" = NOW();
