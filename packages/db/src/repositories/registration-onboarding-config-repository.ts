import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../schema/index';
import {
  registrationOnboardingConfigs,
  REGISTRATION_ONBOARDING_CONFIG_ID,
} from '../schema/registration-onboarding-configs';

type Db = BetterSQLite3Database<typeof schema>;

export class RegistrationOnboardingConfigRepository {
  constructor(private readonly db: Db) {}

  async get() {
    return this.db.select().from(registrationOnboardingConfigs)
      .where(eq(registrationOnboardingConfigs.id, REGISTRATION_ONBOARDING_CONFIG_ID))
      .get() ?? null;
  }

  async setDefaultLlmProfile(
    defaultLlmProfileId: string | null,
    updatedByUserId: string,
    updatedAt: Date = new Date(),
  ) {
    this.db.insert(registrationOnboardingConfigs).values({
      id: REGISTRATION_ONBOARDING_CONFIG_ID,
      defaultLlmProfileId,
      updatedByUserId,
      createdAt: updatedAt,
      updatedAt,
    }).onConflictDoUpdate({
      target: registrationOnboardingConfigs.id,
      set: { defaultLlmProfileId, updatedByUserId, updatedAt },
    }).run();
    return this.get();
  }
}
