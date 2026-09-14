import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { resolveBotInstancePaths } from '../bot-instance-paths';
import { loadManagedSkillManifest, type ManagedSkillManifest } from './load-managed-skill-manifest';
import { acquireManagedSkillsLock, resolveManagedSkillsLockPath } from './managed-skills-lock';
import { resolveManagedSkillSourceDir, resolveManagedSkillTargetPath } from './managed-skills-paths';

const MANAGED_SKILLS_METADATA_SCHEMA_VERSION = 1;
const MANAGED_SKILLS_MARKER_FILE_NAME = '.weclaws-managed-skill.json';
const MANAGED_SKILLS_METADATA_FILE_NAME = '.weclaws-managed-skills.json';

const ManagedSkillMarkerSchema = z.object({
  bundleVersion: z.string().min(1),
  managedAt: z.string().min(1),
  schemaVersion: z.literal(MANAGED_SKILLS_METADATA_SCHEMA_VERSION),
  skillName: z.string().min(1),
});

const ManagedSkillSnapshotSchema = z.object({
  bundleVersion: z.string().min(1),
  managedAt: z.string().min(1),
  name: z.string().min(1),
});

const ManagedSkillsMetadataSchema = z.object({
  bundleVersion: z.string().nullable(),
  lastError: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }).nullable(),
  lastOperation: z.enum([
    'remove-all-managed',
    'remove-selected-managed',
    'sync-all-managed',
    'sync-selected-managed',
  ]),
  lastSyncedAt: z.string().min(1),
  lastSyncStatus: z.enum(['busy', 'error', 'success']),
  managedSkills: z.array(ManagedSkillSnapshotSchema),
  schemaVersion: z.literal(MANAGED_SKILLS_METADATA_SCHEMA_VERSION),
  skippedConflicts: z.array(z.string()),
});

const ManagedSkillsOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('sync-all-managed'),
  }),
  z.object({
    skillNames: z.array(z.string().min(1)).min(1),
    type: z.literal('sync-selected-managed'),
  }),
  z.object({
    skillNames: z.array(z.string().min(1)).min(1),
    type: z.literal('remove-selected-managed'),
  }),
  z.object({
    type: z.literal('remove-all-managed'),
  }),
]);

export type ManagedSkillMarker = z.infer<typeof ManagedSkillMarkerSchema>;
export type ManagedSkillsMetadata = z.infer<typeof ManagedSkillsMetadataSchema>;
export type ManagedSkillsOperation = z.infer<typeof ManagedSkillsOperationSchema>;
export type ManagedSkillsOperationType = ManagedSkillsOperation['type'];

export interface ManagedSkillsOperationError {
  code: string;
  message: string;
}

export interface ManagedSkillsOperationResult {
  bundleVersion: string | null;
  error: ManagedSkillsOperationError | null;
  errors: ManagedSkillsOperationError[];
  installedSkills: string[];
  metadataRepaired: boolean;
  operation: ManagedSkillsOperationType;
  removedSkills: string[];
  repairedMarkers: string[];
  skippedConflicts: string[];
  status: 'busy' | 'error' | 'success';
  updatedSkills: string[];
}

export interface SyncManagedSkillsInput {
  botInstanceId: string;
  bundleRoot: string;
  enabledSkillNames?: readonly string[];
  instancesRoot: string;
  operation: ManagedSkillsOperation;
}

interface ManagedSkillPaths {
  dataDir: string;
  lockPath: string;
  metadataPath: string;
  skillsDir: string;
}

interface SkillOwnershipState {
  kind: 'managed' | 'user';
  marker: ManagedSkillMarker | null;
  snapshot: ManagedSkillSnapshot | null;
}

type ManagedSkillSnapshot = z.infer<typeof ManagedSkillSnapshotSchema>;

export function resolveManagedSkillsPaths(instancesRoot: string, botInstanceId: string): ManagedSkillPaths {
  const botPaths = resolveBotInstancePaths(instancesRoot, botInstanceId);

  return {
    dataDir: botPaths.dataDir,
    lockPath: resolveManagedSkillsLockPath(instancesRoot, botInstanceId),
    metadataPath: path.join(botPaths.dataDir, MANAGED_SKILLS_METADATA_FILE_NAME),
    skillsDir: path.join(botPaths.dataDir, 'skills'),
  };
}

export async function readManagedSkillMarker(skillDir: string): Promise<ManagedSkillMarker | null> {
  const markerPath = path.join(skillDir, MANAGED_SKILLS_MARKER_FILE_NAME);

  try {
    const raw = await readFile(markerPath, 'utf8');
    return ManagedSkillMarkerSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    return null;
  }
}

export async function syncManagedSkills(input: SyncManagedSkillsInput): Promise<ManagedSkillsOperationResult> {
  const operation = ManagedSkillsOperationSchema.parse(input.operation);
  const managedPaths = resolveManagedSkillsPaths(input.instancesRoot, input.botInstanceId);

  await mkdir(managedPaths.dataDir, { recursive: true });
  const lockHandle = await acquireManagedSkillsLock(managedPaths.lockPath);

  if (!lockHandle) {
    return createResult(operation.type, {
      bundleVersion: null,
      errors: [{
        code: 'SYNC_IN_PROGRESS',
        message: 'Managed skills sync is already running for this bot.',
      }],
      status: 'busy',
    });
  }

  try {
    if (operation.type !== 'sync-all-managed') {
      return createResult(operation.type, {
        bundleVersion: null,
        errors: [{
          code: 'UNSUPPORTED_OPERATION',
          message: `Managed skills operation is not implemented yet: ${operation.type}.`,
        }],
        status: 'error',
      });
    }

    return await syncAllManagedSkills({
      bundleRoot: input.bundleRoot,
      enabledSkillNames: input.enabledSkillNames,
      managedPaths,
      operation,
    });
  } finally {
    await lockHandle.release();
  }
}

async function syncAllManagedSkills(input: {
  bundleRoot: string;
  enabledSkillNames?: readonly string[];
  managedPaths: ManagedSkillPaths;
  operation: Extract<ManagedSkillsOperation, { type: 'sync-all-managed' }>;
}): Promise<ManagedSkillsOperationResult> {
  await mkdir(input.managedPaths.skillsDir, { recursive: true });
  const existingMetadata = await readManagedSkillsMetadata(input.managedPaths.metadataPath);

  let manifest: ManagedSkillManifest;

  try {
    manifest = await loadManagedSkillManifest({
      bundleRoot: input.bundleRoot,
    });
  } catch (error) {
    return finalizeWithMetadataWrite(input.managedPaths, createResult(input.operation.type, {
      bundleVersion: null,
      errors: [{
        code: 'MANIFEST_INVALID',
        message: toErrorMessage(error, 'Managed skills manifest is invalid.'),
      }],
      status: 'error',
    }), existingMetadata?.managedSkills ?? []);
  }

  const existingMetadataByName = new Map(existingMetadata?.managedSkills.map((skill) => [skill.name, skill]));
  const result = createResult(input.operation.type, {
    bundleVersion: manifest.version,
  });
  const manifestSkillNames = new Set(manifest.skills.map((skill) => skill.name));
  const enabledSkillNames = input.enabledSkillNames === undefined
    ? manifestSkillNames
    : new Set(input.enabledSkillNames);
  const desiredSkills = manifest.skills.filter((skill) => enabledSkillNames.has(skill.name));
  const desiredSkillNames = new Set(desiredSkills.map((skill) => skill.name));

  for (const skillName of enabledSkillNames) {
    if (!manifestSkillNames.has(skillName)) {
      result.errors.push({
        code: 'SKILL_NOT_IN_MANIFEST',
        message: `Enabled managed skill is not present in the bundle manifest: ${skillName}`,
      });
    }
  }

  for (const skill of desiredSkills) {
    let targetPath: string;
    let sourceDir: string;

    try {
      targetPath = resolveManagedSkillTargetPath(input.managedPaths.skillsDir, skill.name);
      sourceDir = await resolveManagedSkillSourceDir(input.bundleRoot, skill.path, skill.name);
    } catch (error) {
      result.errors.push({
        code: 'SYNC_FAILED',
        message: `Failed to resolve managed skill "${skill.name}": ${toErrorMessage(error, 'Unknown error.')}`,
      });
      continue;
    }

    const ownership = await getSkillOwnershipState(targetPath, existingMetadataByName.get(skill.name) ?? null);

    if (ownership.kind === 'user') {
      if (await pathExists(targetPath)) {
        result.skippedConflicts.push(skill.name);
        continue;
      }
    }

    try {
      await installManagedSkill({
        bundleVersion: manifest.version,
        skillName: skill.name,
        sourceDir,
        targetDir: targetPath,
      });

      if (await pathExists(targetPath)) {
        if (ownership.kind === 'managed') {
          result.updatedSkills.push(skill.name);
        } else {
          result.installedSkills.push(skill.name);
        }
      }
    } catch (error) {
      result.errors.push({
        code: 'SYNC_FAILED',
        message: `Failed to sync managed skill "${skill.name}": ${toErrorMessage(error, 'Unknown error.')}`,
      });
    }
  }

  for (const [skillName, snapshot] of existingMetadataByName) {
    if (desiredSkillNames.has(skillName)) {
      continue;
    }

    try {
      const targetPath = resolveManagedSkillTargetPath(input.managedPaths.skillsDir, skillName);
      const ownership = await getSkillOwnershipState(targetPath, snapshot);

      if (ownership.kind !== 'managed') {
        continue;
      }

      if (ownership.marker === null && snapshot) {
        result.repairedMarkers.push(skillName);
        await writeManagedSkillMarker(targetPath, {
          bundleVersion: snapshot.bundleVersion,
          managedAt: snapshot.managedAt,
          skillName,
        });
      }

      await rm(targetPath, { force: true, recursive: true });
      result.removedSkills.push(skillName);
    } catch (error) {
      result.errors.push({
        code: 'SYNC_FAILED',
        message: `Failed to remove retired managed skill "${skillName}": ${toErrorMessage(error, 'Unknown error.')}`,
      });
    }
  }

  const nextManagedSkills = await listManagedSkillSnapshots(
    input.managedPaths.skillsDir,
    existingMetadataByName,
  );
  const metadataRepaired = existingMetadata === null && nextManagedSkills.length > 0;
  const finalizedStatus = result.errors.length > 0 ? 'error' : 'success';

  return finalizeWithMetadataWrite(input.managedPaths, {
    ...result,
    metadataRepaired,
    status: finalizedStatus,
  }, nextManagedSkills);
}

async function finalizeWithMetadataWrite(
  managedPaths: ManagedSkillPaths,
  result: ManagedSkillsOperationResult,
  managedSkills: ManagedSkillSnapshot[] = [],
) {
  try {
    await writeJsonAtomic(managedPaths.metadataPath, {
      bundleVersion: result.bundleVersion,
      lastError: result.error,
      lastOperation: result.operation,
      lastSyncedAt: new Date().toISOString(),
      lastSyncStatus: result.status,
      managedSkills,
      schemaVersion: MANAGED_SKILLS_METADATA_SCHEMA_VERSION,
      skippedConflicts: result.skippedConflicts,
    } satisfies ManagedSkillsMetadata);

    return result;
  } catch (error) {
    const metadataError = {
      code: 'METADATA_WRITE_FAILED',
      message: toErrorMessage(error, 'Failed to write managed skills metadata.'),
    };

    return {
      ...result,
      error: metadataError,
      errors: [...result.errors, metadataError],
      status: 'error' as const,
    };
  }
}

async function installManagedSkill(input: {
  bundleVersion: string;
  skillName: string;
  sourceDir: string;
  targetDir: string;
}) {
  const stagingRoot = await mkdtemp(path.join(path.dirname(input.targetDir), `.weclaws-managed-skill-${input.skillName}-`));
  const stagedTarget = path.join(stagingRoot, input.skillName);

  try {
    await cp(input.sourceDir, stagedTarget, {
      recursive: true,
    });
    await writeManagedSkillMarker(stagedTarget, {
      bundleVersion: input.bundleVersion,
      managedAt: new Date().toISOString(),
      skillName: input.skillName,
    });

    if (!(await pathExists(input.targetDir))) {
      await rename(stagedTarget, input.targetDir);
      return;
    }

    const backupTarget = `${input.targetDir}.backup-${randomUUID()}`;

    await rename(input.targetDir, backupTarget);

    try {
      await rename(stagedTarget, input.targetDir);
      await rm(backupTarget, { force: true, recursive: true });
    } catch (error) {
      await rm(input.targetDir, { force: true, recursive: true });
      await rename(backupTarget, input.targetDir);
      throw error;
    }
  } finally {
    await rm(stagingRoot, { force: true, recursive: true });
  }
}

async function writeManagedSkillMarker(skillDir: string, marker: {
  bundleVersion: string;
  managedAt: string;
  skillName: string;
}) {
  await mkdir(skillDir, { recursive: true });
  await writeJsonAtomic(path.join(skillDir, MANAGED_SKILLS_MARKER_FILE_NAME), {
    bundleVersion: marker.bundleVersion,
    managedAt: marker.managedAt,
    schemaVersion: MANAGED_SKILLS_METADATA_SCHEMA_VERSION,
    skillName: marker.skillName,
  } satisfies ManagedSkillMarker);
}

async function listManagedSkillSnapshots(
  skillsDir: string,
  existingMetadataByName: Map<string, ManagedSkillSnapshot>,
) {
  const directoryEntries = await readDirectoryNames(skillsDir);
  const managedSkills: ManagedSkillSnapshot[] = [];

  for (const skillName of directoryEntries) {
    const skillPath = path.join(skillsDir, skillName);
    const marker = await readManagedSkillMarker(skillPath);

    if (marker) {
      managedSkills.push({
        bundleVersion: marker.bundleVersion,
        managedAt: marker.managedAt,
        name: skillName,
      });
      continue;
    }

    const fallbackSnapshot = existingMetadataByName.get(skillName);

    if (fallbackSnapshot) {
      managedSkills.push(fallbackSnapshot);
    }
  }

  return managedSkills.sort((left, right) => left.name.localeCompare(right.name));
}

async function getSkillOwnershipState(targetPath: string, metadataSnapshot: ManagedSkillSnapshot | null): Promise<SkillOwnershipState> {
  if (!(await pathExists(targetPath))) {
    return metadataSnapshot
      ? { kind: 'managed', marker: null, snapshot: metadataSnapshot }
      : { kind: 'user', marker: null, snapshot: null };
  }

  const marker = await readManagedSkillMarker(targetPath);

  if (marker) {
    return {
      kind: 'managed',
      marker,
      snapshot: {
        bundleVersion: marker.bundleVersion,
        managedAt: marker.managedAt,
        name: marker.skillName,
      },
    };
  }

  if (metadataSnapshot) {
    return {
      kind: 'managed',
      marker: null,
      snapshot: metadataSnapshot,
    };
  }

  return {
    kind: 'user',
    marker: null,
    snapshot: null,
  };
}

export async function readManagedSkillsMetadata(metadataPath: string): Promise<ManagedSkillsMetadata | null> {
  try {
    const raw = await readFile(metadataPath, 'utf8');
    return ManagedSkillsMetadataSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    return null;
  }
}

async function readDirectoryNames(directoryPath: string) {
  try {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (isMissingFileError(error)) {
      return [];
    }

    throw error;
  }
}

async function writeJsonAtomic(targetPath: string, value: unknown) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(value, null, 2));
  await rename(temporaryPath, targetPath);
}

async function pathExists(targetPath: string) {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }
}

function createResult(
  operation: ManagedSkillsOperationType,
  input: Partial<Omit<ManagedSkillsOperationResult, 'operation'>>,
): ManagedSkillsOperationResult {
  const errors = input.errors ?? [];

  return {
    bundleVersion: input.bundleVersion ?? null,
    error: input.error ?? errors[0] ?? null,
    errors,
    installedSkills: input.installedSkills ?? [],
    metadataRepaired: input.metadataRepaired ?? false,
    operation,
    removedSkills: input.removedSkills ?? [],
    repairedMarkers: input.repairedMarkers ?? [],
    skippedConflicts: input.skippedConflicts ?? [],
    status: input.status ?? 'success',
    updatedSkills: input.updatedSkills ?? [],
  };
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function toErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message
    ? error.message
    : fallback;
}
