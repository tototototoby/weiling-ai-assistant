import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { employeeDirectoryEntries } from './employee-directory-entries';
import { employeeGroups } from './employee-groups';

export const GROUP_TASK_STATUSES = [
  'pending',
  'in_progress',
  'submitted',
  'accepted',
  'needs_revision',
  'archived',
] as const;

export type GroupTaskStatus = (typeof GROUP_TASK_STATUSES)[number];

export const groupTasks = sqliteTable(
  'group_tasks',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => employeeGroups.id, { onDelete: 'cascade' }),
    assignerEmployeeId: text('assigner_employee_id')
      .notNull()
      .references(() => employeeDirectoryEntries.id, { onDelete: 'restrict' }),
    assigneeEmployeeId: text('assignee_employee_id')
      .notNull()
      .references(() => employeeDirectoryEntries.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    acceptanceCriteria: text('acceptance_criteria').notNull().default(''),
    status: text('status', { enum: GROUP_TASK_STATUSES })
      .notNull()
      .default('pending'),
    dueAt: integer('due_at', { mode: 'timestamp_ms' }),
    submittedAt: integer('submitted_at', { mode: 'timestamp_ms' }),
    submittedSummary: text('submitted_summary'),
    submittedEvidenceJson: text('submitted_evidence_json'),
    acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
    feedback: text('feedback'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    groupStatusIndex: index('group_tasks_group_status_idx').on(
      table.groupId,
      table.status,
    ),
    assigneeStatusIndex: index('group_tasks_assignee_status_idx').on(
      table.assigneeEmployeeId,
      table.status,
    ),
    assignerStatusIndex: index('group_tasks_assigner_status_idx').on(
      table.assignerEmployeeId,
      table.status,
    ),
  }),
);
