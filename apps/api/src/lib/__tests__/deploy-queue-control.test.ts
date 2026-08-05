import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');
const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/deploy.yml'), 'utf8');
const controlScript = fs.readFileSync(path.join(repoRoot, 'apps/api/src/scripts/deploy-queue-control.ts'), 'utf8');

describe('worker deployment queue coordination', () => {
  it('pauses all worker queues before waiting for active browser jobs', () => {
    const pauseIndex = workflow.indexOf('deploy-queue-control.js pause');
    const waitIndex = workflow.indexOf('for ATTEMPT in $(seq 1 60)');

    expect(pauseIndex).toBeGreaterThan(-1);
    expect(waitIndex).toBeGreaterThan(pauseIndex);
    expect(controlScript).toContain('uploadQueue');
    expect(controlScript).toContain('warmupQueue');
    expect(controlScript).toContain('analyticsCronQueue');
    expect(controlScript).toContain("queue.pause() : queue.resume()");
  });

  it('resumes queues both after success and through an EXIT trap', () => {
    expect(workflow).toContain('trap resume_worker_queues EXIT');
    expect(workflow).toContain('deploy-queue-control.js resume || true');
    expect(workflow).toContain('deploy-queue-control.js resume');
    expect(workflow).toContain('trap - EXIT');
  });
});
