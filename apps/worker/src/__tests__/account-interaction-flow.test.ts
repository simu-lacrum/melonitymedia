import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const UPLOAD_SRC = fs.readFileSync(
  path.resolve(__dirname, '../handlers/upload.ts'),
  'utf-8',
);

const COOKIES_SRC = fs.readFileSync(
  path.resolve(__dirname, '../handlers/cookies.ts'),
  'utf-8',
);

const WARMUP_SRC = fs.readFileSync(
  path.resolve(__dirname, '../handlers/warmup.ts'),
  'utf-8',
);

const LOGIN_SRC = fs.readFileSync(
  path.resolve(__dirname, '../handlers/login.ts'),
  'utf-8',
);

const SESSION_VALIDATOR_SRC = fs.readFileSync(
  path.resolve(__dirname, '../core/auth/session-validator.ts'),
  'utf-8',
);

const CURL_CLIENT_SRC = fs.readFileSync(
  path.resolve(__dirname, '../core/tls/curl-impersonate-client.ts'),
  'utf-8',
);

const BROWSER_SESSION_SRC = fs.readFileSync(
  path.resolve(__dirname, '../core/auth/browser-session.ts'),
  'utf-8',
);

const WORKER_INDEX_SRC = fs.readFileSync(
  path.resolve(__dirname, '../index.ts'),
  'utf-8',
);

describe('account interaction flow safety', () => {
  it('refreshes cookies without networkidle hangs or broad body-text logout checks', () => {
    expect(COOKIES_SRC).not.toContain("waitUntil: 'networkidle'");
    expect(COOKIES_SRC).not.toContain('page.textContent(\'body\')');
    expect(COOKIES_SRC).toContain('confirmBrowserSession(page, ctxAcc.platform, 2)');
    expect(BROWSER_SESSION_SRC).toContain('ServiceLogin');
    expect(BROWSER_SESSION_SRC).toContain('top-login-button');
    expect(BROWSER_SESSION_SRC).toContain('exactVisibleText');
    expect(BROWSER_SESSION_SRC).toContain("['Log in', 'Sign in', 'Войти']");
    expect(BROWSER_SESSION_SRC).toContain("checks.every((check) => check.state === 'logged_out')");
    expect(COOKIES_SRC).toContain("status: 'ALIVE' as const");
  });

  it('logs in without relying on networkidle for auth page navigation', () => {
    expect(LOGIN_SRC).toContain("ctx.platform === 'YOUTUBE' ? 'load' as const : 'domcontentloaded' as const");
    expect(LOGIN_SRC).toContain('timeout: 45_000');
    expect(LOGIN_SRC).not.toContain("await page.goto(loginUrl, { waitUntil: waitStrategy });");
  });

  it('does not verify cookie imports as ALIVE on inconclusive network checks', () => {
    expect(SESSION_VALIDATOR_SRC).toContain("export type CookieStatus = 'alive' | 'expired' | 'banned' | 'unknown'");
    expect(SESSION_VALIDATOR_SRC).toContain("return 'unknown'");
    expect(LOGIN_SRC).toContain("browserCheck.state === 'unknown'");
    expect(LOGIN_SRC).toContain('Сохранённые cookies не изменены');
    expect(LOGIN_SRC).toContain('data.previousStatus');
    expect(LOGIN_SRC).toContain("code: 'NETWORK_ERROR'");
    expect(UPLOAD_SRC).toContain("cookieStatus === 'unknown'");
  });

  it('never propagates curl arguments containing cookies or proxy credentials', () => {
    expect(CURL_CLIENT_SRC).toContain('execFile errors include the full argv');
    expect(CURL_CLIENT_SRC).toContain('curl-impersonate request failed');
    expect(CURL_CLIENT_SRC).not.toContain('throw err;');
    expect(SESSION_VALIDATOR_SRC).not.toContain('(err as Error).message');
  });

  it('does not retry a browser-confirmed logout', () => {
    expect(COOKIES_SRC).toContain("throw new UnrecoverableError('COOKIES_EXPIRED')");
    expect(LOGIN_SRC).toContain('throw new UnrecoverableError(err.message)');
  });

  it('requires positive platform confirmation before upload success is accepted', () => {
    expect(UPLOAD_SRC).toContain('_waitForTikTokPublishConfirmation');
    expect(UPLOAD_SRC).toContain('_ensureTikTokPublicVisibility');
    expect(UPLOAD_SRC).toContain('Public/Everyone');
    expect(UPLOAD_SRC).toContain('TikTok не подтвердил публикацию видео');
    expect(UPLOAD_SRC).toContain('YouTube Studio не подтвердил публикацию Shorts');
    expect(UPLOAD_SRC).not.toContain('но дошли до конца flow');
  });

  it('fails loudly when publish controls or required metadata fields are missing', () => {
    expect(UPLOAD_SRC).toContain('postClicked');
    expect(UPLOAD_SRC).toContain('Не удалось найти и нажать кнопку публикации TikTok');
    expect(UPLOAD_SRC).toContain('Не удалось заполнить описание TikTok');
    expect(UPLOAD_SRC).toContain('Не удалось заполнить заголовок YouTube Studio');
  });

  it('honors user-selected hourly warmup as upload readiness', () => {
    expect(WARMUP_SRC).toContain("status: 'ALIVE'");
    expect(WARMUP_SRC).toContain('warmupCompletedAt: new Date()');
    expect(WARMUP_SRC).toContain('lastError: null');
    expect(WARMUP_SRC).toContain('Ускоренный прогрев');
  });

  it('keeps parent warmup tasks running while self-rescheduled sessions remain', () => {
    expect(WARMUP_SRC).toContain('_trackNextWarmupJob(data.taskId, nextJobId)');
    expect(WARMUP_SRC).toContain('bullmqJobId: jobId');
    expect(WORKER_INDEX_SRC).toContain("task.type === 'WARMUP'");
    expect(WORKER_INDEX_SRC).toContain('collectTaskAccountIds');
    expect(WORKER_INDEX_SRC).toContain('warmingAccounts > 0');
    expect(WORKER_INDEX_SRC).toContain('completedAccounts === accountIds.length');
    expect(WORKER_INDEX_SRC).toContain("status: 'WARMING_UP'");
    expect(WORKER_INDEX_SRC).toContain("status: 'RUNNING'");
    expect(WORKER_INDEX_SRC).toContain("...(error ? { error } : {})");
  });
});
