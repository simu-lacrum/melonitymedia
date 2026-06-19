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

describe('account interaction flow safety', () => {
  it('refreshes cookies without networkidle hangs or broad body-text logout checks', () => {
    expect(COOKIES_SRC).not.toContain("waitUntil: 'networkidle'");
    expect(COOKIES_SRC).not.toContain('page.textContent(\'body\')');
    expect(COOKIES_SRC).toContain('_detectLoggedOut');
    expect(COOKIES_SRC).toContain('ServiceLogin');
    expect(COOKIES_SRC).toContain('top-login-button');
    expect(COOKIES_SRC).toContain("status: 'ALIVE' as const");
  });

  it('requires positive platform confirmation before upload success is accepted', () => {
    expect(UPLOAD_SRC).toContain('_waitForTikTokPublishConfirmation');
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

  it('does not treat hourly fast warmup as full upload readiness', () => {
    expect(WARMUP_SRC).toContain("status: 'PAUSED'");
    expect(WARMUP_SRC).toContain('warmupCompletedAt: null');
    expect(WARMUP_SRC).toContain('быстрый режим не открывает upload-gate');
  });
});
