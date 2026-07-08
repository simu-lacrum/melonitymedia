import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const WORKER_ROOT = path.resolve(__dirname, '../..');
const DOCKERFILE = fs.readFileSync(path.join(WORKER_ROOT, 'Dockerfile'), 'utf-8');
const ENTRYPOINT = fs.readFileSync(path.join(WORKER_ROOT, 'entrypoint.sh'), 'utf-8');
const PATCHRIGHT_LAUNCHER = fs.readFileSync(path.join(WORKER_ROOT, 'src/core/browser/patchright-launcher.ts'), 'utf-8');
const WORKER_INDEX = fs.readFileSync(path.join(WORKER_ROOT, 'src/index.ts'), 'utf-8');
const EDIT_PROFILE_HANDLER = fs.readFileSync(path.join(WORKER_ROOT, 'src/handlers/edit-profile.ts'), 'utf-8');

// docker-compose is at repo root
const COMPOSE = fs.readFileSync(path.join(WORKER_ROOT, '../../docker-compose.yml'), 'utf-8');

describe('Dockerfile source verification', () => {
  // ── BUG 8: curl-impersonate fork ──────────────────────────
  describe('curl-impersonate version (BUG 8 regression)', () => {
    it('uses lexiforest fork, not lwthiker', () => {
      expect(DOCKERFILE).toContain('lexiforest/curl-impersonate');
      expect(DOCKERFILE).not.toContain('lwthiker/curl-impersonate');
    });

    it('uses v1.1.0 or later', () => {
      expect(DOCKERFILE).toContain('v1.1.0');
      expect(DOCKERFILE).not.toContain('v0.6.1');
    });
  });

  // ── BUG 12: Xvfb readiness ───────────────────────────────
  describe('Dockerfile X11 packages', () => {
    it('includes x11-utils for xdpyinfo', () => {
      expect(DOCKERFILE).toContain('x11-utils');
    });
  });
});

describe('automation dependency policy', () => {
  it('does not import forbidden browser automation stacks', () => {
    const forbiddenImport = /\b(?:import|require)\s*(?:\(|[^'"]*from\s*)['"](puppeteer|selenium-webdriver|undetected-chromedriver(?:-js)?)['"]/;
    const stack = [path.join(WORKER_ROOT, 'src')];
    const files: string[] = [];

    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(fullPath);
        if (entry.isFile() && /\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) files.push(fullPath);
      }
    }

    for (const file of files) {
      expect(fs.readFileSync(file, 'utf-8')).not.toMatch(forbiddenImport);
    }
  });
});

describe('dynamic GUI source verification', () => {
  it('keeps entrypoint focused on the worker process', () => {
    expect(ENTRYPOINT).not.toContain('Xvfb :99');
    expect(ENTRYPOINT).toContain('exec node dist/index.js');
  });

  it('starts Xvfb per browser job', () => {
    expect(PATCHRIGHT_LAUNCHER).toContain("spawn('Xvfb'");
    expect(PATCHRIGHT_LAUNCHER).toContain('displayConfig.display');
  });

  it('starts x11vnc without daemonizing away from the tracked process', () => {
    expect(PATCHRIGHT_LAUNCHER).toContain("spawn('x11vnc'");
    expect(PATCHRIGHT_LAUNCHER).not.toContain("'-bg'");
  });

  it('builds VNC URL from environment-driven public host settings', () => {
    expect(PATCHRIGHT_LAUNCHER).toContain('VNC_PUBLIC_HOST');
    expect(PATCHRIGHT_LAUNCHER).not.toContain('melonitymedia.site');
  });

  it('registers owner-scoped VNC sessions for task monitors', () => {
    expect(PATCHRIGHT_LAUNCHER).toContain('prisma.vncSession.upsert');
    expect(PATCHRIGHT_LAUNCHER).toContain('taskId_jobId');
    expect(PATCHRIGHT_LAUNCHER).toContain('/api/workspace/jobs/');
  });

  it('refuses to launch non-login browser jobs with an empty cookie jar', () => {
    expect(PATCHRIGHT_LAUNCHER).toContain("const requireCookies = opts.jobType !== 'login'");
    expect(PATCHRIGHT_LAUNCHER).toContain('empty cookie jar after disk cache and DB fallback');
    expect(PATCHRIGHT_LAUNCHER).not.toContain('Continue without cookies');
  });

  it('refuses to launch browser jobs without a pinned proxy', () => {
    expect(PATCHRIGHT_LAUNCHER).toContain('no pinned proxy');
    expect(PATCHRIGHT_LAUNCHER).toContain('Pin a proxy first');
    expect(PATCHRIGHT_LAUNCHER).not.toContain('Pin an LTE_MOBILE or STATIC_RESIDENTIAL proxy first');
    expect(PATCHRIGHT_LAUNCHER).not.toContain('using direct connection');
  });

  it('fails SOCKS proxy auth before browser launch with a specific error', () => {
    expect(PATCHRIGHT_LAUNCHER).toContain('function assertProxySupportedByBrowser');
    expect(PATCHRIGHT_LAUNCHER).toContain('SOCKS proxy authentication is not supported');
    expect(PATCHRIGHT_LAUNCHER).toContain('use SOCKS without username/password');
  });
});

describe('task state truthfulness', () => {
  it('does not leave a failed warmup account visually stuck in WARMING_UP', () => {
    expect(WORKER_INDEX).toContain('function getJobAccountId');
    expect(WORKER_INDEX).toContain("task.type === 'WARMUP'");
    expect(WORKER_INDEX).toContain('if (hasFailed)');
    expect(WORKER_INDEX).toContain("status: 'WARMING_UP'");
    expect(WORKER_INDEX).toContain("status: 'ALIVE'");
    expect(WORKER_INDEX).toContain("lastError: error ?? 'Warmup job failed'");
  });

  it('fails edit-profile jobs instead of reporting success after skipped changes', () => {
    expect(EDIT_PROFILE_HANDLER).toContain('No profile changes requested');
    expect(EDIT_PROFILE_HANDLER).toContain('Avatar source unavailable');
    expect(EDIT_PROFILE_HANDLER).toContain('TikTok bio update failed');
    expect(EDIT_PROFILE_HANDLER).toContain('TikTok profile save failed: save button not found');
    expect(EDIT_PROFILE_HANDLER).toContain('YouTube avatar upload flow did not reach a confirmed upload/save step');
    expect(EDIT_PROFILE_HANDLER).toContain('YouTube profile description update failed');
    expect(EDIT_PROFILE_HANDLER).not.toContain("don't fail the whole job");
  });
});

describe('docker-compose.yml (BUG 12)', () => {
  it('grants SYS_ADMIN capability to worker', () => {
    expect(COMPOSE).toContain('SYS_ADMIN');
  });

  it('sets shm_size for Chrome stability', () => {
    expect(COMPOSE).toContain('shm_size');
  });

  it('does not publish VNC monitor ports publicly', () => {
    expect(COMPOSE).not.toContain('"6000-6020:6000-6020"');
    expect(COMPOSE).not.toContain("'6000-6020:6000-6020'");
  });
});
