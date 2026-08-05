import { prisma } from './prisma.js';
import { normalizeWarmupDays, recoverWarmupProgress } from './warmup-state.js';

export interface WarmupRepairDetail {
  accountId: string;
  completed: boolean;
  recoveredDay: number;
  totalDays: number;
}

export interface WarmupRepairResult {
  repaired: WarmupRepairDetail[];
  scanned: number;
}

function sameDate(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}

/**
 * Reconcile legacy reset damage from durable WARMUP task history. This never
 * credits calendar time: progress requires a completed parent task or a
 * worker-created next-day job proving the previous day finished.
 */
export async function reconcileUserWarmupProgress(
  userId: string,
  accountIds?: string[],
): Promise<WarmupRepairResult> {
  const accounts = await prisma.socialAccount.findMany({
    where: {
      userId,
      ...(accountIds ? { id: { in: accountIds } } : {}),
    },
    select: {
      id: true,
      status: true,
      warmupDays: true,
      warmupStartedAt: true,
      warmupCompletedAt: true,
      lastWarmupDay: true,
    },
  });

  if (accounts.length === 0) return { repaired: [], scanned: 0 };

  const tasks = await prisma.task.findMany({
    where: { userId, type: 'WARMUP' },
    select: {
      accountId: true,
      bullmqJobId: true,
      completedAt: true,
      createdAt: true,
      config: true,
      status: true,
    },
  });

  const repaired: WarmupRepairDetail[] = [];

  for (const account of accounts) {
    const evidence = recoverWarmupProgress(account.id, tasks);
    const currentTotalDays = normalizeWarmupDays(account.warmupDays);
    let totalDays = currentTotalDays;
    let completedDay = Math.max(0, account.lastWarmupDay ?? 0, evidence.completedDays);
    let completedAt = account.warmupCompletedAt;

    if (!completedAt && evidence.completedAt) {
      // A previously completed curriculum remains complete. A later accidental
      // restart must not silently extend or invalidate it.
      totalDays = Math.max(1, evidence.completedDays);
      completedDay = totalDays;
      completedAt = evidence.completedAt;
    } else if (!completedAt && completedDay >= totalDays) {
      completedDay = totalDays;
      completedAt = new Date();
    } else if (completedAt) {
      // A completed curriculum can be followed by an accidental shorter
      // restart (for example 5 completed days overwritten with a 2-hour run).
      // Keep the strongest durable evidence and restore a canonical X/X state.
      totalDays = Math.max(totalDays, completedDay);
      completedDay = totalDays;
    }

    const startedAt = account.warmupStartedAt ?? evidence.startedAt;
    const becameReady = Boolean(completedAt) && account.status === 'WARMING_UP';
    const status = becameReady
      ? 'ALIVE'
      : account.status;
    const changed = totalDays !== account.warmupDays
      || completedDay !== (account.lastWarmupDay ?? 0)
      || !sameDate(startedAt, account.warmupStartedAt)
      || !sameDate(completedAt, account.warmupCompletedAt)
      || status !== account.status;

    if (!changed) continue;

    await prisma.socialAccount.update({
      where: { id: account.id },
      data: {
        status,
        warmupDays: totalDays,
        warmupStartedAt: startedAt,
        warmupCompletedAt: completedAt,
        lastWarmupDay: completedDay > 0 ? completedDay : null,
        ...(becameReady ? { lastError: null } : {}),
      },
    });

    repaired.push({
      accountId: account.id,
      completed: Boolean(completedAt),
      recoveredDay: completedDay,
      totalDays,
    });
  }

  return { repaired, scanned: accounts.length };
}

export async function reconcileAllWarmupProgress(): Promise<WarmupRepairResult> {
  const users = await prisma.task.findMany({
    where: { type: 'WARMUP' },
    distinct: ['userId'],
    select: { userId: true },
  });

  const combined: WarmupRepairResult = { repaired: [], scanned: 0 };
  for (const { userId } of users) {
    const result = await reconcileUserWarmupProgress(userId);
    combined.scanned += result.scanned;
    combined.repaired.push(...result.repaired);
  }
  return combined;
}
