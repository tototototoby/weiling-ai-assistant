import { desc } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { employeeGroups } from './employee-groups';
import { employeeInviteLinks } from './employee-invite-links';
import { users } from './users';

export const employeeDirectoryEntries = sqliteTable(
  'employee_directory_entries',
  {
    id: text('id').primaryKey(),
    legalName: text('legal_name'),
    nickname: text('nickname'),
    companyEmail: text('company_email'),
    normalizedLegalName: text('normalized_legal_name'),
    normalizedNickname: text('normalized_nickname'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    reservationToken: text('reservation_token'),
    reservedAt: integer('reserved_at', { mode: 'timestamp_ms' }),
    reservationInviteId: text('reservation_invite_id')
      .references(() => employeeInviteLinks.id, { onDelete: 'set null' }),
    claimedByUserId: text('claimed_by_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    claimedAt: integer('claimed_at', { mode: 'timestamp_ms' }),
    claimedBotInstanceId: text('claimed_bot_instance_id'),
    claimedViaInviteId: text('claimed_via_invite_id')
      .references(() => employeeInviteLinks.id, { onDelete: 'set null' }),
    groupId: text('group_id').references(() => employeeGroups.id, {
      onDelete: 'set null',
    }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => ({
    claimedByUserIdIndex: uniqueIndex('employee_directory_claimed_user_idx').on(table.claimedByUserId),
    claimedBotInstanceIdIndex: index('employee_directory_claimed_bot_idx').on(table.claimedBotInstanceId),
    companyEmailIndex: index('employee_directory_company_email_idx').on(table.companyEmail),
    groupIdIndex: index('employee_directory_group_idx').on(table.groupId),
    createdAtIndex: index('employee_directory_created_at_idx').on(desc(table.createdAt), desc(table.id)),
    normalizedLegalNameIndex: index('employee_directory_legal_name_idx').on(table.normalizedLegalName),
    normalizedNicknameIndex: index('employee_directory_nickname_idx').on(table.normalizedNickname),
    reservationTokenIndex: uniqueIndex('employee_directory_reservation_token_idx').on(table.reservationToken),
  }),
);
