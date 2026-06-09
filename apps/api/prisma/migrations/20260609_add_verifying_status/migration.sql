-- Add VERIFYING to AccountStatus enum
-- This status is used during account import: accounts start as VERIFYING
-- and become ALIVE after successful login validation by the worker.
ALTER TYPE "AccountStatus" ADD VALUE IF NOT EXISTS 'VERIFYING';
