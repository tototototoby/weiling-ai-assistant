import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acquireManagedSkillsLock,
  readManagedSkillMarker,
  resolveManagedSkillsLockPath,
  resolveManagedSkillsPaths,
  syncManagedSkills,
} from '../index';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true,
  })));
});

describe('syncManagedSkills', () => {
  it('installs only explicitly enabled managed skills', async () => {
    const harness = await createHarness({
      skills: {
        alpha: { 'SKILL.md': '# Alpha' },
        beta: { 'SKILL.md': '# Beta' },
      },
      version: 'bundle-v1',
    });

    const result = await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      enabledSkillNames: ['beta'],
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });

    expect(result).toMatchObject({
      installedSkills: ['beta'],
      status: 'success',
    });
    await expect(pathExists(path.join(
      resolveManagedSkillsPaths(harness.instancesRoot, harness.botInstanceId).skillsDir,
      'alpha',
    ))).resolves.toBe(false);
    await expect(readSkillFile(
      harness.instancesRoot,
      harness.botInstanceId,
      'beta',
      'SKILL.md',
    )).resolves.toBe('# Beta');
    await expectManagedSkills(harness.instancesRoot, harness.botInstanceId, ['beta']);
  });

  it('removes newly disabled managed skills without touching user-owned skills', async () => {
    const harness = await createHarness({
      skills: {
        alpha: { 'SKILL.md': '# Alpha managed' },
        beta: { 'SKILL.md': '# Beta managed' },
      },
      version: 'bundle-v1',
    });
    const managedPaths = resolveManagedSkillsPaths(harness.instancesRoot, harness.botInstanceId);

    await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });
    await mkdir(path.join(managedPaths.skillsDir, 'user-only'), { recursive: true });
    await writeFile(path.join(managedPaths.skillsDir, 'user-only', 'SKILL.md'), '# User');

    const result = await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      enabledSkillNames: ['beta'],
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });

    expect(result).toMatchObject({
      removedSkills: ['alpha'],
      status: 'success',
      updatedSkills: ['beta'],
    });
    await expect(pathExists(path.join(managedPaths.skillsDir, 'alpha'))).resolves.toBe(false);
    await expect(readSkillFile(
      harness.instancesRoot,
      harness.botInstanceId,
      'user-only',
      'SKILL.md',
    )).resolves.toBe('# User');
    await expectManagedSkills(harness.instancesRoot, harness.botInstanceId, ['beta']);
  });

  it('installs all managed skills into an empty target directory and writes metadata', async () => {
    const harness = await createHarness({
      skills: {
        alpha: {
          'SKILL.md': '# Alpha',
        },
        beta: {
          'SKILL.md': '# Beta',
          'notes.txt': 'beta',
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
      installedSkills: ['alpha', 'beta'],
      skippedConflicts: [],
      status: 'success',
      updatedSkills: [],
    });
    await expect(readSkillFile(harness.instancesRoot, harness.botInstanceId, 'alpha', 'SKILL.md')).resolves.toBe('# Alpha');
    await expect(readSkillFile(harness.instancesRoot, harness.botInstanceId, 'beta', 'notes.txt')).resolves.toBe('beta');
    await expectManagedSkills(harness.instancesRoot, harness.botInstanceId, ['alpha', 'beta']);
    await expect(readManagedSkillMarker(
      path.join(resolveManagedSkillsPaths(harness.instancesRoot, harness.botInstanceId).skillsDir, 'alpha'),
    )).resolves.toMatchObject({
      bundleVersion: 'bundle-v1',
      skillName: 'alpha',
    });
  });

  it('updates existing managed skills in place when the bundle version changes', async () => {
    const harness = await createHarness({
      skills: {
        alpha: {
          'SKILL.md': '# Alpha v1',
        },
      },
      version: 'bundle-v1',
    });

    await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });
    await writeBundle(harness.bundleRoot, {
      skills: {
        alpha: {
          'SKILL.md': '# Alpha v2',
        },
      },
      version: 'bundle-v2',
    });

    const result = await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });

    expect(result).toMatchObject({
      bundleVersion: 'bundle-v2',
      status: 'success',
      updatedSkills: ['alpha'],
    });
    await expect(readSkillFile(harness.instancesRoot, harness.botInstanceId, 'alpha', 'SKILL.md')).resolves.toBe('# Alpha v2');
    await expectManagedSkills(harness.instancesRoot, harness.botInstanceId, ['alpha']);
  });

  it('skips user-installed conflicting skills without overwriting them', async () => {
    const harness = await createHarness({
      skills: {
        alpha: {
          'SKILL.md': '# Alpha managed',
        },
        beta: {
          'SKILL.md': '# Beta managed',
        },
      },
      version: 'bundle-v1',
    });
    const managedPaths = resolveManagedSkillsPaths(harness.instancesRoot, harness.botInstanceId);

    await mkdir(path.join(managedPaths.skillsDir, 'alpha'), { recursive: true });
    await writeFile(path.join(managedPaths.skillsDir, 'alpha', 'SKILL.md'), '# Alpha user');

    const result = await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });

    expect(result).toMatchObject({
      installedSkills: ['beta'],
      skippedConflicts: ['alpha'],
      status: 'success',
    });
    await expect(readSkillFile(harness.instancesRoot, harness.botInstanceId, 'alpha', 'SKILL.md')).resolves.toBe('# Alpha user');
    await expect(readSkillFile(harness.instancesRoot, harness.botInstanceId, 'beta', 'SKILL.md')).resolves.toBe('# Beta managed');
    await expectManagedSkills(harness.instancesRoot, harness.botInstanceId, ['beta']);
  });

  it('removes retired managed skills without touching unknown sibling directories', async () => {
    const harness = await createHarness({
      skills: {
        alpha: {
          'SKILL.md': '# Alpha',
        },
        beta: {
          'SKILL.md': '# Beta',
        },
      },
      version: 'bundle-v1',
    });

    await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });

    const managedPaths = resolveManagedSkillsPaths(harness.instancesRoot, harness.botInstanceId);
    await mkdir(path.join(managedPaths.skillsDir, 'user-only'), { recursive: true });
    await writeFile(path.join(managedPaths.skillsDir, 'user-only', 'SKILL.md'), '# User');

    await writeBundle(harness.bundleRoot, {
      skills: {
        alpha: {
          'SKILL.md': '# Alpha next',
        },
      },
      version: 'bundle-v2',
    });

    const result = await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });

    expect(result).toMatchObject({
      removedSkills: ['beta'],
      status: 'success',
      updatedSkills: ['alpha'],
    });
    await expect(readSkillFile(harness.instancesRoot, harness.botInstanceId, 'alpha', 'SKILL.md')).resolves.toBe('# Alpha next');
    await expect(readSkillFile(harness.instancesRoot, harness.botInstanceId, 'user-only', 'SKILL.md')).resolves.toBe('# User');
    await expect(pathExists(path.join(managedPaths.skillsDir, 'beta'))).resolves.toBe(false);
    await expectManagedSkills(harness.instancesRoot, harness.botInstanceId, ['alpha']);
  });

  it('repairs global metadata from ownership markers when metadata is missing', async () => {
    const harness = await createHarness({
      skills: {
        alpha: {
          'SKILL.md': '# Alpha',
        },
      },
      version: 'bundle-v1',
    });

    await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });

    await unlink(resolveManagedSkillsPaths(harness.instancesRoot, harness.botInstanceId).metadataPath);
    const result = await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });

    expect(result.status).toBe('success');
    await expectManagedSkills(harness.instancesRoot, harness.botInstanceId, ['alpha']);
  });

  it('keeps managed ownership when metadata write fails and repairs metadata on the next sync', async () => {
    const harness = await createHarness({
      skills: {
        alpha: {
          'SKILL.md': '# Alpha v1',
        },
      },
      version: 'bundle-v1',
    });

    await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });

    await writeBundle(harness.bundleRoot, {
      skills: {
        alpha: {
          'SKILL.md': '# Alpha v2',
        },
      },
      version: 'bundle-v2',
    });

    const managedPaths = resolveManagedSkillsPaths(harness.instancesRoot, harness.botInstanceId);
    await rm(managedPaths.metadataPath, { force: true, recursive: true });
    await mkdir(managedPaths.metadataPath, { recursive: true });

    const failedResult = await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });

    expect(failedResult).toMatchObject({
      bundleVersion: 'bundle-v2',
      status: 'error',
    });
    await expect(readSkillFile(harness.instancesRoot, harness.botInstanceId, 'alpha', 'SKILL.md')).resolves.toBe('# Alpha v2');
    await expect(readManagedSkillMarker(
      path.join(managedPaths.skillsDir, 'alpha'),
    )).resolves.toMatchObject({
      bundleVersion: 'bundle-v2',
      skillName: 'alpha',
    });

    await rm(managedPaths.metadataPath, { force: true, recursive: true });

    const repairedResult = await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });

    expect(repairedResult.status).toBe('success');
    await expectManagedSkills(harness.instancesRoot, harness.botInstanceId, ['alpha']);
  });

  it('preserves existing metadata ownership snapshots when the manifest becomes invalid', async () => {
    const harness = await createHarness({
      skills: {
        alpha: {
          'SKILL.md': '# Alpha',
        },
      },
      version: 'bundle-v1',
    });

    await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });

    const managedPaths = resolveManagedSkillsPaths(harness.instancesRoot, harness.botInstanceId);
    await rm(path.join(managedPaths.skillsDir, 'alpha', '.weclaws-managed-skill.json'), { force: true });
    await writeFile(path.join(harness.bundleRoot, 'manifest.json'), '{');

    const result = await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });

    expect(result.status).toBe('error');
    await expectManagedSkills(harness.instancesRoot, harness.botInstanceId, ['alpha']);
  });

  it('rejects manifest entries whose source path escapes the managed bundle root', async () => {
    const harness = await createHarness({
      skills: {
        alpha: {
          'SKILL.md': '# Alpha',
        },
      },
      version: 'bundle-v1',
    });
    const escapedSkillRoot = path.join(path.dirname(harness.bundleRoot), 'escaped-skill');

    await mkdir(escapedSkillRoot, { recursive: true });
    await writeFile(path.join(escapedSkillRoot, 'SKILL.md'), '# Escaped');
    await writeManifest(harness.bundleRoot, {
      skills: [{
        name: 'escaped-skill',
        path: 'nested/../../escaped-skill',
      }],
      version: 'bundle-v1',
    });

    const result = await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });

    expect(result).toMatchObject({
      error: {
        code: 'MANIFEST_INVALID',
      },
      status: 'error',
    });
    await expect(pathExists(
      path.join(resolveManagedSkillsPaths(harness.instancesRoot, harness.botInstanceId).skillsDir, 'escaped-skill'),
    )).resolves.toBe(false);
  });

  it('rejects manifest entries whose skill name escapes the managed target directory', async () => {
    const harness = await createHarness({
      skills: {
        alpha: {
          'SKILL.md': '# Alpha',
        },
      },
      version: 'bundle-v1',
    });
    const managedPaths = resolveManagedSkillsPaths(harness.instancesRoot, harness.botInstanceId);

    await writeManifest(harness.bundleRoot, {
      skills: [{
        name: '../escaped',
        path: 'alpha',
      }],
      version: 'bundle-v1',
    });

    const result = await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });

    expect(result).toMatchObject({
      error: {
        code: 'MANIFEST_INVALID',
      },
      status: 'error',
    });
    await expect(pathExists(path.join(managedPaths.dataDir, 'escaped'))).resolves.toBe(false);
    await expect(pathExists(path.join(managedPaths.skillsDir, '..', 'escaped'))).resolves.toBe(false);
  });

  it('rejects manifest entries whose skill name is not a direct child directory', async () => {
    const harness = await createHarness({
      skills: {
        alpha: {
          'SKILL.md': '# Alpha',
        },
      },
      version: 'bundle-v1',
    });
    const managedPaths = resolveManagedSkillsPaths(harness.instancesRoot, harness.botInstanceId);

    await writeManifest(harness.bundleRoot, {
      skills: [{
        name: 'nested/name',
        path: 'alpha',
      }],
      version: 'bundle-v1',
    });

    const result = await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });

    expect(result).toMatchObject({
      error: {
        code: 'MANIFEST_INVALID',
      },
      status: 'error',
    });
    await expect(pathExists(path.join(managedPaths.skillsDir, 'nested'))).resolves.toBe(false);
  });

  it('deletes metadata-only retired managed skills and leaves unknown directories intact', async () => {
    const harness = await createHarness({
      skills: {
        alpha: {
          'SKILL.md': '# Alpha',
        },
      },
      version: 'bundle-v1',
    });

    await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });

    const managedPaths = resolveManagedSkillsPaths(harness.instancesRoot, harness.botInstanceId);
    await rm(path.join(managedPaths.skillsDir, 'alpha', '.weclaws-managed-skill.json'), { force: true });
    await mkdir(path.join(managedPaths.skillsDir, 'user-only'), { recursive: true });
    await writeFile(path.join(managedPaths.skillsDir, 'user-only', 'SKILL.md'), '# User');
    await writeBundle(harness.bundleRoot, {
      skills: {},
      version: 'bundle-v2',
    });

    const result = await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });

    expect(result).toMatchObject({
      removedSkills: ['alpha'],
      status: 'success',
    });
    await expect(pathExists(path.join(managedPaths.skillsDir, 'alpha'))).resolves.toBe(false);
    await expect(readSkillFile(harness.instancesRoot, harness.botInstanceId, 'user-only', 'SKILL.md')).resolves.toBe('# User');
    await expectManagedSkills(harness.instancesRoot, harness.botInstanceId, []);
  });

  it('returns busy when another writer already holds the bot-scoped sync lock', async () => {
    const harness = await createHarness({
      skills: {
        alpha: {
          'SKILL.md': '# Alpha',
        },
      },
      version: 'bundle-v1',
    });
    const lockHandle = await acquireManagedSkillsLock(resolveManagedSkillsLockPath(
      harness.instancesRoot,
      harness.botInstanceId,
    ));

    expect(lockHandle).not.toBeNull();

    try {
      const result = await syncManagedSkills({
        botInstanceId: harness.botInstanceId,
        bundleRoot: harness.bundleRoot,
        instancesRoot: harness.instancesRoot,
        operation: { type: 'sync-all-managed' },
      });

      expect(result).toMatchObject({
        error: {
          code: 'SYNC_IN_PROGRESS',
        },
        status: 'busy',
      });
    } finally {
      await lockHandle?.release();
    }
  });

  it('cleans stale lock files before running a sync', async () => {
    const harness = await createHarness({
      skills: {
        alpha: {
          'SKILL.md': '# Alpha',
        },
      },
      version: 'bundle-v1',
    });
    const lockPath = resolveManagedSkillsLockPath(harness.instancesRoot, harness.botInstanceId);

    await mkdir(path.dirname(lockPath), { recursive: true });
    await writeFile(lockPath, JSON.stringify({
      pid: process.pid,
      startedAt: '2000-01-01T00:00:00.000Z',
    }));

    const result = await syncManagedSkills({
      botInstanceId: harness.botInstanceId,
      bundleRoot: harness.bundleRoot,
      instancesRoot: harness.instancesRoot,
      operation: { type: 'sync-all-managed' },
    });

    expect(result.status).toBe('success');
    await expectManagedSkills(harness.instancesRoot, harness.botInstanceId, ['alpha']);
  });
});

interface HarnessInput {
  skills: Record<string, Record<string, string>>;
  version: string;
}

async function createHarness(input: HarnessInput) {
  const root = await mkdtemp(path.join(tmpdir(), 'weiling-managed-skills-'));
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

async function writeBundle(bundleRoot: string, input: HarnessInput) {
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

async function writeManifest(
  bundleRoot: string,
  manifest: {
    skills: Array<{ name: string; path: string }>;
    version: string;
  },
) {
  await writeFile(path.join(bundleRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

async function expectManagedSkills(instancesRoot: string, botInstanceId: string, expectedNames: string[]) {
  const metadata = JSON.parse(await readFile(
    resolveManagedSkillsPaths(instancesRoot, botInstanceId).metadataPath,
    'utf8',
  )) as {
    managedSkills: Array<{ name: string }>;
  };

  expect(metadata.managedSkills.map((item) => item.name).sort()).toEqual([...expectedNames].sort());
}

async function readSkillFile(
  instancesRoot: string,
  botInstanceId: string,
  skillName: string,
  relativePath: string,
) {
  const managedPaths = resolveManagedSkillsPaths(instancesRoot, botInstanceId);
  return readFile(path.join(managedPaths.skillsDir, skillName, relativePath), 'utf8');
}

async function pathExists(targetPath: string) {
  try {
    await readFile(targetPath);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EISDIR') {
      return true;
    }

    return !(error instanceof Error && 'code' in error && error.code === 'ENOENT');
  }
}
