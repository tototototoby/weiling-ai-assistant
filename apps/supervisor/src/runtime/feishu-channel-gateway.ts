import { once } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { resolveBotInstancePaths } from '@weiling-ai/shared';
import type {
  BotFeishuConfigRecord,
  BotFeishuConfigRepository,
  BotFeishuEventRepository,
  BotFeishuGroupSessionRepository,
  BotInstanceRepository,
} from '@weiling-ai/db';
import type { SupervisorConfig } from '../config';
import {
  type AdminMessageCopyProvider,
  renderAdminMessageCopy,
} from './admin-message-copy';
import {
  runLarkCliCapture,
  runLarkCliOnce,
  spawnLarkCli,
  type RunLarkCliOnceInput,
  type SpawnLarkCliInput,
} from './lark-cli-runner';

const MAX_STREAM_BYTES = 18_000;
const EVENT_STALE_MS = 6 * 60_000;
const FEISHU_EXTERNAL_TURN_TIMEOUT_MS = 20 * 60_000;
const SEND_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 5_000;
const RESTART_BACKOFF_MS = 30_000;
const GROUP_ATTACHMENT_DEDUPE_MS = 10 * 60_000;
const INBOUND_RESOURCE_DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_INBOUND_RESOURCE_BYTES = 50 * 1024 * 1024;
const MAX_INBOUND_FILE_NAME_BYTES = 180;
const FEISHU_DENIED_IM_TOOLS = ['send_im', 'send_im_media'];
const CREDENTIALS_FILE_NAME = path.join('.weclaws-feishu', 'credentials.json');
const FEISHU_INBOX_DIRECTORY = 'feishu-inbox';
const P2P_PERSONA = '当前会话是飞书私聊。禁止调用 send_im、send_im_media 或任何微信发送工具；这些工具不适用于当前入口。用户要求制作、发送、重发或查看图片/文件时，最终回复末尾必须为每个要发送的文件单独输出一行：[飞书文件: 工作区相对路径]；重发已有文件也必须输出标记。没有有效工作区相对路径和对应标记时，不得声称文件已经发送或交付。标记内不得使用绝对路径。除这些标记外，直接输出给用户的回复内容。';
const GROUP_PERSONA = '你是服务于本群的微Link（微Link · 微灵 AI 助手）。你现在在飞书群聊中为群成员提供协作服务。请以“服务于本群的微Link”身份作答，面向群成员，回复简洁清晰，直接输出回复内容即可。重要：本会话没有任何可用的 IM 发送/媒体工具，调用任何发送工具都会失败；生成需要分享到群里的图片或文件后，只需在回复末尾单独输出一行标记：[群文件: 工作区相对路径]，多个文件则每行一个（例如 [群文件: poster_test/september.png]），平台会自动把文件发到群里。不要提及或引用私聊内容。群成员需要你查看本群聊天记录时，用 lark-cli 查询（在沙箱工作区执行）：HOME=$PWD lark-cli im +chat-messages-list --chat-id <下方当前群 chat_id> --as bot，可按 --start/--end 限定时间范围。';
const P2P_FILE_MARKER_PATTERN = /^\[飞书文件:\s*([^\]]+)\]$/u;
const GROUP_FILE_MARKER_PATTERN = /^\[群文件:\s*([^\]]+)\]$/u;
const EXTERNAL_TURN_TIMEOUT_REPLY = '任务处理超时，任务可能仍在后台继续。请不要重复提交，稍后可以再询问处理进度。';
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const P2P_PROGRESS_UPDATES = [
  {
    delayMs: 2 * 60_000,
    text: '小灵进度：任务仍在处理中，完成后会自动发送结果，不需要重复提交。',
  },
  {
    delayMs: 5 * 60_000,
    text: '小灵进度：任务还在继续处理，可能需要更多时间；完成后会自动回复并发送文件。',
  },
  {
    delayMs: 10 * 60_000,
    text: '小灵进度：这是一个较长任务，目前仍在运行。请继续等待，无需重复发送。',
  },
] as const;

export interface ExternalTurnRunner {
  runExternalTurn(botInstanceId: string, requestId: string, text: string): Promise<string>;
  runExternalTurnDetailed?(
    botInstanceId: string,
    requestId: string,
    text: string,
    options?: {
      denyTools?: string[];
      sessionId?: string;
      sessionKey?: string;
      systemPrompt?: string;
      timeoutMs?: number;
    },
  ): Promise<{ sessionId?: string; text: string }>;
}

export interface FeishuChannelGatewayDependencies {
  botInstances: Pick<BotInstanceRepository, 'listAllForAdministration'>;
  config: SupervisorConfig;
  configs: BotFeishuConfigRepository;
  events: BotFeishuEventRepository;
  groupSessions: BotFeishuGroupSessionRepository;
  messageCopy: AdminMessageCopyProvider;
  now?: () => Date;
  onUserActive?: (botInstanceId: string) => Promise<unknown>;
  processManager: ExternalTurnRunner;
  resolveBotAppName?: (botInstanceId: string) => Promise<string | null>;
  runLarkCapture?: (input: RunLarkCliOnceInput) => Promise<string>;
  runLarkOnce?: (input: RunLarkCliOnceInput) => Promise<void>;
  spawnLark?: (input: SpawnLarkCliInput) => ChildProcess;
}

interface FeishuInboundEvent {
  chat_id?: unknown;
  chat_type?: unknown;
  content?: unknown;
  event_id?: unknown;
  message_id?: unknown;
  message_type?: unknown;
  sender_id?: unknown;
  type?: unknown;
}

interface FeishuBotSession {
  child: ChildProcess;
  revision: number;
}

interface FeishuCredentials {
  appId: string;
  appSecret?: string;
}

interface FeishuInboundResource {
  fileKey: string;
  originalFileName: string;
  type: 'file' | 'image';
}

interface DownloadedFeishuResource extends FeishuInboundResource {
  relativePath: string;
}

interface ResolvedGroupAttachment {
  absolutePath: string;
  fileStat: Awaited<ReturnType<typeof lstat>>;
}

interface GroupAttachmentSendSummary {
  deduplicated: number;
  failed: number;
  rejected: number;
  sent: number;
}

interface AttachmentSendOptions {
  deduplicate?: boolean;
  idempotencyScope?: string;
}

class FeishuInboundResourceError extends Error {
  constructor(message: string, readonly userMessage: string) {
    super(message);
    this.name = 'FeishuInboundResourceError';
  }
}

class FeishuGroupAttachmentPathError extends Error {
  constructor(
    message: string,
    readonly category: 'failed' | 'rejected' = 'rejected',
  ) {
    super(message);
    this.name = 'FeishuGroupAttachmentPathError';
  }
}

export class FeishuChannelGateway {
  private readonly dependencies: FeishuChannelGatewayDependencies;
  private readonly getNow: () => Date;
  private readonly appNames = new Map<string, string | null>();
  private readonly eventQueues = new Map<string, Promise<void>>();
  private readonly sentGroupAttachments = new Map<string, number>();
  private readonly lastStartAttemptAt = new Map<string, number>();
  private readonly sessions = new Map<string, FeishuBotSession>();

  constructor(dependencies: FeishuChannelGatewayDependencies) {
    this.dependencies = dependencies;
    this.getNow = dependencies.now ?? (() => new Date());
  }

  async runOnce(): Promise<void> {
    await this.importCredentialsFiles();
    const configured = await this.dependencies.configs.listConfigured();
    const byId = new Map(configured.map((config) => [config.botInstanceId, config]));

    for (const [botInstanceId, session] of [...this.sessions.entries()]) {
      const config = byId.get(botInstanceId);
      if (!config || session.revision !== config.revision || session.child.exitCode !== null) {
        await this.stopSession(botInstanceId);
        if (!config) {
          await this.runBestEffort(
            () => this.removeLarkConfig(this.resolveLarkHomeDir(botInstanceId)),
            `Failed to remove the Feishu lark config for Bot ${botInstanceId}.`,
          );
        }
      }
    }

    for (const config of configured) {
      const session = this.sessions.get(config.botInstanceId);
      if (!session || session.revision !== config.revision || session.child.exitCode !== null) {
        const lastAttempt = this.lastStartAttemptAt.get(config.botInstanceId) ?? 0;
        if (this.getNow().getTime() - lastAttempt >= RESTART_BACKOFF_MS) {
          await this.startSession(config);
        }
      }
    }
  }

  async dispose(): Promise<void> {
    for (const botInstanceId of [...this.sessions.keys()]) {
      await this.stopSession(botInstanceId);
    }
    this.eventQueues.clear();
  }

  private async importCredentialsFiles(): Promise<void> {
    const bots = await this.dependencies.botInstances.listAllForAdministration();

    for (const bot of bots) {
      const existing = await this.dependencies.configs.findByBotInstanceId(bot.id);
      if (existing?.appId?.trim()) continue;
      const workspaceDir = this.resolveWorkspaceDir(bot.id);
      const credentials = await this.tryReadCredentialsFile(workspaceDir);
      if (!credentials) continue;
      await this.migrateWorkspaceLarkConfig(bot.id, workspaceDir, credentials.appId);
      await this.dependencies.configs.ensure(bot.id);
      await this.dependencies.configs.update({
        appId: credentials.appId,
        ...(credentials.appSecret ? { appSecret: credentials.appSecret } : {}),
        botInstanceId: bot.id,
        enabled: true,
      });
    }
  }

  private async tryReadCredentialsFile(homeDir: string): Promise<FeishuCredentials | null> {
    try {
      const raw = await readFile(path.join(homeDir, CREDENTIALS_FILE_NAME), 'utf8');
      const parsed = JSON.parse(raw) as { appId?: unknown; appSecret?: unknown };
      const appId = typeof parsed.appId === 'string' ? parsed.appId.trim() : '';
      const appSecret = typeof parsed.appSecret === 'string' ? parsed.appSecret.trim() : '';
      if (!appId) return null;
      return { appId, appSecret: appSecret || undefined };
    } catch {
      return null;
    }
  }

  private async startSession(config: BotFeishuConfigRecord): Promise<void> {
    await this.stopSession(config.botInstanceId);
    const botInstanceId = config.botInstanceId;
    const revision = config.revision;
    const homeDir = this.resolveLarkHomeDir(botInstanceId);

    await this.ensureLarkConfig(homeDir, config);
    this.lastStartAttemptAt.set(botInstanceId, this.getNow().getTime());

    this.observeStatusUpdate(this.dependencies.configs.recordEventStatus({
      botInstanceId,
      observedRevision: revision,
      status: 'connecting',
      updatedAt: this.getNow(),
    }));

    const child = this.spawnLark({
      args: ['event', 'consume', 'im.message.receive_v1', '--as', 'bot'],
      config: this.dependencies.config,
      homeDir,
    });
    const session: FeishuBotSession = { child, revision };
    this.sessions.set(botInstanceId, session);

    child.once('error', (error) => {
      if (this.sessions.get(botInstanceId) !== session) return;
      this.sessions.delete(botInstanceId);
      this.clearEventQueuesForBot(botInstanceId);
      console.error(`Feishu event consume failed to start for Bot ${botInstanceId}.`);
      console.error(error);
      this.observeStatusUpdate(this.dependencies.configs.recordEventStatus({
        botInstanceId,
        error: formatError(error),
        observedRevision: revision,
        status: 'error',
        updatedAt: this.getNow(),
      }));
    });

    child.once('exit', (exitCode, signal) => {
      if (this.sessions.get(botInstanceId) !== session) return;
      this.sessions.delete(botInstanceId);
      this.clearEventQueuesForBot(botInstanceId);
      this.observeStatusUpdate(this.dependencies.configs.recordEventStatus({
        botInstanceId,
        disconnectedAt: this.getNow(),
        error: exitCode === 0
          ? null
          : `Feishu event consume exited (code=${exitCode}, signal=${signal ?? 'none'}).`,
        observedRevision: revision,
        status: exitCode === 0 ? 'connecting' : 'error',
        updatedAt: this.getNow(),
      }));
    });

    if (!child.stdout || !child.stderr) {
      this.sessions.delete(botInstanceId);
      this.observeStatusUpdate(this.dependencies.configs.recordEventStatus({
        botInstanceId,
        error: 'Feishu event consume did not expose stdout/stderr streams.',
        observedRevision: revision,
        status: 'error',
        updatedAt: this.getNow(),
      }));
      return;
    }

    const stdout = createInterface({ input: child.stdout });
    stdout.on('line', (line) => {
      this.enqueueEventLine(botInstanceId, revision, line);
    });

    const stderr = createInterface({ input: child.stderr });
    stderr.on('line', (line) => {
      if (line.includes('[event] ready')) {
        this.observeStatusUpdate(this.dependencies.configs.recordEventStatus({
          botInstanceId,
          connectedAt: this.getNow(),
          observedRevision: revision,
          status: 'connected',
        }));
      } else if (line.includes('error') || line.includes('Error')) {
        this.observeStatusUpdate(this.dependencies.configs.recordEventStatus({
          botInstanceId,
          error: line.trim().slice(0, 500),
          observedRevision: revision,
          status: 'error',
        }));
      }
    });
  }

  private enqueueEventLine(botInstanceId: string, revision: number, line: string): void {
    const event = parseFeishuEvent(line);
    if (!event || event.type !== 'im.message.receive_v1') return;
    const chatId = normalizeText(event.chat_id);
    const messageId = normalizeText(event.message_id);
    const queueKey = `${botInstanceId}\u0000${chatId ?? `missing-chat:${messageId ?? 'unknown'}`}`;
    const previous = this.eventQueues.get(queueKey) ?? Promise.resolve();
    const queued = previous
      .then(() => this.handleEvent(botInstanceId, revision, event))
      .catch((error: unknown) => {
        console.error(`Feishu inbound event handling failed for Bot ${botInstanceId}.`);
        console.error(error);
      });
    this.eventQueues.set(queueKey, queued);
    void queued.then(() => {
      if (this.eventQueues.get(queueKey) === queued) {
        this.eventQueues.delete(queueKey);
      }
    });
  }

  private async handleEvent(
    botInstanceId: string,
    revision: number,
    event: FeishuInboundEvent,
  ): Promise<void> {
    const session = this.sessions.get(botInstanceId);
    if (!session || session.revision !== revision) return;

    const eventId = normalizeText(event.event_id);
    const messageId = normalizeText(event.message_id);
    if (!eventId || !messageId) return;

    const copy = await this.dependencies.messageCopy.getCopy();
    const now = this.getNow();
    const chatId = normalizeText(event.chat_id) ?? '';
    const senderOpenId = normalizeText(event.sender_id) ?? '';

    if (event.chat_type !== 'p2p') {
      await this.handleGroupEvent(
        botInstanceId,
        eventId,
        messageId,
        chatId,
        senderOpenId,
        normalizeText(event.message_type),
        normalizeText(event.content),
        now,
      );
      return;
    }

    const claim = await this.dependencies.events.tryAccept({
      botInstanceId,
      chatId,
      eventId,
      messageId,
      receivedAt: now,
      senderOpenId,
      staleBefore: new Date(now.getTime() - EVENT_STALE_MS),
    });
    if (claim !== 'claimed') return;

    const content = normalizeText(event.content);
    const messageType = normalizeText(event.message_type);
    if (!content && !isInboundResourceMessageType(messageType)) {
      await this.sendReply(
        botInstanceId,
        messageId,
        chatId,
        renderAdminMessageCopy(copy.wecomUnsupported, {
          assistantName: copy.assistantName,
        }),
      );
      await this.runBestEffort(
        () => this.dependencies.events.markSucceeded(eventId, now),
        `Failed to mark Feishu event ${eventId} as succeeded.`,
      );
      return;
    }

    await this.runBestEffort(
      () => this.dependencies.configs.recordOwnerOpenId(botInstanceId, senderOpenId, now),
      `Failed to record Feishu owner open id for Bot ${botInstanceId}.`,
    );

    await this.runBestEffort(
      () => this.dependencies.configs.recordActivity({ botInstanceId, inboundAt: now }),
      `Failed to record Feishu inbound activity for Bot ${botInstanceId}.`,
    );

    try {
      await this.sendReply(
        botInstanceId,
        messageId,
        chatId,
        renderAdminMessageCopy(copy.wecomAck, {
          assistantName: copy.assistantName,
        }),
      );
      const text = await this.prepareInboundTurnText({
        botInstanceId,
        content,
        messageId,
        messageType,
      });
      const stopProgressUpdates = this.startP2PProgressUpdates(botInstanceId, messageId, chatId);
      let result: { sessionId?: string; text: string };
      try {
        result = await this.runDetailed(
          botInstanceId,
          messageId,
          text,
          {
            denyTools: [...FEISHU_DENIED_IM_TOOLS],
            systemPrompt: P2P_PERSONA,
            timeoutMs: FEISHU_EXTERNAL_TURN_TIMEOUT_MS,
          },
        );
      } finally {
        stopProgressUpdates();
      }
      const attachments = await extractP2PAttachments(
        result.text,
        this.resolveWorkspaceDir(botInstanceId),
        botInstanceId,
      );
      await this.sendReply(botInstanceId, messageId, chatId, stripP2PAttachments(result.text));
      const attachmentSummary = await this.sendGroupAttachments(
        botInstanceId,
        chatId,
        attachments,
        {
          deduplicate: false,
          idempotencyScope: `p2p:${messageId}`,
        },
      );
      if (attachmentSummary.failed > 0 || attachmentSummary.rejected > 0) {
        await this.sendReply(
          botInstanceId,
          messageId,
          chatId,
          buildP2PAttachmentFailureNotice(attachmentSummary),
        );
      }
      await Promise.all([
        this.runBestEffort(
          () => this.dependencies.configs.recordActivity({
            botInstanceId,
            outboundAt: this.getNow(),
          }),
          `Failed to record Feishu outbound activity for Bot ${botInstanceId}.`,
        ),
        this.runBestEffort(
          () => this.dependencies.events.markSucceeded(eventId),
          `Failed to mark Feishu event ${eventId} as succeeded.`,
        ),
      ]);
      if (this.dependencies.onUserActive) {
        await this.runBestEffort(
          () => this.dependencies.onUserActive!(botInstanceId),
          `Failed to resume deferred messages for Bot ${botInstanceId}.`,
        );
      }
    } catch (error) {
      const message = formatError(error);
      console.error(`Failed to deliver Feishu message ${eventId} for Bot ${botInstanceId}.`);
      console.error(error);
      await Promise.all([
        this.runBestEffort(
          () => this.dependencies.events.markFailed(eventId, message),
          `Failed to mark Feishu event ${eventId} as failed.`,
        ),
        this.runBestEffort(
          () => this.sendReply(
            botInstanceId,
            messageId,
            chatId,
            resolveExternalTurnFailureReply(
              error,
              renderAdminMessageCopy(copy.wecomFailure, {
                assistantName: copy.assistantName,
              }),
            ),
          ),
          `Failed to send the Feishu failure notice for Bot ${botInstanceId}.`,
        ),
      ]);
    }
  }

  private async handleGroupEvent(
    botInstanceId: string,
    eventId: string,
    messageId: string,
    chatId: string,
    senderOpenId: string,
    messageType: string | null,
    content: string | null,
    now: Date,
  ): Promise<void> {
    if (!await this.isGroupMention(botInstanceId, content)) return;

    const claim = await this.dependencies.events.tryAccept({
      botInstanceId,
      chatId,
      eventId,
      messageId,
      receivedAt: now,
      senderOpenId,
      staleBefore: new Date(now.getTime() - EVENT_STALE_MS),
    });
    if (claim !== 'claimed') return;

    await this.runBestEffort(
      () => this.dependencies.configs.recordActivity({ botInstanceId, inboundAt: now }),
      `Failed to record Feishu group inbound activity for Bot ${botInstanceId}.`,
    );

    try {
      const text = await this.prepareInboundTurnText({
        botInstanceId,
        content,
        messageId,
        messageType,
      });
      const existing = await this.dependencies.groupSessions.find(botInstanceId, chatId);
      const result = existing
        ? await this.runDetailed(botInstanceId, messageId, text, {
          denyTools: [...FEISHU_DENIED_IM_TOOLS],
          sessionKey: `feishu-group:${chatId}`,
          sessionId: existing.sessionId,
          systemPrompt: buildGroupPersona(chatId),
          timeoutMs: FEISHU_EXTERNAL_TURN_TIMEOUT_MS,
        })
        : await this.runDetailed(botInstanceId, messageId, text, {
          denyTools: [...FEISHU_DENIED_IM_TOOLS],
          sessionKey: `feishu-group:${chatId}`,
          sessionId: undefined,
          systemPrompt: buildGroupPersona(chatId),
          timeoutMs: FEISHU_EXTERNAL_TURN_TIMEOUT_MS,
        });
      if (!existing && result.sessionId) {
        await this.dependencies.groupSessions.upsert(botInstanceId, chatId, result.sessionId, now);
      }
      const attachments = extractGroupAttachments(result.text);
      await this.sendReply(botInstanceId, messageId, chatId, stripGroupAttachments(result.text));
      const attachmentSummary = await this.sendGroupAttachments(
        botInstanceId,
        chatId,
        attachments,
        {
          deduplicate: true,
          idempotencyScope: `group:${messageId}`,
        },
      );
      if (attachmentSummary.failed > 0 || attachmentSummary.rejected > 0) {
        await this.sendReply(
          botInstanceId,
          messageId,
          chatId,
          buildGroupAttachmentFailureNotice(attachmentSummary),
        );
      }
      await Promise.all([
        this.runBestEffort(
          () => this.dependencies.configs.recordActivity({
            botInstanceId,
            outboundAt: this.getNow(),
          }),
          `Failed to record Feishu group outbound activity for Bot ${botInstanceId}.`,
        ),
        this.runBestEffort(
          () => this.dependencies.events.markSucceeded(eventId),
          `Failed to mark Feishu group event ${eventId} as succeeded.`,
        ),
      ]);
      if (this.dependencies.onUserActive) {
        await this.runBestEffort(
          () => this.dependencies.onUserActive!(botInstanceId),
          `Failed to resume deferred messages for Bot ${botInstanceId}.`,
        );
      }
    } catch (error) {
      const message = formatError(error);
      console.error(`Failed to deliver Feishu message ${eventId} for Bot ${botInstanceId}.`);
      console.error(error);
      await Promise.all([
        this.runBestEffort(
          () => this.dependencies.events.markFailed(eventId, message),
          `Failed to mark Feishu group event ${eventId} as failed.`,
        ),
        this.runBestEffort(
          () => this.sendReply(
            botInstanceId,
            messageId,
            chatId,
            resolveExternalTurnFailureReply(error, '群聊处理失败，请稍后重试。'),
          ),
          `Failed to send the Feishu group failure notice for Bot ${botInstanceId}.`,
        ),
      ]);
    }
  }

  private async isGroupMention(
    botInstanceId: string,
    content: string | null,
  ): Promise<boolean> {
    if (!content) return false;
    const appName = await this.resolveBotAppName(botInstanceId);
    return appName ? containsExactRenderedMention(content, appName) : false;
  }

  private async resolveBotAppName(botInstanceId: string): Promise<string | null> {
    const cached = this.appNames.get(botInstanceId);
    if (cached !== undefined) return cached;
    const appName = await this.fetchBotAppName(botInstanceId);
    this.appNames.set(botInstanceId, appName);
    return appName;
  }

  private async fetchBotAppName(botInstanceId: string): Promise<string | null> {
    const resolve = this.dependencies.resolveBotAppName;
    if (resolve) return resolve(botInstanceId);
    try {
      const output = await this.runLarkCapture({
        args: ['api', 'GET', '/open-apis/bot/v3/info', '--as', 'bot'],
        config: this.dependencies.config,
        homeDir: this.resolveLarkHomeDir(botInstanceId),
        timeoutMs: SEND_TIMEOUT_MS,
      });
      const parsed = JSON.parse(output) as {
        app?: { app_name?: unknown; appName?: unknown };
      };
      const name = parsed.app?.app_name ?? parsed.app?.appName;
      return typeof name === 'string' && name.trim() ? name.trim() : null;
    } catch {
      return null;
    }
  }

  private async prepareInboundTurnText(input: {
    botInstanceId: string;
    content: string | null;
    messageId: string;
    messageType: string | null;
  }): Promise<string> {
    if (!isInboundResourceMessageType(input.messageType)) {
      const text = input.content?.trim();
      if (!text) throw new Error('Feishu inbound message content is empty.');
      return text;
    }

    const resource = parseInboundResource(input.messageType, input.content);
    const downloaded = await this.downloadInboundResource(
      input.botInstanceId,
      input.messageId,
      resource,
    );
    return buildInboundResourcePrompt(downloaded);
  }

  private async downloadInboundResource(
    botInstanceId: string,
    messageId: string,
    resource: FeishuInboundResource,
  ): Promise<DownloadedFeishuResource> {
    if (!isSafeLarkIdentifier(messageId, 'om_')) {
      throw new FeishuInboundResourceError(
        `Invalid Feishu message ID: ${messageId}`,
        '飞书附件信息无效，未保存。请重新发送该附件。',
      );
    }

    const workspaceDir = this.resolveWorkspaceDir(botInstanceId);
    let stagingDir: string | null = null;
    try {
      await assertSafeDirectory(workspaceDir);
      const inboxDir = await ensureSafeChildDirectory(workspaceDir, FEISHU_INBOX_DIRECTORY);
      const messageDir = await ensureSafeChildDirectory(inboxDir, messageId);
      stagingDir = await mkdtemp(path.join(messageDir, '.download-'));
      await assertSafeDirectory(stagingDir);
      assertPathWithin(await realpath(messageDir), await realpath(stagingDir));

      const requestedName = resource.type === 'file'
        ? resource.originalFileName
        : 'image';
      await this.runLarkCapture({
        args: [
          'im', '+messages-resources-download',
          '--message-id', messageId,
          '--file-key', resource.fileKey,
          '--type', resource.type,
          '--output', `./${requestedName}`,
          '--as', 'bot',
        ],
        config: this.dependencies.config,
        cwd: stagingDir,
        homeDir: this.resolveLarkHomeDir(botInstanceId),
        timeoutMs: INBOUND_RESOURCE_DOWNLOAD_TIMEOUT_MS,
      });

      const entries = await readdir(stagingDir, { withFileTypes: true });
      const candidates = entries.filter((entry) => (
        entry.isFile() && isExpectedDownloadedName(entry.name, requestedName)
      ));
      if (candidates.length !== 1 || entries.length !== 1) {
        throw new FeishuInboundResourceError(
          `Expected one regular downloaded resource, found ${entries.length}.`,
          '飞书附件下载结果异常，未保存。请重新发送该附件。',
        );
      }

      const stagedPath = path.join(stagingDir, candidates[0].name);
      const stagedStat = await lstat(stagedPath);
      if (!stagedStat.isFile() || stagedStat.isSymbolicLink()) {
        throw new FeishuInboundResourceError(
          'Downloaded Feishu resource is not a regular file.',
          '飞书附件下载结果不安全，未保存。请重新发送该附件。',
        );
      }
      if (stagedStat.size > MAX_INBOUND_RESOURCE_BYTES) {
        throw new FeishuInboundResourceError(
          `Feishu resource exceeds ${MAX_INBOUND_RESOURCE_BYTES} bytes.`,
          '飞书附件超过 50 MB 限制，未交给助理处理。请压缩或改用较小文件。',
        );
      }

      const finalName = resource.type === 'file' && path.extname(requestedName)
        ? requestedName
        : sanitizeInboundFileName(candidates[0].name, `${resource.type}.bin`);
      const finalPath = path.join(messageDir, finalName);
      assertPathWithin(messageDir, finalPath);
      const existing = await tryLstat(finalPath);
      if (existing) {
        if (!existing.isFile() || existing.isSymbolicLink()) {
          throw new FeishuInboundResourceError(
            'Existing Feishu inbox target is not a regular file.',
            '飞书附件保存路径不安全，未覆盖现有内容。请联系管理员检查 Bot 工作区。',
          );
        }
        await rm(finalPath, { force: true });
      }
      await rename(stagedPath, finalPath);

      const finalStat = await lstat(finalPath);
      if (!finalStat.isFile() || finalStat.isSymbolicLink()) {
        throw new FeishuInboundResourceError(
          'Final Feishu inbox target is not a regular file.',
          '飞书附件保存路径不安全，未交给助理处理。请联系管理员检查 Bot 工作区。',
        );
      }
      const canonicalWorkspace = await realpath(workspaceDir);
      const canonicalFile = await realpath(finalPath);
      assertPathWithin(canonicalWorkspace, canonicalFile);
      const relativePath = toPosixPath(path.relative(canonicalWorkspace, canonicalFile));
      return {
        ...resource,
        originalFileName: resource.type === 'image' ? finalName : resource.originalFileName,
        relativePath,
      };
    } catch (error) {
      if (error instanceof FeishuInboundResourceError) throw error;
      throw new FeishuInboundResourceError(
        `Feishu resource download failed: ${formatError(error)}`,
        '飞书附件下载失败，暂时无法处理。请确认应用已开通 im:message:readonly 权限且 Bot 仍可访问该消息后重试。',
      );
    } finally {
      if (stagingDir) {
        await rm(stagingDir, { force: true, recursive: true }).catch(() => undefined);
      }
    }
  }

  private runDetailed(
    botInstanceId: string,
    requestId: string,
    text: string,
    options: {
      denyTools?: string[];
      sessionId?: string;
      sessionKey?: string;
      systemPrompt?: string;
      timeoutMs?: number;
    },
  ): Promise<{ sessionId?: string; text: string }> {
    if (this.dependencies.processManager.runExternalTurnDetailed) {
      return this.dependencies.processManager.runExternalTurnDetailed(
        botInstanceId,
        requestId,
        text,
        options,
      );
    }
    return this.dependencies.processManager.runExternalTurn(botInstanceId, requestId, text)
      .then((reply) => ({ text: reply }));
  }

  private runLarkCapture(input: RunLarkCliOnceInput): Promise<string> {
    return this.dependencies.runLarkCapture?.(input) ?? runLarkCliCapture(input);
  }

  private startP2PProgressUpdates(
    botInstanceId: string,
    messageId: string,
    chatId: string,
  ): () => void {
    let active = true;
    const timers = P2P_PROGRESS_UPDATES.map((update, index) => {
      const timer = setTimeout(() => {
        if (!active) return;
        void this.runBestEffort(
          () => active
            ? this.sendReply(
              botInstanceId,
              messageId,
              chatId,
              update.text,
              buildP2PProgressIdempotencyKey(messageId, index),
            )
            : Promise.resolve(),
          `Failed to send Feishu progress update ${index + 1} for Bot ${botInstanceId}.`,
        );
      }, update.delayMs);
      timer.unref();
      return timer;
    });

    return () => {
      active = false;
      for (const timer of timers) clearTimeout(timer);
    };
  }

  private async sendReply(
    botInstanceId: string,
    messageId: string,
    chatId: string,
    text: string,
    idempotencyKey?: string,
  ): Promise<void> {
    const homeDir = this.resolveLarkHomeDir(botInstanceId);
    const chunks = splitUtf8(text, MAX_STREAM_BYTES);
    if (chunks.length === 0) return;

    const firstArgs = [
      'im', '+messages-reply',
      '--message-id', messageId,
      '--text', chunks[0],
      '--as', 'bot',
    ];
    if (idempotencyKey) firstArgs.push('--idempotency-key', idempotencyKey);
    await this.runLarkOnce({
      args: firstArgs,
      config: this.dependencies.config,
      homeDir,
      timeoutMs: SEND_TIMEOUT_MS,
    });

    for (const [index, chunk] of chunks.slice(1).entries()) {
      const args = [
        'im', '+messages-send',
        '--chat-id', chatId,
        '--text', chunk,
        '--as', 'bot',
      ];
      if (idempotencyKey) {
        args.push(
          '--idempotency-key',
          buildLarkIdempotencyKey(idempotencyKey, 'part', String(index + 2)),
        );
      }
      await this.runLarkOnce({
        args,
        config: this.dependencies.config,
        homeDir,
        timeoutMs: SEND_TIMEOUT_MS,
      });
    }
  }

  private async sendGroupAttachments(
    botInstanceId: string,
    chatId: string,
    attachments: string[],
    options: AttachmentSendOptions = {},
  ): Promise<GroupAttachmentSendSummary> {
    const workspaceDir = this.resolveWorkspaceDir(botInstanceId);
    const homeDir = this.resolveLarkHomeDir(botInstanceId);
    const summary: GroupAttachmentSendSummary = {
      deduplicated: 0,
      failed: 0,
      rejected: 0,
      sent: 0,
    };

    for (const relativePath of attachments) {
      let resolved: ResolvedGroupAttachment;
      try {
        resolved = await resolveWorkspaceAttachmentPath(
          workspaceDir,
          botInstanceId,
          relativePath,
        );
      } catch (error) {
        if (
          error instanceof FeishuGroupAttachmentPathError
          && error.category === 'failed'
        ) {
          summary.failed += 1;
        } else {
          summary.rejected += 1;
        }
        console.error(
          `Rejected Feishu group attachment marker for Bot ${botInstanceId}: ${formatError(error)}`,
        );
        continue;
      }
      const { absolutePath, fileStat } = resolved;
      const dedupeKey = `${chatId}\u0000${absolutePath}:${fileStat.mtimeMs}`;
      const lastSentAt = this.sentGroupAttachments.get(dedupeKey) ?? 0;
      const now = this.getNow().getTime();
      if (options.deduplicate !== false && now - lastSentAt < GROUP_ATTACHMENT_DEDUPE_MS) {
        summary.deduplicated += 1;
        continue;
      }
      const extension = path.extname(absolutePath).toLowerCase();
      const flag = IMAGE_EXTENSIONS.has(extension) ? '--image' : '--file';
      try {
        const args = [
          'im', '+messages-send',
          '--chat-id', chatId,
          flag, `./${path.basename(absolutePath)}`,
          '--as', 'bot',
        ];
        if (options.idempotencyScope) {
          args.push(
            '--idempotency-key',
            buildLarkIdempotencyKey(
              options.idempotencyScope,
              absolutePath,
              String(fileStat.mtimeMs),
            ),
          );
        }
        await this.runLarkOnce({
          args,
          config: this.dependencies.config,
          cwd: path.dirname(absolutePath),
          homeDir,
          timeoutMs: SEND_TIMEOUT_MS,
        });
        if (options.deduplicate !== false) {
          this.sentGroupAttachments.set(dedupeKey, now);
          this.pruneSentGroupAttachments(now);
        }
        summary.sent += 1;
        console.info(`Sent Feishu group attachment for Bot ${botInstanceId}: ${absolutePath}`);
      } catch (error) {
        summary.failed += 1;
        console.error(`Failed to send Feishu group attachment for Bot ${botInstanceId}.`);
        console.error(error);
      }
    }

    return summary;
  }

  private pruneSentGroupAttachments(now: number): void {
    for (const [key, sentAt] of this.sentGroupAttachments) {
      if (now - sentAt >= GROUP_ATTACHMENT_DEDUPE_MS) {
        this.sentGroupAttachments.delete(key);
      }
    }
  }

  private async stopSession(botInstanceId: string): Promise<void> {
    this.clearEventQueuesForBot(botInstanceId);
    const session = this.sessions.get(botInstanceId);
    if (!session) return;
    this.sessions.delete(botInstanceId);

    const child = session.child;
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([
      once(child, 'exit'),
      new Promise((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS)),
    ]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }

  private clearEventQueuesForBot(botInstanceId: string): void {
    const prefix = `${botInstanceId}\u0000`;
    for (const key of this.eventQueues.keys()) {
      if (key.startsWith(prefix)) {
        this.eventQueues.delete(key);
      }
    }
  }

  private resolveWorkspaceDir(botInstanceId: string): string {
    return resolveBotInstancePaths(this.dependencies.config.instancesRoot, botInstanceId).workspaceDir;
  }

  private resolveLarkHomeDir(botInstanceId: string): string {
    return path.join(this.dependencies.config.larkConfigRoot, botInstanceId);
  }

  private async migrateWorkspaceLarkConfig(
    botInstanceId: string,
    workspaceDir: string,
    appId: string,
  ): Promise<void> {
    const larkHome = this.resolveLarkHomeDir(botInstanceId);
    const destinationConfigFile = path.join(larkHome, '.lark-cli', 'config.json');
    try {
      const existing = JSON.parse(await readFile(destinationConfigFile, 'utf8')) as {
        apps?: Array<{ appId?: unknown }>;
      };
      if (existing.apps?.[0]?.appId === appId) return;
    } catch {
      // Missing destination config; copy from the workspace below.
    }

    const sourceConfigFile = path.join(workspaceDir, '.lark-cli', 'config.json');
    let sourceConfig: { apps?: Array<{ appId?: unknown }> } | null = null;
    try {
      sourceConfig = JSON.parse(await readFile(sourceConfigFile, 'utf8'));
    } catch {
      sourceConfig = null;
    }
    if (!sourceConfig?.apps?.[0]?.appId || sourceConfig.apps[0].appId !== appId) return;

    await mkdir(path.join(larkHome, '.lark-cli'), { recursive: true });
    await writeFile(destinationConfigFile, await readFile(sourceConfigFile, 'utf8'), 'utf8');
    await chmod(destinationConfigFile, 0o600);

    const sourceKeychainDir = path.join(workspaceDir, '.local', 'share', 'lark-cli');
    const destinationKeychainDir = path.join(larkHome, '.local', 'share', 'lark-cli');
    let keychainFiles: string[] = [];
    try {
      keychainFiles = await readdir(sourceKeychainDir);
    } catch {
      keychainFiles = [];
    }
    if (keychainFiles.length > 0) {
      await mkdir(destinationKeychainDir, { recursive: true });
      for (const name of keychainFiles) {
        const sourceFile = path.join(sourceKeychainDir, name);
        const destinationFile = path.join(destinationKeychainDir, name);
        await writeFile(destinationFile, await readFile(sourceFile), 'utf8');
        await chmod(destinationFile, 0o600);
      }
    }
  }

  private async ensureLarkConfig(
    homeDir: string,
    config: BotFeishuConfigRecord,
  ): Promise<void> {
    const configDirectory = path.join(homeDir, '.lark-cli');
    const configFile = path.join(configDirectory, 'config.json');
    try {
      const existing = JSON.parse(await readFile(configFile, 'utf8')) as {
        apps?: Array<{ appId?: unknown }>;
      };
      if (existing.apps?.[0]?.appId === config.appId) return;
    } catch {
      // Missing or malformed config; rewrite below.
    }

    if (!config.appSecret) return;

    await mkdir(configDirectory, { recursive: true });
    await writeFile(
      configFile,
      `${JSON.stringify({
        apps: [{
          appId: config.appId,
          appSecret: config.appSecret,
          brand: 'feishu',
          lang: 'zh',
          users: [],
        }],
      }, null, 2)}\n`,
      'utf8',
    );
    await chmod(configFile, 0o600);
  }

  private async removeLarkConfig(homeDir: string): Promise<void> {
    await rm(path.join(homeDir, '.lark-cli', 'config.json'), { force: true });
  }

  private spawnLark(input: SpawnLarkCliInput): ChildProcess {
    return this.dependencies.spawnLark?.(input) ?? spawnLarkCli(input);
  }

  private runLarkOnce(input: RunLarkCliOnceInput): Promise<void> {
    return this.dependencies.runLarkOnce?.(input) ?? runLarkCliOnce(input);
  }

  private observeStatusUpdate(update: Promise<unknown>): void {
    void update.catch((error: unknown) => {
      console.error('Failed to persist Feishu connection status.');
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
}

function parseFeishuEvent(line: string): FeishuInboundEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as FeishuInboundEvent;
  } catch {
    return null;
  }
}

async function extractP2PAttachments(
  text: string,
  workspaceDir: string,
  botInstanceId: string,
): Promise<string[]> {
  const explicitAttachments = text
    .split('\n')
    .map((line) => line.trim().match(P2P_FILE_MARKER_PATTERN)?.[1]?.trim() ?? '')
    .filter((value) => value.length > 0);
  if (explicitAttachments.length > 0) {
    return dedupeAttachmentPaths(explicitAttachments);
  }

  const implicitImageAttachments = extractMarkdownInlineImagePaths(text);
  const validImplicitAttachments: string[] = [];
  for (const candidate of implicitImageAttachments) {
    try {
      await resolveWorkspaceAttachmentPath(workspaceDir, botInstanceId, candidate);
      validImplicitAttachments.push(candidate);
    } catch {
      // Inline paths are only a best-effort fallback. Ignore stale or unsafe
      // explanatory paths without turning them into attachment failures.
    }
  }
  return dedupeAttachmentPaths(validImplicitAttachments);
}

function dedupeAttachmentPaths(attachments: string[]): string[] {
  const seen = new Set<string>();
  return attachments.filter((value) => {
    const key = value.replace(/\\/gu, '/').replace(/^(?:\.\/)+/u, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractMarkdownInlineImagePaths(text: string): string[] {
  const paths: string[] = [];
  const inlineCodePattern = /(?<!`)(`+)([^`\r\n]+?)\1(?!`)/gu;

  for (const match of text.matchAll(inlineCodePattern)) {
    const candidate = match[2]?.trim() ?? '';
    const normalized = candidate.replace(/\\/gu, '/');
    if (
      !normalized
      || normalized.startsWith('/')
      || /^[A-Za-z][A-Za-z\d+.-]*:/u.test(normalized)
      || !IMAGE_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase())
    ) {
      continue;
    }
    paths.push(candidate);
  }

  return paths;
}

function stripP2PAttachments(text: string): string {
  return text
    .split('\n')
    .filter((line) => !P2P_FILE_MARKER_PATTERN.test(line.trim()))
    .join('\n')
    .trim();
}

function extractGroupAttachments(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim().match(GROUP_FILE_MARKER_PATTERN)?.[1]?.trim() ?? '')
    .filter((value) => value.length > 0);
}

function stripGroupAttachments(text: string): string {
  return text
    .split('\n')
    .filter((line) => !GROUP_FILE_MARKER_PATTERN.test(line.trim()))
    .join('\n')
    .trim();
}

async function resolveWorkspaceAttachmentPath(
  workspaceDir: string,
  botInstanceId: string,
  value: string,
): Promise<ResolvedGroupAttachment> {
  const normalized = value.trim().replace(/\\/gu, '/');
  const workspacePrefix = `/app/storage/instances/${botInstanceId}/workspace/`;
  let workspaceRelativePath: string;
  if (normalized.startsWith(workspacePrefix)) {
    workspaceRelativePath = normalized.slice(workspacePrefix.length);
  } else if (normalized.startsWith('/workspace/')) {
    workspaceRelativePath = normalized.slice('/workspace/'.length);
  } else {
    if (/^[A-Za-z]:/u.test(normalized) || normalized.startsWith('/')) {
      throw new FeishuGroupAttachmentPathError('Absolute attachment paths are not allowed.');
    }
    workspaceRelativePath = normalized;
  }

  if (!workspaceRelativePath) {
    throw new FeishuGroupAttachmentPathError('Attachment path cannot be empty.');
  }

  try {
    const workspaceStat = await lstat(workspaceDir);
    if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink()) {
      throw new FeishuGroupAttachmentPathError('Bot workspace is not a safe directory.');
    }
    const canonicalWorkspace = await realpath(workspaceDir);
    const candidatePath = path.resolve(workspaceDir, ...workspaceRelativePath.split('/'));
    if (!isContainedPath(workspaceDir, candidatePath)) {
      throw new FeishuGroupAttachmentPathError('Attachment path escapes the Bot workspace.');
    }

    const fileStat = await lstat(candidatePath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new FeishuGroupAttachmentPathError('Attachment target must be a regular non-symlink file.');
    }
    const canonicalCandidate = await realpath(candidatePath);
    if (!isContainedPath(canonicalWorkspace, canonicalCandidate)) {
      throw new FeishuGroupAttachmentPathError(
        'Attachment real path escapes the canonical Bot workspace.',
      );
    }
    return { absolutePath: canonicalCandidate, fileStat };
  } catch (error) {
    if (error instanceof FeishuGroupAttachmentPathError) throw error;
    throw new FeishuGroupAttachmentPathError(
      `Attachment path validation failed: ${formatError(error)}`,
      'failed',
    );
  }
}

function buildGroupPersona(chatId: string): string {
  return `${GROUP_PERSONA}\n\n当前群聊的 chat_id：${chatId}`;
}

function containsExactRenderedMention(content: string, appName: string): boolean {
  const searchable = content.replace(/<(?:audio|file|video)\b[^>]*\/?>/giu, ' ');
  const mention = `@${appName}`;
  let offset = 0;
  while (offset < searchable.length) {
    const index = searchable.indexOf(mention, offset);
    if (index < 0) return false;
    const before = index > 0 ? searchable[index - 1] : null;
    const afterIndex = index + mention.length;
    const after = afterIndex < searchable.length ? searchable[afterIndex] : null;
    if (isMentionBoundary(before) && isMentionBoundary(after)) return true;
    offset = index + mention.length;
  }
  return false;
}

function buildGroupAttachmentFailureNotice(summary: GroupAttachmentSendSummary): string {
  const details: string[] = [];
  if (summary.failed > 0) details.push(`发送失败 ${summary.failed} 个`);
  if (summary.rejected > 0) details.push(`安全拒绝 ${summary.rejected} 个`);
  return `有群文件未发送（${details.join('，')}）。请检查文件后重试。`;
}

function buildP2PAttachmentFailureNotice(summary: GroupAttachmentSendSummary): string {
  const details: string[] = [];
  if (summary.failed > 0) details.push(`发送失败 ${summary.failed} 个`);
  if (summary.rejected > 0) details.push(`安全拒绝 ${summary.rejected} 个`);
  return `有飞书文件未发送（${details.join('，')}）。请检查文件后重试。`;
}

function buildP2PProgressIdempotencyKey(messageId: string, index: number): string {
  return buildLarkIdempotencyKey('p2p-progress', messageId, String(index + 1));
}

function buildLarkIdempotencyKey(...parts: string[]): string {
  const digest = createHash('sha256').update(parts.join('\u0000')).digest('hex');
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join('-');
}

function isMentionBoundary(value: string | null): boolean {
  return value === null || /[\s,，.。!！?？:：;；、()[\]{}<>（）【】]/u.test(value);
}

function isInboundResourceMessageType(value: string | null): value is 'file' | 'image' {
  return value === 'file' || value === 'image';
}

function parseInboundResource(
  messageType: 'file' | 'image',
  content: string | null,
): FeishuInboundResource {
  const normalized = content?.trim() ?? '';
  const rawObject = tryParseJsonObject(normalized);
  if (messageType === 'image') {
    const renderedKey = normalized.match(/\[Image:\s*([A-Za-z0-9_-]+)\s*\]/iu)?.[1];
    const fileKey = renderedKey
      ?? normalizeText(rawObject?.image_key)
      ?? '';
    if (!isSafeLarkIdentifier(fileKey, 'img_')) {
      throw new FeishuInboundResourceError(
        'Feishu image event does not contain a valid image key.',
        '飞书图片信息无效，未保存。请重新发送该图片。',
      );
    }
    return {
      fileKey,
      originalFileName: 'image',
      type: 'image',
    };
  }

  const attributes = parseRenderedTagAttributes(normalized, 'file');
  const fileKey = attributes.get('key')
    ?? normalizeText(rawObject?.file_key)
    ?? '';
  if (!isSafeLarkIdentifier(fileKey, 'file_')) {
    throw new FeishuInboundResourceError(
      'Feishu file event does not contain a valid file key.',
      '飞书文件信息无效，未保存。请重新发送该文件。',
    );
  }
  const originalFileName = sanitizeInboundFileName(
    attributes.get('name') ?? normalizeText(rawObject?.file_name) ?? '',
    fileKey,
  );
  return {
    fileKey,
    originalFileName,
    type: 'file',
  };
}

function parseRenderedTagAttributes(content: string, tagName: string): Map<string, string> {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const tag = content.match(new RegExp(`<${escapedTagName}\\b([^>]*)/?>`, 'iu'));
  const attributes = new Map<string, string>();
  if (!tag) return attributes;
  const pattern = /([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu;
  for (const match of tag[1].matchAll(pattern)) {
    attributes.set(match[1].toLowerCase(), decodeXmlAttribute(match[2] ?? match[3] ?? ''));
  }
  return attributes;
}

function tryParseJsonObject(value: string): Record<string, unknown> | null {
  if (!value.startsWith('{') || !value.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_, code: string) => safeCodePoint(code, 16))
    .replace(/&#([0-9]+);/gu, (_, code: string) => safeCodePoint(code, 10))
    .replace(/&quot;/gu, '"')
    .replace(/&apos;|&#39;/gu, "'")
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&amp;/gu, '&');
}

function safeCodePoint(value: string, radix: number): string {
  const parsed = Number.parseInt(value, radix);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0x10ffff) return '';
  try {
    return String.fromCodePoint(parsed);
  } catch {
    return '';
  }
}

function sanitizeInboundFileName(value: string, fallback: string): string {
  const segments = value
    .normalize('NFKC')
    .replace(/\\/gu, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..');
  let candidate = segments.at(-1) ?? '';
  candidate = candidate
    .replace(/[\u0000-\u001f\u007f]/gu, '_')
    .replace(/[<>:"|?*]/gu, '_')
    .replace(/^[.\s]+|[.\s]+$/gu, '');
  if (!candidate) candidate = fallback;

  const existingExtension = path.extname(candidate);
  const stem = existingExtension ? candidate.slice(0, -existingExtension.length) : candidate;
  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/iu.test(stem)) {
    candidate = `_${candidate}`;
  }
  if (Buffer.byteLength(candidate, 'utf8') <= MAX_INBOUND_FILE_NAME_BYTES) return candidate;

  const rawExtension = path.extname(candidate);
  const extension = Buffer.byteLength(rawExtension, 'utf8') <= 24 ? rawExtension : '';
  const stemValue = extension ? candidate.slice(0, -extension.length) : candidate;
  const stemBudget = Math.max(1, MAX_INBOUND_FILE_NAME_BYTES - Buffer.byteLength(extension, 'utf8'));
  let truncatedStem = '';
  for (const character of stemValue) {
    if (Buffer.byteLength(truncatedStem + character, 'utf8') > stemBudget) break;
    truncatedStem += character;
  }
  return `${truncatedStem || 'file'}${extension}`;
}

function isSafeLarkIdentifier(value: string, prefix: 'file_' | 'img_' | 'om_'): boolean {
  return value.startsWith(prefix)
    && value.length <= 512
    && /^[A-Za-z0-9_-]+$/u.test(value);
}

async function assertSafeDirectory(directoryPath: string): Promise<void> {
  const directoryStat = await lstat(directoryPath);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new FeishuInboundResourceError(
      `Unsafe Feishu inbox directory: ${directoryPath}`,
      '飞书附件保存路径不安全，未保存。请联系管理员检查 Bot 工作区。',
    );
  }
}

async function ensureSafeChildDirectory(parentPath: string, childName: string): Promise<string> {
  if (!childName || path.isAbsolute(childName) || path.basename(childName) !== childName) {
    throw new FeishuInboundResourceError(
      `Unsafe Feishu inbox directory name: ${childName}`,
      '飞书附件保存路径不安全，未保存。请联系管理员检查 Bot 工作区。',
    );
  }
  await assertSafeDirectory(parentPath);
  const childPath = path.join(parentPath, childName);
  try {
    await mkdir(childPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await assertSafeDirectory(childPath);
  const canonicalParent = await realpath(parentPath);
  const canonicalChild = await realpath(childPath);
  assertPathWithin(canonicalParent, canonicalChild);
  return childPath;
}

function isExpectedDownloadedName(value: string, requestedName: string): boolean {
  if (path.extname(requestedName)) return value === requestedName;
  if (value === requestedName) return true;
  if (!value.startsWith(`${requestedName}.`)) return false;
  return /^\.[A-Za-z0-9]{1,10}$/u.test(value.slice(requestedName.length));
}

async function tryLstat(filePath: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function assertPathWithin(parentPath: string, candidatePath: string): void {
  if (!isContainedPath(parentPath, candidatePath)) {
    throw new FeishuInboundResourceError(
      `Feishu inbox path escaped its root: ${candidatePath}`,
      '飞书附件保存路径不安全，未保存。请联系管理员检查 Bot 工作区。',
    );
  }
}

function isContainedPath(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function buildInboundResourcePrompt(resource: DownloadedFeishuResource): string {
  const kind = resource.type === 'image' ? '图片' : '文件';
  return [
    `用户通过飞书发送了一个${kind}。`,
    `原始文件名：${resource.originalFileName}`,
    `工作区相对路径：${resource.relativePath}`,
    '本条消息仅表示收到附件。不要自动安装、解压或执行附件；请先确认收到，等待用户给出明确的后续处理指令。',
  ].join('\n');
}

function resolveInboundFailureReply(error: unknown, fallback: string): string {
  return error instanceof FeishuInboundResourceError ? error.userMessage : fallback;
}

function resolveExternalTurnFailureReply(error: unknown, fallback: string): string {
  if (/FastAgent external turn timed out\.?/iu.test(formatError(error))) {
    return EXTERNAL_TURN_TIMEOUT_REPLY;
  }
  return resolveInboundFailureReply(error, fallback);
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
