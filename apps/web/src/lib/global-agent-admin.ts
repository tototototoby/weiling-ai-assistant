import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  loadManagedSkillManifest,
  resolveManagedSkillsBundleRoot,
  type ManagedSkillManifest,
} from '@weiling-ai/shared/managed-skills';
import { z } from 'zod';
import { ApiError } from './api-error';
import { getWorkspaceRoot } from './env';
import type { WebRepositories } from './repositories';

const documentsSchema = z.object({
  agentsMarkdown: z.string().trim().min(1).max(200_000),
  soulMarkdown: z.string().trim().min(1).max(200_000),
}).strict();

const skillPatchSchema = z.object({ enabled: z.boolean() }).strict();

type GlobalAgentAdminRepositories = Pick<
  WebRepositories,
  'botAgentConfigSyncStates' | 'botInstances' | 'globalAgentConfigs'
>;

export interface AdminGlobalAgentSkill {
  content: string;
  description: string;
  enabled: boolean;
  name: string;
}

export interface AdminGlobalAgentApplication {
  appliedRevision: number;
  botId: string;
  botName: string;
  lastSyncError: string | null;
  lastSyncedAt: string | null;
  syncStatus: string;
}

export interface AdminGlobalAgentPayload {
  applications: AdminGlobalAgentApplication[];
  config: {
    agentsMarkdown: string;
    revision: number;
    soulMarkdown: string;
    updatedAt: string;
  };
  skills: AdminGlobalAgentSkill[];
  summary: {
    botCount: number;
    enabledSkillCount: number;
    errorCount: number;
    pendingCount: number;
    syncedCount: number;
  };
}

interface GlobalAgentBundle {
  agentsMarkdown: string;
  manifest: ManagedSkillManifest;
  skills: Array<{ content: string; description: string; name: string }>;
  soulMarkdown: string;
}

export async function listAdminGlobalAgent(
  repositories: GlobalAgentAdminRepositories,
): Promise<AdminGlobalAgentPayload> {
  const bundle = await loadGlobalAgentBundle();
  const snapshot = await repositories.globalAgentConfigs.ensure({
    agentsMarkdown: bundle.agentsMarkdown,
    skills: bundle.manifest.skills.map((skill) => ({ enabled: true, skillName: skill.name })),
    soulMarkdown: bundle.soulMarkdown,
  });
  const [bots, applications] = await Promise.all([
    repositories.botInstances.listAllForAdministration(),
    repositories.botAgentConfigSyncStates.ensureForAllBots(),
  ]);
  const botNames = new Map(bots.map((bot) => [bot.id, bot.name]));
  const policies = new Map(snapshot.skills.map((skill) => [skill.skillName, skill.enabled]));
  const items = applications.map((application) => ({
    appliedRevision: application.appliedRevision,
    botId: application.botInstanceId,
    botName: botNames.get(application.botInstanceId) ?? application.botInstanceId,
    lastSyncError: application.lastSyncError,
    lastSyncedAt: toIsoString(application.lastSyncedAt),
    syncStatus: application.syncStatus,
  }));
  const skills = bundle.skills.map((skill) => ({
    ...skill,
    enabled: policies.get(skill.name) ?? true,
  }));
  const isSynced = (item: AdminGlobalAgentApplication) => (
    item.syncStatus === 'synced' && item.appliedRevision === snapshot.config.revision
  );

  return {
    applications: items,
    config: {
      agentsMarkdown: snapshot.config.agentsMarkdown,
      revision: snapshot.config.revision,
      soulMarkdown: snapshot.config.soulMarkdown,
      updatedAt: snapshot.config.updatedAt.toISOString(),
    },
    skills,
    summary: {
      botCount: bots.length,
      enabledSkillCount: skills.filter((skill) => skill.enabled).length,
      errorCount: items.filter((item) => item.syncStatus === 'error').length,
      pendingCount: items.filter((item) => item.syncStatus !== 'error' && !isSynced(item)).length,
      syncedCount: items.filter(isSynced).length,
    },
  };
}

export async function updateAdminGlobalAgentDocuments(input: {
  payload: unknown;
  repositories: GlobalAgentAdminRepositories;
}): Promise<AdminGlobalAgentPayload> {
  const parsed = documentsSchema.safeParse(input.payload);

  if (!parsed.success) {
    throw invalidConfigError();
  }

  await ensureGlobalAgentConfig(input.repositories);
  await input.repositories.globalAgentConfigs.updateDocuments(parsed.data);
  return listAdminGlobalAgent(input.repositories);
}

export async function updateAdminGlobalAgentSkill(input: {
  payload: unknown;
  repositories: GlobalAgentAdminRepositories;
  skillName: string;
}): Promise<AdminGlobalAgentPayload> {
  const parsed = skillPatchSchema.safeParse(input.payload);

  if (!parsed.success) {
    throw invalidConfigError();
  }

  const bundle = await ensureGlobalAgentConfig(input.repositories);
  const knownSkills = new Set(bundle.manifest.skills.map((skill) => skill.name));

  if (!knownSkills.has(input.skillName)) {
    throw new ApiError({
      code: 'GLOBAL_AGENT_SKILL_NOT_FOUND',
      message: 'Managed skill not found.',
      status: 404,
    });
  }

  await input.repositories.globalAgentConfigs.setSkillEnabled(input.skillName, parsed.data.enabled);
  return listAdminGlobalAgent(input.repositories);
}

export async function republishAdminGlobalAgent(
  repositories: GlobalAgentAdminRepositories,
): Promise<AdminGlobalAgentPayload> {
  await ensureGlobalAgentConfig(repositories);
  await repositories.botAgentConfigSyncStates.ensureForAllBots();
  await repositories.botAgentConfigSyncStates.markPendingForAll();
  return listAdminGlobalAgent(repositories);
}

async function ensureGlobalAgentConfig(
  repositories: GlobalAgentAdminRepositories,
): Promise<GlobalAgentBundle> {
  const bundle = await loadGlobalAgentBundle();
  await repositories.globalAgentConfigs.ensure({
    agentsMarkdown: bundle.agentsMarkdown,
    skills: bundle.manifest.skills.map((skill) => ({ enabled: true, skillName: skill.name })),
    soulMarkdown: bundle.soulMarkdown,
  });
  return bundle;
}

async function loadGlobalAgentBundle(): Promise<GlobalAgentBundle> {
  const workspaceRoot = getWorkspaceRoot();
  const bundleRoot = resolveManagedSkillsBundleRoot(workspaceRoot);
  const manifest = await loadManagedSkillManifest({ bundleRoot });
  const [agentsMarkdown, soulMarkdown, skills] = await Promise.all([
    readFile(path.join(workspaceRoot, 'resources', 'agent', 'global', 'AGENTS.md'), 'utf8'),
    readFile(path.join(workspaceRoot, 'resources', 'agent', 'global', 'SOUL.md'), 'utf8'),
    Promise.all(manifest.skills.map(async (skill) => {
      const content = await readFile(path.join(bundleRoot, skill.path, 'SKILL.md'), 'utf8');
      return {
        content,
        description: extractSkillDescription(content, skill.name),
        name: skill.name,
      };
    })),
  ]);

  return { agentsMarkdown, manifest, skills, soulMarkdown };
}

function extractSkillDescription(content: string, fallback: string): string {
  const frontmatter = content.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/);
  const description = frontmatter?.[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return description || fallback;
}

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function invalidConfigError(): ApiError {
  return new ApiError({
    code: 'GLOBAL_AGENT_INVALID_CONFIG',
    message: 'Invalid global agent configuration.',
    status: 400,
  });
}
