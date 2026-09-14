import { desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { deliveryHealthChecks } from '../schema/delivery-health-checks';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;
type Row = typeof deliveryHealthChecks.$inferSelect;

export interface SaveDeliveryHealthCheckInput {
  id: string;
  checkDate: string;
  summaryJson: string;
  alertSent: boolean;
  createdAt?: Date;
}

export class DeliveryHealthCheckRepository {
  constructor(private readonly db: Db) {}

  async upsertByDate(input: SaveDeliveryHealthCheckInput): Promise<Row> {
    const existing = await this.findByDate(input.checkDate);
    if (existing) {
      this.db.update(deliveryHealthChecks)
        .set({
          summaryJson: input.summaryJson,
          alertSent: input.alertSent,
        })
        .where(eq(deliveryHealthChecks.checkDate, input.checkDate))
        .run();
      return (await this.findByDate(input.checkDate))!;
    }
    this.db.insert(deliveryHealthChecks).values({
      id: input.id,
      checkDate: input.checkDate,
      summaryJson: input.summaryJson,
      alertSent: input.alertSent,
      createdAt: input.createdAt ?? new Date(),
    }).run();
    return (await this.findByDate(input.checkDate))!;
  }

  async findByDate(checkDate: string): Promise<Row | null> {
    return this.db.select().from(deliveryHealthChecks)
      .where(eq(deliveryHealthChecks.checkDate, checkDate)).get() ?? null;
  }

  async listRecent(limit = 30): Promise<Row[]> {
    return this.db.select().from(deliveryHealthChecks)
      .orderBy(desc(deliveryHealthChecks.checkDate), desc(deliveryHealthChecks.createdAt))
      .limit(limit).all();
  }
}
