import { eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { users } from '../schema/users';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;

export interface CreateUserInput {
  id: string;
  email: string;
  name: string;
  emailVerified?: boolean;
  image?: string | null;
}

export class UserRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateUserInput) {
    const now = new Date();

    this.db.insert(users).values({
      ...input,
      emailVerified: input.emailVerified ?? false,
      image: input.image ?? null,
      createdAt: now,
      updatedAt: now,
    }).run();

    return this.findById(input.id);
  }

  async findByEmail(email: string) {
    const row = this.db.select().from(users).where(eq(users.email, email)).get();
    return row ?? null;
  }

  async countAll() {
    const row = this.db.select({
      count: sql<number>`count(*)`,
    }).from(users).get();

    return Number(row?.count ?? 0);
  }

  async findById(id: string) {
    const row = this.db.select().from(users).where(eq(users.id, id)).get();
    return row ?? null;
  }

  async deleteById(id: string) {
    const result = this.db.delete(users).where(eq(users.id, id)).run();
    return result.changes > 0;
  }
}
