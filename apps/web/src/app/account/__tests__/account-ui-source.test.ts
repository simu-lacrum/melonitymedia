import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const ACCOUNTS_PAGE_SRC = fs.readFileSync(
  path.resolve(__dirname, '../accounts/page.tsx'),
  'utf-8',
);

const WORKSPACE_PAGE_SRC = fs.readFileSync(
  path.resolve(__dirname, '../workspace/page.tsx'),
  'utf-8',
);

describe('account UI safety copy', () => {
  it('shows warmup progress in the account status instead of hiding it', () => {
    expect(ACCOUNTS_PAGE_SRC).toContain('warmupProgress');
    expect(ACCOUNTS_PAGE_SRC).toContain('acc.warmupDay');
    expect(ACCOUNTS_PAGE_SRC).toContain('Прогрев');
  });

  it('warns that hourly warmup is faster but riskier upload readiness', () => {
    expect(WORKSPACE_PAGE_SRC).toContain('Ускоренный (часы)');
    expect(WORKSPACE_PAGE_SRC).toContain('откроет заливы');
    expect(WORKSPACE_PAGE_SRC).toContain('рискованнее');
  });

  it('shows Google/TikTok verification flows in the account 2FA dialog', () => {
    expect(ACCOUNTS_PAGE_SRC).toContain('login:2fa_required');
    expect(ACCOUNTS_PAGE_SRC).toContain('phone_prompt');
    expect(ACCOUNTS_PAGE_SRC).toContain('number_match');
    expect(ACCOUNTS_PAGE_SRC).toContain('challengeNumber');
    expect(ACCOUNTS_PAGE_SRC).toContain('TikTok/Google');
  });

  it('exposes VNC monitor controls for active workspace jobs', () => {
    expect(WORKSPACE_PAGE_SRC).toContain('vncSessions');
    expect(WORKSPACE_PAGE_SRC).toContain('monitorUrl');
    expect(WORKSPACE_PAGE_SRC).toContain('VNC Monitor');
    expect(WORKSPACE_PAGE_SRC).toContain('title="VNC monitor"');
  });
});
