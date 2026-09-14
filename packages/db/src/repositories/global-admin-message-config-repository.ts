import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  type GlobalAdminMessageCopy,
  type GlobalAdminMessageCopyKey,
  DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY,
  GLOBAL_ADMIN_MESSAGE_COPY_KEYS,
  globalAdminMessageConfigs,
  GLOBAL_ADMIN_MESSAGE_CONFIG_ID,
} from '../schema/global-admin-message-configs';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;
type Row = typeof globalAdminMessageConfigs.$inferSelect;

export interface GlobalAdminMessageConfigRecord extends Row {}

export type UpdateGlobalAdminMessageConfigInput = Partial<GlobalAdminMessageCopy> & {
  deferFailedUntilUserActive?: boolean;
  updatedAt?: Date;
  updatedByUserId?: string | null;
};

const ALLOWED_TEMPLATE_VARIABLES = new Set([
  'assistantName',
  'employeeName',
  'date',
  'time',
  'city',
]);
const ASSISTANT_NAME_MAX_LENGTH = 80;
const MESSAGE_COPY_MAX_LENGTH = 4_000;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const TEMPLATE_VARIABLE_PATTERN = /\{\{([a-zA-Z]+)\}\}/gu;

export class GlobalAdminMessageConfigRepository {
  constructor(private readonly db: Db) {}

  async find(): Promise<GlobalAdminMessageConfigRecord | null> {
    return this.db.select().from(globalAdminMessageConfigs)
      .where(eq(globalAdminMessageConfigs.id, GLOBAL_ADMIN_MESSAGE_CONFIG_ID))
      .get() ?? null;
  }

  async ensure(createdAt: Date = new Date()): Promise<GlobalAdminMessageConfigRecord> {
    this.db.insert(globalAdminMessageConfigs)
      .values({
        ...DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY,
        id: GLOBAL_ADMIN_MESSAGE_CONFIG_ID,
        createdAt,
        updatedAt: createdAt,
      })
      .onConflictDoNothing({ target: globalAdminMessageConfigs.id })
      .run();
    const config = await this.find();
    if (!config) throw new Error('Failed to ensure global admin message config.');
    return config;
  }

  async update(input: UpdateGlobalAdminMessageConfigInput): Promise<GlobalAdminMessageConfigRecord> {
    const copyPatch = normalizeCopyPatch(input);

    return this.db.transaction((tx) => {
      const updatedAt = input.updatedAt ?? new Date();
      tx.insert(globalAdminMessageConfigs)
        .values({ id: GLOBAL_ADMIN_MESSAGE_CONFIG_ID, createdAt: updatedAt, updatedAt })
        .onConflictDoNothing({ target: globalAdminMessageConfigs.id })
        .run();
      const current = tx.select().from(globalAdminMessageConfigs)
        .where(eq(globalAdminMessageConfigs.id, GLOBAL_ADMIN_MESSAGE_CONFIG_ID))
        .get();
      if (!current) throw new Error('Failed to ensure global admin message config.');

      const nextDeferred = input.deferFailedUntilUserActive
        ?? current.deferFailedUntilUserActive;
      const copyChanged = GLOBAL_ADMIN_MESSAGE_COPY_KEYS.some((key) => (
        copyPatch[key] !== undefined && copyPatch[key] !== current[key]
      ));
      const changed = copyChanged
        || nextDeferred !== current.deferFailedUntilUserActive;
      if (!changed) return current;

      tx.update(globalAdminMessageConfigs).set({
        ...copyPatch,
        deferFailedUntilUserActive: nextDeferred,
        observedRevision: null,
        revision: current.revision + 1,
        updatedAt,
        ...(input.updatedByUserId === undefined
          ? {}
          : { updatedByUserId: input.updatedByUserId }),
      }).where(eq(globalAdminMessageConfigs.id, GLOBAL_ADMIN_MESSAGE_CONFIG_ID)).run();
      return tx.select().from(globalAdminMessageConfigs)
        .where(eq(globalAdminMessageConfigs.id, GLOBAL_ADMIN_MESSAGE_CONFIG_ID))
        .get()!;
    }, { behavior: 'immediate' });
  }

  async recordObservedRevision(revision: number): Promise<GlobalAdminMessageConfigRecord | null> {
    if (!Number.isInteger(revision) || revision < 1) {
      throw new Error('Observed global message-copy revision must be a positive integer.');
    }

    this.db.update(globalAdminMessageConfigs)
      .set({ observedRevision: revision })
      .where(and(
        eq(globalAdminMessageConfigs.id, GLOBAL_ADMIN_MESSAGE_CONFIG_ID),
        eq(globalAdminMessageConfigs.revision, revision),
      ))
      .run();
    return this.find();
  }
}

function normalizeCopyPatch(
  input: UpdateGlobalAdminMessageConfigInput,
): Partial<GlobalAdminMessageCopy> {
  const patch: Partial<GlobalAdminMessageCopy> = {};
  for (const key of GLOBAL_ADMIN_MESSAGE_COPY_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    patch[key] = normalizeCopyValue(key, value);
  }
  return patch;
}

function normalizeCopyValue(key: GlobalAdminMessageCopyKey, value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Global message copy ${key} must not be empty.`);
  const maxLength = key === 'assistantName'
    ? ASSISTANT_NAME_MAX_LENGTH
    : MESSAGE_COPY_MAX_LENGTH;
  if (normalized.length > maxLength) {
    throw new Error(`Global message copy ${key} must not exceed ${maxLength} characters.`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(normalized)) {
    throw new Error(`Global message copy ${key} must not contain control characters.`);
  }

  const variables = [...normalized.matchAll(TEMPLATE_VARIABLE_PATTERN)];
  for (const match of variables) {
    if (!ALLOWED_TEMPLATE_VARIABLES.has(match[1])) {
      throw new Error(`Global message copy ${key} contains an unsupported template variable.`);
    }
  }
  const withoutVariables = normalized.replace(TEMPLATE_VARIABLE_PATTERN, '');
  if (withoutVariables.includes('{{') || withoutVariables.includes('}}')) {
    throw new Error(`Global message copy ${key} contains an invalid template variable.`);
  }
  if (key === 'assistantName' && variables.length > 0) {
    throw new Error('Global message copy assistantName must not contain template variables.');
  }
  return normalized;
}
