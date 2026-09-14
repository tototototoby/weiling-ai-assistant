import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const readFileMock = vi.fn();
const getWorkspaceRootMock = vi.fn(() => '/tmp/weiling');

vi.mock('node:fs/promises', () => ({
  readFile: readFileMock,
}));

vi.mock('../env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../env')>();

  return {
    ...actual,
    getWorkspaceRoot: getWorkspaceRootMock,
  };
});

describe('getFastAgentCliVersion', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getWorkspaceRootMock.mockReturnValue('/tmp/weiling');
  });

  it('reads the pinned @fastagent/cli version from apps/supervisor/package.json', async () => {
    readFileMock.mockResolvedValue(JSON.stringify({
      dependencies: {
        '@fastagent/cli': '0.5.2',
      },
    }));

    const { getFastAgentCliVersion } = await import('../fastagent-cli-version');

    await expect(getFastAgentCliVersion()).resolves.toBe('0.5.2');
    expect(readFileMock).toHaveBeenCalledWith(join('/tmp/weiling', 'apps', 'supervisor', 'package.json'), 'utf8');
  });

  it('returns null when the dependency is missing', async () => {
    readFileMock.mockResolvedValue(JSON.stringify({
      dependencies: {},
    }));

    const { getFastAgentCliVersion } = await import('../fastagent-cli-version');

    await expect(getFastAgentCliVersion()).resolves.toBeNull();
  });
});
