import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  EMAIL_SECURITY_MODES,
  globalEmailConfigs,
  GLOBAL_EMAIL_CONFIG_ID,
  type EmailSecurityMode,
} from '../schema/global-email-configs';
import type * as schema from '../schema/index';

const DEFAULT_EMAIL_SENDER_NAME = '微Link · 微灵 AI 助手';

type Db = BetterSQLite3Database<typeof schema>;
type Row = typeof globalEmailConfigs.$inferSelect;

export interface GlobalEmailConfigRecord extends Row {}

export interface UpdateGlobalEmailConfigInput {
  enabled: boolean;
  senderEmail?: string | null;
  senderName: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: EmailSecurityMode;
  updatedAt?: Date;
  updatedByUserId: string;
}

export class GlobalEmailConfigRepository {
  constructor(private readonly db: Db) {}

  async find(): Promise<GlobalEmailConfigRecord | null> {
    return this.db.select().from(globalEmailConfigs)
      .where(eq(globalEmailConfigs.id, GLOBAL_EMAIL_CONFIG_ID))
      .get() ?? null;
  }

  async ensure(createdAt: Date = new Date()): Promise<GlobalEmailConfigRecord> {
    this.db.insert(globalEmailConfigs)
      .values({
        createdAt,
        id: GLOBAL_EMAIL_CONFIG_ID,
        senderName: DEFAULT_EMAIL_SENDER_NAME,
        updatedAt: createdAt,
      })
      .onConflictDoNothing({ target: globalEmailConfigs.id })
      .run();

    const config = await this.find();
    if (!config) throw new Error('Failed to ensure global email config.');
    return config;
  }

  async update(input: UpdateGlobalEmailConfigInput): Promise<GlobalEmailConfigRecord> {
    const smtpHost = normalizeString(input.smtpHost, 'SMTP host');
    const smtpPort = normalizePort(input.smtpPort);
    const smtpSecurity = normalizeSecurity(input.smtpSecurity);
    const senderName = normalizeString(input.senderName, 'Sender name');

    return this.db.transaction((tx) => {
      const current = tx.select().from(globalEmailConfigs)
        .where(eq(globalEmailConfigs.id, GLOBAL_EMAIL_CONFIG_ID))
        .get();

      if (!current) throw new Error('Global email config must be initialized before update.');

      const senderEmail = input.senderEmail === undefined
        ? current.senderEmail
        : normalizeOptionalEmail(input.senderEmail);
      const next = {
        enabled: input.enabled,
        senderEmail,
        senderName,
        smtpHost,
        smtpPort,
        smtpSecurity,
      };

      if (next.enabled && !next.smtpHost) {
        throw new Error('SMTP host is required when email delivery is enabled.');
      }
      if (next.enabled && !next.senderEmail) {
        throw new Error('Sender email is required when email delivery is enabled.');
      }

      const changed = next.enabled !== current.enabled
        || next.senderEmail !== current.senderEmail
        || next.senderName !== current.senderName
        || next.smtpHost !== current.smtpHost
        || next.smtpPort !== current.smtpPort
        || next.smtpSecurity !== current.smtpSecurity;
      if (!changed) return current;

      const updatedAt = input.updatedAt ?? new Date();
      tx.update(globalEmailConfigs).set({
        ...next,
        observedRevision: null,
        revision: current.revision + 1,
        updatedAt,
        updatedByUserId: input.updatedByUserId,
      }).where(eq(globalEmailConfigs.id, GLOBAL_EMAIL_CONFIG_ID)).run();

      return tx.select().from(globalEmailConfigs)
        .where(eq(globalEmailConfigs.id, GLOBAL_EMAIL_CONFIG_ID))
        .get()!;
    }, { behavior: 'immediate' });
  }

  async recordObservedRevision(revision: number): Promise<GlobalEmailConfigRecord | null> {
    if (!Number.isInteger(revision) || revision < 1) {
      throw new Error('Observed global email revision must be a positive integer.');
    }

    this.db.update(globalEmailConfigs).set({ observedRevision: revision })
      .where(and(
        eq(globalEmailConfigs.id, GLOBAL_EMAIL_CONFIG_ID),
        eq(globalEmailConfigs.revision, revision),
      )).run();
    return this.find();
  }

  async observedRevision(revision: number): Promise<GlobalEmailConfigRecord | null> {
    return this.recordObservedRevision(revision);
  }
}

function normalizeString(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty.`);
  return normalized;
}

function normalizeOptionalEmail(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function normalizePort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error('SMTP port must be an integer between 1 and 65535.');
  }
  return value;
}

function normalizeSecurity(value: EmailSecurityMode): EmailSecurityMode {
  if (!EMAIL_SECURITY_MODES.includes(value)) {
    throw new Error('SMTP security must be SSL or STARTTLS.');
  }
  return value;
}
