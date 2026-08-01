import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const UPLOAD_SRC = fs.readFileSync(
  path.resolve(__dirname, '../handlers/upload.ts'),
  'utf-8',
);

const WORKER_SRC = fs.readFileSync(
  path.resolve(__dirname, '../index.ts'),
  'utf-8',
);

describe('YouTube Studio upload safety', () => {
  it('targets the exact visible metadata field even when Studio repeats #textbox ids', () => {
    expect(UPLOAD_SRC).toContain("node.setAttribute('data-melonity-target', value)");
    expect(UPLOAD_SRC).toContain('ytcp-uploads-dialog #title-textarea #textbox');
    expect(UPLOAD_SRC).toContain('ytcp-uploads-dialog #description-textarea #textbox');
    expect(UPLOAD_SRC).not.toContain('return `#${actualId}`');
  });

  it('dismisses the first-visit Studio dialog through its web-component action', () => {
    expect(UPLOAD_SRC).toContain('_dismissYouTubeStudioWelcome');
    expect(UPLOAD_SRC).toContain('Welcome to YouTube Studio');
    expect(UPLOAD_SRC).toContain('button, ytcp-button, tp-yt-paper-button');
  });

  it('never substitutes Escape or Enter for upload-dialog actions', () => {
    expect(UPLOAD_SRC).not.toContain("page.keyboard.press('Escape'");
    expect(UPLOAD_SRC).not.toContain("page.keyboard.press('Enter'");
    expect(UPLOAD_SRC).not.toContain('Publish через Enter');
  });

  it('requires a visible enabled Studio publish button and hard evidence of publication', () => {
    expect(UPLOAD_SRC).toContain("'ytcp-uploads-dialog #done-button'");
    expect(UPLOAD_SRC).toContain('_waitForEnabledSelector');
    expect(UPLOAD_SRC).toContain('hasPublishedText && hasShareLink');
    expect(UPLOAD_SRC).toContain('new UnrecoverableError');
    expect(UPLOAD_SRC).toContain('undefined, { timeout: 45_000 }');
  });

  it('treats uncertain post-click results as terminal to avoid duplicate retries', () => {
    expect(WORKER_SRC).toContain("err.name === 'UnrecoverableError'");
    expect(WORKER_SRC).toContain('isUnrecoverable || job.attemptsMade >= maxAttempts');
  });
});
