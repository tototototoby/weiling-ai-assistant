import { and, asc, desc, eq, gte, inArray, lte, or } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
  groupTasks,
  type GroupTaskStatus,
} from '../schema/group-tasks';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;
type TaskRow = typeof groupTasks.$inferSelect;

export interface CreateGroupTaskInput {
  id: string;
  groupId: string;
  assignerEmployeeId: string;
  assigneeEmployeeId: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  dueAt?: Date | null;
  createdAt?: Date;
}

export interface SubmitGroupTaskInput {
  submittedAt?: Date;
  summary: string;
  evidencePaths: string[];
}

export class GroupTaskRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateGroupTaskInput): Promise<TaskRow> {
    const now = input.createdAt ?? new Date();
    this.db.insert(groupTasks).values({
      id: input.id,
      groupId: input.groupId,
      assignerEmployeeId: input.assignerEmployeeId,
      assigneeEmployeeId: input.assigneeEmployeeId,
      title: input.title,
      description: input.description ?? '',
      acceptanceCriteria: input.acceptanceCriteria ?? '',
      status: 'pending',
      dueAt: input.dueAt ?? null,
      createdAt: now,
      updatedAt: now,
    }).run();
    const row = await this.findById(input.id);
    if (!row) throw new Error(`Failed to create group task: ${input.id}`);
    return row;
  }

  async findById(id: string): Promise<TaskRow | null> {
    return this.db.select().from(groupTasks)
      .where(eq(groupTasks.id, id)).get() ?? null;
  }

  async listByGroup(groupId: string): Promise<TaskRow[]> {
    return this.db.select().from(groupTasks)
      .where(eq(groupTasks.groupId, groupId))
      .orderBy(desc(groupTasks.createdAt), desc(groupTasks.id)).all();
  }

  async listByAssignee(assigneeEmployeeId: string): Promise<TaskRow[]> {
    return this.db.select().from(groupTasks)
      .where(eq(groupTasks.assigneeEmployeeId, assigneeEmployeeId))
      .orderBy(desc(groupTasks.createdAt), desc(groupTasks.id)).all();
  }

  async listByAssigner(assignerEmployeeId: string): Promise<TaskRow[]> {
    return this.db.select().from(groupTasks)
      .where(eq(groupTasks.assignerEmployeeId, assignerEmployeeId))
      .orderBy(desc(groupTasks.createdAt), desc(groupTasks.id)).all();
  }

  async listActiveByAssignee(assigneeEmployeeId: string): Promise<TaskRow[]> {
    return this.db.select().from(groupTasks)
      .where(and(
        eq(groupTasks.assigneeEmployeeId, assigneeEmployeeId),
        inArray(groupTasks.status, ['pending', 'in_progress', 'needs_revision']),
      ))
      .orderBy(asc(groupTasks.dueAt), asc(groupTasks.createdAt)).all();
  }

  async listDueSoon(now: Date, dueBefore: Date): Promise<TaskRow[]> {
    return this.db.select().from(groupTasks)
      .where(and(
        inArray(groupTasks.status, ['pending', 'in_progress', 'needs_revision']),
        gte(groupTasks.dueAt, now),
        lte(groupTasks.dueAt, dueBefore),
      ))
      .all();
  }

  async listOverdue(now: Date): Promise<TaskRow[]> {
    return this.db.select().from(groupTasks)
      .where(and(
        inArray(groupTasks.status, ['pending', 'in_progress', 'needs_revision']),
        lte(groupTasks.dueAt, now),
      ))
      .all();
  }

  async updateStatus(id: string, status: GroupTaskStatus, updatedAt: Date = new Date()): Promise<TaskRow | null> {
    this.db.update(groupTasks)
      .set({ status, updatedAt })
      .where(eq(groupTasks.id, id))
      .run();
    return this.findById(id);
  }

  async markSubmitted(id: string, input: SubmitGroupTaskInput, updatedAt: Date = new Date()): Promise<TaskRow | null> {
    this.db.update(groupTasks)
      .set({
        status: 'submitted',
        submittedAt: input.submittedAt ?? updatedAt,
        submittedSummary: input.summary,
        submittedEvidenceJson: JSON.stringify(input.evidencePaths),
        updatedAt,
      })
      .where(eq(groupTasks.id, id))
      .run();
    return this.findById(id);
  }

  async accept(id: string, feedback: string | null, updatedAt: Date = new Date()): Promise<TaskRow | null> {
    this.db.update(groupTasks)
      .set({
        status: 'accepted',
        acceptedAt: updatedAt,
        feedback,
        updatedAt,
      })
      .where(eq(groupTasks.id, id))
      .run();
    return this.findById(id);
  }

  async archive(id: string, updatedAt: Date = new Date()): Promise<TaskRow | null> {
    return this.updateStatus(id, 'archived', updatedAt);
  }

  async needsRevision(id: string, feedback: string | null, updatedAt: Date = new Date()): Promise<TaskRow | null> {
    this.db.update(groupTasks)
      .set({ status: 'needs_revision', feedback, updatedAt })
      .where(eq(groupTasks.id, id))
      .run();
    return this.findById(id);
  }

  async countByStatus(groupId: string, statuses: GroupTaskStatus[]): Promise<number> {
    const rows = this.db.select({ count: groupTasks.id })
      .from(groupTasks)
      .where(and(eq(groupTasks.groupId, groupId), inArray(groupTasks.status, statuses)))
      .all();
    return rows.length;
  }
}
