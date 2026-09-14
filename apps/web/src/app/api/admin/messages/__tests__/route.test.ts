import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdminRequestSessionMock,
  getRepositoriesMock,
  createAdminMessageBatchMock,
  listAdminMessagesMock,
  updateAdminMessageConfigMock,
} = vi.hoisted(() => ({
  requireAdminRequestSessionMock: vi.fn(),
  getRepositoriesMock: vi.fn(),
  createAdminMessageBatchMock: vi.fn(),
  listAdminMessagesMock: vi.fn(),
  updateAdminMessageConfigMock: vi.fn(),
}));

const ADMIN_MESSAGE_COPY_DEFAULTS = {
  assistantName: '微Link · 微灵 AI 助手',
  mealConsentPrompt: '我是{{assistantName}}。工作日需要我提醒你点外卖吗？需要的话请回复“开启外卖提醒”，不需要请回复“关闭外卖提醒”。',
  mealRainReminder: '我是{{assistantName}}。今天可能下雨，外卖配送可能会比平时慢，记得现在点外卖。',
  mealStandardReminder: '我是{{assistantName}}。该点外卖了，记得安排今天的午餐。',
  morningBriefingIntro: '早上好，我是{{assistantName}}。今天是 {{date}}。',
  processingAck: '收到，我是{{assistantName}}，正在处理，完成后把结果发给你。',
  wecomAck: '{{assistantName}}已收到，正在处理，完成后把结果发给你。',
  wecomDuplicate: '{{assistantName}}已收到这条消息，正在处理中，请稍候。',
  wecomCompleted: '{{assistantName}}已经处理完这条消息，请勿重复发送。',
  wecomFailure: '{{assistantName}}这次处理没有完成，请稍后重新发送。',
  wecomUnbound: '我是{{assistantName}}。你的企业微信账号尚未绑定员工 Bot，请联系管理员完成绑定。',
  wecomUnsupported: '我是{{assistantName}}。当前企业微信通道支持文字和语音转文字，请补充文字说明。',
  wecomGroupUnsupported: '我是{{assistantName}}。当前仅支持员工与机器人单聊。',
  wecomBindingNamePrompt: '我是{{assistantName}}。为了绑定你已有的员工 Bot，请回复你的姓名或常用称呼。',
  wecomBindingNameInvalid: '我是{{assistantName}}。暂时无法确认你的员工身份，请核对姓名或常用称呼后重试，或联系管理员。',
  wecomBindingSuccess: '我是{{assistantName}}。企业微信已绑定到你的员工 Bot，之后会继续使用同一会话、记忆和工具。',
};

vi.mock('@/lib/admin', () => ({
  requireAdminRequestSession: requireAdminRequestSessionMock,
}));

vi.mock('@/lib/repositories', () => ({
  getRepositories: getRepositoriesMock,
}));

vi.mock('@/lib/admin-messages', () => ({
  createAdminMessageBatch: createAdminMessageBatchMock,
  listAdminMessages: listAdminMessagesMock,
  updateAdminMessageConfig: updateAdminMessageConfigMock,
}));

describe('/api/admin/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminRequestSessionMock.mockResolvedValue({
      user: { email: 'admin@example.com', id: 'admin_1' },
    });
    getRepositoriesMock.mockReturnValue({ repository: true });
  });

  it('authenticates and returns the durable queue and failed-message policy', async () => {
    listAdminMessagesMock.mockResolvedValue({
      config: { deferFailedUntilUserActive: true },
      deliveries: [],
      targets: [],
    });
    const { GET } = await import('../route');

    const response = await GET(new Request('http://localhost/api/admin/messages'));

    expect(response.status).toBe(200);
    expect(requireAdminRequestSessionMock).toHaveBeenCalledOnce();
    expect(listAdminMessagesMock).toHaveBeenCalledWith({ repository: true });
  });

  it('authenticates and updates the failed-message policy', async () => {
    updateAdminMessageConfigMock.mockResolvedValue({
      config: { deferFailedUntilUserActive: false, ...ADMIN_MESSAGE_COPY_DEFAULTS },
      deliveries: [],
      targets: [],
    });
    const { PATCH } = await import('../route');
    const payload = { deferFailedUntilUserActive: false, ...ADMIN_MESSAGE_COPY_DEFAULTS };

    const response = await PATCH(new Request('http://localhost/api/admin/messages', {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }));

    expect(response.status).toBe(200);
    expect(requireAdminRequestSessionMock).toHaveBeenCalledOnce();
    expect(updateAdminMessageConfigMock).toHaveBeenCalledWith({
      payload,
      repositories: { repository: true },
      updatedByUserId: 'admin_1',
    });
  });

  it('authenticates and queues an email notification batch', async () => {
    createAdminMessageBatchMock.mockResolvedValue({
      config: { deferFailedUntilUserActive: true },
      deliveries: [],
      emailDeliveries: [{ id: 'email_1' }],
      targets: [],
    });
    const { POST } = await import('../route');
    const payload = {
      botInstanceIds: ['bot_1'],
      channel: 'email',
      message: 'Company notice',
      scope: 'selected',
      subject: 'Important notice',
    };

    const response = await POST(new Request('http://localhost/api/admin/messages', {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }));

    expect(response.status).toBe(200);
    expect(createAdminMessageBatchMock).toHaveBeenCalledWith({
      createdByUserId: 'admin_1',
      payload,
      repositories: { repository: true },
    });
  });

  it('returns a controlled client error for malformed PATCH JSON', async () => {
    const { PATCH } = await import('../route');

    const response = await PATCH(new Request('http://localhost/api/admin/messages', {
      body: '{',
      headers: { 'content-type': 'application/json' },
      method: 'PATCH',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'INVALID_JSON_BODY' },
    });
    expect(updateAdminMessageConfigMock).not.toHaveBeenCalled();
  });
});
