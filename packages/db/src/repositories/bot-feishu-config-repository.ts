import { and, eq, isNull, ne, or } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  botFeishuConfigs,
  type FeishuEventStatus,
} from '../schema/bot-feishu-configs';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;

export interface BotFeishuConfigRecord {
  appId: string;
  appSecret: string;
  botInstanceId: string;
  createdAt: Date;
  enabled: boolean;
  eventStatus: FeishuEventStatus;
  lastConnectedAt: Date | null;
  lastDisconnectedAt: Date | null;
  lastError: string | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  observedRevision: number | null;
  ownerOpenId: string | null;
  revision: number;
  updatedAt: Date;
  updatedByUserId: string | null;
}

export interface UpdateBotFeishuConfigInput {
  appId: string;
  appSecret?: string;
  botInstanceId: string;
  enabled: boolean;
  updatedAt?: Date;
  updatedByUserId?: string | null;
}

export interface RecordBotFeishuEventStatusInput {
  botInstanceId: string;
  connectedAt?: Date | null;
  disconnectedAt?: Date | null;
  error?: string | null;
  observedRevision: number;
  status: FeishuEventStatus;
  updatedAt?: Date;
}

export class BotFeishuConfigRepository {
  constructor(private readonly db: Db) {}

  async findByBotInstanceId(botInstanceId: string): Promise<BotFeishuConfigRecord | null> {
    return this.db.select()
      .from(botFeishuConfigs)
      .where(eq(botFeishuConfigs.botInstanceId, botInstanceId))
      .get() ?? null;
  }

  async ensure(
    botInstanceId: string,
    createdAt: Date = new Date(),
  ): Promise<BotFeishuConfigRecord> {
    this.db.insert(botFeishuConfigs)
      .values({
        botInstanceId,
        createdAt,
        updatedAt: createdAt,
      })
      .onConflictDoNothing({ target: botFeishuConfigs.botInstanceId })
      .run();
    const config = await this.findByBotInstanceId(botInstanceId);
    if (!config) throw new Error('Failed to ensure Bot Feishu config.');
    return config;
  }

  async listAll(): Promise<BotFeishuConfigRecord[]> {
    return this.db.select().from(botFeishuConfigs).all();
  }

  async listConfigured(): Promise<BotFeishuConfigRecord[]> {
    return this.db.select()
      .from(botFeishuConfigs)
      .where(and(
        eq(botFeishuConfigs.enabled, true),
        ne(botFeishuConfigs.appId, ''),
      ))
      .all();
  }

  async update(input: UpdateBotFeishuConfigInput): Promise<BotFeishuConfigRecord> {
    const botInstanceId = input.botInstanceId.trim();
    const appId = input.appId.trim();
    const appSecret = input.appSecret?.trim() || '';

    if (!botInstanceId) throw new Error('Bot instance ID is required.');
    if (input.enabled && !appId) throw new Error('Feishu App ID is required when enabled.');

    return this.db.transaction((tx) => {
      const current = tx.select()
        .from(botFeishuConfigs)
        .where(eq(botFeishuConfigs.botInstanceId, botInstanceId))
        .get();
      if (!current) throw new Error('Bot Feishu config must be initialized before update.');

      const nextSecret = appSecret || current.appSecret;

      const changed = input.enabled !== current.enabled
        || appId !== current.appId
        || nextSecret !== current.appSecret;
      if (!changed) return current;

      const updatedAt = input.updatedAt ?? new Date();
      tx.update(botFeishuConfigs).set({
        appId,
        appSecret: nextSecret,
        enabled: input.enabled,
        eventStatus: input.enabled ? 'connecting' : 'disabled',
        lastError: null,
        observedRevision: null,
        revision: current.revision + 1,
        updatedAt,
        updatedByUserId: input.updatedByUserId ?? null,
      }).where(eq(botFeishuConfigs.botInstanceId, botInstanceId)).run();

      return tx.select()
        .from(botFeishuConfigs)
        .where(eq(botFeishuConfigs.botInstanceId, botInstanceId))
        .get()!;
    }, { behavior: 'immediate' });
  }

  async disable(input: {
    botInstanceId: string;
    updatedAt?: Date;
    updatedByUserId?: string | null;
  }): Promise<BotFeishuConfigRecord> {
    return this.db.transaction((tx) => {
      const current = tx.select()
        .from(botFeishuConfigs)
        .where(eq(botFeishuConfigs.botInstanceId, input.botInstanceId))
        .get();
      if (!current) throw new Error('Bot Feishu config must be initialized before disabling.');
      if (!current.enabled) return current;

      const updatedAt = input.updatedAt ?? new Date();
      tx.update(botFeishuConfigs).set({
        enabled: false,
        eventStatus: 'disabled',
        lastError: null,
        observedRevision: null,
        revision: current.revision + 1,
        updatedAt,
        updatedByUserId: input.updatedByUserId ?? null,
      }).where(eq(botFeishuConfigs.botInstanceId, input.botInstanceId)).run();

      return tx.select()
        .from(botFeishuConfigs)
        .where(eq(botFeishuConfigs.botInstanceId, input.botInstanceId))
        .get()!;
    }, { behavior: 'immediate' });
  }

  async clearCredentials(input: {
    botInstanceId: string;
    updatedAt?: Date;
    updatedByUserId?: string | null;
  }): Promise<BotFeishuConfigRecord> {
    return this.db.transaction((tx) => {
      const current = tx.select()
        .from(botFeishuConfigs)
        .where(eq(botFeishuConfigs.botInstanceId, input.botInstanceId))
        .get();
      if (!current) throw new Error('Bot Feishu config must be initialized before clearing.');

      const changed = current.enabled || current.appId || current.appSecret;
      if (!changed) return current;

      const updatedAt = input.updatedAt ?? new Date();
      tx.update(botFeishuConfigs).set({
        appId: '',
        appSecret: '',
        enabled: false,
        eventStatus: 'not_configured',
        lastError: null,
        observedRevision: null,
        revision: current.revision + 1,
        updatedAt,
        updatedByUserId: input.updatedByUserId ?? null,
      }).where(eq(botFeishuConfigs.botInstanceId, input.botInstanceId)).run();

      return tx.select()
        .from(botFeishuConfigs)
        .where(eq(botFeishuConfigs.botInstanceId, input.botInstanceId))
        .get()!;
    }, { behavior: 'immediate' });
  }

  async recordEventStatus(
    input: RecordBotFeishuEventStatusInput,
  ): Promise<BotFeishuConfigRecord | null> {
    const updatedAt = input.updatedAt ?? new Date();
    this.db.update(botFeishuConfigs).set({
      eventStatus: input.status,
      ...(input.connectedAt === undefined ? {} : { lastConnectedAt: input.connectedAt }),
      ...(input.disconnectedAt === undefined ? {} : { lastDisconnectedAt: input.disconnectedAt }),
      lastError: input.error?.trim() || null,
      observedRevision: input.observedRevision,
      updatedAt,
    }).where(and(
      eq(botFeishuConfigs.botInstanceId, input.botInstanceId),
      eq(botFeishuConfigs.revision, input.observedRevision),
    )).run();
    return this.findByBotInstanceId(input.botInstanceId);
  }

  async recordActivity(input: {
    botInstanceId: string;
    inboundAt?: Date;
    outboundAt?: Date;
  }): Promise<void> {
    this.db.update(botFeishuConfigs).set({
      ...(input.inboundAt === undefined ? {} : { lastInboundAt: input.inboundAt }),
      ...(input.outboundAt === undefined ? {} : { lastOutboundAt: input.outboundAt }),
      updatedAt: input.outboundAt ?? input.inboundAt ?? new Date(),
    }).where(eq(botFeishuConfigs.botInstanceId, input.botInstanceId)).run();
  }

  async recordOwnerOpenId(
    botInstanceId: string,
    ownerOpenId: string,
    recordedAt: Date = new Date(),
  ): Promise<void> {
    const normalized = ownerOpenId.trim();
    if (!normalized) return;
    this.db.update(botFeishuConfigs).set({
      ownerOpenId: normalized,
      updatedAt: recordedAt,
    }).where(and(
      eq(botFeishuConfigs.botInstanceId, botInstanceId),
      or(
        eq(botFeishuConfigs.ownerOpenId, ''),
        isNull(botFeishuConfigs.ownerOpenId),
      ),
    )).run();
  }
}
