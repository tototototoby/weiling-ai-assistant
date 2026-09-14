import { and, desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { employeeInviteLinks } from '../schema/employee-invite-links';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;

export interface CreateEmployeeInviteLinkInput {
  id: string;
  token: string;
  createdByUserId: string;
  createdAt?: Date;
}

export class EmployeeInviteLinkRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateEmployeeInviteLinkInput) {
    const now = input.createdAt ?? new Date();
    this.db.insert(employeeInviteLinks).values({
      ...input,
      createdAt: now,
      updatedAt: now,
    }).run();
    return this.findById(input.id);
  }

  async findById(id: string) {
    return this.db.select().from(employeeInviteLinks).where(eq(employeeInviteLinks.id, id)).get() ?? null;
  }

  async findEnabledByToken(token: string) {
    return this.db.select().from(employeeInviteLinks)
      .where(and(eq(employeeInviteLinks.token, token), eq(employeeInviteLinks.enabled, true)))
      .get() ?? null;
  }

  async listRecent(limit: number = 50) {
    return this.db.select().from(employeeInviteLinks)
      .orderBy(desc(employeeInviteLinks.createdAt), desc(employeeInviteLinks.id))
      .limit(limit)
      .all();
  }

  async setEnabled(id: string, enabled: boolean, updatedAt: Date = new Date()) {
    this.db.update(employeeInviteLinks).set({ enabled, updatedAt })
      .where(eq(employeeInviteLinks.id, id)).run();
    return this.findById(id);
  }
}
