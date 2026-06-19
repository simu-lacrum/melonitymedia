import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const ACCOUNTS_SRC = fs.readFileSync(
  path.resolve(__dirname, '../accounts.ts'),
  'utf-8',
);

const WORKSPACE_SRC = fs.readFileSync(
  path.resolve(__dirname, '../workspace.ts'),
  'utf-8',
);

describe('account route safety guards', () => {
  it('protects bulk status updates from bypassing banned or shadowbanned accounts', () => {
    expect(ACCOUNTS_SRC).toContain('bulkStatusBlockers');
    expect(ACCOUNTS_SRC).toContain('DANGEROUS_STATUS_TRANSITION');
    expect(ACCOUNTS_SRC).toContain('blockedAccountIds');
    expect(ACCOUNTS_SRC).toContain('account.status.force_override');
  });

  it('keeps upload warmup force override admin-only', () => {
    expect(WORKSPACE_SRC).toContain('forceRequested && req.user!.role !== "ADMIN"');
    expect(WORKSPACE_SRC).toContain('Force launch override is admin-only');
    expect(WORKSPACE_SRC).toContain('forceSkipWarmup: force');
  });

  it('rolls back unfinished warmup status when a warmup task is cancelled', () => {
    expect(WORKSPACE_SRC).toContain("task.type === 'WARMUP'");
    expect(WORKSPACE_SRC).toContain('collectTaskAccountIds');
    expect(WORKSPACE_SRC).toContain("status: 'WARMING_UP'");
    expect(WORKSPACE_SRC).toContain("status: 'ALIVE'");
    expect(WORKSPACE_SRC).toContain('warmupStartedAt: null');
    expect(WORKSPACE_SRC).toContain('lastWarmupDay: null');
  });

  it('does not mark multi-session warmup tasks completed while accounts are still warming', () => {
    expect(WORKSPACE_SRC).toContain('warmingAccounts > 0');
    expect(WORKSPACE_SRC).toContain("warmupCompletedAt: null");
    expect(WORKSPACE_SRC).toContain("data: { status: 'RUNNING' }");
  });
});
