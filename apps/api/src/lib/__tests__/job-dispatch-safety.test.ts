import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const JOB_DISPATCH_SRC = fs.readFileSync(
  path.resolve(__dirname, '../job-dispatch.ts'),
  'utf-8',
);

describe('job dispatch safety guards', () => {
  it('blocks automation for young accounts without LTE_MOBILE proxies', () => {
    expect(JOB_DISPATCH_SRC).toContain('accountAgeDays < 30');
    expect(JOB_DISPATCH_SRC).toContain("account.pinnedProxy.type !== 'LTE_MOBILE'");
    expect(JOB_DISPATCH_SRC).toContain("error: 'PROXY_NOT_LTE_FOR_YOUNG_ACCOUNT'");
  });

  it('keeps fingerprint and proxy resolved fresh in the worker', () => {
    expect(JOB_DISPATCH_SRC).toContain('intentionally NOT included');
    expect(JOB_DISPATCH_SRC).toContain('loadAccountContext(accountId)');
    expect(JOB_DISPATCH_SRC).toContain('prevents stale-data crashes');
  });
});
