import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();

  return {
    ...actual,
    rename: vi.fn(async (source: string, destination: string) => {
      if (!source.includes('/instances/') && destination.includes('/instances/')) {
        const error = new Error('cross-device link not permitted') as NodeJS.ErrnoException;
        error.code = 'EXDEV';
        throw error;
      }

      return actual.rename(source, destination);
    }),
  };
});

import { syncManagedSkills } from '../index';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true,
  })));
});

describe('syncManagedSkills EXDEV handling', () => {
  it('syncs managed skills when the target directory lives on a different filesystem', async () => {
    const harness = await createHarness({
      skills: {
        alpha: {
          'SKILL.md': '# Alpha',
        },
      },
      version: 'bundle-v1',
    });

    const result = await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });

    expect(result).toMatchObject({
      bundleVersion: 'bundle-v1',
      installedSkills: ['alpha'],
      status: 'success',
    });
    await expect(readFile(
      path.join(harness.instancesRoot, harness.botInstanceId, 'data', 'skills', 'alpha', 'SKILL.md'),
      'utf8',
    )).resolves.toBe('# Alpha');
  });
});

async function createHarness(input: {
  skills: Record<string, Record<string, string>>;
  version: string;
}) {
  const root = await mkdtemp(path.join(tmpdir(), 'weiling-managed-skills-exdev-'));
  const instancesRoot = path.join(root, 'instances');
  const bundleRoot = path.join(root, 'bundle');
  const botInstanceId = 'bot_1';

  tempDirs.push(root);

  await mkdir(instancesRoot, { recursive: true });
  await writeBundle(bundleRoot, input);

  return {
    botInstanceId,
    bundleRoot,
    instancesRoot,
  };
}

async function writeBundle(
  bundleRoot: string,
  input: {
    skills: Record<string, Record<string, string>>;
    version: string;
  },
) {
  await rm(bundleRoot, { force: true, recursive: true });
  await mkdir(bundleRoot, { recursive: true });

  const skills = Object.entries(input.skills).map(([name, files]) => ({
    files,
    name,
  }));

  await Promise.all(skills.map(async ({ files, name }) => {
    const skillRoot = path.join(bundleRoot, name);
    await mkdir(skillRoot, { recursive: true });

    await Promise.all(Object.entries(files).map(async ([relativePath, content]) => {
      const filePath = path.join(skillRoot, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }));
  }));

  await writeFile(path.join(bundleRoot, 'manifest.json'), JSON.stringify({
    skills: skills.map(({ name }) => ({
      name,
      path: name,
    })),
    version: input.version,
  }, null, 2));
}
