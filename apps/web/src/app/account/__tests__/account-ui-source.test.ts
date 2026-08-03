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

  it('does not label a terminally failed warmup as a healthy account', () => {
    expect(ACCOUNTS_PAGE_SRC).toContain('warmupStopped');
    expect(ACCOUNTS_PAGE_SRC).toContain('Прогрев остановлен');
    expect(ACCOUNTS_PAGE_SRC).toContain('warmupCompletedAt');
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
    expect(ACCOUNTS_PAGE_SRC).toContain('currentTwoFA.platform === "TIKTOK" ? "TikTok" : "YouTube"');
    expect(ACCOUNTS_PAGE_SRC).toContain('уведомление Google');
  });

  it('exposes VNC monitor controls for active workspace jobs', () => {
    expect(WORKSPACE_PAGE_SRC).toContain('vncSessions');
    expect(WORKSPACE_PAGE_SRC).toContain('monitorUrl');
    expect(WORKSPACE_PAGE_SRC).toContain('VNC Monitor');
    expect(WORKSPACE_PAGE_SRC).toContain('title="VNC monitor"');
  });

  it('exposes account-row VNC monitor controls during login verification', () => {
    expect(ACCOUNTS_PAGE_SRC).toContain('fetchAccountMonitors');
    expect(ACCOUNTS_PAGE_SRC).toContain('/api/workspace/jobs');
    expect(ACCOUNTS_PAGE_SRC).toContain('renderAccountMonitorLink');
    expect(ACCOUNTS_PAGE_SRC).toContain('Открыть монитор');
    expect(ACCOUNTS_PAGE_SRC).toContain('window.setTimeout(fetchAccountMonitors, 2500)');
  });

  it('describes cookie jobs as visible browser session checks', () => {
    expect(ACCOUNTS_PAGE_SRC).toContain('Проверить сессии');
    expect(ACCOUNTS_PAGE_SRC).toContain('Проверка сессий запущена');
    expect(ACCOUNTS_PAGE_SRC).toContain('headless: false');
  });

  it('keeps proxy add form focused on protocol/type instead of manual carrier for static proxies', () => {
    expect(PROXIES_PAGE_SRC).toContain('formProtocol');
    expect(PROXIES_PAGE_SRC).toContain('SOCKS5');
    expect(PROXIES_PAGE_SRC).toContain('handleProxyTypeChange');
    expect(PROXIES_PAGE_SRC).not.toContain('id="proxy-carrier"');
    expect(PROXIES_PAGE_SRC).not.toContain('id="bulk-proxy-carrier"');
    expect(PROXIES_PAGE_SRC).toContain('{isMobileProxy && (');
  });

  it('requires a proxy for imports and surfaces backend pre-flight errors', () => {
    expect(ACCOUNTS_PAGE_SRC).toContain('Выберите прокси для импорта');
    expect(ACCOUNTS_PAGE_SRC).toContain('рабочий прокси');
    expect(ACCOUNTS_PAGE_SRC).toContain('Тип прокси не блокирует старт задачи');
    expect(ACCOUNTS_PAGE_SRC).not.toContain('LTE mobile или Static residential');
    expect(ACCOUNTS_PAGE_SRC).toContain('Прокси для аккаунта *');
    expect(ACCOUNTS_PAGE_SRC).toContain('err instanceof ApiError ? err.message : "Ошибка запуска"');
    expect(ACCOUNTS_PAGE_SRC).not.toContain('Привязать прокси (опционально)');
  });

  it('shows a dead pinned proxy directly in the account table', () => {
    expect(ACCOUNTS_PAGE_SRC).toContain('acc.pinnedProxy?.status === "DEAD"');
    expect(ACCOUNTS_PAGE_SRC).toContain('Прокси недоступен');
  });

  it('explains that scheduled warmup remains active between browser sessions', () => {
    expect(ACCOUNTS_PAGE_SRC).toContain('Прогрев по расписанию');
    expect(ACCOUNTS_PAGE_SRC).toContain('активные browser-сессии чередуются с паузами');
    expect(ACCOUNTS_PAGE_SRC).toContain('Во время паузы монитор скрыт');
  });

  it('prevents upload selection for accounts whose warmup is incomplete', () => {
    expect(WORKSPACE_PAGE_SRC).toContain('isUploadReady');
    expect(WORKSPACE_PAGE_SRC).toContain('warmupCompletedAt');
    expect(WORKSPACE_PAGE_SRC).toContain('disabled={uploadUnavailable}');
    expect(WORKSPACE_PAGE_SRC).toContain('Прогрев идёт');
    expect(WORKSPACE_PAGE_SRC).toContain('Нужен прогрев');
  });

  it('surfaces partial launch failures and duplicate-safe skips', () => {
    expect(WORKSPACE_PAGE_SRC).toContain('result.warning');
    expect(WORKSPACE_PAGE_SRC).toContain('result.alreadyUploaded');
    expect(WORKSPACE_PAGE_SRC).toContain('Повторный залив не создан');
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
