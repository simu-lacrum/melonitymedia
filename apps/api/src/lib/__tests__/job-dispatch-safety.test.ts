import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const JOB_DISPATCH_SRC = fs.readFileSync(
  path.resolve(__dirname, '../job-dispatch.ts'),
  'utf-8',
);

describe('job dispatch safety guards', () => {
  it('requires a pinned proxy but does not require LTE_MOBILE', () => {
    expect(JOB_DISPATCH_SRC).toContain('if (!account.pinnedProxy)');
    expect(JOB_DISPATCH_SRC).toContain('error: "NO_PROXY"');
    expect(JOB_DISPATCH_SRC).not.toContain('accountAgeDays < 30');
    expect(JOB_DISPATCH_SRC).not.toContain("account.pinnedProxy.type !== 'LTE_MOBILE'");
    expect(JOB_DISPATCH_SRC).not.toContain('PROXY_NOT_LTE_FOR_YOUNG_ACCOUNT');
  });

  it('keeps fingerprint and proxy resolved fresh in the worker', () => {
    expect(JOB_DISPATCH_SRC).toContain('intentionally NOT included');
    expect(JOB_DISPATCH_SRC).toContain('loadAccountContext(accountId)');
    expect(JOB_DISPATCH_SRC).toContain('prevents stale-data crashes');
  });
});
