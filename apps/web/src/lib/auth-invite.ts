import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { getRepositories } from './repositories';

export const INVITE_RESERVATION_TOKEN_FIELD = 'inviteReservationToken';
export const BOOTSTRAP_REGISTRATION_TOKEN_FIELD = 'bootstrapRegistrationToken';
export const EMPLOYEE_ONBOARDING_TOKEN_FIELD = 'employeeOnboardingToken';
export const INVITE_RESERVATION_TTL_MS = 5 * 60 * 1000;

interface InviteReservationLookupResult {
  reservedAt: Date | null;
  reservedByEmail: string | null;
}

interface BootstrapClaimLookupResult {
  claimedAt: Date | null;
  claimedByEmail: string | null;
}

interface EmployeeOnboardingLookupResult {
  reservedAt: Date | null;
}

interface ValidateInviteReservationInput {
  body: Record<string, unknown> | null | undefined;
  findReservationByToken(reservationToken: string): Promise<InviteReservationLookupResult | null>;
  findBootstrapClaimByToken?(claimToken: string): Promise<BootstrapClaimLookupResult | null>;
  countUsers?(): Promise<number>;
  findEmployeeOnboardingByToken?(reservationToken: string): Promise<EmployeeOnboardingLookupResult | null>;
  now?: Date;
}

interface ValidateInviteReservationResult {
  cleanedBody: Record<string, unknown>;
  reservationToken: string | null;
}

function createInviteRequiredError() {
  return APIError.from('FORBIDDEN', {
    code: 'INVITE_REQUIRED',
    message: 'Invite code required.',
  });
}

function normalizeEmail(email: unknown): string | null {
  if (typeof email !== 'string') {
    return null;
  }

  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export async function validateInviteReservation({
  body,
  findReservationByToken,
  findBootstrapClaimByToken,
  countUsers,
  findEmployeeOnboardingByToken,
  now = new Date(),
}: ValidateInviteReservationInput): Promise<ValidateInviteReservationResult> {
  if (!body) {
    throw createInviteRequiredError();
  }

  const reservationTokenValue = body[INVITE_RESERVATION_TOKEN_FIELD];
  const reservationToken = typeof reservationTokenValue === 'string'
    ? reservationTokenValue.trim()
    : '';
  const bootstrapTokenValue = body[BOOTSTRAP_REGISTRATION_TOKEN_FIELD];
  const bootstrapToken = typeof bootstrapTokenValue === 'string'
    ? bootstrapTokenValue.trim()
    : '';
  const employeeTokenValue = body[EMPLOYEE_ONBOARDING_TOKEN_FIELD];
  const employeeToken = typeof employeeTokenValue === 'string'
    ? employeeTokenValue.trim()
    : '';
  const normalizedEmail = normalizeEmail(body.email);

  if (!normalizedEmail) {
    throw createInviteRequiredError();
  }


  if (employeeToken && findEmployeeOnboardingByToken) {
    const employeeReservation = await findEmployeeOnboardingByToken(employeeToken);

    if (
      !employeeReservation?.reservedAt
      || now.getTime() - employeeReservation.reservedAt.getTime() > INVITE_RESERVATION_TTL_MS
    ) {
      throw createInviteRequiredError();
    }

    const {
      [EMPLOYEE_ONBOARDING_TOKEN_FIELD]: _employeeToken,
      [BOOTSTRAP_REGISTRATION_TOKEN_FIELD]: _bootstrapToken,
      [INVITE_RESERVATION_TOKEN_FIELD]: _reservationToken,
      ...cleanedBody
    } = body;

    return { cleanedBody, reservationToken: null };
  }

  if (!reservationToken) {
    if (!bootstrapToken || !findBootstrapClaimByToken || !countUsers) {
      throw createInviteRequiredError();
    }

    const userCount = await countUsers();

    if (userCount !== 0) {
      throw createInviteRequiredError();
    }

    const bootstrapClaim = await findBootstrapClaimByToken(bootstrapToken);

    if (
      !bootstrapClaim
      || !bootstrapClaim.claimedAt
      || normalizeEmail(bootstrapClaim.claimedByEmail) !== normalizedEmail
      || now.getTime() - bootstrapClaim.claimedAt.getTime() > INVITE_RESERVATION_TTL_MS
    ) {
      throw createInviteRequiredError();
    }

    const {
      [BOOTSTRAP_REGISTRATION_TOKEN_FIELD]: _bootstrapToken,
      [INVITE_RESERVATION_TOKEN_FIELD]: _reservationToken,
      ...cleanedBody
    } = body;

    return {
      cleanedBody,
      reservationToken: null,
    };
  }

  const reservation = await findReservationByToken(reservationToken);

  if (
    !reservation
    || !reservation.reservedAt
    || normalizeEmail(reservation.reservedByEmail) !== normalizedEmail
    || now.getTime() - reservation.reservedAt.getTime() > INVITE_RESERVATION_TTL_MS
  ) {
    throw createInviteRequiredError();
  }

  const { [INVITE_RESERVATION_TOKEN_FIELD]: _reservationToken, ...cleanedBody } = body;

  return {
    cleanedBody,
    reservationToken,
  };
}

export const inviteOnlyRegistrationPlugin = {
  id: 'invite-only-registration',
  hooks: {
    before: [
      {
        matcher(context) {
          return context.path === '/sign-up/email';
        },
        handler: createAuthMiddleware(async (ctx) => {
          const body = (typeof ctx.body === 'object' && ctx.body !== null)
            ? ctx.body as Record<string, unknown>
            : null;
          const repositories = getRepositories();
          const { cleanedBody } = await validateInviteReservation({
            body,
            findReservationByToken: (reservationToken) => (
              repositories.registrationInvites.findByReservationToken(reservationToken)
            ),
            findBootstrapClaimByToken: (claimToken) => (
              repositories.registrationBootstrapClaims.findByClaimToken(claimToken)
            ),
            countUsers: () => repositories.users.countAll(),
            findEmployeeOnboardingByToken: (reservationToken) => (
              repositories.employeeDirectory.findByReservationToken(reservationToken)
            ),
          });

          return {
            context: {
              ...ctx,
              body: cleanedBody,
            },
          };
        }),
      },
    ],
  },
} satisfies BetterAuthPlugin;
