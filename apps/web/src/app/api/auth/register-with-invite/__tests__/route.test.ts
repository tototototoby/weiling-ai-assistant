import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOOTSTRAP_REGISTRATION_TOKEN_FIELD,
  INVITE_RESERVATION_TOKEN_FIELD,
} from '@/lib/auth-invite';

const {
  signUpEmailMock,
  countAllUsersMock,
  reserveMock,
  consumeReservationMock,
  releaseReservationMock,
  claimBootstrapMock,
  findBootstrapClaimByTokenMock,
  releaseBootstrapClaimMock,
  isAdminEmailMock,
} = vi.hoisted(() => ({
  signUpEmailMock: vi.fn(),
  countAllUsersMock: vi.fn(),
  reserveMock: vi.fn(),
  consumeReservationMock: vi.fn(),
  releaseReservationMock: vi.fn(),
  claimBootstrapMock: vi.fn(),
  findBootstrapClaimByTokenMock: vi.fn(),
  releaseBootstrapClaimMock: vi.fn(),
  isAdminEmailMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getAuth: () => ({
    api: {
      signUpEmail: signUpEmailMock,
    },
  }),
}));

vi.mock('@/lib/admin', () => ({
  isAdminEmail: isAdminEmailMock,
}));

vi.mock('@/lib/repositories', () => ({
  getRepositories: () => ({
    users: {
      countAll: countAllUsersMock,
    },
    registrationBootstrapClaims: {
      claim: claimBootstrapMock,
      findByClaimToken: findBootstrapClaimByTokenMock,
      release: releaseBootstrapClaimMock,
    },
    registrationInvites: {
      consumeReservation: consumeReservationMock,
      releaseReservation: releaseReservationMock,
      reserve: reserveMock,
    },
  }),
}));

describe('/api/auth/register-with-invite route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    countAllUsersMock.mockResolvedValue(1);
    isAdminEmailMock.mockReturnValue(false);
    claimBootstrapMock.mockResolvedValue(null);
  });

  it('rejects invalid payloads', async () => {
    const { POST } = await import('../route');

    const response = await POST(
      new Request('http://localhost/api/auth/register-with-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          password: 'password123',
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(reserveMock).not.toHaveBeenCalled();
  });

  it('allows the first configured admin to register without an invite code', async () => {
    isAdminEmailMock.mockReturnValue(true);
    claimBootstrapMock.mockResolvedValue({
      claimToken: 'bootstrap_1',
      claimedAt: new Date('2026-04-08T00:00:00.000Z'),
      claimedByEmail: 'admin@example.com',
    });
    signUpEmailMock.mockResolvedValue(new Response(JSON.stringify({
      token: null,
      user: {
        id: 'user_1',
        email: 'admin@example.com',
        name: 'admin',
      },
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'better-auth.session_token=abc123; Path=/; HttpOnly',
      },
    }));

    const { POST } = await import('../route');

    const response = await POST(
      new Request('http://localhost/api/auth/register-with-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@example.com',
          password: 'password123',
        }),
      }),
    );

    expect(isAdminEmailMock).toHaveBeenCalledWith('admin@example.com');
    expect(claimBootstrapMock).toHaveBeenCalledWith(expect.objectContaining({
      claimedByEmail: 'admin@example.com',
    }));
    const bootstrapClaimToken = claimBootstrapMock.mock.calls[0]?.[0]?.claimToken as string;
    expect(reserveMock).not.toHaveBeenCalled();
    expect(consumeReservationMock).not.toHaveBeenCalled();
    expect(releaseReservationMock).not.toHaveBeenCalled();
    expect(signUpEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      asResponse: true,
      body: {
        [BOOTSTRAP_REGISTRATION_TOKEN_FIELD]: bootstrapClaimToken,
        email: 'admin@example.com',
        name: 'admin',
        password: 'password123',
      },
    }));
    expect(response.status).toBe(200);
  });

  it('still requires an invite code after the first user exists', async () => {
    isAdminEmailMock.mockReturnValue(true);
    claimBootstrapMock.mockResolvedValue(null);

    const { POST } = await import('../route');

    const response = await POST(
      new Request('http://localhost/api/auth/register-with-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@example.com',
          password: 'password123',
        }),
      }),
    );

    expect(claimBootstrapMock).toHaveBeenCalledTimes(1);
    expect(reserveMock).not.toHaveBeenCalled();
    expect(signUpEmailMock).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: 'INVITE_REQUIRED',
        message: 'Invite code required.',
      },
    });
  });

  it('still requires an invite code for non-admin emails even before the first user exists', async () => {
    isAdminEmailMock.mockReturnValue(false);

    const { POST } = await import('../route');

    const response = await POST(
      new Request('http://localhost/api/auth/register-with-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'member@example.com',
          password: 'password123',
        }),
      }),
    );

    expect(claimBootstrapMock).not.toHaveBeenCalled();
    expect(reserveMock).not.toHaveBeenCalled();
    expect(signUpEmailMock).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: 'INVITE_REQUIRED',
        message: 'Invite code required.',
      },
    });
  });

  it('releases the bootstrap claim when Better Auth signup fails', async () => {
    isAdminEmailMock.mockReturnValue(true);
    claimBootstrapMock.mockResolvedValue({
      claimToken: 'bootstrap_1',
      claimedAt: new Date('2026-04-08T00:00:00.000Z'),
      claimedByEmail: 'admin@example.com',
    });
    signUpEmailMock.mockResolvedValue(new Response(JSON.stringify({
      code: 'USER_ALREADY_EXISTS',
      message: 'User already exists',
    }), {
      status: 400,
      headers: {
        'content-type': 'application/json',
      },
    }));

    const { POST } = await import('../route');

    const response = await POST(
      new Request('http://localhost/api/auth/register-with-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'admin@example.com',
          password: 'password123',
        }),
      }),
    );

    expect(releaseBootstrapClaimMock).toHaveBeenCalledWith(
      claimBootstrapMock.mock.calls[0]?.[0]?.claimToken as string,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: 'INVITE_SIGN_UP_FAILED',
        message: 'User already exists',
      },
    });
  });

  it('rejects unavailable invites before signup', async () => {
    reserveMock.mockResolvedValue(null);

    const { POST } = await import('../route');

    const response = await POST(
      new Request('http://localhost/api/auth/register-with-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'bot@example.com',
          inviteCode: 'MISSING-CODE',
          password: 'password123',
        }),
      }),
    );

    expect(signUpEmailMock).not.toHaveBeenCalled();
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: 'INVALID_INVITE',
        message: 'Invite code is invalid or unavailable.',
      },
    });
  });

  it('signs up with Better Auth, finalizes the reserved invite, and forwards the auth cookie', async () => {
    reserveMock.mockResolvedValue({
      code: 'VALID-CODE',
      reservationToken: 'reservation_1',
      reservedAt: new Date('2026-04-02T00:00:00.000Z'),
      reservedByEmail: 'bot@example.com',
      usedAt: null,
      usedByUserId: null,
    });
    signUpEmailMock.mockResolvedValue(new Response(JSON.stringify({
      token: null,
      user: {
        id: 'user_1',
        email: 'bot@example.com',
        name: 'bot',
      },
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'better-auth.session_token=abc123; Path=/; HttpOnly',
      },
    }));
    consumeReservationMock.mockResolvedValue({
      code: 'VALID-CODE',
      reservationToken: null,
      reservedAt: null,
      reservedByEmail: null,
      usedAt: new Date('2026-04-02T00:00:00.000Z'),
      usedByUserId: 'user_1',
    });

    const { POST } = await import('../route');

    const response = await POST(
      new Request('http://localhost/api/auth/register-with-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'bot@example.com',
          inviteCode: 'VALID-CODE',
          password: 'password123',
        }),
      }),
    );

    const reservedToken = reserveMock.mock.calls[0]?.[0]?.reservationToken as string;

    expect(reservedToken).toEqual(expect.any(String));
    expect(signUpEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      asResponse: true,
      body: {
        email: 'bot@example.com',
        [INVITE_RESERVATION_TOKEN_FIELD]: reservedToken,
        name: 'bot',
        password: 'password123',
      },
    }));
    expect(consumeReservationMock).toHaveBeenCalledWith(expect.objectContaining({
      reservationToken: reservedToken,
      usedByUserId: 'user_1',
    }));
    expect(releaseReservationMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('better-auth.session_token=abc123');
    await expect(response.json()).resolves.toEqual({
      data: {
        user: {
          email: 'bot@example.com',
          id: 'user_1',
          name: 'bot',
        },
      },
      error: null,
    });
  });

  it('releases the reservation when Better Auth signup fails', async () => {
    reserveMock.mockResolvedValue({
      code: 'VALID-CODE',
      reservationToken: 'reservation_1',
      reservedAt: new Date('2026-04-02T00:00:00.000Z'),
      reservedByEmail: 'bot@example.com',
      usedAt: null,
      usedByUserId: null,
    });
    signUpEmailMock.mockResolvedValue(new Response(JSON.stringify({
      code: 'USER_ALREADY_EXISTS',
      message: 'User already exists',
    }), {
      status: 400,
      headers: {
        'content-type': 'application/json',
      },
    }));

    const { POST } = await import('../route');

    const response = await POST(
      new Request('http://localhost/api/auth/register-with-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'bot@example.com',
          inviteCode: 'VALID-CODE',
          password: 'password123',
        }),
      }),
    );

    expect(consumeReservationMock).not.toHaveBeenCalled();
    expect(releaseReservationMock).toHaveBeenCalledWith(
      reserveMock.mock.calls[0]?.[0]?.reservationToken as string,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: 'INVITE_SIGN_UP_FAILED',
        message: 'User already exists',
      },
    });
  });

  it('does not release the invite reservation after account creation if invite finalization fails', async () => {
    reserveMock.mockResolvedValue({
      code: 'VALID-CODE',
      reservationToken: 'reservation_1',
      reservedAt: new Date('2026-04-02T00:00:00.000Z'),
      reservedByEmail: 'bot@example.com',
      usedAt: null,
      usedByUserId: null,
    });
    signUpEmailMock.mockResolvedValue(new Response(JSON.stringify({
      token: null,
      user: {
        id: 'user_1',
        email: 'bot@example.com',
        name: 'bot',
      },
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'better-auth.session_token=abc123; Path=/; HttpOnly',
      },
    }));
    consumeReservationMock.mockResolvedValue(null);

    const { POST } = await import('../route');

    const response = await POST(
      new Request('http://localhost/api/auth/register-with-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'bot@example.com',
          inviteCode: 'VALID-CODE',
          password: 'password123',
        }),
      }),
    );

    expect(consumeReservationMock).toHaveBeenCalledWith(expect.objectContaining({
      reservationToken: reserveMock.mock.calls[0]?.[0]?.reservationToken as string,
      usedByUserId: 'user_1',
    }));
    expect(releaseReservationMock).not.toHaveBeenCalled();
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: 'INVITE_CONSUME_FAILED',
        message: 'Invite reservation could not be completed.',
      },
    });
  });

  it('forwards every auth cookie returned by Better Auth', async () => {
    reserveMock.mockResolvedValue({
      code: 'VALID-CODE',
      reservationToken: 'reservation_1',
      reservedAt: new Date('2026-04-02T00:00:00.000Z'),
      reservedByEmail: 'bot@example.com',
      usedAt: null,
      usedByUserId: null,
    });

    const responseHeaders = new Headers({
      'content-type': 'application/json',
    });
    responseHeaders.append('set-cookie', 'better-auth.session_token=abc123; Path=/; HttpOnly');
    responseHeaders.append('set-cookie', 'better-auth.csrf_token=def456; Path=/; HttpOnly');

    signUpEmailMock.mockResolvedValue(new Response(JSON.stringify({
      token: null,
      user: {
        id: 'user_1',
        email: 'bot@example.com',
        name: 'bot',
      },
    }), {
      status: 200,
      headers: responseHeaders,
    }));
    consumeReservationMock.mockResolvedValue({
      code: 'VALID-CODE',
      reservationToken: null,
      reservedAt: null,
      reservedByEmail: null,
      usedAt: new Date('2026-04-02T00:00:00.000Z'),
      usedByUserId: 'user_1',
    });

    const { POST } = await import('../route');

    const response = await POST(
      new Request('http://localhost/api/auth/register-with-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'bot@example.com',
          inviteCode: 'VALID-CODE',
          password: 'password123',
        }),
      }),
    );

    expect(response.headers.getSetCookie()).toEqual([
      'better-auth.session_token=abc123; Path=/; HttpOnly',
      'better-auth.csrf_token=def456; Path=/; HttpOnly',
    ]);
  });

  it('hides unexpected internal error details from clients', async () => {
    reserveMock.mockRejectedValue(new Error('sqlite constraint failed at /private/tmp/test.sqlite'));

    const { POST } = await import('../route');

    const response = await POST(
      new Request('http://localhost/api/auth/register-with-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'bot@example.com',
          inviteCode: 'VALID-CODE',
          password: 'password123',
        }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      data: null,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Unexpected server error.',
      },
    });
  });
});
