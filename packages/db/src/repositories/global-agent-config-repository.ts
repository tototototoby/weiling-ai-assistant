import { asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { botAgentConfigSyncStates } from '../schema/bot-agent-config-sync-states';
import { globalAgentConfigs, GLOBAL_AGENT_CONFIG_ID } from '../schema/global-agent-configs';
import { globalAgentSkillPolicies } from '../schema/global-agent-skill-policies';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;

export interface GlobalAgentConfigRecord {
  agentsMarkdown: string;
  createdAt: Date;
  id: string;
  revision: number;
  soulMarkdown: string;
  updatedAt: Date;
}

export interface GlobalAgentSkillPolicyRecord {
  createdAt: Date;
  enabled: boolean;
  skillName: string;
  updatedAt: Date;
}

export interface GlobalAgentConfigSnapshot {
  config: GlobalAgentConfigRecord;
  skills: GlobalAgentSkillPolicyRecord[];
}

export interface GlobalAgentSkillPolicyInput {
  enabled: boolean;
  skillName: string;
}

export interface EnsureGlobalAgentConfigInput {
  agentsMarkdown: string;
  createdAt?: Date;
  skills: GlobalAgentSkillPolicyInput[];
  soulMarkdown: string;
}

export interface UpdateGlobalAgentDocumentsInput {
  agentsMarkdown?: string;
  soulMarkdown?: string;
  updatedAt?: Date;
}

export class GlobalAgentConfigRepository {
  constructor(private readonly db: Db) {}

  async find(): Promise<GlobalAgentConfigRecord | null> {
    const row = this.db.select()
      .from(globalAgentConfigs)
      .where(eq(globalAgentConfigs.id, GLOBAL_AGENT_CONFIG_ID))
      .get();

    return row ?? null;
  }

  async listSkillPolicies(): Promise<GlobalAgentSkillPolicyRecord[]> {
    return this.db.select()
      .from(globalAgentSkillPolicies)
      .orderBy(asc(globalAgentSkillPolicies.skillName))
      .all();
  }

  async getSnapshot(): Promise<GlobalAgentConfigSnapshot | null> {
    const config = await this.find();

    if (!config) {
      return null;
    }

    return {
      config,
      skills: await this.listSkillPolicies(),
    };
  }

  async ensure(input: EnsureGlobalAgentConfigInput): Promise<GlobalAgentConfigSnapshot> {
    validateDocument(input.agentsMarkdown, 'AGENTS.md');
    validateDocument(input.soulMarkdown, 'SOUL.md');
    const skills = normalizeSkillInputs(input.skills);

    return this.db.transaction((tx) => {
      const existing = tx.select()
        .from(globalAgentConfigs)
        .where(eq(globalAgentConfigs.id, GLOBAL_AGENT_CONFIG_ID))
        .get();

      if (!existing) {
        const createdAt = input.createdAt ?? new Date();
        tx.insert(globalAgentConfigs).values({
          agentsMarkdown: input.agentsMarkdown,
          createdAt,
          id: GLOBAL_AGENT_CONFIG_ID,
          revision: 1,
          soulMarkdown: input.soulMarkdown,
          updatedAt: createdAt,
        }).run();

        if (skills.length > 0) {
          tx.insert(globalAgentSkillPolicies).values(skills.map((skill) => ({
            ...skill,
            createdAt,
            updatedAt: createdAt,
          }))).run();
        }
      }

      const config = tx.select()
        .from(globalAgentConfigs)
        .where(eq(globalAgentConfigs.id, GLOBAL_AGENT_CONFIG_ID))
        .get();

      if (!config) {
        throw new Error('Failed to ensure global agent config.');
      }

      return {
        config,
        skills: tx.select()
          .from(globalAgentSkillPolicies)
          .orderBy(asc(globalAgentSkillPolicies.skillName))
          .all(),
      };
    }, { behavior: 'immediate' });
  }

  async updateDocuments(
    input: UpdateGlobalAgentDocumentsInput,
  ): Promise<GlobalAgentConfigRecord | null> {
    if (input.agentsMarkdown !== undefined) {
      validateDocument(input.agentsMarkdown, 'AGENTS.md');
    }

    if (input.soulMarkdown !== undefined) {
      validateDocument(input.soulMarkdown, 'SOUL.md');
    }

    return this.db.transaction((tx) => {
      const current = tx.select()
        .from(globalAgentConfigs)
        .where(eq(globalAgentConfigs.id, GLOBAL_AGENT_CONFIG_ID))
        .get();

      if (!current) {
        return null;
      }

      const agentsMarkdown = input.agentsMarkdown ?? current.agentsMarkdown;
      const soulMarkdown = input.soulMarkdown ?? current.soulMarkdown;

      if (agentsMarkdown === current.agentsMarkdown && soulMarkdown === current.soulMarkdown) {
        return current;
      }

      const updatedAt = input.updatedAt ?? new Date();
      tx.update(globalAgentConfigs)
        .set({
          agentsMarkdown,
          revision: current.revision + 1,
          soulMarkdown,
          updatedAt,
        })
        .where(eq(globalAgentConfigs.id, GLOBAL_AGENT_CONFIG_ID))
        .run();
      markAllBotSyncStatesPending(tx, updatedAt);

      return tx.select()
        .from(globalAgentConfigs)
        .where(eq(globalAgentConfigs.id, GLOBAL_AGENT_CONFIG_ID))
        .get() ?? null;
    }, { behavior: 'immediate' });
  }

  async setSkillEnabled(
    skillName: string,
    enabled: boolean,
    updatedAt: Date = new Date(),
  ): Promise<GlobalAgentConfigRecord | null> {
    const normalizedName = normalizeSkillName(skillName);

    return this.db.transaction((tx) => {
      const config = tx.select()
        .from(globalAgentConfigs)
        .where(eq(globalAgentConfigs.id, GLOBAL_AGENT_CONFIG_ID))
        .get();

      if (!config) {
        return null;
      }

      const current = tx.select()
        .from(globalAgentSkillPolicies)
        .where(eq(globalAgentSkillPolicies.skillName, normalizedName))
        .get();

      if (current?.enabled === enabled) {
        return config;
      }

      tx.insert(globalAgentSkillPolicies)
        .values({
          createdAt: current?.createdAt ?? updatedAt,
          enabled,
          skillName: normalizedName,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: globalAgentSkillPolicies.skillName,
          set: { enabled, updatedAt },
        })
        .run();
      bumpRevisionAndMarkPending(tx, config.revision, updatedAt);

      return tx.select()
        .from(globalAgentConfigs)
        .where(eq(globalAgentConfigs.id, GLOBAL_AGENT_CONFIG_ID))
        .get() ?? null;
    }, { behavior: 'immediate' });
  }

  async bulkSetSkills(
    input: GlobalAgentSkillPolicyInput[],
    updatedAt: Date = new Date(),
  ): Promise<GlobalAgentConfigRecord | null> {
    const skills = normalizeSkillInputs(input);

    return this.db.transaction((tx) => {
      const config = tx.select()
        .from(globalAgentConfigs)
        .where(eq(globalAgentConfigs.id, GLOBAL_AGENT_CONFIG_ID))
        .get();

      if (!config) {
        return null;
      }

      const currentPolicies = new Map(
        tx.select().from(globalAgentSkillPolicies).all()
          .map((policy) => [policy.skillName, policy]),
      );
      const changed = skills.filter((skill) => (
        currentPolicies.get(skill.skillName)?.enabled !== skill.enabled
      ));

      if (changed.length === 0) {
        return config;
      }

      for (const skill of changed) {
        const current = currentPolicies.get(skill.skillName);
        tx.insert(globalAgentSkillPolicies)
          .values({
            createdAt: current?.createdAt ?? updatedAt,
            enabled: skill.enabled,
            skillName: skill.skillName,
            updatedAt,
          })
          .onConflictDoUpdate({
            target: globalAgentSkillPolicies.skillName,
            set: { enabled: skill.enabled, updatedAt },
          })
          .run();
      }

      bumpRevisionAndMarkPending(tx, config.revision, updatedAt);

      return tx.select()
        .from(globalAgentConfigs)
        .where(eq(globalAgentConfigs.id, GLOBAL_AGENT_CONFIG_ID))
        .get() ?? null;
    }, { behavior: 'immediate' });
  }
}

function bumpRevisionAndMarkPending(
  tx: Parameters<Parameters<Db['transaction']>[0]>[0],
  currentRevision: number,
  updatedAt: Date,
): void {
  tx.update(globalAgentConfigs)
    .set({ revision: currentRevision + 1, updatedAt })
    .where(eq(globalAgentConfigs.id, GLOBAL_AGENT_CONFIG_ID))
    .run();
  markAllBotSyncStatesPending(tx, updatedAt);
}

function markAllBotSyncStatesPending(
  tx: Parameters<Parameters<Db['transaction']>[0]>[0],
  updatedAt: Date,
): void {
  tx.update(botAgentConfigSyncStates)
    .set({
      lastSyncError: null,
      syncStatus: 'pending',
      updatedAt,
    })
    .run();
}

function normalizeSkillInputs(
  input: GlobalAgentSkillPolicyInput[],
): GlobalAgentSkillPolicyInput[] {
  const normalized = new Map<string, boolean>();

  for (const skill of input) {
    normalized.set(normalizeSkillName(skill.skillName), skill.enabled);
  }

  return [...normalized.entries()]
    .map(([skillName, enabled]) => ({ enabled, skillName }))
    .sort((left, right) => left.skillName.localeCompare(right.skillName));
}

function normalizeSkillName(skillName: string): string {
  const normalized = skillName.trim();

  if (!normalized) {
    throw new Error('Global skill name must not be empty.');
  }

  return normalized;
}

function validateDocument(content: string, name: 'AGENTS.md' | 'SOUL.md'): void {
  if (!content.trim()) {
    throw new Error(`Global ${name} content must not be empty.`);
  }
}
