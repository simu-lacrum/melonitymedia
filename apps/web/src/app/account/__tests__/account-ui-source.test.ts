import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const ACCOUNTS_PAGE_SRC = fs.readFileSync(
  path.resolve(__dirname, '../accounts/page.tsx'),
  'utf-8',
);

const WORKSPACE_PAGE_SRC = fs.readFileSync(
  path.resolve(__dirname, '../workspace/page.tsx'),
  'utf-8',
);

describe('account UI safety copy', () => {
  it('shows warmup progress in the account status instead of hiding it', () => {
    expect(ACCOUNTS_PAGE_SRC).toContain('warmupProgress');
    expect(ACCOUNTS_PAGE_SRC).toContain('acc.warmupDay');
    expect(ACCOUNTS_PAGE_SRC).toContain('Прогрев');
  });

  it('warns that hourly fast warmup is not upload readiness', () => {
    expect(WORKSPACE_PAGE_SRC).toContain('Быстрый тест (часы)');
    expect(WORKSPACE_PAGE_SRC).toContain('Он не открывает заливы');
    expect(WORKSPACE_PAGE_SRC).toContain('admin force');
  });
});
