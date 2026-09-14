import { access, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const MANAGED_ROOT = new URL('../../../../../resources/skills/managed/', import.meta.url);

describe('managed Skill distribution boundary', () => {
  it('does not bundle the externally installed presentation Skill', async () => {
    const [index, manifest] = await Promise.all([
      readJson('index.json'),
      readJson('manifest.json'),
    ]);
    const names = [
      ...index.skills.map((entry) => entry.name),
      ...manifest.skills.map((entry) => entry.name),
    ];

    expect(names).not.toContain('ppt-skill');
    expect(names).not.toContain('gaozhiling-ppt');
    await expect(access(new URL('ppt-skill/', MANAGED_ROOT))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function readJson(relativePath: string) {
  return JSON.parse(await readFile(new URL(relativePath, MANAGED_ROOT), 'utf8')) as {
    skills: Array<{ name: string }>;
  };
}
