import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireRequestSessionMock = vi.fn();
const requireOwnedBotMock = vi.fn();
const resolveInstancesRootMock = vi.fn();
const getWorkspaceRootMock = vi.fn();
const resolveManagedSkillsBundleRootMock = vi.fn();
const syncManagedSkillsMock = vi.fn();

vi.mock('@/lib/session', () => ({
  requireOwnedBot: requireOwnedBotMock,
  requireRequestSession: requireRequestSessionMock,
}));

vi.mock('@/lib/env', () => ({
  getWorkspaceRoot: getWorkspaceRootMock,
  resolveInstancesRoot: resolveInstancesRootMock,
}));

vi.mock('@weiling-ai/shared/managed-skills', () => ({
  resolveManagedSkillsBundleRoot: resolveManagedSkillsBundleRootMock,
  syncManagedSkills: syncManagedSkillsMock,
}));

describe('/api/bots/[id]/skills/sync route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    requireRequestSessionMock.mockResolvedValue({
      user: { id: 'user_1', email: 'zac@example.com' },
    });
    requireOwnedBotMock.mockResolvedValue({
      id: 'bot_1',
      ownerUserId: 'user_1',
    });
    resolveInstancesRootMock.mockReturnValue('/instances');
    getWorkspaceRootMock.mockReturnValue('/workspace');
    resolveManagedSkillsBundleRootMock.mockReturnValue('/workspace/resources/skills/managed');
  });

  it('runs an owner-scoped sync-all-managed operation by default', async () => {
    syncManagedSkillsMock.mockResolvedValue({
      bundleVersion: 'bundle-v1',
      error: null,
      errors: [],
      installedSkills: ['alpha'],
      metadataRepaired: false,
      operation: 'sync-all-managed',
      removedSkills: [],
      repairedMarkers: [],
      skippedConflicts: [],
      status: 'success',
      updatedSkills: [],
    });

    const { POST } = await import('../route');
    const response = await POST(new Request('http://localhost/api/bots/bot_1/skills/sync', {
      method: 'POST',
    }), {
      params: Promise.resolve({ id: 'bot_1' }),
    });

    expect(syncManagedSkillsMock).toHaveBeenCalledWith({
      botInstanceId: 'bot_1',
      bundleRoot: '/workspace/resources/skills/managed',
      instancesRoot: '/instances',
      operation: {
        type: 'sync-all-managed',
      },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        result: {
          bundleVersion: 'bundle-v1',
          error: null,
          errors: [],
          installedSkills: ['alpha'],
          metadataRepaired: false,
          operation: 'sync-all-managed',
          removedSkills: [],
          repairedMarkers: [],
          skippedConflicts: [],
          status: 'success',
          updatedSkills: [],
        },
      },
      error: null,
    });
  });

  it('returns a structured busy result when the sync lock is already held', async () => {
    syncManagedSkillsMock.mockResolvedValue({
      bundleVersion: null,
      error: {
        code: 'SYNC_IN_PROGRESS',
        message: 'Managed skills sync is already running for this bot.',
      },
      errors: [{
        code: 'SYNC_IN_PROGRESS',
        message: 'Managed skills sync is already running for this bot.',
      }],
      installedSkills: [],
      metadataRepaired: false,
      operation: 'sync-all-managed',
      removedSkills: [],
      repairedMarkers: [],
      skippedConflicts: [],
      status: 'busy',
      updatedSkills: [],
    });

    const { POST } = await import('../route');
    const response = await POST(new Request('http://localhost/api/bots/bot_1/skills/sync', {
      method: 'POST',
    }), {
      params: Promise.resolve({ id: 'bot_1' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      data: {
        result: {
          bundleVersion: null,
          error: {
            code: 'SYNC_IN_PROGRESS',
            message: 'Managed skills sync is already running for this bot.',
          },
          errors: [{
            code: 'SYNC_IN_PROGRESS',
            message: 'Managed skills sync is already running for this bot.',
          }],
          installedSkills: [],
          metadataRepaired: false,
          operation: 'sync-all-managed',
          removedSkills: [],
          repairedMarkers: [],
          skippedConflicts: [],
          status: 'busy',
          updatedSkills: [],
        },
      },
      error: null,
    });
  });

  it('rejects unsupported future operations without changing the route shape', async () => {
    const { POST } = await import('../route');
    const response = await POST(new Request('http://localhost/api/bots/bot_1/skills/sync', {
      body: JSON.stringify({
        operation: 'remove-all-managed',
      }),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }), {
      params: Promise.resolve({ id: 'bot_1' }),
    });

    expect(syncManagedSkillsMock).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: 'Only sync-all-managed is currently supported.',
      },
    });
  });
});
