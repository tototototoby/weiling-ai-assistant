import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  installWorkspacePathOverride,
  resolveWorkspacePathOverride,
} from '../../../../../infra/sandbox-runtime/workspace-root-override.mjs';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('workspace-root-override', () => {
  it('resolves a mapped real workspace path from the workspace map file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weiling-sandbox-runtime-override-'));
    tempDirs.push(dir);

    const workspaceMapFile = join(dir, 'workspace-map.json');
    await writeFile(workspaceMapFile, JSON.stringify({
      version: 1,
      workspaces: {
        ws_real: {
          workspacePath: '/real/workspace',
        },
      },
    }));

    await expect(resolveWorkspacePathOverride({
      workspaceId: 'ws_real',
      workspaceMapFile,
    })).resolves.toBe('/real/workspace');
  });

  it('patches WorkspaceManager.getWorkspacePath to return the mapped real workspace', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weiling-sandbox-runtime-patch-'));
    tempDirs.push(dir);

    const workspaceMapFile = join(dir, 'workspace-map.json');
    await writeFile(workspaceMapFile, JSON.stringify({
      version: 1,
      workspaces: {
        ws_real: {
          workspacePath: '/real/workspace',
        },
      },
    }));

    class FakeWorkspaceManager {
      getWorkspacePath(workspaceId: string, userId: string) {
        return `/tmp/sandbox-workspaces/${userId}/${workspaceId}`;
      }
    }

    installWorkspacePathOverride({
      WorkspaceManager: FakeWorkspaceManager,
      workspaceMapFile,
    });

    const manager = new FakeWorkspaceManager();

    expect(manager.getWorkspacePath('ws_real', 'im-gateway')).toBe('/real/workspace');
    expect(manager.getWorkspacePath('ws_other', 'im-gateway')).toBe(
      '/tmp/sandbox-workspaces/im-gateway/ws_other',
    );
  });
});
