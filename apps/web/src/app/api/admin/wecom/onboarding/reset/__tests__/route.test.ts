import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireAdminRequestSessionMock = vi.fn();
const getRepositoriesMock = vi.fn();
const resetAdminWecomOnboardingSessionMock = vi.fn();

vi.mock('@/lib/admin', () => ({
  requireAdminRequestSession: requireAdminRequestSessionMock,
}));

vi.mock('@/lib/repositories', () => ({
  getRepositories: getRepositoriesMock,
}));

vi.mock('@/lib/wecom-admin', () => ({
  resetAdminWecomOnboardingSession: resetAdminWecomOnboardingSessionMock,
}));

describe('/api/admin/wecom/onboarding/reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminRequestSessionMock.mockResolvedValue({
      user: { email: 'admin@example.com', id: 'admin_1' },
    });
    getRepositoriesMock.mockReturnValue({ wecomOnboarding: { repository: true } });
  });

  it('requires an administrator and injects the web repository collection', async () => {
    const payload = { resetToken: 'a'.repeat(64) };
    resetAdminWecomOnboardingSessionMock.mockResolvedValue({ onboardingSessions: [] });
    const { POST } = await import('../route');

    const response = await POST(new Request('http://localhost/api/admin/wecom/onboarding/reset', {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }));

    expect(response.status).toBe(200);
    expect(requireAdminRequestSessionMock).toHaveBeenCalledOnce();
    expect(getRepositoriesMock).toHaveBeenCalledOnce();
    expect(resetAdminWecomOnboardingSessionMock).toHaveBeenCalledWith({
      payload,
      repositories: { wecomOnboarding: { repository: true } },
    });
  });

  it('returns a controlled error for malformed JSON', async () => {
    const { POST } = await import('../route');
    const response = await POST(new Request('http://localhost/api/admin/wecom/onboarding/reset', {
      body: '{',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_JSON_BODY' },
    });
  });
});
