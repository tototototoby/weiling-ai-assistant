import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  globalWecomConfigs,
  GLOBAL_WECOM_CONFIG_ID,
  type WecomConnectionStatus,
} from '../schema/global-wecom-configs';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;

export interface GlobalWecomConfigRecord {
  botId: string;
  connectionStatus: WecomConnectionStatus;
  createdAt: Date;
  enabled: boolean;
  id: string;
  lastConnectedAt: Date | null;
  lastDisconnectedAt: Date | null;
  lastError: string | null;
  observedRevision: number | null;
  revision: number;
  secret: string;
  updatedAt: Date;
  updatedByUserId: string | null;
  wsUrl: string;
}

export interface UpdateGlobalWecomConfigInput {
  botId: string;
  enabled: boolean;
  secret?: string;
  updatedAt?: Date;
  updatedByUserId: string;
  wsUrl?: string;
}

export class GlobalWecomConfigRepository {
  constructor(private readonly db: Db) {}

  async find(): Promise<GlobalWecomConfigRecord | null> {
    return this.db.select()
      .from(globalWecomConfigs)
      .where(eq(globalWecomConfigs.id, GLOBAL_WECOM_CONFIG_ID))
      .get() ?? null;
  }

  async ensure(createdAt: Date = new Date()): Promise<GlobalWecomConfigRecord> {
    this.db.insert(globalWecomConfigs)
      .values({ id: GLOBAL_WECOM_CONFIG_ID, createdAt, updatedAt: createdAt })
      .onConflictDoNothing({ target: globalWecomConfigs.id })
      .run();
    const config = await this.find();
    if (!config) throw new Error('Failed to ensure global WeCom config.');
    return config;
  }

  async update(input: UpdateGlobalWecomConfigInput): Promise<GlobalWecomConfigRecord> {
    const botId = input.botId.trim();
    const secret = input.secret?.trim() || '';
    const wsUrl = normalizeWsUrl(input.wsUrl);

    if (input.enabled && !botId) throw new Error('WeCom Bot ID is required when enabled.');
    if (input.enabled && !wsUrl) throw new Error('WeCom WebSocket URL is required when enabled.');

    return this.db.transaction((tx) => {
      const current = tx.select()
        .from(globalWecomConfigs)
        .where(eq(globalWecomConfigs.id, GLOBAL_WECOM_CONFIG_ID))
        .get();
      if (!current) throw new Error('Global WeCom config must be initialized before update.');

      const nextSecret = secret || current.secret;
      if (input.enabled && !nextSecret) throw new Error('WeCom Secret is required when enabled.');

      const changed = input.enabled !== current.enabled
        || botId !== current.botId
        || nextSecret !== current.secret
        || wsUrl !== current.wsUrl;
      if (!changed) return current;

      const updatedAt = input.updatedAt ?? new Date();
      tx.update(globalWecomConfigs).set({
        botId,
        connectionStatus: input.enabled ? 'connecting' : 'disabled',
        enabled: input.enabled,
        lastError: null,
        observedRevision: null,
        revision: current.revision + 1,
        secret: nextSecret,
        updatedAt,
        updatedByUserId: input.updatedByUserId,
        wsUrl,
      }).where(eq(globalWecomConfigs.id, GLOBAL_WECOM_CONFIG_ID)).run();

      return tx.select()
        .from(globalWecomConfigs)
        .where(eq(globalWecomConfigs.id, GLOBAL_WECOM_CONFIG_ID))
        .get()!;
    }, { behavior: 'immediate' });
  }

  async requestReconnect(input: {
    requestedAt?: Date;
    updatedByUserId: string;
  }): Promise<GlobalWecomConfigRecord> {
    return this.db.transaction((tx) => {
      const current = tx.select()
        .from(globalWecomConfigs)
        .where(eq(globalWecomConfigs.id, GLOBAL_WECOM_CONFIG_ID))
        .get();
      if (!current) throw new Error('Global WeCom config must be initialized before reconnect.');
      if (!current.enabled) throw new Error('Global WeCom config must be enabled before reconnect.');

      tx.update(globalWecomConfigs).set({
        connectionStatus: 'connecting',
        lastError: null,
        observedRevision: null,
        revision: current.revision + 1,
        updatedAt: input.requestedAt ?? new Date(),
        updatedByUserId: input.updatedByUserId,
      }).where(eq(globalWecomConfigs.id, GLOBAL_WECOM_CONFIG_ID)).run();

      return tx.select()
        .from(globalWecomConfigs)
        .where(eq(globalWecomConfigs.id, GLOBAL_WECOM_CONFIG_ID))
        .get()!;
    }, { behavior: 'immediate' });
  }

  async recordConnectionStatus(input: {
    connectedAt?: Date | null;
    disconnectedAt?: Date | null;
    error?: string | null;
    observedRevision: number;
    status: WecomConnectionStatus;
    updatedAt?: Date;
  }): Promise<GlobalWecomConfigRecord | null> {
    const updatedAt = input.updatedAt ?? new Date();
    this.db.update(globalWecomConfigs).set({
      connectionStatus: input.status,
      ...(input.connectedAt === undefined ? {} : { lastConnectedAt: input.connectedAt }),
      ...(input.disconnectedAt === undefined ? {} : { lastDisconnectedAt: input.disconnectedAt }),
      lastError: input.error?.trim() || null,
      observedRevision: input.observedRevision,
      updatedAt,
    }).where(and(
      eq(globalWecomConfigs.id, GLOBAL_WECOM_CONFIG_ID),
      eq(globalWecomConfigs.revision, input.observedRevision),
    )).run();
    return this.find();
  }
}

function normalizeWsUrl(value?: string): string {
  const normalized = value?.trim() || 'wss://openws.work.weixin.qq.com';
  const parsed = new URL(normalized);
  if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') {
    throw new Error('WeCom WebSocket URL must use WS or WSS.');
  }
  return parsed.toString().replace(/\/$/, '');
}
