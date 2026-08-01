import { describe, expect, it } from 'vitest';
import { describeDispatchFailure, describeDispatchFailures } from '../dispatch-failure-message.js';

describe('dispatch failure messages', () => {
  it('explains the warmup upload gate without internal pre-flight wording', () => {
    const message = describeDispatchFailures([
      { accountId: 'one', error: 'WARMUP_REQUIRED' },
      { accountId: 'two', error: 'WARMUP_REQUIRED' },
    ]);

    expect(message).toContain('Прогрев аккаунта не завершён');
    expect(message).toContain('2 аккаунтов');
    expect(message).not.toContain('pre-flight');
  });

  it('names the task holding an account lock', () => {
    expect(describeDispatchFailure('ACCOUNT_BUSY:warmup')).toContain('выполняется прогрев');
  });

  it('keeps unknown backend reasons visible for diagnostics', () => {
    expect(describeDispatchFailure('NEW_GUARD')).toContain('NEW_GUARD');
  });
});
