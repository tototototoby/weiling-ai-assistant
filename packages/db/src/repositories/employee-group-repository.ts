import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { employeeDirectoryEntries } from '../schema/employee-directory-entries';
import { employeeGroups } from '../schema/employee-groups';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;
type GroupRow = typeof employeeGroups.$inferSelect;

export interface CreateEmployeeGroupInput {
  id: string;
  name: string;
  leaderEmployeeId?: string | null;
  createdByUserId?: string | null;
  createdAt?: Date;
}

export interface UpdateEmployeeGroupInput {
  name?: string;
  leaderEmployeeId?: string | null;
  updatedAt?: Date;
}

export class EmployeeGroupRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateEmployeeGroupInput): Promise<GroupRow> {
    const now = input.createdAt ?? new Date();
    this.db.insert(employeeGroups).values({
      id: input.id,
      name: input.name,
      leaderEmployeeId: input.leaderEmployeeId ?? null,
      createdByUserId: input.createdByUserId ?? null,
      createdAt: now,
      updatedAt: now,
    }).run();
    const row = await this.findById(input.id);
    if (!row) throw new Error(`Failed to create employee group: ${input.id}`);
    return row;
  }

  async findById(id: string): Promise<GroupRow | null> {
    return this.db.select().from(employeeGroups)
      .where(eq(employeeGroups.id, id)).get() ?? null;
  }

  async findByName(name: string): Promise<GroupRow | null> {
    return this.db.select().from(employeeGroups)
      .where(eq(employeeGroups.name, name)).get() ?? null;
  }

  async list(): Promise<GroupRow[]> {
    return this.db.select().from(employeeGroups)
      .orderBy(asc(employeeGroups.name), asc(employeeGroups.id)).all();
  }

  async listByLeaderEmployeeId(leaderEmployeeId: string): Promise<GroupRow[]> {
    return this.db.select().from(employeeGroups)
      .where(eq(employeeGroups.leaderEmployeeId, leaderEmployeeId)).all();
  }

  async update(id: string, input: UpdateEmployeeGroupInput): Promise<GroupRow | null> {
    const now = input.updatedAt ?? new Date();
    this.db.update(employeeGroups)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.leaderEmployeeId !== undefined
          ? { leaderEmployeeId: input.leaderEmployeeId }
          : {}),
        updatedAt: now,
      })
      .where(eq(employeeGroups.id, id))
      .run();
    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    this.db.update(employeeDirectoryEntries)
      .set({ groupId: null })
      .where(eq(employeeDirectoryEntries.groupId, id))
      .run();
    this.db.delete(employeeGroups).where(eq(employeeGroups.id, id)).run();
  }

  async listMemberEntries(groupId: string) {
    return this.db.select().from(employeeDirectoryEntries)
      .where(and(
        eq(employeeDirectoryEntries.groupId, groupId),
        eq(employeeDirectoryEntries.enabled, true),
      ))
      .orderBy(asc(employeeDirectoryEntries.nickname), asc(employeeDirectoryEntries.legalName))
      .all();
  }

  async listUnassignedEnabledEntries() {
    return this.db.select().from(employeeDirectoryEntries)
      .where(and(
        isNull(employeeDirectoryEntries.groupId),
        eq(employeeDirectoryEntries.enabled, true),
      ))
      .orderBy(asc(employeeDirectoryEntries.nickname), asc(employeeDirectoryEntries.legalName))
      .all();
  }
}
