import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  globalImagegenConfigs,
  GLOBAL_IMAGEGEN_CONFIG_ID,
} from '../schema/global-imagegen-configs';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;
type Row = typeof globalImagegenConfigs.$inferSelect;

export interface UpdateGlobalImagegenConfigInput {
  enabled: boolean;
  endpoint: string;
  apiKey: string;
  model: string;
  updatedAt?: Date;
  updatedByUserId: string;
}

export class GlobalImagegenConfigRepository {
  constructor(private readonly db: Db) {}

  async find(): Promise<Row | null> {
    return this.db.select().from(globalImagegenConfigs)
      .where(eq(globalImagegenConfigs.id, GLOBAL_IMAGEGEN_CONFIG_ID)).get() ?? null;
  }

  async ensure(createdAt: Date = new Date()): Promise<Row> {
    this.db.insert(globalImagegenConfigs)
      .values({
        id: GLOBAL_IMAGEGEN_CONFIG_ID,
        createdAt,
        updatedAt: createdAt,
      })
      .onConflictDoNothing({ target: globalImagegenConfigs.id })
      .run();
    const config = await this.find();
    if (!config) throw new Error('Failed to ensure global imagegen config.');
    return config;
  }

  async update(input: UpdateGlobalImagegenConfigInput): Promise<Row> {
    const current = await this.ensure(input.updatedAt ?? new Date());
    const now = input.updatedAt ?? new Date();
    this.db.update(globalImagegenConfigs)
      .set({
        enabled: input.enabled,
        endpoint: input.endpoint,
        apiKey: input.apiKey,
        model: input.model,
        revision: current.revision + 1,
        observedRevision: current.revision,
        updatedByUserId: input.updatedByUserId,
        updatedAt: now,
      })
      .where(eq(globalImagegenConfigs.id, GLOBAL_IMAGEGEN_CONFIG_ID))
      .run();
    const row = await this.find();
    if (!row) throw new Error('Failed to update global imagegen config.');
    return row;
  }
}
