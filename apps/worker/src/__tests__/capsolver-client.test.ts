import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('capsolver-client', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CAPSOLVER_API_KEY = 'test_key';
  });

  it('throws when CAPSOLVER_API_KEY not set', async () => {
    delete process.env.CAPSOLVER_API_KEY;
    const { solveCaptcha } = await import('../core/captcha/capsolver-client.js');
    await expect(solveCaptcha({
      type: 'tiktok',
      websiteURL: 'https://www.tiktok.com/upload',
      proxyUrl: 'http://u:p@host:8080',
      userAgent: 'Mozilla/5.0',
    })).rejects.toThrow(/CAPSOLVER_API_KEY not set/);
  });

  it('parses slider solution from {x, y}', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ errorId: 0, taskId: 'task-123' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ errorId: 0, status: 'ready', solution: { x: 142, y: 0 } }) });
    global.fetch = fetchMock as any;

    const { solveCaptcha } = await import('../core/captcha/capsolver-client.js');
    const result = await solveCaptcha({
      type: 'tiktok',
      websiteURL: 'https://www.tiktok.com/upload',
      proxyUrl: 'http://u:p@host:8080',
      userAgent: 'Mozilla/5.0',
      challengeType: 'slide',
      bodyImage: 'AAAA',
      pieceImage: 'BBBB',
    });

    expect(result).toEqual({ kind: 'slider', x: 142, y: 0 });
  });

  it('parses whirl solution from {angle}', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ errorId: 0, taskId: 't2' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ errorId: 0, status: 'ready', solution: { angle: 87 } }) });
    global.fetch = fetchMock as any;

    const { solveCaptcha } = await import('../core/captcha/capsolver-client.js');
    const result = await solveCaptcha({
      type: 'tiktok',
      websiteURL: 'https://www.tiktok.com',
      proxyUrl: 'http://u:p@host:8080',
      userAgent: 'Mozilla/5.0',
      challengeType: 'whirl',
    });

    expect(result).toEqual({ kind: 'whirl', angle: 87 });
  });

  it('throws on CapSolver error response', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ errorId: 1, errorCode: 'INVALID_KEY', errorDescription: 'bad key' }) });
    global.fetch = fetchMock as any;

    const { solveCaptcha } = await import('../core/captcha/capsolver-client.js');
    await expect(solveCaptcha({
      type: 'tiktok',
      websiteURL: 'https://www.tiktok.com',
      proxyUrl: 'http://u:p@host:8080',
      userAgent: 'Mozilla/5.0',
    })).rejects.toThrow(/INVALID_KEY/);
  });
});
