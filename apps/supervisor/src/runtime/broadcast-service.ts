import type {
  AdminMessageDeliveryRepository,
  BotInstanceRepository,
  EmployeeDirectoryRepository,
  EmployeeGroupRepository,
  GlobalBroadcastConfigRepository,
} from '@weiling-ai/db';

export type BroadcastScope = 'all' | 'group' | 'selected';

export interface SendBroadcastInput {
  botInstanceId: string;
  scope: BroadcastScope;
  targetBotInstanceIds?: string[];
  text: string;
}

export interface SendBroadcastResult {
  accepted: boolean;
  deliveryCount: number;
  deliveryIds: string[];
}

type BroadcastConfigRepository = Pick<GlobalBroadcastConfigRepository, 'ensure'>;

export interface BroadcastServiceDependencies {
  botInstances: Pick<BotInstanceRepository, 'findById'>;
  employeeDirectory: Pick<EmployeeDirectoryRepository, 'findClaimedByBotInstanceId' | 'listAll'>;
  employeeGroups: Pick<EmployeeGroupRepository, 'listByLeaderEmployeeId' | 'listMemberEntries'>;
  globalBroadcastConfig?: BroadcastConfigRepository;
  /** Compatibility alias for the current index.ts wiring. */
  broadcastConfig?: BroadcastConfigRepository;
  deliveries: Pick<AdminMessageDeliveryRepository, 'createBatch'>;
  now?: () => Date;
}

export class BroadcastError extends Error {
  constructor(
    public readonly code: 'FORBIDDEN' | 'RATE_LIMITED' | 'INVALID_TEXT',
    message: string,
  ) {
    super(message);
    this.name = 'BroadcastError';
  }
}

export class BroadcastService {
  private readonly botInstances: BroadcastServiceDependencies['botInstances'];
  private readonly employeeDirectory: BroadcastServiceDependencies['employeeDirectory'];
  private readonly employeeGroups: BroadcastServiceDependencies['employeeGroups'];
  private readonly deliveries: BroadcastServiceDependencies['deliveries'];
  private readonly getNow: () => Date;
  private readonly broadcastConfig: BroadcastConfigRepository;
  private readonly lastBroadcastAtByBotInstance = new Map<string, Date>();

  constructor(dependencies: BroadcastServiceDependencies) {
    this.botInstances = dependencies.botInstances;
    this.employeeDirectory = dependencies.employeeDirectory;
    this.employeeGroups = dependencies.employeeGroups;
    this.deliveries = dependencies.deliveries;
    this.getNow = dependencies.now ?? (() => new Date());
    const broadcastConfig = dependencies.globalBroadcastConfig ?? dependencies.broadcastConfig;
    if (!broadcastConfig) {
      throw new Error('BroadcastService requires a global broadcast config repository.');
    }
    this.broadcastConfig = broadcastConfig;
  }

  async sendBroadcast(input: SendBroadcastInput): Promise<SendBroadcastResult> {
    const now = this.getNow();
    const text = typeof input.text === 'string' ? input.text.trim() : '';

    if (!text) {
      throw new BroadcastError('INVALID_TEXT', 'Broadcast text cannot be empty.');
    }
    if (Buffer.byteLength(text, 'utf8') > 64 * 1024) {
      throw new BroadcastError('INVALID_TEXT', 'Broadcast text must not exceed 64KB.');
    }
    if (!isBroadcastScope(input.scope)) {
      throw new BroadcastError('INVALID_TEXT', 'Broadcast scope must be all, group, or selected.');
    }

    const senderEntry = await this.employeeDirectory.findClaimedByBotInstanceId(
      input.botInstanceId,
    );
    if (!senderEntry) {
      throw new BroadcastError('FORBIDDEN', 'Sender Bot is not bound to an employee.');
    }

    const senderBot = await this.botInstances.findById(input.botInstanceId);
    if (!senderBot) {
      throw new BroadcastError('FORBIDDEN', 'Sender Bot does not exist.');
    }

    let targetBotInstanceIds: string[];
    let config: Awaited<ReturnType<BroadcastConfigRepository['ensure']>> | null = null;

    if (input.scope === 'group') {
      const ledGroups = await this.employeeGroups.listByLeaderEmployeeId(senderEntry.id);
      if (!ledGroups.length) {
        throw new BroadcastError('FORBIDDEN', 'Sender Employee does not lead a group.');
      }

      const targets = new Set<string>();
      for (const group of ledGroups) {
        const members = await this.employeeGroups.listMemberEntries(group.id);
        for (const member of members) {
          if (member.id !== senderEntry.id && member.claimedBotInstanceId) {
            targets.add(member.claimedBotInstanceId);
          }
        }
      }

      if (targets.size === 0) {
        return { accepted: false, deliveryCount: 0, deliveryIds: [] };
      }
      targetBotInstanceIds = [...targets];
    } else {
      config = await this.broadcastConfig.ensure();
      const authorizedEmployeeIds = JSON.parse(config.authorizedEmployeeIdsJson || '[]') as string[];
      if (!config.enabled || !authorizedEmployeeIds.includes(senderEntry.id)) {
        throw new BroadcastError('FORBIDDEN', 'Sender Employee is not authorized to broadcast.');
      }

      if (input.scope === 'selected') {
        if (
          !Array.isArray(input.targetBotInstanceIds)
          || input.targetBotInstanceIds.length === 0
        ) {
          throw new BroadcastError(
            'INVALID_TEXT',
            'Selected broadcasts require targetBotInstanceIds.',
          );
        }
        targetBotInstanceIds = [
          ...new Set(input.targetBotInstanceIds.filter(
            (botInstanceId): botInstanceId is string => typeof botInstanceId === 'string',
          )),
        ];
      } else {
        const entries = await this.employeeDirectory.listAll();
        targetBotInstanceIds = entries
          .map((entry) => entry.claimedBotInstanceId)
          .filter((botInstanceId): botInstanceId is string => Boolean(botInstanceId));
      }
    }

    this.assertRateLimit(input.botInstanceId, config?.rateLimitMinutes ?? 10, now);

    const timestamp = Date.now();
    const batchId = `scheduled:broadcast:${input.botInstanceId}:${timestamp}`;
    const rows: Array<{
      batchId: string;
      botInstanceId: string;
      createdByUserId: string;
      id: string;
      message: string;
      recipientUserId: string;
      metadata: string;
    }> = [];
    let index = 0;

    for (const targetBotInstanceId of targetBotInstanceIds) {
      const targetBot = await this.botInstances.findById(targetBotInstanceId);
      if (!targetBot) {
        continue;
      }

      rows.push({
        id: `broadcast:${input.botInstanceId}:${timestamp}:${index++}`,
        batchId,
        botInstanceId: targetBot.id,
        createdByUserId: senderBot.ownerUserId,
        recipientUserId: targetBot.ownerUserId,
        message: text,
        metadata: JSON.stringify({
          broadcast: true,
          channel: 'im',
          scope: input.scope,
          senderBotInstanceId: input.botInstanceId,
          senderEmployeeId: senderEntry.id,
        }),
      });
    }

    const created = await this.deliveries.createBatch(rows, now);
    if (rows.length > 0) {
      this.lastBroadcastAtByBotInstance.set(input.botInstanceId, now);
    }

    return {
      accepted: rows.length > 0,
      deliveryCount: rows.length,
      deliveryIds: created.map((row) => row.id),
    };
  }

  private assertRateLimit(botInstanceId: string, rateLimitMinutes: number, now: Date): void {
    const last = this.lastBroadcastAtByBotInstance.get(botInstanceId);
    if (!last) {
      return;
    }
    const windowMs = Math.max(0, rateLimitMinutes) * 60_000;
    if (now.getTime() - last.getTime() < windowMs) {
      throw new BroadcastError('RATE_LIMITED', 'Broadcast rate limit exceeded.');
    }
  }
}

function isBroadcastScope(value: unknown): value is BroadcastScope {
  return value === 'all' || value === 'group' || value === 'selected';
}
