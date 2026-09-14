import { describe, expect, it, vi } from 'vitest';
import {
  BOOTSTRAP_REGISTRATION_TOKEN_FIELD,
  EMPLOYEE_ONBOARDING_TOKEN_FIELD,
  INVITE_RESERVATION_TOKEN_FIELD,
  INVITE_RESERVATION_TTL_MS,
  inviteOnlyRegistrationPlugin,
  validateInviteReservation,
} from '../auth-invite';

describe('invite-only auth helpers', () => {
  it('accepts a live reservation for the matching email and strips the reservation token', async () => {
    const result = await validateInviteReservation({
      body: {
        email: 'bot@example.com',
        [INVITE_RESERVATION_TOKEN_FIELD]: 'reservation_1',
        password: 'password123',
      },
      findReservationByToken: vi.fn().mockResolvedValue({
        reservedAt: new Date('2026-04-02T00:00:00.000Z'),
        reservedByEmail: 'bot@example.com',
      }),
      now: new Date('2026-04-02T00:04:59.000Z'),
    });

    expect(result).toEqual({
      cleanedBody: {
        email: 'bot@example.com',
        password: 'password123',
      },
      reservationToken: 'reservation_1',
    });
  });

  it('rejects sign-up requests without a reservation token', async () => {
    await expect(validateInviteReservation({
      body: {
        email: 'bot@example.com',
        password: 'password123',
      },
      findReservationByToken: vi.fn(),
    })).rejects.toMatchObject({
      body: {
        code: 'INVITE_REQUIRED',
      },
    });
  });

  it('accepts a live private employee onboarding reservation and strips its token', async () => {
    const result = await validateInviteReservation({
      body: {
        email: 'employee.id@weiling.invalid',
        [EMPLOYEE_ONBOARDING_TOKEN_FIELD]: 'employee_reservation',
        password: 'generated-password',
      },
      findReservationByToken: vi.fn(),
      findEmployeeOnboardingByToken: vi.fn().mockResolvedValue({
        reservedAt: new Date('2026-04-02T00:00:00.000Z'),
      }),
      now: new Date('2026-04-02T00:04:59.000Z'),
    });

    expect(result.cleanedBody).toEqual({
      email: 'employee.id@weiling.invalid',
      password: 'generated-password',
    });
  });

  it('allows the bootstrap admin to sign up with a live bootstrap claim token', async () => {
    const result = await validateInviteReservation({
      body: {
        email: 'admin@example.com',
        [BOOTSTRAP_REGISTRATION_TOKEN_FIELD]: 'bootstrap_1',
        password: 'password123',
      },
      findReservationByToken: vi.fn(),
      findBootstrapClaimByToken: vi.fn().mockResolvedValue({
        claimedAt: new Date('2026-04-08T00:00:00.000Z'),
        claimedByEmail: 'admin@example.com',
      }),
      countUsers: vi.fn().mockResolvedValue(0),
      now: new Date('2026-04-08T00:04:59.000Z'),
    });

    expect(result).toEqual({
      cleanedBody: {
        email: 'admin@example.com',
        password: 'password123',
      },
      reservationToken: null,
    });
  });

  it('rejects expired reservations', async () => {
    await expect(validateInviteReservation({
      body: {
        email: 'bot@example.com',
        [INVITE_RESERVATION_TOKEN_FIELD]: 'reservation_1',
        password: 'password123',
      },
      findReservationByToken: vi.fn().mockResolvedValue({
        reservedAt: new Date('2026-04-02T00:00:00.000Z'),
        reservedByEmail: 'bot@example.com',
      }),
      now: new Date('2026-04-02T00:05:00.001Z'),
    })).rejects.toMatchObject({
      body: {
        code: 'INVITE_REQUIRED',
      },
    });
  });

  it('rejects bootstrap registration tokens once a user already exists', async () => {
    await expect(validateInviteReservation({
      body: {
        email: 'admin@example.com',
        [BOOTSTRAP_REGISTRATION_TOKEN_FIELD]: 'bootstrap_1',
        password: 'password123',
      },
      findReservationByToken: vi.fn(),
      findBootstrapClaimByToken: vi.fn().mockResolvedValue({
        claimedAt: new Date('2026-04-08T00:00:00.000Z'),
        claimedByEmail: 'admin@example.com',
      }),
      countUsers: vi.fn().mockResolvedValue(1),
    })).rejects.toMatchObject({
      body: {
        code: 'INVITE_REQUIRED',
      },
    });
  });

  it('rejects bootstrap registration tokens for the wrong email or expired claims', async () => {
    await expect(validateInviteReservation({
      body: {
        email: 'member@example.com',
        [BOOTSTRAP_REGISTRATION_TOKEN_FIELD]: 'bootstrap_1',
        password: 'password123',
      },
      findReservationByToken: vi.fn(),
      findBootstrapClaimByToken: vi.fn().mockResolvedValue({
        claimedAt: new Date('2026-04-08T00:00:00.000Z'),
        claimedByEmail: 'admin@example.com',
      }),
      countUsers: vi.fn().mockResolvedValue(0),
    })).rejects.toMatchObject({
      body: {
        code: 'INVITE_REQUIRED',
      },
    });

    await expect(validateInviteReservation({
      body: {
        email: 'admin@example.com',
        [BOOTSTRAP_REGISTRATION_TOKEN_FIELD]: 'bootstrap_1',
        password: 'password123',
      },
      findReservationByToken: vi.fn(),
      findBootstrapClaimByToken: vi.fn().mockResolvedValue({
        claimedAt: new Date('2026-04-08T00:00:00.000Z'),
        claimedByEmail: 'admin@example.com',
      }),
      countUsers: vi.fn().mockResolvedValue(0),
      now: new Date('2026-04-08T00:05:00.001Z'),
    })).rejects.toMatchObject({
      body: {
        code: 'INVITE_REQUIRED',
      },
    });
  });

  it('matches the Better Auth email sign-up endpoint only', () => {
    const matcher = inviteOnlyRegistrationPlugin.hooks.before[0]?.matcher;
    type MatcherContext = Parameters<NonNullable<typeof matcher>>[0];
    const signUpContext = {
      context: {} as MatcherContext['context'],
      path: '/sign-up/email',
    };
    const signInContext = {
      context: {} as MatcherContext['context'],
      path: '/sign-in/email',
    };

    expect(matcher?.(signUpContext)).toBe(true);
    expect(matcher?.(signInContext)).toBe(false);
  });
});
