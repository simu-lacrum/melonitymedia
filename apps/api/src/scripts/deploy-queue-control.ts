import {
  analyticsCronQueue,
  cleanupQueue,
  cookiesQueue,
  editProfileQueue,
  loginQueue,
  shadowbanCheckQueue,
  uploadQueue,
  warmupQueue,
} from '../lib/bullmq.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';

const TERMINAL_TASK_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

const queues = [
  uploadQueue,
  warmupQueue,
  cookiesQueue,
  editProfileQueue,
  loginQueue,
  analyticsCronQueue,
  shadowbanCheckQueue,
  cleanupQueue,
];

async function printBlockingActiveCount(): Promise<void> {
  const activeByQueue = await Promise.all(queues.map(async (queue) => ({
    queue,
    jobs: await queue.getActive(0, -1),
  })));
  const active = activeByQueue.flatMap(({ queue, jobs }) => jobs.map((job) => ({ queue, job })));
  const taskIds = [...new Set(active
    .map(({ job }) => job.data?.taskId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0))];
  const warmupAccountIds = [...new Set(active
    .filter(({ queue }) => queue.name === 'warmup')
    .map(({ job }) => job.data?.accountId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0))];

  const [tasks, warmupAccounts] = await Promise.all([
    prisma.task.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, status: true },
    }),
    prisma.socialAccount.findMany({
      where: { id: { in: warmupAccountIds } },
      select: { id: true, warmupCompletedAt: true },
    }),
  ]);
  const taskStatus = new Map(tasks.map((task) => [task.id, task.status]));
  const completedWarmups = new Set(warmupAccounts
    .filter((account) => account.warmupCompletedAt !== null)
    .map((account) => account.id));

  let blocking = 0;
  let obsolete = 0;
  for (const { queue, job } of active) {
    const taskId = typeof job.data?.taskId === 'string' ? job.data.taskId : null;
    const accountId = typeof job.data?.accountId === 'string' ? job.data.accountId : null;
    const terminalTask = taskId ? TERMINAL_TASK_STATUSES.has(taskStatus.get(taskId) ?? '') : false;
    const completedWarmup = queue.name === 'warmup' && accountId
      ? completedWarmups.has(accountId)
      : false;

    if (terminalTask || completedWarmup) obsolete += 1;
    else blocking += 1;
  }

  console.error(`[Deploy] Active jobs: ${active.length}; blocking: ${blocking}; obsolete: ${obsolete}`);
  console.log(blocking);
}

async function main() {
  const action = process.argv[2];
  if (action !== 'pause' && action !== 'resume' && action !== 'blocking-count') {
    throw new Error('Usage: deploy-queue-control <pause|resume|blocking-count>');
  }

  try {
    if (action === 'blocking-count') {
      await printBlockingActiveCount();
      return;
    }
    await Promise.all(queues.map((queue) => action === 'pause' ? queue.pause() : queue.resume()));
    console.log(`[Deploy] Worker queues ${action === 'pause' ? 'paused' : 'resumed'}: ${queues.map(q => q.name).join(', ')}`);
  } finally {
    await Promise.allSettled(queues.map((queue) => queue.close()));
    await prisma.$disconnect().catch(() => {});
    await redis.quit().catch(() => {});
  }
}

void main().catch((error) => {
  console.error(`[Deploy] Queue control failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
