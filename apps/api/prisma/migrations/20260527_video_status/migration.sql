-- Create VideoStatus enum
CREATE TYPE "VideoStatus" AS ENUM ('QUEUED', 'PROCESSING', 'UPLOADED', 'FAILED');

-- Add status column to Video with default
ALTER TABLE "Video" ADD COLUMN "status" "VideoStatus" NOT NULL DEFAULT 'QUEUED';

-- Backfill: derive status from existing isUploaded flag
UPDATE "Video" SET "status" = 'UPLOADED' WHERE "isUploaded" = true;

-- Add index for filtering
CREATE INDEX "Video_status_idx" ON "Video"("status");
