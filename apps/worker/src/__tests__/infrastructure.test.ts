import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const WORKER_ROOT = path.resolve(__dirname, '../..');
const DOCKERFILE = fs.readFileSync(path.join(WORKER_ROOT, 'Dockerfile'), 'utf-8');
const ENTRYPOINT = fs.readFileSync(path.join(WORKER_ROOT, 'entrypoint.sh'), 'utf-8');
const PATCHRIGHT_LAUNCHER = fs.readFileSync(path.join(WORKER_ROOT, 'src/core/browser/patchright-launcher.ts'), 'utf-8');

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
