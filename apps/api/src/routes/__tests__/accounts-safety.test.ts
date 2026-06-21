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

  it('creates monitorable LOGIN tasks for account import and retry login', () => {
    expect(ACCOUNTS_SRC).toContain('createLoginMonitorTask');
    expect(ACCOUNTS_SRC).toContain("type: 'LOGIN'");
    expect(ACCOUNTS_SRC).toContain("'account_import'");
    expect(ACCOUNTS_SRC).toContain("'retry_login'");
    expect(ACCOUNTS_SRC).toContain("extra: { mode: importMode, taskId: loginTask.id }");
    expect(ACCOUNTS_SRC).toContain("extra: { mode, taskId: loginTask.id }");
    expect(ACCOUNTS_SRC).toContain("workspaceUrl: '/account/workspace'");
  });

  it('does not report quick warmup as started when pre-flight dispatch fails for every account', () => {
    expect(ACCOUNTS_SRC).toContain('dispatched === 0');
    expect(ACCOUNTS_SRC).toContain('res.status(409).json');
    expect(ACCOUNTS_SRC).toContain("f.error === 'NO_PROXY'");
    expect(ACCOUNTS_SRC).toContain('Подходит LTE_MOBILE или STATIC_RESIDENTIAL');
    expect(ACCOUNTS_SRC).not.toContain('PROXY_NOT_LTE_FOR_YOUNG_ACCOUNT');
  });

  it('requires selecting a proxy before import starts login verification jobs', () => {
    expect(ACCOUNTS_SRC).toContain("proxyId === 'none'");
    expect(ACCOUNTS_SRC).toContain('Выберите прокси для импорта');
    expect(ACCOUNTS_SRC).toContain('Для проверки входа и любых задач к аккаунту должен быть привязан прокси');
  });
});
