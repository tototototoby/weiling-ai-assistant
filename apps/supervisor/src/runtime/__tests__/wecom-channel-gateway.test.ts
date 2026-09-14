import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY,
  type BotWecomBindingRepository,
  type GlobalWecomConfigRecord,
  type GlobalWecomConfigRepository,
  type WecomMessageReceiptRepository,
  type WecomProactiveDeliveryRepository,
} from '@weiling-ai/db';
import {
  splitUtf8,
  WecomChannelGateway,
  WeixinFirstMessageSender,
} from '../wecom-channel-gateway';

describe('WecomChannelGateway', () => {
  it('connects with the durable config and records SDK connection state', async () => {
    const fixture = createFixture();

    await fixture.gateway.runOnce();

    expect(fixture.client.connect).toHaveBeenCalledOnce();
    expect(fixture.configs.recordConnectionStatus).toHaveBeenCalledWith({
      observedRevision: 3,
      status: 'connecting',
    });

    fixture.client.emit('authenticated');
    await vi.waitFor(() => {
      expect(fixture.configs.recordConnectionStatus).toHaveBeenCalledWith({
        connectedAt: expect.any(Date),
        observedRevision: 3,
        status: 'connected',
      });
    });
  });

  it('rebuilds the client after WeCom terminates it because another connection was established', async () => {
    const fixture = createFixture({ clients: [new MockWecomClient(), new MockWecomClient()] });

    await fixture.gateway.runOnce();
    fixture.clients[0].emit('event.disconnected_event');
    await fixture.gateway.runOnce();

    expect(fixture.clientFactory).toHaveBeenCalledTimes(2);
    expect(fixture.clients[0].disconnect).toHaveBeenCalledOnce();
    expect(fixture.clients[1].connect).toHaveBeenCalledOnce();
  });

  it('leaves ordinary disconnected events to the SDK reconnect loop', async () => {
    const fixture = createFixture({ clients: [new MockWecomClient(), new MockWecomClient()] });

    await fixture.gateway.runOnce();
    fixture.clients[0].emit('disconnected', 'network');
    await fixture.gateway.runOnce();

    expect(fixture.clientFactory).toHaveBeenCalledOnce();
    expect(fixture.clients[0].connect).toHaveBeenCalledOnce();
  });

  it('keeps an auth-exhausted client in error until configuration changes', async () => {
    const fixture = createFixture({ clients: [new MockWecomClient(), new MockWecomClient()] });
    const error = Object.assign(new Error('authentication exhausted'), {
      code: 'WS_AUTH_FAILURE_EXHAUSTED',
    });

    await fixture.gateway.runOnce();
    fixture.clients[0].emit('error', error);
    await vi.waitFor(() => {
      expect(fixture.configs.recordConnectionStatus).toHaveBeenCalledWith(expect.objectContaining({
        status: 'error',
      }));
    });
    await fixture.gateway.runOnce();

    expect(fixture.clientFactory).toHaveBeenCalledOnce();
  });

  it('consumes connection status persistence failures from SDK event callbacks', async () => {
    const fixture = createFixture();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await fixture.gateway.runOnce();
      fixture.configs.recordConnectionStatus.mockRejectedValueOnce(new Error('database unavailable'));
      fixture.client.emit('authenticated');

      await vi.waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith('Failed to persist WeCom connection status.');
      });
    } finally {
      consoleError.mockRestore();
    }
  });

  it('acknowledges an inbound message immediately and completes it in the same Bot session', async () => {
    const fixture = createFixture();
    await fixture.gateway.runOnce();

    fixture.client.emit('message', createTextFrame('msg_1', 'wecom_user_1', 'hello'));

    await vi.waitFor(() => {
      expect(fixture.processManager.runExternalTurn).toHaveBeenCalledWith(
        'bot_1',
        'msg_1',
        'hello',
      );
      expect(fixture.receipts.markSucceeded).toHaveBeenCalledWith('msg_1');
    });
    expect(fixture.client.replyStream).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.any(String),
      '微Link已收到，正在处理，完成后把结果发给你。',
      false,
    );
    expect(fixture.client.replyStream).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.any(String),
      'final answer',
      true,
    );
    expect(fixture.bindings.recordInbound).toHaveBeenCalledWith('bot_1');
    expect(fixture.bindings.recordOutbound).toHaveBeenCalledWith('bot_1');
    expect(fixture.receipts.tryAccept).toHaveBeenCalledWith(expect.objectContaining({
      botInstanceId: 'bot_1',
      messageId: 'msg_1',
    }));
    expect(fixture.receipts.tryAccept.mock.calls[0]?.[0]).not.toHaveProperty('employeeId');
    expect(fixture.onUserActive).toHaveBeenCalledWith('bot_1');
  });

  it('uses the latest configured WeCom copy for the processing acknowledgement', async () => {
    const fixture = createFixture();
    fixture.messageCopy.getCopy.mockResolvedValue({
      ...DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY,
      assistantName: '测试助手',
      wecomAck: '{{assistantName}}正在处理，请稍候。',
    });
    await fixture.gateway.runOnce();

    fixture.client.emit('message', createTextFrame('msg_custom_copy', 'wecom_user_1', 'hello'));

    await vi.waitFor(() => {
      expect(fixture.client.replyStream).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        '测试助手正在处理，请稍候。',
        false,
      );
    });
  });

  it('keeps a successful inbound result when the deferred-message wakeup fails', async () => {
    const activityError = new Error('database unavailable');
    const fixture = createFixture({ activityError });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await fixture.gateway.runOnce();
      fixture.client.emit('message', createTextFrame('msg_activity_error', 'wecom_user_1', 'hello'));

      await vi.waitFor(() => {
        expect(fixture.receipts.markSucceeded).toHaveBeenCalledWith('msg_activity_error');
        expect(consoleError).toHaveBeenCalledWith(
          'Failed to resume deferred messages for Bot bot_1.',
        );
        expect(consoleError).toHaveBeenCalledWith(activityError);
      });
      expect(fixture.receipts.markFailed).not.toHaveBeenCalled();
      expect(fixture.client.replyStream).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.any(String),
        'final answer',
        true,
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('finishes duplicate callbacks without running the model twice', async () => {
    const fixture = createFixture({ accepted: 'processing' });
    await fixture.gateway.runOnce();

    fixture.client.emit('message', createTextFrame('msg_duplicate', 'wecom_user_1', 'hello'));

    await vi.waitFor(() => {
      expect(fixture.client.replyStream).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.stringContaining('微Link已收到'),
        true,
      );
    });
    expect(fixture.processManager.runExternalTurn).not.toHaveBeenCalled();
    expect(fixture.bindings.recordInbound).not.toHaveBeenCalled();
  });

  it('acknowledges an already completed callback without running the model again', async () => {
    const fixture = createFixture({ accepted: 'succeeded' });
    await fixture.gateway.runOnce();

    fixture.client.emit('message', createTextFrame('msg_succeeded', 'wecom_user_1', 'hello'));

    await vi.waitFor(() => {
      expect(fixture.client.replyStream).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.stringContaining('微Link已经处理完'),
        true,
      );
    });
    expect(fixture.processManager.runExternalTurn).not.toHaveBeenCalled();
  });

  it('replays a completed onboarding receipt after binding without running the model', async () => {
    const fixture = createFixture({ onboardingReplay: '企业微信已绑定成功。' });
    await fixture.gateway.runOnce();

    fixture.client.emit('message', createTextFrame('msg_binding', 'wecom_user_1', '张三'));

    await vi.waitFor(() => {
      expect(fixture.client.replyStream).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        '企业微信已绑定成功。',
        true,
      );
    });
    expect(fixture.bindings.findActiveByWecomUserId).not.toHaveBeenCalled();
    expect(fixture.receipts.tryAccept).not.toHaveBeenCalled();
    expect(fixture.processManager.runExternalTurn).not.toHaveBeenCalled();
  });

  it('rejects an unbound sender without exposing a Bot', async () => {
    const fixture = createFixture({ binding: null });
    await fixture.gateway.runOnce();

    fixture.client.emit('message', createTextFrame('msg_unbound', 'unknown_user', 'hello'));

    await vi.waitFor(() => {
      expect(fixture.client.replyStream).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.stringContaining('请回复你的姓名或常用称呼'),
        true,
      );
    });
    expect(fixture.receipts.tryAccept).not.toHaveBeenCalled();
    expect(fixture.processManager.runExternalTurn).not.toHaveBeenCalled();
  });

  it('keeps the first prompt and second binding reply out of the model path', async () => {
    const fixture = createFixture({ binding: null });
    fixture.onboarding.handleMessage
      .mockResolvedValueOnce('Please reply with your employee name.')
      .mockResolvedValueOnce('Enterprise WeCom binding completed.');
    await fixture.gateway.runOnce();

    fixture.client.emit('message', createTextFrame('msg_prompt', 'new_user', 'hello'));
    await vi.waitFor(() => {
      expect(fixture.client.replyStream).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        'Please reply with your employee name.',
        true,
      );
    });

    fixture.client.emit('message', createTextFrame('msg_bind', 'new_user', 'Zhang San'));
    await vi.waitFor(() => {
      expect(fixture.client.replyStream).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        'Enterprise WeCom binding completed.',
        true,
      );
    });

    expect(fixture.onboarding.handleMessage).toHaveBeenNthCalledWith(1, {
      messageId: 'msg_prompt',
      text: 'hello',
      wecomUserId: 'new_user',
    });
    expect(fixture.onboarding.handleMessage).toHaveBeenNthCalledWith(2, {
      messageId: 'msg_bind',
      text: 'Zhang San',
      wecomUserId: 'new_user',
    });
    expect(fixture.processManager.runExternalTurn).not.toHaveBeenCalled();
    expect(fixture.receipts.tryAccept).not.toHaveBeenCalled();
  });

  it('routes a disabled employee through onboarding without running the model', async () => {
    const fixture = createFixture({
      binding: {
        ...createBinding(),
        employeeEnabled: false,
      },
    });
    fixture.onboarding.handleMessage.mockResolvedValueOnce('This employee is disabled.');
    await fixture.gateway.runOnce();

    fixture.client.emit(
      'message',
      createTextFrame('msg_disabled_employee', 'wecom_user_1', 'hello'),
    );

    await vi.waitFor(() => {
      expect(fixture.client.replyStream).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        'This employee is disabled.',
        true,
      );
    });
    expect(fixture.onboarding.handleMessage).toHaveBeenCalledWith({
      messageId: 'msg_disabled_employee',
      text: 'hello',
      wecomUserId: 'wecom_user_1',
    });
    expect(fixture.processManager.runExternalTurn).not.toHaveBeenCalled();
    expect(fixture.receipts.tryAccept).not.toHaveBeenCalled();
  });

  it('records failed turns and closes the stream with a useful error', async () => {
    const fixture = createFixture({ turnError: new Error('model unavailable') });
    await fixture.gateway.runOnce();

    fixture.client.emit('message', createTextFrame('msg_failed', 'wecom_user_1', 'hello'));

    await vi.waitFor(() => {
      expect(fixture.receipts.markFailed).toHaveBeenCalledWith('msg_failed', 'model unavailable');
      expect(fixture.bindings.recordError).toHaveBeenCalledWith('bot_1', 'model unavailable');
    });
    expect(fixture.client.replyStream).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.any(String),
      '微Link这次处理没有完成，请稍后重新发送。',
      true,
    );
  });

  it('finishes the reply stream and sends oversized remainder chunks proactively', async () => {
    const fixture = createFixture({ reply: 'x'.repeat(36_001) });
    await fixture.gateway.runOnce();

    fixture.client.emit('message', createTextFrame('msg_long', 'wecom_user_1', 'hello'));

    await vi.waitFor(() => {
      expect(fixture.receipts.markSucceeded).toHaveBeenCalledWith('msg_long');
    });
    expect(fixture.client.replyStream).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.any(String),
      'x'.repeat(18_000),
      true,
    );
    expect(fixture.client.sendMessage).toHaveBeenCalledTimes(2);
    expect(fixture.client.sendMessage).toHaveBeenNthCalledWith(1, 'wecom_user_1', {
      markdown: { content: 'x'.repeat(18_000) },
      msgtype: 'markdown',
    });
    expect(fixture.client.sendMessage).toHaveBeenNthCalledWith(2, 'wecom_user_1', {
      markdown: { content: 'x' },
      msgtype: 'markdown',
    });
  });

  it('returns false and records the binding error when proactive delivery fails', async () => {
    const fixture = createFixture();
    fixture.client.isConnected = true;
    fixture.client.sendMessage.mockRejectedValueOnce(new Error('socket closed'));
    await fixture.gateway.runOnce();

    await expect(fixture.gateway.trySendProactive(
      'bot_1',
      'delivery_failure',
      'semantic_failure',
      'notice',
    )).resolves.toBe(false);
    expect(fixture.bindings.recordError).toHaveBeenCalledWith('bot_1', 'socket closed');
    expect(fixture.proactiveDeliveries.markFailed).toHaveBeenCalledWith(
      'delivery_failure',
      'socket closed',
    );
    expect(fixture.proactiveDeliveries.claim).toHaveBeenCalledWith(expect.objectContaining({
      botInstanceId: 'bot_1',
      deliveryId: 'delivery_failure',
      semanticKey: 'semantic_failure',
    }));
    expect(fixture.proactiveDeliveries.claim.mock.calls[0]?.[0]).not.toHaveProperty('employeeId');
  });

  it('keeps proactive delivery successful when outbound telemetry persistence fails', async () => {
    const fixture = createFixture();
    fixture.bindings.recordOutbound.mockRejectedValueOnce(new Error('database unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await fixture.gateway.runOnce();
      await expect(fixture.gateway.trySendProactive(
        'bot_1',
        'delivery_telemetry',
        'semantic_telemetry',
        'notice',
      )).resolves.toBe(true);
      expect(fixture.bindings.recordError).not.toHaveBeenCalled();
      expect(fixture.proactiveDeliveries.markSent).toHaveBeenCalledWith('delivery_telemetry');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('falls back when a Bot has no preferred WeCom binding', async () => {
    const fixture = createFixture({ preferredBinding: null });

    await fixture.gateway.runOnce();
    await expect(fixture.gateway.trySendProactive(
      'bot_1',
      'delivery_unbound',
      'semantic_unbound',
      'notice',
    )).resolves.toBe(false);
    expect(fixture.bindings.findPreferredByBotInstanceId).toHaveBeenCalledWith('bot_1');
    expect(fixture.client.sendMessage).not.toHaveBeenCalled();
  });

  it('does not send a failure frame when the final reply succeeded but telemetry failed', async () => {
    const fixture = createFixture();
    fixture.bindings.recordOutbound.mockRejectedValueOnce(new Error('database unavailable'));
    fixture.receipts.markSucceeded.mockRejectedValueOnce(new Error('database unavailable'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await fixture.gateway.runOnce();
      fixture.client.emit('message', createTextFrame('msg_telemetry', 'wecom_user_1', 'hello'));

      await vi.waitFor(() => {
        expect(fixture.receipts.markSucceeded).toHaveBeenCalledWith('msg_telemetry');
      });
      expect(fixture.client.replyStream).toHaveBeenCalledTimes(2);
      expect(fixture.client.replyStream).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.any(String),
        'final answer',
        true,
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('does not resend or fall back for a proactive delivery already claimed by another pass', async () => {
    const fixture = createFixture();
    fixture.proactiveDeliveries.claim.mockResolvedValueOnce('processing');

    await fixture.gateway.runOnce();
    await expect(fixture.gateway.trySendProactive(
      'bot_1',
      'delivery_processing',
      'semantic_processing',
      'notice',
    )).rejects.toThrow('already in progress');
    expect(fixture.client.sendMessage).not.toHaveBeenCalled();
  });
});

describe('WeixinFirstMessageSender', () => {
  it('delivers through Weixin first and skips the other channels on success', async () => {
    const weixin = { sendAdminMessage: vi.fn().mockResolvedValue(undefined) };
    const gateway = { trySendProactive: vi.fn() };
    const sender = createWeixinFirstSender(weixin, gateway, {});

    await sender.sendAdminMessage('bot_1', 'delivery_1', 'notice', 'semantic_1');

    expect(weixin.sendAdminMessage).toHaveBeenCalledWith(
      'bot_1',
      'delivery_1',
      'notice',
      'semantic_1',
    );
    expect(gateway.trySendProactive).not.toHaveBeenCalled();
  });

  it('falls back to WeCom with a recovery hint when Weixin fails', async () => {
    const weixin = {
      sendAdminMessage: vi.fn().mockRejectedValue(new Error('Weixin API request failed.')),
    };
    const gateway = {
      trySendProactive: vi.fn().mockResolvedValue(true),
    };
    const sender = createWeixinFirstSender(weixin, gateway, {});

    await sender.sendAdminMessage('bot_1', 'delivery_1', 'notice', 'semantic_1');

    const sentText = gateway.trySendProactive.mock.calls[0][3] as string;
    expect(gateway.trySendProactive).toHaveBeenCalledWith(
      'bot_1',
      'delivery_1',
      'semantic_1',
      expect.any(String),
    );
    expect(sentText).toContain('notice');
    expect(sentText).toContain('请在微信上给“微Link · 微灵 AI 助手”发一条消息恢复互动');
  });

  it('falls back to email when Weixin and WeCom both fail on Monday', async () => {
    const weixin = {
      sendAdminMessage: vi.fn().mockRejectedValue(new Error('Weixin unavailable.')),
    };
    const gateway = { trySendProactive: vi.fn().mockResolvedValue(false) };
    const emailDeliveries = { createBatch: vi.fn().mockResolvedValue(undefined) };
    const employeeDirectory = {
      findClaimedByBotInstanceId: vi.fn().mockResolvedValue({
        claimedByUserId: 'user_1',
        companyEmail: 'employee@example.com',
      }),
    };
    const sender = createWeixinFirstSender(weixin, gateway, {
      emailDeliveries,
      employeeDirectory,
      getNow: () => new Date('2026-08-17T01:00:00.000Z'),
    });

    await sender.sendAdminMessage('bot_1', 'delivery_1', 'notice', 'semantic_1');

    expect(emailDeliveries.createBatch).toHaveBeenCalledWith([expect.objectContaining({
      botInstanceId: 'bot_1',
      recipientEmail: 'employee@example.com',
      source: 'admin',
      subject: '微Link · 微灵 AI 助手通知',
    })]);
  });

  it('does not fall back to email outside Monday', async () => {
    const weixin = {
      sendAdminMessage: vi.fn().mockRejectedValue(new Error('Weixin unavailable.')),
    };
    const gateway = { trySendProactive: vi.fn().mockResolvedValue(false) };
    const emailDeliveries = { createBatch: vi.fn().mockResolvedValue(undefined) };
    const employeeDirectory = {
      findClaimedByBotInstanceId: vi.fn().mockResolvedValue({
        claimedByUserId: 'user_1',
        companyEmail: 'employee@example.com',
      }),
    };
    const sender = createWeixinFirstSender(weixin, gateway, {
      emailDeliveries,
      employeeDirectory,
      getNow: () => new Date('2026-08-18T01:00:00.000Z'),
    });

    await expect(sender.sendAdminMessage(
      'bot_1',
      'delivery_1',
      'notice',
      'semantic_1',
    )).rejects.toThrow('主动消息微信、企业微信与邮箱投递均失败。');
    expect(emailDeliveries.createBatch).not.toHaveBeenCalled();
  });

  it('throws when every delivery channel is unavailable', async () => {
    const weixin = {
      sendAdminMessage: vi.fn().mockRejectedValue(new Error('Weixin unavailable.')),
    };
    const gateway = { trySendProactive: vi.fn().mockResolvedValue(false) };
    const sender = createWeixinFirstSender(weixin, gateway, {});

    await expect(sender.sendAdminMessage(
      'bot_1',
      'delivery_1',
      'notice',
      'semantic_1',
    )).rejects.toThrow('主动消息微信、企业微信与邮箱投递均失败。');
  });
});

function createWeixinFirstSender(
  weixin: { sendAdminMessage: ReturnType<typeof vi.fn> },
  gateway: { trySendProactive: ReturnType<typeof vi.fn> },
  extra: {
    emailDeliveries?: { createBatch: ReturnType<typeof vi.fn> };
    employeeDirectory?: { findClaimedByBotInstanceId: ReturnType<typeof vi.fn> };
    getNow?: () => Date;
  },
) {
  return new WeixinFirstMessageSender(
    weixin as never,
    gateway as never,
    {
      emailDeliveries: extra.emailDeliveries as never,
      employeeDirectory: extra.employeeDirectory as never,
      getNow: extra.getNow,
      messageCopy: {
        getCopy: vi.fn().mockResolvedValue({
          assistantName: '微Link · 微灵 AI 助手',
        }),
      } as never,
    },
  );
}

describe('splitUtf8', () => {
  it('splits on code point boundaries and respects byte limits', () => {
    const chunks = splitUtf8('a你好b世界', 7);

    expect(chunks.join('')).toBe('a你好b世界');
    expect(chunks.every((chunk) => Buffer.byteLength(chunk, 'utf8') <= 7)).toBe(true);
  });
});

function createFixture(input: {
  accepted?: 'claimed' | 'processing' | 'succeeded';
  activityError?: Error;
  binding?: ReturnType<typeof createBinding> | null;
  clients?: MockWecomClient[];
  onboardingReplay?: string | null;
  preferredBinding?: ReturnType<typeof createBinding> | null;
  reply?: string;
  turnError?: Error;
} = {}) {
  const config = createConfig();
  const clients = input.clients ?? [new MockWecomClient()];
  let clientIndex = 0;
  const client = clients[0];
  const clientFactory = vi.fn(() => clients[Math.min(clientIndex++, clients.length - 1)]);
  const configs = {
    ensure: vi.fn().mockResolvedValue(config),
    recordConnectionStatus: vi.fn().mockResolvedValue(config),
  };
  const messageCopy = {
    getCopy: vi.fn().mockResolvedValue(DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY),
  };
  const bindings = {
    findActiveByWecomUserId: vi.fn().mockResolvedValue(
      input.binding === undefined ? createBinding() : input.binding,
    ),
    findPreferredByBotInstanceId: vi.fn().mockResolvedValue(
      input.preferredBinding === undefined ? createBinding() : input.preferredBinding,
    ),
    recordError: vi.fn().mockResolvedValue(undefined),
    recordInbound: vi.fn().mockResolvedValue(undefined),
    recordOutbound: vi.fn().mockResolvedValue(undefined),
  };
  const receipts = {
    markFailed: vi.fn().mockResolvedValue(undefined),
    markSucceeded: vi.fn().mockResolvedValue(undefined),
    tryAccept: vi.fn().mockResolvedValue(input.accepted ?? 'claimed'),
  };
  const proactiveDeliveries = {
    claim: vi.fn().mockResolvedValue('claimed'),
    markFailed: vi.fn().mockResolvedValue(true),
    markSent: vi.fn().mockResolvedValue(true),
  };
  const processManager = {
    runExternalTurn: input.turnError
      ? vi.fn().mockRejectedValue(input.turnError)
      : vi.fn().mockResolvedValue(input.reply ?? 'final answer'),
  };
  const onUserActive = input.activityError
    ? vi.fn().mockRejectedValue(input.activityError)
    : vi.fn().mockResolvedValue(undefined);
  const onboarding = {
    findReceiptResponse: vi.fn().mockResolvedValue(input.onboardingReplay ?? null),
    handleMessage: vi.fn().mockResolvedValue(
      '我是微Link。为了绑定你已有的员工 Bot，请回复你的姓名或常用称呼。',
    ),
  };
  const gateway = new WecomChannelGateway({
    bindings: bindings as unknown as BotWecomBindingRepository,
    clientFactory,
    configs: configs as unknown as GlobalWecomConfigRepository,
    messageCopy,
    onboarding,
    onUserActive,
    processManager,
    proactiveDeliveries: proactiveDeliveries as unknown as WecomProactiveDeliveryRepository,
    receipts: receipts as unknown as WecomMessageReceiptRepository,
  });

  return {
    bindings,
    client,
    clientFactory,
    clients,
    configs,
    gateway,
    messageCopy,
    onboarding,
    onUserActive,
    processManager,
    proactiveDeliveries,
    receipts,
  };
}

function createConfig(): GlobalWecomConfigRecord {
  const now = new Date('2026-07-27T00:00:00.000Z');
  return {
    botId: 'wecom_bot_1',
    connectionStatus: 'disabled',
    createdAt: now,
    enabled: true,
    id: 'global',
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    lastError: null,
    observedRevision: null,
    revision: 3,
    secret: 'secret',
    updatedAt: now,
    updatedByUserId: 'admin_1',
    wsUrl: 'wss://openws.work.weixin.qq.com',
  };
}

function createBinding() {
  const now = new Date('2026-07-27T00:00:00.000Z');
  return {
    botInstanceId: 'bot_1',
    createdAt: now,
    employeeEnabled: null as boolean | null,
    employeeId: null,
    enabled: true,
    lastError: null,
    lastInboundAt: null,
    lastOutboundAt: null,
    legalName: null,
    nickname: null,
    preferredForProactive: true,
    updatedAt: now,
    wecomUserId: 'wecom_user_1',
  };
}

function createTextFrame(messageId: string, userId: string, content: string) {
  return {
    body: {
      aibotid: 'wecom_bot_1',
      chattype: 'single',
      create_time: 1_785_110_400,
      from: { userid: userId },
      msgid: messageId,
      msgtype: 'text',
      text: { content },
    },
    headers: { req_id: `req_${messageId}` },
  };
}

class MockWecomClient {
  isConnected = true;
  readonly connect = vi.fn(() => this);
  readonly disconnect = vi.fn();
  readonly replyStream = vi.fn().mockResolvedValue({ headers: { req_id: 'reply' } });
  readonly sendMessage = vi.fn().mockResolvedValue({ headers: { req_id: 'send' } });
  private readonly listeners = new Map<string, Array<(...args: any[]) => void>>();

  on(event: string, listener: (...args: any[]) => void) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  emit(event: string, ...args: any[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}
