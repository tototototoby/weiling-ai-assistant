import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError, fail } from '@/lib/api-error';
import { getAuth } from '@/lib/auth';
import {
  BOOTSTRAP_REGISTRATION_TOKEN_FIELD,
  INVITE_RESERVATION_TOKEN_FIELD,
  INVITE_RESERVATION_TTL_MS,
} from '@/lib/auth-invite';
import { isAdminEmail } from '@/lib/admin';
import { getRepositories } from '@/lib/repositories';
import { getDefaultUserName } from '@/lib/user-name';

const registerWithInviteSchema = z.object({
  email: z.string().trim().email(),
  inviteCode: z.string().trim().optional().transform((value) => value ?? ''),
  password: z.string().min(8),
});

export async function POST(request: Request): Promise<Response> {
  let releaseReservationOnError = false;
  let reservationToken: string | null = null;
  let bootstrapClaimToken: string | null = null;
  const repositories = getRepositories();

  try {
    const payload = await readJsonBody(request);
    const parsed = registerWithInviteSchema.safeParse(payload);

    if (!parsed.success) {
      throw new ApiError({
        code: 'VALIDATION_ERROR',
        message: 'Invalid invite registration payload.',
        status: 400,
      });
    }

    const normalizedEmail = parsed.data.email.trim().toLowerCase();
    const inviteCode = parsed.data.inviteCode;
    const bootstrapRegistrationAllowed = inviteCode.length === 0 && isAdminEmail(normalizedEmail);

    if (!bootstrapRegistrationAllowed) {
      if (!inviteCode) {
        throw new ApiError({
          code: 'INVITE_REQUIRED',
          message: 'Invite code required.',
          status: 400,
        });
      }

      reservationToken = randomUUID();
      const invite = await repositories.registrationInvites.reserve({
        code: inviteCode,
        reservationToken,
        reservedAt: new Date(),
        reservedByEmail: normalizedEmail,
        staleBefore: new Date(Date.now() - INVITE_RESERVATION_TTL_MS),
      });

      if (!invite) {
        throw new ApiError({
          code: 'INVALID_INVITE',
          message: 'Invite code is invalid or unavailable.',
          status: 400,
        });
      }

      releaseReservationOnError = true;
    } else {
      bootstrapClaimToken = randomUUID();
      const bootstrapClaim = await repositories.registrationBootstrapClaims.claim({
        claimToken: bootstrapClaimToken,
        claimedAt: new Date(),
        claimedByEmail: normalizedEmail,
        staleBefore: new Date(Date.now() - INVITE_RESERVATION_TTL_MS),
      });

      if (!bootstrapClaim) {
        throw new ApiError({
          code: 'INVITE_REQUIRED',
          message: 'Invite code required.',
          status: 400,
        });
      }
    }

    const signUpBody = {
      email: normalizedEmail,
      name: getDefaultUserName(normalizedEmail),
      password: parsed.data.password,
      ...(reservationToken ? { [INVITE_RESERVATION_TOKEN_FIELD]: reservationToken } : {}),
      ...(bootstrapClaimToken ? { [BOOTSTRAP_REGISTRATION_TOKEN_FIELD]: bootstrapClaimToken } : {}),
    };

    const signUpResponse = await getAuth().api.signUpEmail({
      asResponse: true,
      body: signUpBody as never,
    });

    const responseBody = await signUpResponse.json() as {
      code?: string;
      message?: string;
      token?: string | null;
      user?: {
        email: string;
        id: string;
        name: string;
      };
    };

    if (!signUpResponse.ok || !responseBody.user) {
      throw new ApiError({
        code: 'INVITE_SIGN_UP_FAILED',
        message: responseBody.message ?? 'Registration failed.',
        status: signUpResponse.status,
      });
    }

    if (reservationToken) {
      releaseReservationOnError = false;
      const consumedInvite = await repositories.registrationInvites.consumeReservation({
        reservationToken,
        usedByUserId: responseBody.user.id,
      });

      if (!consumedInvite) {
        throw new ApiError({
          code: 'INVITE_CONSUME_FAILED',
          message: 'Invite reservation could not be completed.',
          status: 409,
        });
      }
    }

    const response = Response.json({
      data: {
        user: responseBody.user,
      },
      error: null,
    });

    for (const setCookieHeader of getSetCookieHeaders(signUpResponse.headers)) {
      response.headers.append('set-cookie', setCookieHeader);
    }

    if (bootstrapClaimToken) {
      try {
        await repositories.registrationBootstrapClaims.release(bootstrapClaimToken);
      } catch {
        // The first user already exists at this point, so a stale claim cannot reopen bootstrap registration.
      }
    }

    return response;
  } catch (error) {
    if (releaseReservationOnError && reservationToken) {
      try {
        await repositories.registrationInvites.releaseReservation(reservationToken);
      } catch (releaseError) {
        return fail(releaseError);
      }
    }

    if (bootstrapClaimToken) {
      try {
        await repositories.registrationBootstrapClaims.release(bootstrapClaimToken);
      } catch (releaseError) {
        return fail(releaseError);
      }
    }

    return fail(error);
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function getSetCookieHeaders(headers: Headers): string[] {
  const headersWithSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof headersWithSetCookie.getSetCookie === 'function') {
    return headersWithSetCookie.getSetCookie();
  }

  const setCookieHeader = headers.get('set-cookie');
  return setCookieHeader ? [setCookieHeader] : [];
}
