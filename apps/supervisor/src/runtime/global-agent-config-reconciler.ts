import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  BotAgentConfigSyncRecord,
  BotAgentConfigOverrideRecord,
  BotAgentConfigOverrideRepository,
  BotAgentConfigSyncRepository,
  GlobalAgentConfigRepository,
  GlobalAgentConfigSnapshot,
} from '@weiling-ai/db';
import { resolveBotInstancePaths } from '@weiling-ai/shared';
import {
  loadManagedSkillManifest,
  readManagedSkillsMetadata,
  resolveManagedSkillsPaths,
  resolveManagedSkillsBundleRoot,
  syncManagedSkills,
  type ManagedSkillsOperationResult,
} from '@weiling-ai/shared/managed-skills';

const GLOBAL_AGENT_RESOURCE_PATH = path.join('resources', 'agent', 'global');
const MAX_GLOBAL_DOCUMENT_BYTES = 2 * 1024 * 1024;

type GlobalConfigRepository = Pick<GlobalAgentConfigRepository, 'ensure' | 'getSnapshot'>;
type OverrideRepository = Pick<BotAgentConfigOverrideRepository, 'findByBotId'>;
type SyncStateRepository = Pick<
  BotAgentConfigSyncRepository,
  'ensureForAllBots' | 'markSyncFailed' | 'markSyncSucceeded'
>;

type SyncManagedSkills = (input: {
  botInstanceId: string;
  bundleRoot: string;
  enabledSkillNames?: readonly string[];
  instancesRoot: string;
  operation: { type: 'sync-all-managed' };
}) => Promise<ManagedSkillsOperationResult>;

export interface GlobalAgentConfigReconcilerDependencies {
  configRepository: GlobalConfigRepository;
  instancesRoot: string;
  logError?: (error: unknown) => void;
  overrideRepository: OverrideRepository;
  syncManagedSkills?: SyncManagedSkills;
  syncStateRepository: SyncStateRepository;
  workspaceRoot: string;
}

export class GlobalAgentConfigReconciler {
  private isRunning = false;
  private readonly configRepository: GlobalConfigRepository;
  private readonly instancesRoot: string;
  private readonly logError: (error: unknown) => void;
  private readonly overrideRepository: OverrideRepository;
  private readonly syncManagedSkills: SyncManagedSkills;
  private readonly syncStateRepository: SyncStateRepository;
  private readonly workspaceRoot: string;

  constructor(dependencies: GlobalAgentConfigReconcilerDependencies) {
    this.configRepository = dependencies.configRepository;
    this.instancesRoot = dependencies.instancesRoot;
    this.overrideRepository = dependencies.overrideRepository;
    this.logError = dependencies.logError ?? console.error;
    this.syncManagedSkills = dependencies.syncManagedSkills ?? syncManagedSkills;
    this.syncStateRepository = dependencies.syncStateRepository;
    this.workspaceRoot = dependencies.workspaceRoot;
  }

  async runOnce(now: Date = new Date()): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      const manifest = await loadManagedSkillManifest({
        bundleRoot: resolveManagedSkillsBundleRoot(this.workspaceRoot),
      });
      const snapshot = await this.ensureGlobalSnapshot(now, manifest.skills.map((skill) => skill.name));
      const states = await this.syncStateRepository.ensureForAllBots(now);
      const enabledSkillNames = snapshot.skills
        .filter((skill) => skill.enabled)
        .map((skill) => skill.skillName);

      for (const state of states) {
        const override = await this.overrideRepository.findByBotId(state.botInstanceId);
        const effective = createEffectiveConfig(snapshot, override);
        if (
          isCurrent(state, snapshot.config.revision, override?.revision ?? 0)
          && await this.isBotProjectionCurrent(
            state.botInstanceId,
            effective,
            enabledSkillNames,
            manifest.version,
          )
        ) {
          continue;
        }

        await this.reconcileBot(
          state.botInstanceId,
          effective,
          enabledSkillNames,
          now,
        );
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async ensureGlobalSnapshot(
    now: Date,
    manifestSkillNames: readonly string[],
  ): Promise<GlobalAgentConfigSnapshot> {
    const existing = await this.configRepository.getSnapshot();

    if (existing) {
      return existing;
    }

    const resourceRoot = path.join(this.workspaceRoot, GLOBAL_AGENT_RESOURCE_PATH);
    const [agentsMarkdown, soulMarkdown] = await Promise.all([
      readSeedDocument(path.join(resourceRoot, 'AGENTS.md')),
      readSeedDocument(path.join(resourceRoot, 'SOUL.md')),
    ]);

    return this.configRepository.ensure({
      agentsMarkdown,
      createdAt: now,
      skills: manifestSkillNames.map((skillName) => ({
        enabled: true,
        skillName,
      })),
      soulMarkdown,
    });
  }

  private async isBotProjectionCurrent(
    botInstanceId: string,
    config: EffectiveAgentConfig,
    enabledSkillNames: readonly string[],
    bundleVersion: string,
  ): Promise<boolean> {
    const { workspaceDir } = resolveBotInstancePaths(this.instancesRoot, botInstanceId);
    const [agentsMatch, soulMatch, metadata] = await Promise.all([
      documentMatches(path.join(workspaceDir, 'AGENTS.md'), config.agentsMarkdown),
      documentMatches(path.join(workspaceDir, 'SOUL.md'), config.soulMarkdown),
      readManagedSkillsMetadata(
        resolveManagedSkillsPaths(this.instancesRoot, botInstanceId).metadataPath,
      ),
    ]);

    if (
      !agentsMatch
      || !soulMatch
      || metadata?.bundleVersion !== bundleVersion
      || metadata.lastSyncStatus !== 'success'
      || metadata.lastError !== null
    ) {
      return false;
    }

    const expectedNames = [...new Set(enabledSkillNames)].sort();
    const observedNames = [...new Set([
      ...metadata.managedSkills.map((skill) => skill.name),
      ...metadata.skippedConflicts,
    ])].sort();

    return expectedNames.length === observedNames.length
      && expectedNames.every((skillName, index) => skillName === observedNames[index]);
  }

  private async reconcileBot(
    botInstanceId: string,
    config: EffectiveAgentConfig,
    enabledSkillNames: readonly string[],
    now: Date,
  ): Promise<void> {
    try {
      const { workspaceDir } = resolveBotInstancePaths(this.instancesRoot, botInstanceId);
      await mkdir(workspaceDir, { recursive: true });
      await assertSafeDirectory(workspaceDir);
      await writeDocumentIfChanged(
        path.join(workspaceDir, 'AGENTS.md'),
        config.agentsMarkdown,
      );
      await writeDocumentIfChanged(
        path.join(workspaceDir, 'SOUL.md'),
        config.soulMarkdown,
      );

      const skillResult = await this.syncManagedSkills({
        botInstanceId,
        bundleRoot: resolveManagedSkillsBundleRoot(this.workspaceRoot),
        enabledSkillNames,
        instancesRoot: this.instancesRoot,
        operation: { type: 'sync-all-managed' },
      });

      if (skillResult.status !== 'success') {
        const details = skillResult.errors
          .map((error) => `${error.code}: ${error.message}`)
          .join('; ');
        throw new Error(details || `Managed skills sync returned ${skillResult.status}.`);
      }

      await this.syncStateRepository.markSyncSucceeded(botInstanceId, {
        appliedOverrideRevision: config.overrideRevision,
        appliedRevision: config.globalRevision,
        lastSyncedAt: now,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      try {
        await this.syncStateRepository.markSyncFailed(botInstanceId, {
          error: message,
          lastSyncedAt: now,
        });
      } catch (markError) {
        this.logError(markError);
      }

      this.logError(
        new Error(`Failed to apply global agent config to ${botInstanceId}: ${message}`),
      );
    }
  }
}

interface EffectiveAgentConfig {
  agentsMarkdown: string;
  globalRevision: number;
  overrideRevision: number;
  soulMarkdown: string;
}

function createEffectiveConfig(
  snapshot: GlobalAgentConfigSnapshot,
  override: BotAgentConfigOverrideRecord | null,
): EffectiveAgentConfig {
  return {
    agentsMarkdown: appendOverride(snapshot.config.agentsMarkdown, override?.agentsAppendix),
    globalRevision: snapshot.config.revision,
    overrideRevision: override?.revision ?? 0,
    soulMarkdown: appendOverride(snapshot.config.soulMarkdown, override?.soulAppendix),
  };
}

function appendOverride(base: string, appendix: string | null | undefined): string {
  const trimmed = appendix?.trim();
  return trimmed ? `${base.trimEnd()}\n\n## Bot-specific administrator override\n\n${trimmed}\n` : base;
}

function isCurrent(
  state: BotAgentConfigSyncRecord,
  revision: number,
  overrideRevision: number,
): boolean {
  return state.appliedRevision === revision
    && state.appliedOverrideRevision === overrideRevision
    && state.syncStatus === 'synced'
    && state.lastSyncError === null;
}

async function readSeedDocument(filePath: string): Promise<string> {
  const stats = await lstat(filePath);

  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Global agent seed must be a regular file: ${filePath}`);
  }

  if (stats.size > MAX_GLOBAL_DOCUMENT_BYTES) {
    throw new Error(`Global agent seed exceeds ${MAX_GLOBAL_DOCUMENT_BYTES} bytes: ${filePath}`);
  }

  const content = await readFile(filePath, 'utf8');

  if (!content.trim()) {
    throw new Error(`Global agent seed must not be empty: ${filePath}`);
  }

  return content;
}

async function assertSafeDirectory(directoryPath: string): Promise<void> {
  const stats = await lstat(directoryPath);

  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Bot workspace must be a regular directory: ${directoryPath}`);
  }
}

async function writeDocumentIfChanged(filePath: string, content: string): Promise<void> {
  if (Buffer.byteLength(content, 'utf8') > MAX_GLOBAL_DOCUMENT_BYTES) {
    throw new Error(`Global agent document exceeds ${MAX_GLOBAL_DOCUMENT_BYTES} bytes: ${filePath}`);
  }

  try {
    const stats = await lstat(filePath);

    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`Global agent document target must be a regular file: ${filePath}`);
    }

    if (stats.size <= MAX_GLOBAL_DOCUMENT_BYTES) {
      const existing = await readFile(filePath, 'utf8');

      if (existing === content) {
        return;
      }
    }
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }

  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryPath, content, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function documentMatches(filePath: string, expectedContent: string): Promise<boolean> {
  try {
    const stats = await lstat(filePath);

    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_GLOBAL_DOCUMENT_BYTES) {
      return false;
    }

    return await readFile(filePath, 'utf8') === expectedContent;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
