import {
  generateReqId,
  WSClient,
  type BaseMessage,
  type Logger,
  type WSClientOptions,
  type WsFrame,
} from '@wecom/aibot-node-sdk';
import type {
  BotWecomBindingRecord,
  BotWecomBindingRepository,
  EmailDeliveryRepository,
  EmployeeDirectoryRepository,
  GlobalWecomConfigRecord,
  GlobalWecomConfigRepository,
  WecomMessageReceiptRepository,
  WecomProactiveDeliveryClaimResult,
  WecomProactiveDeliveryRepository,
} from '@weiling-ai/db';
import type { AdminMessageSender } from './admin-message-dispatcher';
import {
  type AdminMessageCopyProvider,
  renderAdminMessageCopy,
} from './admin-message-copy';
import { getShanghaiDateTime } from './meal-reminder-scheduler';
import type { WecomOnboardingHandler } from './wecom-onboarding';
const MAX_STREAM_BYTES = 18_000;
const RECEIPT_STALE_MS = 6 * 60_000;

export interface ExternalTurnRunner {
  runExternalTurn(botInstanceId: string, requestId: string, text: string): Promise<string>;
}

interface WecomClient {
  readonly isConnected: boolean;
  connect(): this;
  disconnect(): void;
  on(event: string, listener: (...args: any[]) => void): this;
  replyStream(
    frame: Pick<WsFrame, 'headers'>,
    streamId: string,
    content: string,
    finish?: boolean,
  ): Promise<WsFrame>;
  sendMessage(chatId: string, body: {
    markdown: { content: string };
    msgtype: 'markdown';
  }): Promise<WsFrame>;
}

export interface WecomChannelGatewayDependencies {
  bindings: BotWecomBindingRepository;
  clientFactory?: (options: WSClientOptions) => WecomClient;
  configs: GlobalWecomConfigRepository;
  messageCopy: AdminMessageCopyProvider;
  onboarding: WecomOnboardingHandler;
  onUserActive?: (botInstanceId: string) => Promise<unknown>;
  processManager: ExternalTurnRunner;
  proactiveDeliveries: WecomProactiveDeliveryRepository;
  receipts: WecomMessageReceiptRepository;
}

export class WecomChannelGateway {
  private activeRevision: number | null = null;
  private client: WecomClient | null = null;
  private readonly clientFactory: (options: WSClientOptions) => WecomClient;
  private readonly dependencies: WecomChannelGatewayDependencies;

  constructor(dependencies: WecomChannelGatewayDependencies) {
    this.dependencies = dependencies;
    this.clientFactory = dependencies.clientFactory ?? ((options) => new WSClient(options));
  }

  async runOnce(): Promise<void> {
    const config = await this.dependencies.configs.ensure();

    if (!config.enabled) {
      await this.stopClient();
      if (config.connectionStatus !== 'disabled' || config.observedRevision !== config.revision) {
        await this.dependencies.configs.recordConnectionStatus({
          observedRevision: config.revision,
          status: 'disabled',
        });
      }
      return;
    }

    if (this.client && this.activeRevision === config.revision) return;
    await this.startClient(config);
  }

  async dispose(): Promise<void> {
    await this.stopClient();
  }

  async trySendProactive(
    botInstanceId: string,
    deliveryId: string,
    semanticKey: string,
    text: string,
  ): Promise<boolean> {
    const client = this.client;
    if (!client?.isConnected) return false;

    let binding: BotWecomBindingRecord | null;

    try {
      binding = await this.dependencies.bindings.findPreferredByBotInstanceId(botInstanceId);
    } catch (error) {
      console.error(`Failed to resolve the preferred WeCom binding for Bot ${botInstanceId}.`);
      console.error(error);
      return false;
    }
    if (!binding) return false;

    const now = new Date();
    let claimResult: WecomProactiveDeliveryClaimResult;

    try {
      claimResult = await this.dependencies.proactiveDeliveries.claim({
        botInstanceId,
        deliveryId,
        now,
        semanticKey,
        staleBefore: new Date(now.getTime() - RECEIPT_STALE_MS),
      });
    } catch (error) {
      console.error(`Failed to claim WeCom proactive delivery ${deliveryId}.`);
      console.error(error);
      return false;
    }

    if (claimResult === 'sent') return true;
    if (claimResult === 'processing') {
      throw new Error('WeCom proactive delivery is already in progress.');
    }
    if (claimResult === 'failed') return false;

    try {
      await client.sendMessage(binding.wecomUserId, {
        markdown: { content: text },
        msgtype: 'markdown',
      });
    } catch (error) {
      const message = formatError(error);
      await this.runBestEffort(
        () => this.dependencies.bindings.recordError(botInstanceId, message),
        `Failed to persist the WeCom delivery error for Bot ${botInstanceId}.`,
      );
      await this.runBestEffort(
        () => this.dependencies.proactiveDeliveries.markFailed(deliveryId, message),
        `Failed to mark WeCom proactive delivery ${deliveryId} as failed.`,
      );
      console.error(`WeCom proactive delivery failed for Bot ${botInstanceId}.`);
      console.error(error);
      return false;
    }

    await this.runBestEffort(
      () => this.dependencies.bindings.recordOutbound(botInstanceId),
      `Failed to record WeCom outbound activity for Bot ${botInstanceId}.`,
    );
    await this.runBestEffort(
      () => this.dependencies.proactiveDeliveries.markSent(deliveryId),
      `Failed to mark WeCom proactive delivery ${deliveryId} as sent.`,
    );
    return true;
  }

  private async startClient(config: GlobalWecomConfigRecord): Promise<void> {
    await this.stopClient();
    this.activeRevision = config.revision;
    await this.dependencies.configs.recordConnectionStatus({
      observedRevision: config.revision,
      status: 'connecting',
    });

    const client = this.clientFactory({
      botId: config.botId,
      heartbeatInterval: 30_000,
      logger: createSdkLogger(),
      maxAuthFailureAttempts: 5,
      maxReconnectAttempts: -1,
      reconnectInterval: 1_000,
      requestTimeout: 15_000,
      secret: config.secret,
      wsUrl: config.wsUrl,
    });
    this.client = client;

    client.on('authenticated', () => {
      this.observeStatusUpdate(
        this.recordCurrentStatus(config.revision, 'connected', {
          connectedAt: new Date(),
        }),
      );
    });
    client.on('disconnected', () => {
      this.observeStatusUpdate(
        this.recordCurrentStatus(config.revision, 'connecting', {
          disconnectedAt: new Date(),
        }),
      );
    });
    client.on('reconnecting', () => {
      this.observeStatusUpdate(this.recordCurrentStatus(config.revision, 'connecting'));
    });
    client.on('error', (error: Error) => {
      console.error('WeCom long connection error.');
      console.error(error);
      this.observeStatusUpdate(
        this.recordCurrentStatus(config.revision, 'error', {
          error: formatError(error),
        }),
      );
    });
    client.on('event.disconnected_event', () => {
      this.handleTerminalDisconnect(client, config.revision);
    });
    client.on('message', (frame: WsFrame<BaseMessage>) => {
      void this.handleMessage(client, config.revision, frame).catch((error: unknown) => {
        console.error('WeCom inbound message handling failed.');
        console.error(error);
      });
    });

    try {
      client.connect();
    } catch (error) {
      this.client = null;
      this.activeRevision = null;
      client.disconnect();
      await this.dependencies.configs.recordConnectionStatus({
        error: formatError(error),
        observedRevision: config.revision,
        status: 'error',
      });
    }
  }

  private async stopClient(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.activeRevision = null;
    client?.disconnect();
  }

  private async handleMessage(
    client: WecomClient,
    revision: number,
    frame: WsFrame<BaseMessage>,
  ): Promise<void> {
    if (this.client !== client || this.activeRevision !== revision) return;
    const body = frame.body;
    if (!body?.msgid || !body.from?.userid) return;

    const streamId = generateReqId('weclaws');
    const copy = await this.dependencies.messageCopy.getCopy();
    if (body.chattype !== 'single') {
      await client.replyStream(frame, streamId, renderAdminMessageCopy(copy.wecomGroupUnsupported, {
        assistantName: copy.assistantName,
      }), true);
      return;
    }

    const text = extractInboundText(body);
    const onboardingReceiptResponse = await this.dependencies.onboarding.findReceiptResponse({
      messageId: body.msgid,
      wecomUserId: body.from.userid,
    });
    if (onboardingReceiptResponse !== null) {
      await client.replyStream(frame, streamId, onboardingReceiptResponse, true);
      return;
    }
    const binding = await this.dependencies.bindings.findActiveByWecomUserId(body.from.userid);
    if (!binding || binding.employeeEnabled === false) {
      const response = await this.dependencies.onboarding.handleMessage({
        messageId: body.msgid,
        text,
        wecomUserId: body.from.userid,
      });
      await client.replyStream(frame, streamId, response, true);
      return;
    }
    if (!text) {
      await client.replyStream(frame, streamId, renderAdminMessageCopy(copy.wecomUnsupported, {
        assistantName: copy.assistantName,
      }), true);
      return;
    }

    const now = new Date();
    const accepted = await this.dependencies.receipts.tryAccept({
      botInstanceId: binding.botInstanceId,
      messageId: body.msgid,
      receivedAt: now,
      staleBefore: new Date(now.getTime() - RECEIPT_STALE_MS),
    });
    if (accepted === 'processing') {
      await client.replyStream(frame, streamId, renderAdminMessageCopy(copy.wecomDuplicate, {
        assistantName: copy.assistantName,
      }), true);
      return;
    }
    if (accepted === 'succeeded') {
      await client.replyStream(frame, streamId, renderAdminMessageCopy(copy.wecomCompleted, {
        assistantName: copy.assistantName,
      }), true);
      return;
    }

    await this.runBestEffort(
      () => this.dependencies.bindings.recordInbound(binding.botInstanceId),
      `Failed to record WeCom inbound activity for Bot ${binding.botInstanceId}.`,
    );

    let finalFrameSent = false;

    try {
      await client.replyStream(frame, streamId, renderAdminMessageCopy(copy.wecomAck, {
        assistantName: copy.assistantName,
      }), false);
      const reply = await this.dependencies.processManager.runExternalTurn(
        binding.botInstanceId,
        body.msgid,
        text,
      );
      await sendFinalReply(
        client,
        frame,
        streamId,
        body.from.userid,
        reply,
        renderAdminMessageCopy(copy.wecomFailure, { assistantName: copy.assistantName }),
        () => {
        finalFrameSent = true;
        },
      );
    } catch (error) {
      const message = formatError(error);
      await Promise.all([
        this.runBestEffort(
          () => this.dependencies.bindings.recordError(binding.botInstanceId, message),
          `Failed to persist the WeCom inbound error for Bot ${binding.botInstanceId}.`,
        ),
        this.runBestEffort(
          () => this.dependencies.receipts.markFailed(body.msgid, message),
          `Failed to mark WeCom message ${body.msgid} as failed.`,
        ),
      ]);

      if (!finalFrameSent) {
        await client.replyStream(frame, streamId, renderAdminMessageCopy(copy.wecomFailure, {
          assistantName: copy.assistantName,
        }), true).catch((replyError: unknown) => {
          console.error(`Failed to close the failed WeCom stream for message ${body.msgid}.`);
          console.error(replyError);
        });
      }
      return;
    }

    await Promise.all([
      this.runBestEffort(
        () => this.dependencies.bindings.recordOutbound(binding.botInstanceId),
        `Failed to record WeCom outbound activity for Bot ${binding.botInstanceId}.`,
      ),
      this.runBestEffort(
        () => this.dependencies.receipts.markSucceeded(body.msgid),
        `Failed to mark WeCom message ${body.msgid} as succeeded.`,
      ),
    ]);
    if (this.dependencies.onUserActive) {
      await this.runBestEffort(
        () => this.dependencies.onUserActive!(binding.botInstanceId!),
        `Failed to resume deferred messages for Bot ${binding.botInstanceId}.`,
      );
    }
  }

  private handleTerminalDisconnect(client: WecomClient, revision: number): void {
    if (this.client !== client || this.activeRevision !== revision) return;

    this.client = null;
    this.activeRevision = null;
    client.disconnect();
    this.observeStatusUpdate(this.dependencies.configs.recordConnectionStatus({
      disconnectedAt: new Date(),
      observedRevision: revision,
      status: 'connecting',
    }));
  }

  private observeStatusUpdate(update: Promise<unknown>): void {
    void update.catch((error: unknown) => {
      console.error('Failed to persist WeCom connection status.');
      console.error(error);
    });
  }

  private async runBestEffort(
    operation: () => Promise<unknown>,
    failureMessage: string,
  ): Promise<void> {
    try {
      await operation();
    } catch (error) {
      console.error(failureMessage);
      console.error(error);
    }
  }

  private async recordCurrentStatus(
    revision: number,
    status: 'connected' | 'connecting' | 'error',
    details: {
      connectedAt?: Date;
      disconnectedAt?: Date;
      error?: string;
    } = {},
  ): Promise<void> {
    if (this.activeRevision !== revision) return;
    await this.dependencies.configs.recordConnectionStatus({
      ...details,
      observedRevision: revision,
      status,
    });
  }
}

export interface WeixinFirstMessageSenderDependencies {
  emailDeliveries?: EmailDeliveryRepository;
  emailFallback?: boolean;
  employeeDirectory?: Pick<EmployeeDirectoryRepository, 'findClaimedByBotInstanceId'>;
  getNow?: () => Date;
  messageCopy: AdminMessageCopyProvider;
}

/**
 * Proactive delivery order: Weixin first, then WeCom, then email.
 * When Weixin fails, the fallback text carries a hint asking the employee to
 * resume the Weixin conversation so future proactive messages can be delivered.
 */
export class WeixinFirstMessageSender implements AdminMessageSender {
  constructor(
    private readonly weixin: AdminMessageSender,
    private readonly gateway: Pick<WecomChannelGateway, 'trySendProactive'>,
    private readonly dependencies: WeixinFirstMessageSenderDependencies,
  ) {
    this.getNow = dependencies.getNow ?? (() => new Date());
  }

  private readonly getNow: () => Date;

  async sendAdminMessage(
    botInstanceId: string,
    deliveryId: string,
    text: string,
    semanticKey?: string,
  ): Promise<void> {
    let weixinFailed = false;
    try {
      await this.weixin.sendAdminMessage(botInstanceId, deliveryId, text, semanticKey);
      return;
    } catch {
      weixinFailed = true;
    }

    const hint = weixinFailed ? await this.buildWeixinRecoveryHint() : null;
    const wecomText = hint ? `${text}\n\n${hint}` : text;
    try {
      if (await this.gateway.trySendProactive(
        botInstanceId,
        deliveryId,
        semanticKey ?? deliveryId,
        wecomText,
      )) {
        return;
      }
    } catch {
      // Fall through to the email fallback.
    }

    if (this.dependencies.emailFallback === false) {
      throw new Error('主动消息微信与企业微信投递均失败。');
    }

    if (await this.trySendEmailFallback(botInstanceId, deliveryId, semanticKey, text, weixinFailed)) {
      return;
    }

    throw new Error('主动消息微信、企业微信与邮箱投递均失败。');
  }

  private async buildWeixinRecoveryHint(): Promise<string | null> {
    try {
      const copy = await this.dependencies.messageCopy.getCopy();
      const assistantName = copy.assistantName.trim();
      if (!assistantName) {
        return null;
      }
      return `微信通道暂不可用，请在微信上给“${assistantName}”发一条消息恢复互动，以便继续接收提醒。`;
    } catch {
      return null;
    }
  }

  private async trySendEmailFallback(
    botInstanceId: string,
    deliveryId: string,
    semanticKey: string | undefined,
    text: string,
    weixinFailed: boolean,
  ): Promise<boolean> {
    const { emailDeliveries, employeeDirectory } = this.dependencies;
    if (!emailDeliveries || !employeeDirectory) {
      return false;
    }
    const shanghai = getShanghaiDateTime(this.getNow());
    const weekday = new Date(`${shanghai.date}T12:00:00+08:00`).getUTCDay();
    if (weekday !== 1) {
      return false;
    }
    const employee = await employeeDirectory.findClaimedByBotInstanceId(botInstanceId);
    if (!employee?.companyEmail) {
      return false;
    }
    const hint = weixinFailed ? await this.buildWeixinRecoveryHint() : null;
    const message = hint ? `${text}\n\n${hint}` : text;
    await emailDeliveries.createBatch([{
      botInstanceId,
      createdByUserId: employee.claimedByUserId,
      id: `admin-email:${deliveryId}`,
      message,
      recipientEmail: employee.companyEmail,
      recipientUserId: employee.claimedByUserId,
      semanticKey: `admin-email:${semanticKey ?? deliveryId}`,
      source: 'admin',
      subject: buildAdminEmailSubject(semanticKey),
    }]);
    return true;
  }
}

function buildAdminEmailSubject(semanticKey: string | undefined): string {
  if (semanticKey?.startsWith('morning:')) {
    const date = semanticKey.split(':').pop() ?? '';
    return `微Link · 微灵 AI 助手晨报｜${date}`;
  }
  if (semanticKey?.startsWith('meal:')) {
    return '微Link · 微灵 AI 助手午餐提醒';
  }
  return '微Link · 微灵 AI 助手通知';
}

function extractInboundText(body: BaseMessage): string | null {
  if (body.msgtype === 'text') {
    return normalizeText(body.text?.content);
  }
  if (body.msgtype === 'voice') {
    return normalizeText(body.voice?.content);
  }
  if (body.msgtype === 'mixed' && Array.isArray(body.mixed?.msg_item)) {
    const text = body.mixed.msg_item
      .filter((item: { msgtype?: string }) => item.msgtype === 'text')
      .map((item: { text?: { content?: string } }) => item.text?.content ?? '')
      .join('\n');
    return normalizeText(text);
  }
  return null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

async function sendFinalReply(
  client: WecomClient,
  frame: Pick<WsFrame, 'headers'>,
  streamId: string,
  wecomUserId: string,
  text: string,
  fallbackText: string,
  onFinalFrameSent?: () => void,
): Promise<void> {
  const chunks = splitUtf8(text, MAX_STREAM_BYTES);
  await client.replyStream(frame, streamId, chunks[0] ?? fallbackText, true);
  onFinalFrameSent?.();

  for (const chunk of chunks.slice(1)) {
    await client.sendMessage(wecomUserId, {
      markdown: { content: chunk },
      msgtype: 'markdown',
    });
  }
}

export function splitUtf8(value: string, maxBytes: number): string[] {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('maxBytes must be a positive integer.');
  }

  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const character of value) {
    const bytes = Buffer.byteLength(character, 'utf8');
    if (current && currentBytes + bytes > maxBytes) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += character;
    currentBytes += bytes;
  }
  if (current) chunks.push(current);
  return chunks;
}

function createSdkLogger(): Logger {
  return {
    debug: () => undefined,
    error: (message, ...args) => console.error(`[WeCom SDK] ${message}`, ...args),
    info: (message, ...args) => console.info(`[WeCom SDK] ${message}`, ...args),
    warn: (message, ...args) => console.warn(`[WeCom SDK] ${message}`, ...args),
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
