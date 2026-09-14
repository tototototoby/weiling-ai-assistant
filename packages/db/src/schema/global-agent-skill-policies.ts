import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const globalAgentSkillPolicies = sqliteTable('global_agent_skill_policies', {
  skillName: text('skill_name').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
