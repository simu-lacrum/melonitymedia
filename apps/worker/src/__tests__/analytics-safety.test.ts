import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ANALYTICS_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../handlers/analytics.ts'),
  'utf8',
);
const LAUNCHER_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../core/browser/patchright-launcher.ts'),
  'utf8',
);

describe('analytics collection safety', () => {
  it('fans out to connected alive and warming accounts using one daily key', () => {
    expect(ANALYTICS_SOURCE).toContain("status: { in: ['ALIVE', 'WARMING_UP'] }");
    expect(ANALYTICS_SOURCE).toContain('cookiesEncrypted: { not: null }');
    expect(ANALYTICS_SOURCE).toContain("pinnedProxy: { is: { status: 'ACTIVE' } }");
    expect(ANALYTICS_SOURCE).toContain('jobId: `analytics-${acc.id}-${collectionKey}`');
  });

  it('defers around account and proxy locks instead of returning fake zero stats', () => {
    expect(ANALYTICS_SOURCE).toContain("_deferAnalytics(job, data, 'ACCOUNT_BUSY'");
    expect(ANALYTICS_SOURCE).toContain("_deferAnalytics(job, data, 'PROXY_BUSY'");
    expect(ANALYTICS_SOURCE).toContain("_deferAnalytics(job, data, 'TRANSIENT_PLATFORM'");
    expect(ANALYTICS_SOURCE).toContain('proxyLockWaitMs: 0');
    expect(ANALYTICS_SOURCE).not.toContain('return _emptyStats()');
    expect(LAUNCHER_SOURCE).toContain('opts.proxyLockWaitMs');
  });

  it('reads the real Studio Shorts table and fails closed when counters are unavailable', () => {
    expect(ANALYTICS_SOURCE).toContain('/videos/short`');
    expect(ANALYTICS_SOURCE).toContain("row.querySelector('.tablecell-views')");
    expect(ANALYTICS_SOURCE).toContain("stats.viewsSource = 'studio_content'");
    expect(ANALYTICS_SOURCE).not.toContain('youtube.com/@me/videos');
    expect(ANALYTICS_SOURCE).toContain('throw new UnrecoverableError');
    expect(ANALYTICS_SOURCE).toContain('refusing to write a false daily snapshot');
    expect(ANALYTICS_SOURCE).toContain('TRANSIENT_RETRY_DELAY_MS = 2 * 60 * 60 * 1000');
  });
});
