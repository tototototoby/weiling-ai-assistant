import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  globalBroadcastConfigs,
  GLOBAL_BROADCAST_CONFIG_ID,
} from '../schema/global-broadcast-configs';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;
type Row = typeof globalBroadcastConfigs.$inferSelect;

export interface UpdateGlobalBroadcastConfigInput {
  enabled: boolean;
  authorizedEmployeeIds: string[];
  rateLimitMinutes: number;
  updatedAt?: Date;
  updatedByUserId: string;
}

export class GlobalBroadcastConfigRepository {
  constructor(private readonly db: Db) {}

  async find(): Promise<Row | null> {
    return this.db.select().from(globalBroadcastConfigs)
      .where(eq(globalBroadcastConfigs.id, GLOBAL_BROADCAST_CONFIG_ID)).get() ?? null;
  }

  async ensure(createdAt: Date = new Date()): Promise<Row> {
    this.db.insert(globalBroadcastConfigs)
      .values({
        id: GLOBAL_BROADCAST_CONFIG_ID,
        createdAt,
        updatedAt: createdAt,
      })
      .onConflictDoNothing({ target: globalBroadcastConfigs.id })
      .run();
    const config = await this.find();
    if (!config) throw new Error('Failed to ensure global broadcast config.');
    return config;
  }

  async update(input: UpdateGlobalBroadcastConfigInput): Promise<Row> {
    const current = await this.ensure(input.updatedAt ?? new Date());
    const now = input.updatedAt ?? new Date();
    this.db.update(globalBroadcastConfigs)
      .set({
        enabled: input.enabled,
        authorizedEmployeeIdsJson: JSON.stringify(input.authorizedEmployeeIds),
        rateLimitMinutes: input.rateLimitMinutes,
        revision: current.revision + 1,
        observedRevision: current.revision,
        updatedByUserId: input.updatedByUserId,
        updatedAt: now,
      })
      .where(eq(globalBroadcastConfigs.id, GLOBAL_BROADCAST_CONFIG_ID))
      .run();
    const row = await this.find();
    if (!row) throw new Error('Failed to update global broadcast config.');
    return row;
  }
}
