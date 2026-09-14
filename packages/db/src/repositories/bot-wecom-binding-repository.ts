import { and, desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { botInstances } from '../schema/bot-instances';
import { botWecomBindings } from '../schema/bot-wecom-bindings';
import { employeeDirectoryEntries } from '../schema/employee-directory-entries';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;

export interface BotWecomBindingRecord {
  botInstanceId: string;
  createdAt: Date;
  employeeEnabled: boolean | null;
  employeeId: string | null;
  enabled: boolean;
  lastError: string | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  legalName: string | null;
  nickname: string | null;
  preferredForProactive: boolean;
  updatedAt: Date;
  wecomUserId: string;
}

export class BotWecomBindingRepository {
  constructor(private readonly db: Db) {}

  async listAll(): Promise<BotWecomBindingRecord[]> {
    return this.selectJoined().orderBy(desc(botWecomBindings.updatedAt)).all().map(mapJoined);
  }

  async findByBotInstanceId(botInstanceId: string): Promise<BotWecomBindingRecord | null> {
    const row = this.selectJoined()
      .where(eq(botWecomBindings.botInstanceId, botInstanceId))
      .get();
    return row ? mapJoined(row) : null;
  }

  async findActiveByWecomUserId(wecomUserId: string): Promise<BotWecomBindingRecord | null> {
    const row = this.selectJoined().where(and(
      eq(botWecomBindings.wecomUserId, normalizeWecomUserId(wecomUserId)),
      eq(botWecomBindings.enabled, true),
    )).get();
    if (!row) return null;
    if (row.binding.employeeId !== null && row.employee?.enabled !== true) return null;
    return mapJoined(row);
  }

  async findPreferredByBotInstanceId(botInstanceId: string): Promise<BotWecomBindingRecord | null> {
    const row = this.selectJoined().where(and(
      eq(botWecomBindings.botInstanceId, botInstanceId),
      eq(botWecomBindings.enabled, true),
      eq(botWecomBindings.preferredForProactive, true),
    )).get();
    return row ? mapJoined(row) : null;
  }

  async upsert(input: {
    botInstanceId: string;
    employeeId?: string | null;
    enabled?: boolean;
    preferredForProactive?: boolean;
    updatedAt?: Date;
    wecomUserId: string;
  }): Promise<BotWecomBindingRecord> {
    const bot = this.db.select({ id: botInstances.id }).from(botInstances)
      .where(eq(botInstances.id, input.botInstanceId)).get();
    if (!bot) throw new Error('Bot does not exist.');

    const employeeId = input.employeeId ?? null;
    if (employeeId) {
      const employee = this.db.select().from(employeeDirectoryEntries)
        .where(eq(employeeDirectoryEntries.id, employeeId)).get();
      if (!employee) throw new Error('Employee does not exist.');
      if (employee.claimedBotInstanceId !== input.botInstanceId) {
        throw new Error('Employee is not associated with this Bot.');
      }
    }

    const updatedAt = input.updatedAt ?? new Date();
    this.db.insert(botWecomBindings).values({
      botInstanceId: input.botInstanceId,
      createdAt: updatedAt,
      employeeId,
      enabled: input.enabled ?? true,
      preferredForProactive: input.preferredForProactive ?? true,
      updatedAt,
      wecomUserId: normalizeWecomUserId(input.wecomUserId),
    }).onConflictDoUpdate({
      target: botWecomBindings.botInstanceId,
      set: {
        employeeId,
        enabled: input.enabled ?? true,
        lastError: null,
        preferredForProactive: input.preferredForProactive ?? true,
        updatedAt,
        wecomUserId: normalizeWecomUserId(input.wecomUserId),
      },
    }).run();

    const binding = await this.findByBotInstanceId(input.botInstanceId);
    if (!binding) throw new Error('Failed to save Bot WeCom binding.');
    return binding;
  }

  async deleteByBotInstanceId(botInstanceId: string): Promise<boolean> {
    return this.db.delete(botWecomBindings)
      .where(eq(botWecomBindings.botInstanceId, botInstanceId))
      .run().changes > 0;
  }

  async recordInbound(botInstanceId: string, observedAt: Date = new Date()): Promise<void> {
    this.db.update(botWecomBindings).set({
      lastError: null,
      lastInboundAt: observedAt,
      updatedAt: observedAt,
    }).where(eq(botWecomBindings.botInstanceId, botInstanceId)).run();
  }

  async recordOutbound(botInstanceId: string, observedAt: Date = new Date()): Promise<void> {
    this.db.update(botWecomBindings).set({
      lastError: null,
      lastOutboundAt: observedAt,
      updatedAt: observedAt,
    }).where(eq(botWecomBindings.botInstanceId, botInstanceId)).run();
  }

  async recordError(botInstanceId: string, error: string, observedAt: Date = new Date()): Promise<void> {
    this.db.update(botWecomBindings).set({
      lastError: error.trim().slice(0, 1000),
      updatedAt: observedAt,
    }).where(eq(botWecomBindings.botInstanceId, botInstanceId)).run();
  }

  private selectJoined() {
    return this.db.select({
      binding: botWecomBindings,
      employee: employeeDirectoryEntries,
    }).from(botWecomBindings).leftJoin(
      employeeDirectoryEntries,
      eq(botWecomBindings.employeeId, employeeDirectoryEntries.id),
    );
  }
}

function normalizeWecomUserId(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128) throw new Error('Invalid WeCom user ID.');
  return normalized;
}

function mapJoined(row: {
  binding: typeof botWecomBindings.$inferSelect;
  employee: typeof employeeDirectoryEntries.$inferSelect | null;
}): BotWecomBindingRecord {
  return {
    botInstanceId: row.binding.botInstanceId,
    createdAt: row.binding.createdAt,
    employeeEnabled: row.employee?.enabled ?? null,
    employeeId: row.binding.employeeId,
    enabled: row.binding.enabled,
    lastError: row.binding.lastError,
    lastInboundAt: row.binding.lastInboundAt,
    lastOutboundAt: row.binding.lastOutboundAt,
    legalName: row.employee?.legalName ?? null,
    nickname: row.employee?.nickname ?? null,
    preferredForProactive: row.binding.preferredForProactive,
    updatedAt: row.binding.updatedAt,
    wecomUserId: row.binding.wecomUserId,
  };
}
