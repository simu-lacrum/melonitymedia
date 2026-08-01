import { describe, expect, it } from 'vitest';
import { classifyError } from '../lib/error-classifier.js';

describe('classifyError', () => {
  it('explains a blocked YouTube Studio field instead of reporting an unknown error', () => {
    const result = classifyError(
      'Не удалось заполнить заголовок YouTube Studio: Не удалось найти видимое поле заголовка YouTube Studio',
      'upload',
    );

    expect(result.code).toBe('SELECTOR_NOT_FOUND');
    expect(result.title).toBe('Интерфейс YouTube Studio не готов');
    expect(result.advice).toContain('VNC-монитор');
  });

  it('warns users to verify Studio before retrying an unconfirmed publication', () => {
    const result = classifyError(
      'YouTube Studio не подтвердил публикацию Shorts. Повторный автоматический залив отключён.',
      'upload',
    );

    expect(result.code).toBe('UPLOAD_TIMEOUT');
    expect(result.title).toBe('Публикация не подтверждена');
    expect(result.advice).toContain('Не запускайте тот же ролик повторно');
  });

  it('explains SOCKS proxy authentication incompatibility without banning proxy types', () => {
    const result = classifyError(
      '[Patchright] SOCKS proxy authentication is not supported by Chromium/Patchright for login jobs.',
      'login',
    );

    expect(result.code).toBe('PROXY_ERROR');
    expect(result.title).toBe('Прокси несовместим с браузером');
    expect(result.message).toContain('SOCKS-прокси');
    expect(result.advice).toContain('любой привязанный прокси');
    expect(result.advice).toContain('HTTP endpoint');
  });

  it('explains that a failed warmup keeps completed session progress', () => {
    const result = classifyError(
      'Warmup navigation failed after 3 attempts: page.goto: Timeout 30000ms exceeded',
      'warmup',
    );

    expect(result.code).toBe('PAGE_TIMEOUT');
    expect(result.title).toBe('Прогрев остановлен');
    expect(result.message).toContain('Завершённые дни и сессии сохранены');
    expect(result.advice).toContain('с сохранённого дня');
  });
});
