import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  close: vi.fn(),
  queue: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Queue: class QueueMock {
    constructor(...args: unknown[]) {
      mocks.queue(...args);
    }

    add(...args: unknown[]) {
      return mocks.add(...args);
    }

    close() {
      return mocks.close();
    }
  },
}));

import { addJob } from '../bullmq.js';

describe('worker self-scheduled jobs', () => {
  beforeEach(() => {
    mocks.add.mockReset();
    mocks.add.mockResolvedValue({ id: 'scheduled-job' });
  });

  it('uses a real BullMQ jobId and preserves retry defaults', async () => {
    await addJob('warmup-regression', { accountId: 'account-1' }, {
      delay: 1_000,
      jobId: 'warmup-account-1-day2-s0',
    });

    expect(mocks.add).toHaveBeenCalledWith(
      'warmup-regression',
      { accountId: 'account-1' },
      expect.objectContaining({
        delay: 1_000,
        jobId: 'warmup-account-1-day2-s0',
        attempts: 4,
        backoff: { type: 'exponential', delay: 120_000 },
      }),
    );
  });
});
