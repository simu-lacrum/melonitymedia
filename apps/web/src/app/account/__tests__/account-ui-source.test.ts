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

const PROXIES_PAGE_SRC = fs.readFileSync(
  path.resolve(__dirname, '../proxies/page.tsx'),
  'utf-8',
);

const SELECT_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../../components/ui/select.tsx'),
  'utf-8',
);

const DROPDOWN_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../../components/ui/dropdown-menu.tsx'),
  'utf-8',
);

const LIVE_TERMINAL_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../../components/ui/live-terminal.tsx'),
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

  it('keeps proxy add form focused on protocol/type instead of manual carrier for static proxies', () => {
    expect(PROXIES_PAGE_SRC).toContain('formProtocol');
    expect(PROXIES_PAGE_SRC).toContain('SOCKS5');
    expect(PROXIES_PAGE_SRC).toContain('handleProxyTypeChange');
    expect(PROXIES_PAGE_SRC).not.toContain('id="proxy-carrier"');
    expect(PROXIES_PAGE_SRC).not.toContain('id="bulk-proxy-carrier"');
    expect(PROXIES_PAGE_SRC).toContain('{isMobileProxy && (');
  });

  it('highlights interactive dropdown rows and uses pointer cursor', () => {
    expect(SELECT_SRC).toContain('cursor-pointer');
    expect(SELECT_SRC).toContain('data-highlighted:bg-primary/10');
    expect(DROPDOWN_SRC).toContain('cursor-pointer');
    expect(DROPDOWN_SRC).toContain('data-highlighted:bg-primary/10');
  });

  it('renders fullscreen live terminal above the sticky header', () => {
    expect(LIVE_TERMINAL_SRC).toContain('z-[100]');
    expect(LIVE_TERMINAL_SRC).toContain('h-[calc(100dvh-2rem)]');
  });
});
