import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveBotInstancePaths } from '@weiling-ai/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { clearBotLoginState } from '../clear-bot-login-state';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true,
  })));
});

describe('clearBotLoginState', () => {
  it('removes persisted Weixin account credentials while preserving conversation data', async () => {
    const instancesRoot = await mkdtemp(path.join(tmpdir(), 'weiling-clear-login-'));
    tempDirectories.push(instancesRoot);
    const { dataDir } = resolveBotInstancePaths(instancesRoot, 'bot_1');
    await mkdir(dataDir, { recursive: true });

    const loginFiles = [
      'accounts-roster.jsonl',
      'accounts-runtime.jsonl',
      'bindings.jsonl',
      'plugin-secrets.jsonl',
      'plugin-state.jsonl',
    ];
    await Promise.all(loginFiles.map((fileName) => writeFile(
      path.join(dataDir, fileName),
      'login-state',
    )));
    await writeFile(path.join(dataDir, 'conversation-sessions.jsonl'), 'conversation-state');

    await clearBotLoginState({ botInstanceId: 'bot_1', instancesRoot });

    await Promise.all(loginFiles.map(async (fileName) => {
      await expect(readFile(path.join(dataDir, fileName), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }));
    await expect(readFile(path.join(dataDir, 'conversation-sessions.jsonl'), 'utf8'))
      .resolves.toBe('conversation-state');
  });
});
