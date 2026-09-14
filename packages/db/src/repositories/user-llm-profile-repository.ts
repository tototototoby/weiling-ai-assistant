import { and, asc, desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from '../schema/index';
import { userLlmProfiles } from '../schema/user-llm-profiles';

type Db = BetterSQLite3Database<typeof schema>;

export interface CreateUserLlmProfileInput {
  id: string;
  userId: string;
  name: string;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string | null;
  apiType: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UpdateUserLlmProfileInput {
  name: string;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl: string | null;
  apiType: string | null;
  updatedAt?: Date;
}

export class UserLlmProfileRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateUserLlmProfileInput) {
    const now = input.createdAt ?? new Date();

    this.db.insert(userLlmProfiles).values({
      ...input,
      createdAt: now,
      updatedAt: input.updatedAt ?? now,
    }).run();

    return this.findByIdForUser(input.id, input.userId);
  }

  async listByUserId(userId: string) {
    return this.db.select()
      .from(userLlmProfiles)
      .where(eq(userLlmProfiles.userId, userId))
      .orderBy(desc(userLlmProfiles.updatedAt), asc(userLlmProfiles.id))
      .all();
  }

  async findByIdForUser(id: string, userId: string) {
    const row = this.db.select()
      .from(userLlmProfiles)
      .where(and(eq(userLlmProfiles.id, id), eq(userLlmProfiles.userId, userId)))
      .get();

    return row ?? null;
  }

  async findById(id: string) {
    return this.db.select().from(userLlmProfiles).where(eq(userLlmProfiles.id, id)).get() ?? null;
  }

  async updateByIdForUser(id: string, userId: string, input: UpdateUserLlmProfileInput) {
    this.db.update(userLlmProfiles)
      .set({
        apiKey: input.apiKey,
        apiType: input.apiType,
        baseUrl: input.baseUrl,
        model: input.model,
        name: input.name,
        provider: input.provider,
        updatedAt: input.updatedAt ?? new Date(),
      })
      .where(and(eq(userLlmProfiles.id, id), eq(userLlmProfiles.userId, userId)))
      .run();

    return this.findByIdForUser(id, userId);
  }

  async deleteByIdForUser(id: string, userId: string) {
    const current = await this.findByIdForUser(id, userId);

    if (!current) {
      return null;
    }

    const result = this.db.delete(userLlmProfiles)
      .where(and(eq(userLlmProfiles.id, id), eq(userLlmProfiles.userId, userId)))
      .run();

    if (result.changes === 0) {
      return null;
    }

    return current;
  }
}
