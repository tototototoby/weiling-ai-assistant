import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { botAgentConfigOverrideRevisions } from '../schema/bot-agent-config-override-revisions';
import { botAgentConfigOverrides } from '../schema/bot-agent-config-overrides';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;
type OverrideRow = typeof botAgentConfigOverrides.$inferSelect;
type RevisionRow = typeof botAgentConfigOverrideRevisions.$inferSelect;

export interface BotAgentConfigOverrideRecord {
  agentsAppendix: string;
  botInstanceId: string;
  changeReason: string;
  createdAt: Date;
  revision: number;
  soulAppendix: string;
  updatedAt: Date;
  updatedByEmail: string;
}

export interface BotAgentConfigOverrideRevisionRecord {
  agentsAppendix: string;
  botInstanceId: string;
  changeReason: string;
  createdAt: Date;
  id: string;
  revision: number;
  soulAppendix: string;
  updatedByEmail: string;
}

export interface UpdateBotAgentConfigOverrideInput {
  agentsAppendix: string;
  changeReason: string;
  soulAppendix: string;
  updatedAt?: Date;
  updatedByEmail: string;
}

export class BotAgentConfigOverrideRepository {
  constructor(private readonly db: Db) {}

  async findByBotId(botInstanceId: string): Promise<BotAgentConfigOverrideRecord | null> {
    const row = this.db.select().from(botAgentConfigOverrides)
      .where(eq(botAgentConfigOverrides.botInstanceId, botInstanceId)).get();
    return row ? mapOverride(row) : null;
  }

  async listRevisions(
    botInstanceId: string,
    limit = 20,
  ): Promise<BotAgentConfigOverrideRevisionRecord[]> {
    return this.db.select().from(botAgentConfigOverrideRevisions)
      .where(eq(botAgentConfigOverrideRevisions.botInstanceId, botInstanceId))
      .orderBy(desc(botAgentConfigOverrideRevisions.revision))
      .limit(Math.max(1, Math.min(limit, 100)))
      .all()
      .map(mapRevision);
  }

  async update(
    botInstanceId: string,
    input: UpdateBotAgentConfigOverrideInput,
  ): Promise<BotAgentConfigOverrideRecord> {
    validateInput(input);
    const updatedAt = input.updatedAt ?? new Date();

    this.db.transaction((tx) => {
      const current = tx.select().from(botAgentConfigOverrides)
        .where(eq(botAgentConfigOverrides.botInstanceId, botInstanceId)).get();
      const revision = (current?.revision ?? 0) + 1;
      const values = {
        agentsAppendix: input.agentsAppendix.trim(),
        changeReason: input.changeReason.trim(),
        revision,
        soulAppendix: input.soulAppendix.trim(),
        updatedAt,
        updatedByEmail: input.updatedByEmail.trim().toLowerCase(),
      };

      tx.insert(botAgentConfigOverrides).values({
        botInstanceId,
        createdAt: current?.createdAt ?? updatedAt,
        ...values,
      }).onConflictDoUpdate({
        target: botAgentConfigOverrides.botInstanceId,
        set: values,
      }).run();

      tx.insert(botAgentConfigOverrideRevisions).values({
        id: randomUUID(),
        botInstanceId,
        createdAt: updatedAt,
        ...values,
      }).run();
    }, { behavior: 'immediate' });

    const updated = await this.findByBotId(botInstanceId);
    if (!updated) throw new Error('Failed to update Bot agent config override.');
    return updated;
  }

  async restoreRevision(
    botInstanceId: string,
    sourceRevision: number,
    audit: Pick<UpdateBotAgentConfigOverrideInput, 'changeReason' | 'updatedAt' | 'updatedByEmail'>,
  ): Promise<BotAgentConfigOverrideRecord | null> {
    const source = this.db.select().from(botAgentConfigOverrideRevisions).where(and(
      eq(botAgentConfigOverrideRevisions.botInstanceId, botInstanceId),
      eq(botAgentConfigOverrideRevisions.revision, sourceRevision),
    )).get();
    if (!source) return null;

    return this.update(botInstanceId, {
      agentsAppendix: source.agentsAppendix,
      soulAppendix: source.soulAppendix,
      ...audit,
    });
  }
}

function validateInput(input: UpdateBotAgentConfigOverrideInput): void {
  if (input.agentsAppendix.length > 200_000 || input.soulAppendix.length > 200_000) {
    throw new Error('Bot agent config override exceeds the maximum document length.');
  }
  if (!input.changeReason.trim() || input.changeReason.trim().length > 500) {
    throw new Error('Bot agent config override change reason is required and must be at most 500 characters.');
  }
  if (!input.updatedByEmail.trim()) {
    throw new Error('Bot agent config override administrator is required.');
  }
}

function mapOverride(row: OverrideRow): BotAgentConfigOverrideRecord {
  return row;
}

function mapRevision(row: RevisionRow): BotAgentConfigOverrideRevisionRecord {
  return row;
}
