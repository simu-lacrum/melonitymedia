#!/usr/bin/env node
// scripts/backfill-task-account-id.mjs
//
// ONE-TIME migration script. Backfills Task.accountId from the
// config JSON column for rows that were created before the
// 20260527_task_account_id_and_cancel_reason migration.
//
// Safe to run multiple times (idempotent — only updates NULL rows).
//
// Usage:
//   DATABASE_URL=... node scripts/backfill-task-account-id.mjs [--dry-run]

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`[backfill] Starting Task.accountId backfill ${DRY_RUN ? '(DRY RUN)' : ''}...`);

  // Find all tasks where accountId is NULL and config contains accountIds
  const tasks = await prisma.task.findMany({
    where: { accountId: null },
    select: { id: true, config: true },
  });

  console.log(`[backfill] Found ${tasks.length} tasks with NULL accountId`);

  let updated = 0;
  let skipped = 0;

  for (const task of tasks) {
    // config is a JSON field — extract accountIds array
    const config = task.config;
    if (
      typeof config !== 'object' ||
      config === null ||
      !('accountIds' in config) ||
      !Array.isArray(config.accountIds)
    ) {
      skipped++;
      continue;
    }

    const accountIds = config.accountIds;

    // Only backfill single-account tasks (multi-account stays null)
    if (accountIds.length !== 1) {
      skipped++;
      continue;
    }

    const accountId = accountIds[0];

    if (DRY_RUN) {
      console.log(`[backfill] DRY RUN: Task ${task.id} → accountId=${accountId}`);
    } else {
      await prisma.task.update({
        where: { id: task.id },
        data: { accountId },
      });
    }

    updated++;
  }

  console.log(`[backfill] Done. Updated: ${updated}, Skipped: ${skipped}`);
}

main()
  .catch((err) => {
    console.error('[backfill] FATAL:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
