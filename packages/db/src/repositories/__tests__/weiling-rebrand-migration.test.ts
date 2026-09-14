import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabaseClient, migrateDatabase } from '../../client.js';
import { DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY } from '../../schema/global-admin-message-configs.js';

const tempDirs: string[] = [];
const clients: Array<ReturnType<typeof createDatabaseClient>> = [];

afterEach(async () => {
  clients.splice(0).forEach((client) => client.close());
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

const MIGRATION_PATH = fileURLToPath(
  new URL('../../migrations/0025_weilink_rebrand.sql', import.meta.url),
);
const ATTACHMENT_GUIDANCE_MIGRATION_PATH = fileURLToPath(
  new URL('../../migrations/0026_attachment_guidance.sql', import.meta.url),
);
const BRAND_COPY_MIGRATION_PATH = fileURLToPath(
  new URL('../../migrations/0031_welink_brand_copy.sql', import.meta.url),
);
const AGENTS_SEED_PATH = fileURLToPath(
  new URL('../../../../../resources/agent/global/AGENTS.md', import.meta.url),
);
const SOUL_SEED_PATH = fileURLToPath(
  new URL('../../../../../resources/agent/global/SOUL.md', import.meta.url),
);

describe('weiling brand migration chain', () => {
  it('contains only the new brand and no legacy 高智灵/小龙虾 wording', async () => {
    const sql = await readFile(MIGRATION_PATH, 'utf8');

    expect(sql).toContain('微Link · 微灵 AI 助手');
    expect(sql).toContain('微Link');
    expect(sql).not.toContain('高智灵');
    expect(sql).not.toContain('小龙虾');
  });

  it('updates the global copy, email sender and agent documents to the new brand', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'weiling-weiling-rebrand-'));
    tempDirs.push(dir);
    const client = createDatabaseClient({ url: `file:${join(dir, 'test.sqlite')}` });
    clients.push(client);
    migrateDatabase(client);

    const now = Date.now();
    client.connection.prepare(`DELETE FROM global_admin_message_configs WHERE id = 'global'`).run();
    client.connection.prepare(`DELETE FROM global_email_configs WHERE id = 'global'`).run();
    client.connection.prepare(`DELETE FROM global_agent_configs WHERE id = 'global'`).run();
    client.connection
      .prepare(
        `INSERT INTO global_admin_message_configs (id, defer_failed_until_user_active, assistant_name, meal_consent_prompt, meal_rain_reminder, meal_standard_reminder, morning_briefing_intro, processing_ack, wecom_ack, wecom_duplicate, wecom_completed, wecom_failure, wecom_unsupported, wecom_group_unsupported, wecom_unbound, wecom_binding_name_prompt, wecom_binding_name_invalid, wecom_binding_success, revision, created_at, updated_at) VALUES ('global', 1, '高新高智灵小龙虾', '我是{{assistantName}}。工作日需要我提醒你点外卖吗？', '我是{{assistantName}}。今天可能下雨', '我是{{assistantName}}。该点外卖了', '早上好，我是{{assistantName}}。今天是 {{date}}。', '收到，我是{{assistantName}}，正在处理中~请稍后~', '{{assistantName}}已收到，正在处理', '{{assistantName}}已收到这条消息', '{{assistantName}}已经处理完这条消息', '{{assistantName}}这次处理没有完成', '我是{{assistantName}}。当前企业微信通道支持文字和语音转文字', '我是{{assistantName}}。当前仅支持员工与机器人单聊', '我是{{assistantName}}。你的企业微信账号尚未绑定员工 Bot', '我是{{assistantName}}。为了绑定你已有的员工 Bot', '我是{{assistantName}}。暂时无法确认你的员工身份', '我是{{assistantName}}。企业微信已绑定到你的员工 Bot', 1, ?, ?)`,
      )
      .run(now, now);
    client.connection
      .prepare(
        `INSERT INTO global_email_configs (id, enabled, smtp_host, smtp_port, smtp_security, sender_name, revision, created_at, updated_at) VALUES ('global', 1, 'smtp.exmail.qq.com', 465, 'ssl', '高智灵小龙虾', 1, ?, ?)`,
      )
      .run(now, now);
    client.connection
      .prepare(
        `INSERT INTO global_agent_configs (id, agents_markdown, soul_markdown, revision, created_at, updated_at) VALUES ('global', '旧身份文档', '旧气质文档', 1, ?, ?)`,
      )
      .run(now, now);

    const [rebrandSql, guidanceSql, brandCopySql] = await Promise.all([
      readFile(MIGRATION_PATH, 'utf8'),
      readFile(ATTACHMENT_GUIDANCE_MIGRATION_PATH, 'utf8'),
      readFile(BRAND_COPY_MIGRATION_PATH, 'utf8'),
    ]);
    client.connection.exec(rebrandSql);
    client.connection.exec(guidanceSql);
    client.connection.exec(brandCopySql);

    const copyRow = client.connection
      .prepare(
        `SELECT assistant_name AS assistantName, meal_consent_prompt AS mealConsentPrompt, morning_briefing_intro AS morningBriefingIntro, processing_ack AS processingAck, wecom_ack AS wecomAck, wecom_binding_success AS wecomBindingSuccess, revision FROM global_admin_message_configs WHERE id = 'global'`,
      )
      .get() as { assistantName: string; mealConsentPrompt: string; morningBriefingIntro: string; processingAck: string; wecomAck: string; wecomBindingSuccess: string; revision: number };
    expect(copyRow.assistantName).toBe(DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY.assistantName);
    expect(copyRow.mealConsentPrompt).toBe(DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY.mealConsentPrompt);
    expect(copyRow.morningBriefingIntro).toBe(DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY.morningBriefingIntro);
    expect(copyRow.processingAck).toBe(DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY.processingAck);
    expect(copyRow.wecomAck).toBe(DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY.wecomAck);
    expect(copyRow.wecomBindingSuccess).toBe(DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY.wecomBindingSuccess);
    expect(copyRow.revision).toBe(3);

    const emailRow = client.connection
      .prepare(`SELECT sender_name AS senderName, revision FROM global_email_configs WHERE id = 'global'`)
      .get() as { senderName: string; revision: number };
    expect(emailRow.senderName).toBe('微Link · 微灵 AI 助手');
    expect(emailRow.revision).toBe(2);

    const agentRow = client.connection
      .prepare(
        `SELECT agents_markdown AS agentsMarkdown, soul_markdown AS soulMarkdown, revision FROM global_agent_configs WHERE id = 'global'`,
      )
      .get() as { agentsMarkdown: string; soulMarkdown: string; revision: number };
    const [agentsSeed, soulSeed] = await Promise.all([
      readFile(AGENTS_SEED_PATH, 'utf8'),
      readFile(SOUL_SEED_PATH, 'utf8'),
    ]);
    expect(agentRow.agentsMarkdown.trim()).toBe(agentsSeed.trim());
    expect(agentRow.soulMarkdown.trim()).toBe(soulSeed.trim());
    expect(agentRow.revision).toBe(4);
    expect(agentRow.agentsMarkdown).not.toContain('高智灵');
    expect(agentRow.soulMarkdown).not.toContain('高智灵');
    expect(agentRow.agentsMarkdown).toContain('## 图片、文件与成果物');
  });
});
