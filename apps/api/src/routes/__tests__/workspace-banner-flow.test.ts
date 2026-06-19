import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const WORKSPACE_SRC = fs.readFileSync(
  path.resolve(__dirname, '../workspace.ts'),
  'utf-8',
);

describe('workspace upload banner source verification', () => {
  it('normalizes the no-banner select value before dispatch', () => {
    expect(WORKSPACE_SRC).toContain("rawBannerId !== 'none'");
    expect(WORKSPACE_SRC).toContain('const bannerId = rawBannerId');
  });

  it('rejects selected banners that no longer exist', () => {
    expect(WORKSPACE_SRC).toContain('Выбранный баннер не найден или файл удалён');
    expect(WORKSPACE_SRC).toContain('fs.existsSync(banner.filepath)');
    expect(WORKSPACE_SRC).toContain("status: 'FAILED'");
  });

  it('preserves the selected banner when videos are added to a running upload queue', () => {
    expect(WORKSPACE_SRC).toContain('queueBannerPath');
    expect(WORKSPACE_SRC).toContain('bannerPath: queueBannerPath');
  });
});
