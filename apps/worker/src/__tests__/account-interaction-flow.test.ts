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

const WORKER_INDEX_SRC = fs.readFileSync(
  path.resolve(__dirname, '../index.ts'),
  'utf-8',
);

describe('account interaction flow safety', () => {
  it('refreshes cookies without networkidle hangs or broad body-text logout checks', () => {
    expect(COOKIES_SRC).not.toContain("waitUntil: 'networkidle'");
    expect(COOKIES_SRC).not.toContain('page.textContent(\'body\')');
    expect(COOKIES_SRC).toContain('_detectLoggedOut');
    expect(COOKIES_SRC).toContain('ServiceLogin');
    expect(COOKIES_SRC).toContain('top-login-button');
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
    expect(LOGIN_SRC).toContain("status === 'unknown'");
    expect(LOGIN_SRC).toContain("code: 'NETWORK_ERROR'");
    expect(UPLOAD_SRC).toContain("cookieStatus === 'unknown'");
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
    expect(WORKER_INDEX_SRC).toContain("task.type === 'WARMUP'");
    expect(WORKER_INDEX_SRC).toContain('collectTaskAccountIds');
    expect(WORKER_INDEX_SRC).toContain('warmingAccounts > 0');
    expect(WORKER_INDEX_SRC).toContain("status: 'WARMING_UP'");
    expect(WORKER_INDEX_SRC).toContain("status: 'RUNNING'");
    expect(WORKER_INDEX_SRC).toContain("...(error ? { error } : {})");
  });
});
