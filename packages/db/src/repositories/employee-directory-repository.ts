import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { employeeDirectoryEntries } from '../schema/employee-directory-entries';
import { employeeInviteLinks } from '../schema/employee-invite-links';
import type * as schema from '../schema/index';

type Db = BetterSQLite3Database<typeof schema>;

export interface CreateEmployeeDirectoryEntryInput {
  companyEmail?: string | null;
  id: string;
  legalName: string | null;
  nickname: string | null;
  normalizedLegalName: string | null;
  normalizedNickname: string | null;
  enabled?: boolean;
  createdAt?: Date;
}

export interface UpdateEmployeeDirectoryEntryInput {
  companyEmail?: string | null;
  legalName: string | null;
  nickname: string | null;
  normalizedLegalName: string | null;
  normalizedNickname: string | null;
  enabled: boolean;
  updatedAt?: Date;
}

export interface ReserveEmployeeDirectoryEntryInput {
  inviteToken: string;
  normalizedName: string;
  reservationToken: string;
  reservedAt?: Date;
  staleBefore: Date;
}

export class EmployeeDirectoryRepository {
  constructor(private readonly db: Db) {}

  async create(input: CreateEmployeeDirectoryEntryInput) {
    const now = input.createdAt ?? new Date();
    this.db.insert(employeeDirectoryEntries).values({
      companyEmail: normalizeCompanyEmail(input.companyEmail),
      id: input.id,
      legalName: input.legalName,
      nickname: input.nickname,
      normalizedLegalName: input.normalizedLegalName,
      normalizedNickname: input.normalizedNickname,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    }).run();
    return this.findById(input.id);
  }

  async findById(id: string) {
    return this.db.select().from(employeeDirectoryEntries)
      .where(eq(employeeDirectoryEntries.id, id)).get() ?? null;
  }

  async findByReservationToken(reservationToken: string) {
    return this.db.select().from(employeeDirectoryEntries)
      .where(eq(employeeDirectoryEntries.reservationToken, reservationToken)).get() ?? null;
  }

  async findByClaimedBotInstanceId(botInstanceId: string) {
    return this.db.select().from(employeeDirectoryEntries)
      .where(eq(employeeDirectoryEntries.claimedBotInstanceId, botInstanceId)).get() ?? null;
  }

  async listAll() {
    return this.db.select().from(employeeDirectoryEntries)
      .orderBy(desc(employeeDirectoryEntries.createdAt), desc(employeeDirectoryEntries.id)).all();
  }

  async findClaimedByBotInstanceId(botInstanceId: string) {
    return this.db.select().from(employeeDirectoryEntries)
      .where(and(
        eq(employeeDirectoryEntries.claimedBotInstanceId, botInstanceId),
        eq(employeeDirectoryEntries.enabled, true),
      )).get() ?? null;
  }

  async findClaimedByInviteAndName(inviteToken: string, normalizedName: string) {
    const invite = this.db.select().from(employeeInviteLinks).where(and(
      eq(employeeInviteLinks.token, inviteToken),
      eq(employeeInviteLinks.enabled, true),
    )).get();
    if (!invite) return null;

    const matches = this.db.select().from(employeeDirectoryEntries).where(and(
      eq(employeeDirectoryEntries.enabled, true),
      eq(employeeDirectoryEntries.claimedViaInviteId, invite.id),
      or(
        eq(employeeDirectoryEntries.normalizedLegalName, normalizedName),
        eq(employeeDirectoryEntries.normalizedNickname, normalizedName),
      ),
    )).limit(2).all();

    return matches.length === 1 && matches[0].claimedAt && matches[0].claimedBotInstanceId
      ? matches[0]
      : null;
  }

  async updateById(id: string, input: UpdateEmployeeDirectoryEntryInput) {
    this.db.update(employeeDirectoryEntries).set({
      legalName: input.legalName,
      nickname: input.nickname,
      normalizedLegalName: input.normalizedLegalName,
      normalizedNickname: input.normalizedNickname,
      enabled: input.enabled,
      ...(input.companyEmail === undefined
        ? {}
        : { companyEmail: normalizeCompanyEmail(input.companyEmail) }),
      updatedAt: input.updatedAt ?? new Date(),
    }).where(eq(employeeDirectoryEntries.id, id)).run();
    return this.findById(id);
  }

  async updateCompanyEmail(
    id: string,
    companyEmail: string | null,
    updatedAt: Date = new Date(),
  ) {
    this.db.update(employeeDirectoryEntries).set({
      companyEmail: normalizeCompanyEmail(companyEmail),
      updatedAt,
    }).where(eq(employeeDirectoryEntries.id, id)).run();
    return this.findById(id);
  }

  async setGroup(
    id: string,
    groupId: string | null,
    updatedAt: Date = new Date(),
  ) {
    this.db.update(employeeDirectoryEntries).set({
      groupId,
      updatedAt,
    }).where(eq(employeeDirectoryEntries.id, id)).run();
    return this.findById(id);
  }

  async listByGroup(groupId: string) {
    return this.db.select().from(employeeDirectoryEntries)
      .where(and(
        eq(employeeDirectoryEntries.groupId, groupId),
        eq(employeeDirectoryEntries.enabled, true),
      ))
      .orderBy(desc(employeeDirectoryEntries.nickname), desc(employeeDirectoryEntries.legalName))
      .all();
  }

  async deleteUnclaimedById(id: string) {
    const result = this.db.delete(employeeDirectoryEntries).where(and(
      eq(employeeDirectoryEntries.id, id),
      isNull(employeeDirectoryEntries.claimedByUserId),
      isNull(employeeDirectoryEntries.claimedAt),
      isNull(employeeDirectoryEntries.reservationToken),
    )).run();
    return result.changes > 0;
  }

  async deleteById(id: string) {
    const result = this.db.delete(employeeDirectoryEntries)
      .where(eq(employeeDirectoryEntries.id, id))
      .run();
    return result.changes > 0;
  }

  async reserveByInviteAndName(input: ReserveEmployeeDirectoryEntryInput) {
    const reservedAt = input.reservedAt ?? new Date();
    return this.db.transaction((tx) => {
      const invite = tx.select().from(employeeInviteLinks).where(and(
        eq(employeeInviteLinks.token, input.inviteToken),
        eq(employeeInviteLinks.enabled, true),
      )).get();

      if (!invite) return null;

      const matches = tx.select().from(employeeDirectoryEntries).where(and(
        eq(employeeDirectoryEntries.enabled, true),
        isNull(employeeDirectoryEntries.claimedByUserId),
        isNull(employeeDirectoryEntries.claimedAt),
        or(
          eq(employeeDirectoryEntries.normalizedLegalName, input.normalizedName),
          eq(employeeDirectoryEntries.normalizedNickname, input.normalizedName),
        ),
      )).limit(2).all();

      if (matches.length !== 1) return null;
      const employee = matches[0];
      const result = tx.update(employeeDirectoryEntries).set({
        reservationToken: input.reservationToken,
        reservedAt,
        reservationInviteId: invite.id,
        updatedAt: reservedAt,
      }).where(and(
        eq(employeeDirectoryEntries.id, employee.id),
        isNull(employeeDirectoryEntries.claimedByUserId),
        isNull(employeeDirectoryEntries.claimedAt),
        or(
          isNull(employeeDirectoryEntries.reservationToken),
          isNull(employeeDirectoryEntries.reservedAt),
          lt(employeeDirectoryEntries.reservedAt, input.staleBefore),
        ),
      )).run();

      if (result.changes !== 1) return null;
      return tx.select().from(employeeDirectoryEntries)
        .where(eq(employeeDirectoryEntries.reservationToken, input.reservationToken)).get() ?? null;
    }, { behavior: 'immediate' });
  }

  async releaseReservation(reservationToken: string) {
    this.db.update(employeeDirectoryEntries).set({
      reservationToken: null,
      reservedAt: null,
      reservationInviteId: null,
      updatedAt: new Date(),
    }).where(and(
      eq(employeeDirectoryEntries.reservationToken, reservationToken),
      isNull(employeeDirectoryEntries.claimedByUserId),
      isNull(employeeDirectoryEntries.claimedAt),
    )).run();
  }

  async claimReservation(reservationToken: string, userId: string, claimedAt: Date = new Date()) {
    return this.db.transaction((tx) => {
      const employee = tx.select().from(employeeDirectoryEntries)
        .where(eq(employeeDirectoryEntries.reservationToken, reservationToken)).get();
      if (!employee || employee.claimedByUserId || employee.claimedAt || !employee.reservationInviteId) return null;

      const result = tx.update(employeeDirectoryEntries).set({
        claimedAt,
        claimedByUserId: userId,
        claimedViaInviteId: employee.reservationInviteId,
        reservationInviteId: null,
        reservationToken: null,
        reservedAt: null,
        updatedAt: claimedAt,
      }).where(and(
        eq(employeeDirectoryEntries.id, employee.id),
        eq(employeeDirectoryEntries.reservationToken, reservationToken),
        isNull(employeeDirectoryEntries.claimedByUserId),
        isNull(employeeDirectoryEntries.claimedAt),
      )).run();
      if (result.changes !== 1) return null;

      tx.update(employeeInviteLinks).set({
        usageCount: sql`${employeeInviteLinks.usageCount} + 1`,
        updatedAt: claimedAt,
      }).where(eq(employeeInviteLinks.id, employee.reservationInviteId)).run();

      return tx.select().from(employeeDirectoryEntries)
        .where(eq(employeeDirectoryEntries.id, employee.id)).get() ?? null;
    }, { behavior: 'immediate' });
  }

  async claimReservationWithoutUser(
    reservationToken: string,
    botInstanceId: string,
    claimedAt: Date = new Date(),
  ) {
    return this.db.transaction((tx) => {
      const employee = tx.select().from(employeeDirectoryEntries)
        .where(eq(employeeDirectoryEntries.reservationToken, reservationToken)).get();
      if (!employee || employee.claimedByUserId || employee.claimedAt || !employee.reservationInviteId) return null;

      const result = tx.update(employeeDirectoryEntries).set({
        claimedAt,
        claimedBotInstanceId: botInstanceId,
        claimedByUserId: null,
        claimedViaInviteId: employee.reservationInviteId,
        reservationInviteId: null,
        reservationToken: null,
        reservedAt: null,
        updatedAt: claimedAt,
      }).where(and(
        eq(employeeDirectoryEntries.id, employee.id),
        eq(employeeDirectoryEntries.reservationToken, reservationToken),
        isNull(employeeDirectoryEntries.claimedByUserId),
        isNull(employeeDirectoryEntries.claimedAt),
      )).run();
      if (result.changes !== 1) return null;

      tx.update(employeeInviteLinks).set({
        usageCount: sql`${employeeInviteLinks.usageCount} + 1`,
        updatedAt: claimedAt,
      }).where(eq(employeeInviteLinks.id, employee.reservationInviteId)).run();

      return tx.select().from(employeeDirectoryEntries)
        .where(eq(employeeDirectoryEntries.id, employee.id)).get() ?? null;
    }, { behavior: 'immediate' });
  }
}

function normalizeCompanyEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized || null;
}
