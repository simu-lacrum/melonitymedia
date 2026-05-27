import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const WORKER_ROOT = path.resolve(__dirname, '../..');
const DOCKERFILE = fs.readFileSync(path.join(WORKER_ROOT, 'Dockerfile'), 'utf-8');
const ENTRYPOINT = fs.readFileSync(path.join(WORKER_ROOT, 'entrypoint.sh'), 'utf-8');

// docker-compose is at repo root
const COMPOSE = fs.readFileSync(path.join(WORKER_ROOT, '../../docker-compose.yml'), 'utf-8');

describe('Dockerfile source verification', () => {
  // ── BUG 8: curl-impersonate fork ──────────────────────────
  describe('curl-impersonate version (BUG 8 regression)', () => {
    it('uses lexiforest fork, not lwthiker', () => {
      expect(DOCKERFILE).toContain('lexiforest/curl-impersonate');
      expect(DOCKERFILE).not.toContain('lwthiker/curl-impersonate');
    });

    it('uses v0.7.1 or later', () => {
      expect(DOCKERFILE).toContain('v0.7.1');
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

describe('entrypoint.sh source verification (BUG 12)', () => {
  it('starts Xvfb explicitly', () => {
    expect(ENTRYPOINT).toContain('Xvfb :99');
  });

  it('sets DISPLAY=:99', () => {
    expect(ENTRYPOINT).toContain('DISPLAY=:99');
  });

  it('verifies Xvfb readiness via xdpyinfo', () => {
    expect(ENTRYPOINT).toContain('xdpyinfo');
  });

  it('exits on Xvfb failure', () => {
    expect(ENTRYPOINT).toContain('exit 1');
  });
});

describe('docker-compose.yml (BUG 12)', () => {
  it('grants SYS_ADMIN capability to worker', () => {
    expect(COMPOSE).toContain('SYS_ADMIN');
  });

  it('sets shm_size for Chrome stability', () => {
    expect(COMPOSE).toContain('shm_size');
  });
});
