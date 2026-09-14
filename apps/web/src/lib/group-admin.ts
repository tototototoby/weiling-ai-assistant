import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isAdminEmail, requireAdminRequestSession } from './admin';
import { ApiError } from './api-error';
import { getEmployeeDisplayName } from './employee-display';
import { getRepositories, type WebRepositories } from './repositories';
import { requireRequestSession, type AuthSession } from './session';

const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  leaderEmployeeId: z.string().trim().min(1).nullable().optional(),
}).strict();

const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  leaderEmployeeId: z.string().trim().min(1).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required.',
});

const updateMembersSchema = z.object({
  add: z.array(z.string().trim().min(1)).optional(),
  remove: z.array(z.string().trim().min(1)).optional(),
}).strict().refine((value) => (value.add?.length ?? 0) + (value.remove?.length ?? 0) > 0, {
  message: 'At least one member change is required.',
});

const createTaskSchema = z.object({
  assigneeEmployeeId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4_000).optional(),
  acceptanceCriteria: z.string().trim().max(4_000).optional(),
  dueAt: z.union([
    z.string().datetime(),
    z.number().int().positive(),
  ]).optional(),
}).strict();

const updateTaskSchema = z.object({
  action: z.enum(['accept', 'needs_revision']),
  feedback: z.string().trim().max(2_000).nullable().optional(),
}).strict();

const submitTaskSchema = z.object({
  summary: z.string().trim().min(1).max(4_000),
  evidencePaths: z.array(z.string().trim().min(1).max(1_000)).max(100).optional(),
}).strict();

type GroupRepositories = Pick<
  WebRepositories,
  | 'adminMessageDeliveries'
  | 'botDailyActivity'
  | 'botInstances'
  | 'employeeDirectory'
  | 'employeeGroups'
  | 'groupTasks'
  | 'users'
>;

export interface AdminGroupItem {
  id: string;
  name: string;
  leaderEmployeeId: string | null;
  leaderName: string | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeOption {
  id: string;
  nickname: string | null;
  legalName: string | null;
  companyEmail: string | null;
  enabled: boolean;
  claimedBotInstanceId: string | null;
  claimedByUserId: string | null;
}

export interface AdminGroupDetail {
  group: AdminGroupItem;
  members: EmployeeOption[];
  unassignedEmployees: EmployeeOption[];
}

export interface GroupTaskItem {
  id: string;
  groupId: string;
  groupName: string;
  assignerEmployeeId: string;
  assignerName: string | null;
  assigneeEmployeeId: string;
  assigneeName: string | null;
  title: string;
  description: string;
  acceptanceCriteria: string;
  status: string;
  dueAt: string | null;
  submittedAt: string | null;
  submittedSummary: string | null;
  submittedEvidence: string[];
  acceptedAt: string | null;
  feedback: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MyTasksPayload {
  bound: boolean;
  employeeId: string | null;
  tasks: GroupTaskItem[];
}

export interface TeamMemberItem {
  employeeId: string;
  nickname: string | null;
  legalName: string | null;
  botBound: boolean;
  botInstanceId: string | null;
  activity7: number;
  activity30: number;
}

export interface MyTeamGroup {
  groupId: string;
  groupName: string;
  role: 'leader' | 'member';
  leaderEmployeeId: string | null;
  leaderName: string | null;
  members: TeamMemberItem[];
}

export interface MyTeamPayload {
  bound: boolean;
  employeeId: string | null;
  groups: MyTeamGroup[];
}

export async function listAdminGroups(): Promise<AdminGroupItem[]> {
  const repositories = getRepositories();
  const [groups, employees] = await Promise.all([
    repositories.employeeGroups.list(),
    repositories.employeeDirectory.listAll(),
  ]);
  const memberRows = await Promise.all(
    groups.map((group) => repositories.employeeGroups.listMemberEntries(group.id)),
  );
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const countByGroupId = new Map(
    groups.map((group, index) => [group.id, memberRows[index]?.length ?? 0]),
  );

  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    leaderEmployeeId: group.leaderEmployeeId,
    leaderName: group.leaderEmployeeId
      ? getEmployeeDisplayName(employeeById.get(group.leaderEmployeeId))
      : null,
    memberCount: countByGroupId.get(group.id) ?? 0,
    createdAt: toIso(group.createdAt),
    updatedAt: toIso(group.updatedAt),
  }));
}

export async function listEmployeeOptions(): Promise<EmployeeOption[]> {
  return (await getRepositories().employeeDirectory.listAll())
    .filter((employee) => employee.enabled)
    .map(toEmployeeOption);
}

export async function getAdminGroupDetail(groupId: string): Promise<AdminGroupDetail> {
  const repositories = getRepositories();
  const group = await repositories.employeeGroups.findById(groupId);
  if (!group) throw notFoundError('Group not found.');

  const [members, unassigned] = await Promise.all([
    repositories.employeeGroups.listMemberEntries(groupId),
    repositories.employeeGroups.listUnassignedEnabledEntries(),
  ]);
  const leader = group.leaderEmployeeId
    ? await repositories.employeeDirectory.findById(group.leaderEmployeeId)
    : null;
  const employeeById = new Map(members.map((employee) => [employee.id, employee]));
  if (leader) employeeById.set(leader.id, leader);

  return {
    group: toAdminGroupItem(group, employeeById.get(group.leaderEmployeeId ?? '') ?? null, members.length),
    members: members.map(toEmployeeOption),
    unassignedEmployees: unassigned.map(toEmployeeOption),
  };
}

export async function createAdminGroup(input: {
  createdByUserId: string;
  payload: unknown;
}): Promise<AdminGroupItem> {
  const parsed = createGroupSchema.safeParse(input.payload);
  if (!parsed.success) throw validationError('Enter a valid group name.');

  const repositories = getRepositories();
  if (await repositories.employeeGroups.findByName(parsed.data.name)) {
    throw groupNameTakenError();
  }
  if (parsed.data.leaderEmployeeId) {
    const leader = await repositories.employeeDirectory.findById(parsed.data.leaderEmployeeId);
    if (!leader || !leader.enabled) {
      throw validationError('Selected group leader was not found or is disabled.');
    }
  }

  const group = await repositories.employeeGroups.create({
    id: randomUUID(),
    name: parsed.data.name,
    leaderEmployeeId: parsed.data.leaderEmployeeId ?? null,
    createdByUserId: input.createdByUserId,
  });
  const leader = group.leaderEmployeeId
    ? await repositories.employeeDirectory.findById(group.leaderEmployeeId)
    : null;
  return toAdminGroupItem(group, leader, 0);
}

export async function updateAdminGroup(input: {
  groupId: string;
  payload: unknown;
}): Promise<AdminGroupItem> {
  const parsed = updateGroupSchema.safeParse(input.payload);
  if (!parsed.success) throw validationError('Enter a valid group update.');

  const repositories = getRepositories();
  const group = await repositories.employeeGroups.findById(input.groupId);
  if (!group) throw notFoundError('Group not found.');
  if (parsed.data.name !== undefined) {
    const existing = await repositories.employeeGroups.findByName(parsed.data.name);
    if (existing && existing.id !== input.groupId) throw groupNameTakenError();
  }
  if (parsed.data.leaderEmployeeId !== undefined && parsed.data.leaderEmployeeId !== null) {
    const leader = await repositories.employeeDirectory.findById(parsed.data.leaderEmployeeId);
    if (!leader || !leader.enabled) {
      throw validationError('Selected group leader was not found or is disabled.');
    }
  }

  const updated = await repositories.employeeGroups.update(input.groupId, {
    name: parsed.data.name,
    leaderEmployeeId: parsed.data.leaderEmployeeId,
  });
  if (!updated) throw notFoundError('Group not found.');
  const leader = updated.leaderEmployeeId
    ? await repositories.employeeDirectory.findById(updated.leaderEmployeeId)
    : null;
  const members = await repositories.employeeGroups.listMemberEntries(input.groupId);
  return toAdminGroupItem(updated, leader, members.length);
}

export async function deleteAdminGroup(groupId: string): Promise<{ id: string }> {
  const repositories = getRepositories();
  if (!await repositories.employeeGroups.findById(groupId)) {
    throw notFoundError('Group not found.');
  }
  await repositories.employeeGroups.delete(groupId);
  return { id: groupId };
}

export async function listGroupMembers(groupId: string): Promise<EmployeeOption[]> {
  const repositories = getRepositories();
  if (!await repositories.employeeGroups.findById(groupId)) {
    throw notFoundError('Group not found.');
  }
  return (await repositories.employeeGroups.listMemberEntries(groupId)).map(toEmployeeOption);
}

export async function updateGroupMembers(input: {
  groupId: string;
  payload: unknown;
}): Promise<EmployeeOption[]> {
  const parsed = updateMembersSchema.safeParse(input.payload);
  if (!parsed.success) throw validationError('Enter valid member changes.');

  const repositories = getRepositories();
  const group = await repositories.employeeGroups.findById(input.groupId);
  if (!group) throw notFoundError('Group not found.');

  const addIds = Array.from(new Set(parsed.data.add ?? []));
  const removeIds = Array.from(new Set(parsed.data.remove ?? []));
  const candidateIds = Array.from(new Set([...addIds, ...removeIds]));
  const candidates = await Promise.all(
    candidateIds.map((id) => repositories.employeeDirectory.findById(id)),
  );
  const candidateById = new Map(
    candidates
      .filter((employee): employee is NonNullable<typeof employee> => employee !== null)
      .map((employee) => [employee.id, employee]),
  );
  for (const id of candidateIds) {
    const employee = candidateById.get(id);
    if (!employee || !employee.enabled) {
      throw validationError('One or more selected employees were not found or are disabled.');
    }
  }

  await Promise.all(addIds.map((id) => repositories.employeeDirectory.setGroup(id, input.groupId)));
  await Promise.all(removeIds.map((id) => repositories.employeeDirectory.setGroup(id, null)));
  if (group.leaderEmployeeId && removeIds.includes(group.leaderEmployeeId)) {
    await repositories.employeeGroups.update(input.groupId, { leaderEmployeeId: null });
  }

  return (await repositories.employeeGroups.listMemberEntries(input.groupId)).map(toEmployeeOption);
}

export async function listGroupTasks(groupId: string): Promise<GroupTaskItem[]> {
  const repositories = getRepositories();
  const [group, tasks, employees] = await Promise.all([
    repositories.employeeGroups.findById(groupId),
    repositories.groupTasks.listByGroup(groupId),
    repositories.employeeDirectory.listAll(),
  ]);
  if (!group) throw notFoundError('Group not found.');

  return toTaskItems(tasks, group, employees);
}

export async function createGroupTask(input: {
  currentEmployeeId: string | null;
  currentUserId: string;
  groupId: string;
  payload: unknown;
}): Promise<GroupTaskItem> {
  const parsed = createTaskSchema.safeParse(input.payload);
  if (!parsed.success) throw validationError('Enter a valid task.');

  const repositories = getRepositories();
  const group = await repositories.employeeGroups.findById(input.groupId);
  if (!group) throw notFoundError('Group not found.');

  const assignee = await repositories.employeeDirectory.findById(parsed.data.assigneeEmployeeId);
  if (!assignee || !assignee.enabled || assignee.groupId !== input.groupId) {
    throw validationError('Assignee must be an enabled member of this group.');
  }

  const assignerEmployeeId = await resolveAssignerEmployeeId({
    assigneeEmployeeId: assignee.id,
    currentEmployeeId: input.currentEmployeeId,
    group,
    repositories,
  });
  const dueAt = parsed.data.dueAt === undefined
    ? null
    : typeof parsed.data.dueAt === 'number'
      ? new Date(parsed.data.dueAt)
      : new Date(parsed.data.dueAt);

  const task = await repositories.groupTasks.create({
    id: randomUUID(),
    groupId: group.id,
    assignerEmployeeId,
    assigneeEmployeeId: assignee.id,
    title: parsed.data.title,
    description: parsed.data.description ?? '',
    acceptanceCriteria: parsed.data.acceptanceCriteria ?? '',
    dueAt,
  });
  if (!task) throw internalError('Failed to create task.');

  await sendTaskNotification({
    assigneeEmployeeId: assignee.id,
    createdByUserId: input.currentUserId,
    groupId: group.id,
    repositories,
    status: 'created',
    taskId: task.id,
    title: task.title,
  });

  const employees = await repositories.employeeDirectory.listAll();
  const [items] = toTaskItems([task], group, employees);
  return items;
}

export async function updateGroupTask(input: {
  groupId: string;
  payload: unknown;
  taskId: string;
  updatedByUserId: string;
}): Promise<GroupTaskItem> {
  const parsed = updateTaskSchema.safeParse(input.payload);
  if (!parsed.success) throw validationError('Enter a valid task review.');

  const repositories = getRepositories();
  const [group, task] = await Promise.all([
    repositories.employeeGroups.findById(input.groupId),
    repositories.groupTasks.findById(input.taskId),
  ]);
  if (!group) throw notFoundError('Group not found.');
  if (!task || task.groupId !== input.groupId) throw notFoundError('Task not found.');

  const updated = parsed.data.action === 'accept'
    ? await repositories.groupTasks.accept(task.id, parsed.data.feedback ?? null)
    : await repositories.groupTasks.needsRevision(task.id, parsed.data.feedback ?? null);
  if (!updated) throw notFoundError('Task not found.');

  await sendTaskNotification({
    assigneeEmployeeId: updated.assigneeEmployeeId,
    createdByUserId: input.updatedByUserId,
    feedback: updated.feedback,
    groupId: updated.groupId,
    repositories,
    status: parsed.data.action,
    taskId: updated.id,
    title: updated.title,
  });

  const employees = await repositories.employeeDirectory.listAll();
  const [items] = toTaskItems([updated], group, employees);
  return items;
}

export async function listMyTasks(userId: string): Promise<MyTasksPayload> {
  const repositories = getRepositories();
  const employee = await findEmployeeForUser(userId, repositories);
  if (!employee) {
    return { bound: false, employeeId: null, tasks: [] };
  }

  const [tasks, groups, employees] = await Promise.all([
    repositories.groupTasks.listByAssignee(employee.id),
    repositories.employeeGroups.list(),
    repositories.employeeDirectory.listAll(),
  ]);
  const groupById = new Map(groups.map((group) => [group.id, group]));
  return {
    bound: true,
    employeeId: employee.id,
    tasks: tasks.flatMap((task) => {
      const group = groupById.get(task.groupId);
      return group ? toTaskItems([task], group, employees) : [];
    }),
  };
}

export async function submitMyTask(input: {
  payload: unknown;
  taskId: string;
  userId: string;
}): Promise<GroupTaskItem> {
  const parsed = submitTaskSchema.safeParse(input.payload);
  if (!parsed.success) throw validationError('Enter a valid submission.');

  const repositories = getRepositories();
  const employee = await findEmployeeForUser(input.userId, repositories);
  if (!employee) throw forbiddenError();

  const task = await repositories.groupTasks.findById(input.taskId);
  if (!task || task.assigneeEmployeeId !== employee.id) {
    throw forbiddenError('You do not have access to this task.');
  }
  const group = await repositories.employeeGroups.findById(task.groupId);
  if (!group) throw notFoundError('Group not found.');

  const updated = await repositories.groupTasks.markSubmitted(task.id, {
    summary: parsed.data.summary,
    evidencePaths: parsed.data.evidencePaths ?? [],
  });
  if (!updated) throw notFoundError('Task not found.');

  const employees = await repositories.employeeDirectory.listAll();
  const [items] = toTaskItems([updated], group, employees);
  return items;
}

export async function listMyTeam(userId: string): Promise<MyTeamPayload> {
  const repositories = getRepositories();
  const employee = await findEmployeeForUser(userId, repositories);
  if (!employee) {
    return { bound: false, employeeId: null, groups: [] };
  }

  const [allGroups, employees, ledGroups] = await Promise.all([
    repositories.employeeGroups.list(),
    repositories.employeeDirectory.listAll(),
    repositories.employeeGroups.listByLeaderEmployeeId(employee.id),
  ]);
  const employeeById = new Map(employees.map((entry) => [entry.id, entry]));
  const memberRowsByGroup = await Promise.all(
    allGroups.map((group) => repositories.employeeGroups.listMemberEntries(group.id)),
  );
  const groups = allGroups.filter((group) => (
    group.leaderEmployeeId === employee.id
    || memberRowsByGroup[allGroups.indexOf(group)]?.some((member) => member.id === employee.id)
  ));

  const activityCache = new Map<string, { activity7: number; activity30: number }>();
  const groupPayloads = await Promise.all(groups.map(async (group) => {
    const members = memberRowsByGroup[allGroups.indexOf(group)] ?? [];
    const memberItems = await Promise.all(members.map(async (member) => {
      const botId = member.claimedBotInstanceId;
      const activity = botId
        ? await getActivityForBot(botId, repositories, activityCache)
        : { activity7: 0, activity30: 0 };
      return {
        employeeId: member.id,
        nickname: member.nickname,
        legalName: member.legalName,
        botBound: Boolean(botId),
        botInstanceId: botId,
        activity7: activity.activity7,
        activity30: activity.activity30,
      };
    }));
    return {
      groupId: group.id,
      groupName: group.name,
      role: ledGroups.some((led) => led.id === group.id) ? 'leader' as const : 'member' as const,
      leaderEmployeeId: group.leaderEmployeeId,
      leaderName: group.leaderEmployeeId
        ? getEmployeeDisplayName(employeeById.get(group.leaderEmployeeId))
        : null,
      members: memberItems,
    };
  }));

  return {
    bound: true,
    employeeId: employee.id,
    groups: groupPayloads,
  };
}

export async function requireGroupManager(
  request: Request,
  groupId: string,
): Promise<{ session: AuthSession; employeeId: string | null }> {
  const session = await requireRequestSession(request);
  const repositories = getRepositories();
  const group = await repositories.employeeGroups.findById(groupId);
  if (!group) throw notFoundError('Group not found.');
  if (isAdminEmail(session.user.email)) {
    return { session, employeeId: null };
  }

  const employee = await findEmployeeForUser(session.user.id, repositories);
  if (!employee || group.leaderEmployeeId !== employee.id) {
    throw forbiddenError();
  }
  return { session, employeeId: employee.id };
}

export async function requireAdminGroupRequest(request: Request): Promise<AuthSession> {
  return requireAdminRequestSession(request);
}

export { getEmployeeDisplayName } from './employee-display';

export function buildTaskNotificationMessage(input: {
  feedback?: string | null;
  status: 'created' | 'accept' | 'needs_revision' | 'accepted';
  title: string;
}): string {
  const title = input.title;
  if (input.status === 'accept' || input.status === 'accepted') {
    return input.feedback
      ? `微Link：任务「${title}」已验收通过，反馈：${input.feedback}`
      : `微Link：任务「${title}」已验收通过。`;
  }
  if (input.status === 'needs_revision') {
    return input.feedback
      ? `微Link：任务「${title}」需要修改，反馈：${input.feedback}`
      : `微Link：任务「${title}」需要修改，请查看详情。`;
  }
  return `微Link：你有一项新任务「${title}」，请及时处理。`;
}

export async function sendTaskNotification(input: {
  assigneeEmployeeId: string;
  createdByUserId: string;
  feedback?: string | null;
  groupId: string;
  repositories?: GroupRepositories;
  status: 'created' | 'accept' | 'needs_revision';
  taskId: string;
  title: string;
}): Promise<boolean> {
  const repositories = input.repositories ?? getRepositories();
  const employee = await repositories.employeeDirectory.findById(input.assigneeEmployeeId);
  if (!employee?.claimedBotInstanceId) return false;

  const bot = await repositories.botInstances.findById(employee.claimedBotInstanceId);
  if (!bot) return false;

  await repositories.adminMessageDeliveries.createBatch([{
    batchId: `scheduled:task-notify:${input.taskId}`,
    botInstanceId: bot.id,
    createdByUserId: input.createdByUserId,
    id: `task-notify:${input.taskId}:${Date.now()}`,
    message: buildTaskNotificationMessage({
      feedback: input.feedback,
      status: input.status,
      title: input.title,
    }),
    metadata: JSON.stringify({
      channel: 'im',
      taskNotify: true,
      taskId: input.taskId,
      groupId: input.groupId,
    }),
    recipientUserId: bot.ownerUserId,
  }]);
  return true;
}

async function findEmployeeForUser(
  userId: string,
  repositories: GroupRepositories,
) {
  const employees = await repositories.employeeDirectory.listAll();
  return employees.find((employee) => employee.claimedByUserId === userId && employee.enabled) ?? null;
}

async function resolveAssignerEmployeeId(input: {
  assigneeEmployeeId: string;
  currentEmployeeId: string | null;
  group: NonNullable<Awaited<ReturnType<GroupRepositories['employeeGroups']['findById']>>>;
  repositories: GroupRepositories;
}): Promise<string> {
  if (input.group.leaderEmployeeId) return input.group.leaderEmployeeId;
  if (input.currentEmployeeId) {
    const current = await input.repositories.employeeDirectory.findById(input.currentEmployeeId);
    if (current?.groupId === input.group.id) return current.id;
  }
  const members = await input.repositories.employeeGroups.listMemberEntries(input.group.id);
  if (members[0]) return members[0].id;
  return input.assigneeEmployeeId;
}

function toTaskItems(
  tasks: Awaited<ReturnType<GroupRepositories['groupTasks']['listByGroup']>>,
  group: NonNullable<Awaited<ReturnType<GroupRepositories['employeeGroups']['findById']>>>,
  employees: Awaited<ReturnType<GroupRepositories['employeeDirectory']['listAll']>>,
): GroupTaskItem[] {
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  return tasks.map((task) => ({
    id: task.id,
    groupId: task.groupId,
    groupName: group.name,
    assignerEmployeeId: task.assignerEmployeeId,
    assignerName: getEmployeeDisplayName(employeeById.get(task.assignerEmployeeId)),
    assigneeEmployeeId: task.assigneeEmployeeId,
    assigneeName: getEmployeeDisplayName(employeeById.get(task.assigneeEmployeeId)),
    title: task.title,
    description: task.description,
    acceptanceCriteria: task.acceptanceCriteria,
    status: task.status,
    dueAt: task.dueAt ? toIso(task.dueAt) : null,
    submittedAt: task.submittedAt ? toIso(task.submittedAt) : null,
    submittedSummary: task.submittedSummary,
    submittedEvidence: parseEvidence(task.submittedEvidenceJson),
    acceptedAt: task.acceptedAt ? toIso(task.acceptedAt) : null,
    feedback: task.feedback,
    createdAt: toIso(task.createdAt),
    updatedAt: toIso(task.updatedAt),
  }));
}

async function getActivityForBot(
  botInstanceId: string,
  repositories: GroupRepositories,
  cache: Map<string, { activity7: number; activity30: number }>,
) {
  const cached = cache.get(botInstanceId);
  if (cached) return cached;
  const today = new Date();
  const [activity7, activity30] = await Promise.all([
    repositories.botDailyActivity.sumRange(
      toDateKey(addDays(today, -6)),
      toDateKey(today),
    ),
    repositories.botDailyActivity.sumRange(
      toDateKey(addDays(today, -29)),
      toDateKey(today),
    ),
  ]);
  const result = {
    activity7: activity7.reduce((total, row) => total + row.inboundCount + row.outboundCount, 0),
    activity30: activity30.reduce((total, row) => total + row.inboundCount + row.outboundCount, 0),
  };
  cache.set(botInstanceId, result);
  return result;
}

function toAdminGroupItem(
  group: NonNullable<Awaited<ReturnType<GroupRepositories['employeeGroups']['findById']>>>,
  leader: NonNullable<Awaited<ReturnType<GroupRepositories['employeeDirectory']['findById']>>> | null,
  memberCount: number,
): AdminGroupItem {
  return {
    id: group.id,
    name: group.name,
    leaderEmployeeId: group.leaderEmployeeId,
    leaderName: getEmployeeDisplayName(leader),
    memberCount,
    createdAt: toIso(group.createdAt),
    updatedAt: toIso(group.updatedAt),
  };
}

function toEmployeeOption(employee: {
  id: string;
  nickname: string | null;
  legalName: string | null;
  companyEmail: string | null;
  enabled: boolean;
  claimedBotInstanceId: string | null;
  claimedByUserId: string | null;
}): EmployeeOption {
  return {
    id: employee.id,
    nickname: employee.nickname,
    legalName: employee.legalName,
    companyEmail: employee.companyEmail,
    enabled: employee.enabled,
    claimedBotInstanceId: employee.claimedBotInstanceId,
    claimedByUserId: employee.claimedByUserId,
  };
}

function parseEvidence(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function toIso(value: Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function validationError(message: string): ApiError {
  return new ApiError({ code: 'VALIDATION_ERROR', message, status: 400 });
}

function forbiddenError(message = 'You do not have access to this resource.'): ApiError {
  return new ApiError({ code: 'FORBIDDEN', message, status: 403 });
}

function notFoundError(message: string): ApiError {
  return new ApiError({ code: 'NOT_FOUND', message, status: 404 });
}

function internalError(message: string): ApiError {
  return new ApiError({ code: 'INTERNAL_SERVER_ERROR', message, status: 500 });
}

function groupNameTakenError(): ApiError {
  return new ApiError({
    code: 'GROUP_NAME_TAKEN',
    message: 'Group name already exists.',
    status: 409,
  });
}
