import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { userLlmProfiles } from './user-llm-profiles';
import { users } from './users';

export const REGISTRATION_ONBOARDING_CONFIG_ID = 'global';

export const registrationOnboardingConfigs = sqliteTable('registration_onboarding_configs', {
  id: text('id').primaryKey(),
  defaultLlmProfileId: text('default_llm_profile_id')
    .references(() => userLlmProfiles.id, { onDelete: 'set null' }),
  updatedByUserId: text('updated_by_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
