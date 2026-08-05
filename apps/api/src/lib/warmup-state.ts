export const MIN_WARMUP_DAYS = 1;
export const MAX_WARMUP_DAYS = 21;
export const DEFAULT_WARMUP_DAYS = 10;
export const MIN_WARMUP_HOURS = 1;
export const MAX_WARMUP_HOURS = 24;
export const DEFAULT_WARMUP_HOURS = 2;
export const MAX_WARMUP_COMMENTS = 50;
export const MAX_WARMUP_COMMENT_LENGTH = 240;

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function normalizeWarmupDays(value: unknown): number {
  return clampInt(value, MIN_WARMUP_DAYS, MAX_WARMUP_DAYS, DEFAULT_WARMUP_DAYS);
}

export function normalizeWarmupHours(value: unknown): number {
  return clampInt(value, MIN_WARMUP_HOURS, MAX_WARMUP_HOURS, DEFAULT_WARMUP_HOURS);
}

export function normalizeWarmupMode(value: unknown): 'DAYS' | 'HOURS' {
  return value === 'HOURS' ? 'HOURS' : 'DAYS';
}

export function normalizeWarmupComments(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const comments: string[] = [];

  for (const item of value) {
    if (typeof item !== 'string') continue;
    const comment = String(item).replace(/\s+/g, ' ').trim().slice(0, MAX_WARMUP_COMMENT_LENGTH);
    if (!comment || seen.has(comment)) continue;

    seen.add(comment);
    comments.push(comment);
    if (comments.length >= MAX_WARMUP_COMMENTS) break;
  }

  return comments;
}

export function hasCompletedWarmupMismatch(account: {
  status: string;
  warmupCompletedAt: Date | string | null;
}): boolean {
  return account.status === 'WARMING_UP' && account.warmupCompletedAt !== null;
}

export interface WarmupTaskEvidence {
  accountId?: string | null;
  bullmqJobId?: string | null;
  completedAt?: Date | string | null;
  createdAt: Date | string;
  config: unknown;
  status: string;
}

export interface RecoveredWarmupProgress {
  completedAt: Date | null;
  completedDays: number;
  startedAt: Date | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function taskContainsAccount(task: WarmupTaskEvidence, accountId: string): boolean {
  if (task.accountId === accountId) return true;
  const accountIds = asRecord(task.config).accountIds;
  return Array.isArray(accountIds) && accountIds.includes(accountId);
}

function completedDaysBeforeTrackedJob(jobId: string | null | undefined, accountId: string): number {
  if (!jobId || !jobId.includes(`-${accountId}-day`)) return 0;
  const match = jobId.match(/-day(\d+)-s\d+$/);
  if (!match) return 0;

  // A day-N job is only scheduled after every session from day N-1 completed.
  return Math.max(0, Number(match[1]) - 1);
}

/**
 * Recover durable progress from task history after legacy API versions reset
 * lastWarmupDay. Only completed tasks or a follow-up job scheduled by the
 * worker count as evidence; elapsed wall-clock time is intentionally ignored.
 */
export function recoverWarmupProgress(
  accountId: string,
  tasks: WarmupTaskEvidence[],
): RecoveredWarmupProgress {
  let completedAt: Date | null = null;
  let completedDays = 0;
  let startedAt: Date | null = null;

  for (const task of tasks) {
    if (!taskContainsAccount(task, accountId)) continue;

    const taskStartedAt = new Date(task.createdAt);
    if (!Number.isNaN(taskStartedAt.getTime()) && (!startedAt || taskStartedAt < startedAt)) {
      startedAt = taskStartedAt;
    }

    const config = asRecord(task.config);
    const taskDays = normalizeWarmupDays(config.warmupDays);
    if (task.status === 'COMPLETED') {
      completedDays = Math.max(completedDays, taskDays);
      const taskCompletedAt = task.completedAt ? new Date(task.completedAt) : taskStartedAt;
      if (!Number.isNaN(taskCompletedAt.getTime()) && (!completedAt || taskCompletedAt > completedAt)) {
        completedAt = taskCompletedAt;
      }
      continue;
    }

    completedDays = Math.max(
      completedDays,
      Math.min(taskDays, completedDaysBeforeTrackedJob(task.bullmqJobId, accountId)),
    );
  }

  return { completedAt, completedDays, startedAt };
}

export function getWarmupDisplayDay(account: {
  lastWarmupDay: number | null;
  warmupCompletedAt: Date | string | null;
  warmupDays: number;
}): number | null {
  const totalDays = normalizeWarmupDays(account.warmupDays);
  if (account.warmupCompletedAt) return totalDays;
  if (account.lastWarmupDay === null) return null;
  return Math.max(0, Math.min(totalDays, account.lastWarmupDay));
}
