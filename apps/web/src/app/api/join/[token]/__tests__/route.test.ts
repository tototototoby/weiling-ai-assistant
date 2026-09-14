import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerEmployeeFromInviteMock = vi.fn();

vi.mock('@/lib/employee-onboarding', () => ({
  registerEmployeeFromInvite: registerEmployeeFromInviteMock,
}));

describe('/api/join/[token] route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns the public QR share URL without creating a login session', async () => {
    registerEmployeeFromInviteMock.mockResolvedValue({
      botId: 'bot_1',
      publicUrl: 'http://localhost:3000/share/qr/share_token',
    });

    const { POST } = await import('../route');
    const response = await POST(new Request('http://localhost/api/join/invite_token', {
      body: JSON.stringify({ name: 'Zhang Ting' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }), {
      params: Promise.resolve({ token: 'invite_token' }),
    });

    expect(registerEmployeeFromInviteMock).toHaveBeenCalledWith({
      inviteToken: 'invite_token',
      submittedName: 'Zhang Ting',
    });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        botId: 'bot_1',
        publicUrl: 'http://localhost:3000/share/qr/share_token',
      },
      error: null,
    });
  });
});
