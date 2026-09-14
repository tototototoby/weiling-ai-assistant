import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  globalDeliveryHealthConfigs,
  GLOBAL_DELIVERY_HEALTH_CONFIG_ID,
} from '../schema/global-delivery-health-configs';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;
type Row = typeof globalDeliveryHealthConfigs.$inferSelect;

export interface UpdateGlobalDeliveryHealthConfigInput {
  enabled: boolean;
  checkTime: string;
  failedThreshold: number;
  stuckHours: number;
  alertEmail?: string | null;
  updatedAt?: Date;
  updatedByUserId: string;
}

export class GlobalDeliveryHealthConfigRepository {
  constructor(private readonly db: Db) {}

  async find(): Promise<Row | null> {
    return this.db.select().from(globalDeliveryHealthConfigs)
      .where(eq(globalDeliveryHealthConfigs.id, GLOBAL_DELIVERY_HEALTH_CONFIG_ID)).get() ?? null;
  }

  async ensure(createdAt: Date = new Date()): Promise<Row> {
    this.db.insert(globalDeliveryHealthConfigs)
      .values({
        id: GLOBAL_DELIVERY_HEALTH_CONFIG_ID,
        createdAt,
        updatedAt: createdAt,
      })
      .onConflictDoNothing({ target: globalDeliveryHealthConfigs.id })
      .run();
    const config = await this.find();
    if (!config) throw new Error('Failed to ensure global delivery health config.');
    return config;
  }

  async update(input: UpdateGlobalDeliveryHealthConfigInput): Promise<Row> {
    const current = await this.ensure(input.updatedAt ?? new Date());
    const now = input.updatedAt ?? new Date();
    this.db.update(globalDeliveryHealthConfigs)
      .set({
        enabled: input.enabled,
        checkTime: input.checkTime,
        failedThreshold: input.failedThreshold,
        stuckHours: input.stuckHours,
        alertEmail: input.alertEmail ?? null,
        revision: current.revision + 1,
        observedRevision: current.revision,
        updatedByUserId: input.updatedByUserId,
        updatedAt: now,
      })
      .where(eq(globalDeliveryHealthConfigs.id, GLOBAL_DELIVERY_HEALTH_CONFIG_ID))
      .run();
    const row = await this.find();
    if (!row) throw new Error('Failed to update global delivery health config.');
    return row;
  }
}
