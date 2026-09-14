import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const globalAgentDocument = new URL(
  '../../../../resources/agent/global/AGENTS.md',
  import.meta.url,
);
const difyRoutingDocument = new URL(
  '../../../../resources/skills/managed/weiling-assistant/references/knowledge-routing.md',
  import.meta.url,
);
const managedSkillsManifest = new URL(
  '../../../../resources/skills/managed/manifest.json',
  import.meta.url,
);
const difyMcpServerSource = new URL('../dify-mcp-server.ts', import.meta.url);

describe('knowledge Dify routing contract', () => {
  it('keeps focused knowledge lookups explicit and isolated per user', async () => {
    const [globalAgent, routing] = await Promise.all([
      readFile(globalAgentDocument, 'utf8'),
      readFile(difyRoutingDocument, 'utf8'),
    ]);

    expect(globalAgent).toContain('每位用户的知识会话、检索结果和 `conversation_id` 必须隔离');
    expect(globalAgent).toContain('只调用管理员已经配置且与当前任务匹配的工具');
    expect(routing).toContain('`conversation_id` 只能在“同一用户 + 同一知识应用”内复用');
    expect(routing).toContain('两轮以上仍无结果时，如实说明未找到');
  });

  it('advertises focused knowledge fields in the managed Dify MCP tool', async () => {
    const source = await readFile(difyMcpServerSource, 'utf8');

    expect(source).toContain('focused knowledge lookups');
    expect(source).toContain('department, title, phone, email');
    expect(source).toContain('empty or incomplete local roster must not block');
  });

  it('bumps the managed Skill bundle when routing guidance changes', async () => {
    const manifest = JSON.parse(await readFile(managedSkillsManifest, 'utf8')) as {
      version?: string;
    };

    expect(manifest.version).toBe('0.2.0-beta.1');
  });
});
