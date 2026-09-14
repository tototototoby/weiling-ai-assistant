import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('AGPL network source offer', () => {
  it('keeps a visible, configurable source link in the root layout', async () => {
    const layoutPath = fileURLToPath(new URL('../layout.tsx', import.meta.url));
    const source = await readFile(layoutPath, 'utf8');

    expect(source).toContain('WEILING_SOURCE_CODE_URL');
    expect(source).toContain('https://github.com/totototoby/weiling-ai-assistant');
    expect(source).toContain('获取源码 · AGPL-3.0');
  });
});
