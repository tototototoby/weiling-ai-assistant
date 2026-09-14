import { EventEmitter } from 'node:events';
import { access, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY } from '@weiling-ai/db';
import type { ChildProcess } from 'node:child_process';
import type { SupervisorConfig } from '../../config';
import {
  FeishuChannelGateway,
  splitUtf8,
} from '../feishu-channel-gateway';
import type { RunLarkCliOnceInput } from '../lark-cli-runner';

const tempDirs: string[] = [];
const EXPECTED_P2P_SYSTEM_PROMPT = '当前会话是飞书私聊。禁止调用 send_im、send_im_media 或任何微信发送工具；这些工具不适用于当前入口。用户要求制作、发送、重发或查看图片/文件时，最终回复末尾必须为每个要发送的文件单独输出一行：[飞书文件: 工作区相对路径]；重发已有文件也必须输出标记。没有有效工作区相对路径和对应标记时，不得声称文件已经发送或交付。标记内不得使用绝对路径。除这些标记外，直接输出给用户的回复内容。';
const EXPECTED_EXTERNAL_TURN_TIMEOUT_MS = 20 * 60_000;
const EXPECTED_DENIED_IM_TOOLS = ['send_im', 'send_im_media'];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('FeishuChannelGateway', () => {
  it('imports credentials files into the DB and starts an event bus session', async () => {
    const fixture = await createFixture();
    await mkdir(join(fixture.homeDir, '.weclaws-feishu'), { recursive: true });
    await writeFile(
      join(fixture.homeDir, '.weclaws-feishu', 'credentials.json'),
      JSON.stringify({ appId: 'cli_app-one', appSecret: 'secret-one' }),
      'utf8',
    );

    await fixture.gateway.runOnce();

    expect(fixture.configs.upserted).toEqual([
      expect.objectContaining({
        appId: 'cli_app-one',
        appSecret: 'secret-one',
        botInstanceId: 'bot_1',
        enabled: true,
      }),
    ]);
    expect(fixture.spawned).toHaveLength(1);
    expect(fixture.spawned[0].args).toEqual([
      'event', 'consume', 'im.message.receive_v1', '--as', 'bot',
    ]);
    expect(fixture.statuses).toContainEqual(expect.objectContaining({
      botInstanceId: 'bot_1',
      status: 'connecting',
    }));
    await fixture.gateway.dispose();
  });

  it('records connected when the event bus reports ready on stderr', async () => {
    const fixture = await createFixture({ configured: true });
    await fixture.gateway.runOnce();

    fixture.children[0].stderr.write('[event] ready event_key=im.message.receive_v1\n');
    await waitFor(() => fixture.statuses.some((status) => status.status === 'connected'));

    expect(fixture.statuses).toContainEqual(expect.objectContaining({
      botInstanceId: 'bot_1',
      status: 'connected',
    }));
    await fixture.gateway.dispose();
  });

  it('acknowledges, runs an external turn, replies, and marks the event succeeded', async () => {
    const fixture = await createFixture({ configured: true });
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_chat',
      chat_type: 'p2p',
      content: '  hello  ',
      event_id: 'event-1',
      message_id: 'om_1',
      message_type: 'text',
      sender_id: 'ou_user',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.detailedTurns.length === 1);
    expect(fixture.externalTurns).toEqual([]);
    expect(fixture.detailedTurns[0]).toEqual({
      botInstanceId: 'bot_1',
      options: {
        denyTools: EXPECTED_DENIED_IM_TOOLS,
        systemPrompt: EXPECTED_P2P_SYSTEM_PROMPT,
        timeoutMs: EXPECTED_EXTERNAL_TURN_TIMEOUT_MS,
      },
      requestId: 'om_1',
      text: 'hello',
    });
    expect(fixture.replies).toHaveLength(2);
    expect(fixture.replies[0].args).toContain('om_1');
    expect(fixture.replies[1].args).toContain('reply to hello');
    await waitFor(() => fixture.succeeded.length === 1);
    expect(fixture.succeeded).toEqual(['event-1']);
    expect(fixture.inboundActivity).toEqual(['bot_1']);
    expect(fixture.outboundActivity).toEqual(['bot_1']);
    await fixture.gateway.dispose();
  });

  it('sends bounded P2P progress updates at 2, 5, and 10 minutes and cancels later updates', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const requestId = 'om_progress_slow';
    const fixture = await createFixture({
      configured: true,
      deferredDetailedTurnRequestIds: new Set([requestId]),
    });
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_chat',
      chat_type: 'p2p',
      content: '执行一个长任务',
      event_id: 'event-progress-slow',
      message_id: requestId,
      message_type: 'text',
      sender_id: 'ou_user',
      type: 'im.message.receive_v1',
    })}\n`);
    await flushAsyncWork();
    expect(fixture.detailedTurns.some((turn) => turn.requestId === requestId)).toBe(true);

    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await flushAsyncWork();
    expect(progressUpdateCalls(fixture.larkCalls)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(3 * 60_000);
    await flushAsyncWork();
    expect(progressUpdateCalls(fixture.larkCalls)).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await flushAsyncWork();
    expect(progressUpdateCalls(fixture.larkCalls)).toHaveLength(3);
    const progressKeys = progressUpdateCalls(fixture.larkCalls).map(({ args }) => (
      argumentValue(args, '--idempotency-key')
    ));
    expect(new Set(progressKeys).size).toBe(3);
    expect(progressKeys.every((key) => isUuidLikeIdempotencyKey(key))).toBe(true);

    fixture.releaseDetailedTurn(requestId);
    await flushAsyncWork();
    expect(fixture.succeeded).toContain('event-progress-slow');

    await vi.advanceTimersByTimeAsync(20 * 60_000);
    await flushAsyncWork();
    expect(progressUpdateCalls(fixture.larkCalls)).toHaveLength(3);
    vi.useRealTimers();
    await fixture.gateway.dispose();
  });

  it('does not send P2P progress after a fast success or an external-turn failure', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const failureId = 'om_progress_failed';
    const fixture = await createFixture({
      configured: true,
      detailedTurnErrors: new Map([[failureId, new Error('model failed')]]),
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await fixture.gateway.runOnce();

    for (const event of [
      {
        content: '快速完成',
        event_id: 'event-progress-fast',
        message_id: 'om_progress_fast',
      },
      {
        content: '立即失败',
        event_id: 'event-progress-failed',
        message_id: failureId,
      },
    ]) {
      fixture.children[0].stdout.write(`${JSON.stringify({
        chat_id: 'oc_chat',
        chat_type: 'p2p',
        message_type: 'text',
        sender_id: 'ou_user',
        type: 'im.message.receive_v1',
        ...event,
      })}\n`);
      await flushAsyncWork();
    }

    await vi.advanceTimersByTimeAsync(11 * 60_000);
    await flushAsyncWork();
    expect(progressUpdateCalls(fixture.larkCalls)).toEqual([]);
    expect(fixture.succeeded).toContain('event-progress-fast');
    expect(fixture.failed.some(([eventId]) => eventId === 'event-progress-failed')).toBe(true);
    vi.useRealTimers();
    await fixture.gateway.dispose();
  });

  it('keeps the final P2P delivery successful when a progress update send fails', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const requestId = 'om_progress_send_failure';
    const fixture = await createFixture({
      configured: true,
      deferredDetailedTurnRequestIds: new Set([requestId]),
      failLarkIdempotencyKeys: new Set(['*']),
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_chat',
      chat_type: 'p2p',
      content: '进度发送失败也要完成',
      event_id: 'event-progress-send-failure',
      message_id: requestId,
      message_type: 'text',
      sender_id: 'ou_user',
      type: 'im.message.receive_v1',
    })}\n`);
    await flushAsyncWork();
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await flushAsyncWork();
    expect(progressUpdateCalls(fixture.larkCalls)).toHaveLength(1);

    fixture.releaseDetailedTurn(requestId);
    await flushAsyncWork();
    expect(fixture.succeeded).toContain('event-progress-send-failure');
    expect(fixture.replies.some(({ args }) => args.includes('reply to 进度发送失败也要完成')))
      .toBe(true);
    vi.useRealTimers();
    await fixture.gateway.dispose();
  });

  it('does not schedule P2P progress updates for group turns', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fixture = await createFixture({ configured: true });
    fixture.appNameRef.value = '测试机器人';
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_group',
      chat_type: 'group',
      content: '@测试机器人 执行任务',
      event_id: 'event-group-no-p2p-progress',
      message_id: 'om_group_no_p2p_progress',
      message_type: 'text',
      sender_id: 'ou_member',
      type: 'im.message.receive_v1',
    })}\n`);
    await flushAsyncWork();
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    await flushAsyncWork();

    expect(progressUpdateCalls(fixture.larkCalls)).toEqual([]);
    expect(fixture.succeeded).toContain('event-group-no-p2p-progress');
    vi.useRealTimers();
    await fixture.gateway.dispose();
  });

  it('strips a P2P Feishu file marker and sends the referenced workspace file', async () => {
    const fixture = await createFixture({ configured: true });
    const exportsDir = join(fixture.homeDir, 'exports');
    await mkdir(exportsDir, { recursive: true });
    await writeFile(join(exportsDir, 'report.pdf'), 'pdf', 'utf8');
    fixture.replyTextRef.value = '文件已生成。\n[飞书文件: exports/report.pdf]';
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_chat',
      chat_type: 'p2p',
      content: '请生成报告',
      event_id: 'event-p2p-file-marker',
      message_id: 'om_p2p_file_marker',
      message_type: 'text',
      sender_id: 'ou_user',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.succeeded.includes('event-p2p-file-marker'));
    expect(fixture.replies.some(({ args }) => (
      args.includes('文件已生成。') && !args.join(' ').includes('[飞书文件:')
    ))).toBe(true);
    expect(groupAttachmentSends(fixture.replies)).toEqual([
      expect.objectContaining({
        args: expect.arrayContaining(['--file', './report.pdf']),
      }),
    ]);
    await fixture.gateway.dispose();
  });

  it('resends the same P2P file for distinct user messages without the group cooldown', async () => {
    const fixture = await createFixture({ configured: true });
    const exportsDir = join(fixture.homeDir, 'exports');
    await mkdir(exportsDir, { recursive: true });
    await writeFile(join(exportsDir, 'poster.png'), 'png', 'utf8');
    fixture.replyTextRef.value = '直接发图。\n[飞书文件: exports/poster.png]';
    await fixture.gateway.runOnce();

    for (const suffix of ['one', 'two']) {
      fixture.children[0].stdout.write(`${JSON.stringify({
        chat_id: 'oc_chat',
        chat_type: 'p2p',
        content: '把之前的海报再发给我',
        event_id: `event-p2p-resend-${suffix}`,
        message_id: `om_p2p_resend_${suffix}`,
        message_type: 'text',
        sender_id: 'ou_user',
        type: 'im.message.receive_v1',
      })}\n`);
      await waitFor(() => fixture.succeeded.includes(`event-p2p-resend-${suffix}`));
    }

    const sends = groupAttachmentSends(fixture.replies);
    expect(sends).toHaveLength(2);
    const keys = sends.map(({ args }) => argumentValue(args, '--idempotency-key'));
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys.every(isUuidLikeIdempotencyKey)).toBe(true);
    await fixture.gateway.dispose();
  });

  it('rejects an absolute P2P Feishu file marker and reports only failure counts', async () => {
    const fixture = await createFixture({ configured: true });
    fixture.replyTextRef.value = '文件已生成。\n[飞书文件: C:/Windows/win.ini]';
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_chat',
      chat_type: 'p2p',
      content: '请发文件',
      event_id: 'event-p2p-file-rejected',
      message_id: 'om_p2p_file_rejected',
      message_type: 'text',
      sender_id: 'ou_user',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.succeeded.includes('event-p2p-file-rejected'));
    expect(groupAttachmentSends(fixture.replies)).toEqual([]);
    const notice = fixture.replies.find(({ args }) => (
      args.some((arg) => arg.includes('飞书文件未发送'))
    ));
    expect(notice?.args.join(' ')).toContain('安全拒绝 1 个');
    expect(notice?.args.join(' ')).not.toContain('C:/Windows');
    await fixture.gateway.dispose();
  });

  it('reports a missing explicit P2P Feishu file marker as a send failure', async () => {
    const fixture = await createFixture({ configured: true });
    fixture.replyTextRef.value = '文件已生成。\n[飞书文件: exports/missing-report.pdf]';
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_chat',
      chat_type: 'p2p',
      content: '请发文件',
      event_id: 'event-p2p-file-missing',
      message_id: 'om_p2p_file_missing',
      message_type: 'text',
      sender_id: 'ou_user',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.succeeded.includes('event-p2p-file-missing'));
    expect(groupAttachmentSends(fixture.replies)).toEqual([]);
    const notice = fixture.replies.find(({ args }) => (
      args.some((arg) => arg.includes('飞书文件未发送'))
    ));
    expect(notice?.args.join(' ')).toContain('发送失败 1 个');
    await fixture.gateway.dispose();
  });

  it('does not scan or send workspace files for a P2P reply without a marker', async () => {
    const fixture = await createFixture({ configured: true });
    await writeFile(join(fixture.homeDir, 'unmarked.png'), 'png', 'utf8');
    fixture.replyTextRef.value = '本次没有需要回传的文件。';
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_chat',
      chat_type: 'p2p',
      content: '只回复文字',
      event_id: 'event-p2p-no-marker',
      message_id: 'om_p2p_no_marker',
      message_type: 'text',
      sender_id: 'ou_user',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.succeeded.includes('event-p2p-no-marker'));
    expect(groupAttachmentSends(fixture.replies)).toEqual([]);
    expect(fixture.replies.some(({ args }) => args.includes('本次没有需要回传的文件。')))
      .toBe(true);
    await fixture.gateway.dispose();
  });

  it('sends a relative P2P image path from Markdown inline code without stripping it', async () => {
    const fixture = await createFixture({ configured: true });
    const posterDir = join(fixture.homeDir, 'poster_test');
    await mkdir(posterDir, { recursive: true });
    await writeFile(join(posterDir, 'test-poster-0916.png'), 'png', 'utf8');
    fixture.replyTextRef.value = '海报已生成：`poster_test/test-poster-0916.png`';
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_chat',
      chat_type: 'p2p',
      content: '请生成海报',
      event_id: 'event-p2p-inline-image',
      message_id: 'om_p2p_inline_image',
      message_type: 'text',
      sender_id: 'ou_user',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.succeeded.includes('event-p2p-inline-image'));
    expect(groupAttachmentSends(fixture.replies)).toEqual([
      expect.objectContaining({
        args: expect.arrayContaining(['--image', './test-poster-0916.png']),
      }),
    ]);
    expect(fixture.replies.some(({ args }) => (
      args.includes('海报已生成：`poster_test/test-poster-0916.png`')
    ))).toBe(true);
    await fixture.gateway.dispose();
  });

  it('silently ignores a missing implicit P2P image path', async () => {
    const fixture = await createFixture({ configured: true });
    const posterDir = join(fixture.homeDir, 'poster_test');
    await mkdir(posterDir, { recursive: true });
    await writeFile(join(posterDir, 'available.png'), 'png', 'utf8');
    fixture.replyTextRef.value = [
      '海报已生成：`poster_test/available.png`',
      '二维码占位图：`qr-placeholder.png`',
    ].join('\n');
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_chat',
      chat_type: 'p2p',
      content: '请生成海报',
      event_id: 'event-p2p-inline-missing',
      message_id: 'om_p2p_inline_missing',
      message_type: 'text',
      sender_id: 'ou_user',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.succeeded.includes('event-p2p-inline-missing'));
    expect(groupAttachmentSends(fixture.replies)).toEqual([
      expect.objectContaining({
        args: expect.arrayContaining(['--image', './available.png']),
      }),
    ]);
    expect(fixture.replies.some(({ args }) => (
      args.some((arg) => arg.includes('飞书文件未发送'))
    ))).toBe(false);
    await fixture.gateway.dispose();
  });

  it('ignores plain text, URLs, absolute paths, and non-images in P2P replies', async () => {
    const fixture = await createFixture({ configured: true });
    const posterDir = join(fixture.homeDir, 'poster_test');
    const exportsDir = join(fixture.homeDir, 'exports');
    await Promise.all([
      mkdir(posterDir, { recursive: true }),
      mkdir(exportsDir, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(posterDir, 'plain.png'), 'png', 'utf8'),
      writeFile(join(posterDir, 'absolute.png'), 'png', 'utf8'),
      writeFile(join(exportsDir, 'report.pdf'), 'pdf', 'utf8'),
    ]);
    const absoluteImagePath = join(posterDir, 'absolute.png').replace(/\\/gu, '/');
    fixture.replyTextRef.value = [
      '普通文字中的路径 poster_test/plain.png 不触发。',
      'URL `https://example.invalid/remote.png` 不触发。',
      `绝对路径 \`${absoluteImagePath}\` 不触发。`,
      '非图片 `exports/report.pdf` 不触发。',
    ].join('\n');
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_chat',
      chat_type: 'p2p',
      content: '只发送真正生成的相对图片',
      event_id: 'event-p2p-inline-invalid',
      message_id: 'om_p2p_inline_invalid',
      message_type: 'text',
      sender_id: 'ou_user',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.succeeded.includes('event-p2p-inline-invalid'));
    expect(groupAttachmentSends(fixture.replies)).toEqual([]);
    expect(fixture.replies.some(({ args }) => (
      args.some((arg) => arg.includes('飞书文件未发送'))
    ))).toBe(false);
    await fixture.gateway.dispose();
  });

  it('prefers explicit P2P markers over missing implicit image paths', async () => {
    const fixture = await createFixture({ configured: true });
    const posterDir = join(fixture.homeDir, 'poster_test');
    await mkdir(posterDir, { recursive: true });
    await writeFile(join(posterDir, 'deduplicated.png'), 'png', 'utf8');
    fixture.replyTextRef.value = [
      '二维码占位图：`qr-placeholder.png`',
      '[飞书文件: poster_test/deduplicated.png]',
    ].join('\n');
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_chat',
      chat_type: 'p2p',
      content: '请发图片',
      event_id: 'event-p2p-inline-deduplicated',
      message_id: 'om_p2p_inline_deduplicated',
      message_type: 'text',
      sender_id: 'ou_user',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.succeeded.includes('event-p2p-inline-deduplicated'));
    expect(groupAttachmentSends(fixture.replies)).toEqual([
      expect.objectContaining({
        args: expect.arrayContaining(['--image', './deduplicated.png']),
      }),
    ]);
    expect(fixture.replies.some(({ args }) => (
      args.includes('二维码占位图：`qr-placeholder.png`')
      && !args.join(' ').includes('[飞书文件:')
    ))).toBe(true);
    expect(fixture.replies.some(({ args }) => (
      args.some((arg) => arg.includes('飞书文件未发送'))
    ))).toBe(false);
    await fixture.gateway.dispose();
  });

  it('does not cross-interpret P2P and group file markers', async () => {
    const fixture = await createFixture({ configured: true });
    fixture.appNameRef.value = '测试机器人';
    await writeFile(join(fixture.homeDir, 'marker-scope.png'), 'png', 'utf8');
    await fixture.gateway.runOnce();

    fixture.replyTextRef.value = '[群文件: marker-scope.png]';
    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_chat',
      chat_type: 'p2p',
      content: '私聊',
      event_id: 'event-p2p-wrong-marker',
      message_id: 'om_p2p_wrong_marker',
      message_type: 'text',
      sender_id: 'ou_user',
      type: 'im.message.receive_v1',
    })}\n`);
    await waitFor(() => fixture.succeeded.includes('event-p2p-wrong-marker'));

    fixture.replyTextRef.value = '[飞书文件: marker-scope.png]';
    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_group',
      chat_type: 'group',
      content: '@测试机器人 群聊',
      event_id: 'event-group-wrong-marker',
      message_id: 'om_group_wrong_marker',
      message_type: 'text',
      sender_id: 'ou_member',
      type: 'im.message.receive_v1',
    })}\n`);
    await waitFor(() => fixture.succeeded.includes('event-group-wrong-marker'));

    expect(groupAttachmentSends(fixture.replies)).toEqual([]);
    await fixture.gateway.dispose();
  });

  it('downloads a P2P file into the Bot workspace and injects only its relative path', async () => {
    const fixture = await createFixture({ configured: true });
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_chat',
      chat_type: 'p2p',
      content: '<file key="file_v3_skill" name="brand-poster-skill.zip"/>',
      event_id: 'event-file-1',
      message_id: 'om_file_1',
      message_type: 'file',
      sender_id: 'ou_user',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.detailedTurns.length === 1);
    expect(fixture.downloads).toHaveLength(1);
    expect(fixture.downloads[0].args).toEqual([
      'im', '+messages-resources-download',
      '--message-id', 'om_file_1',
      '--file-key', 'file_v3_skill',
      '--type', 'file',
      '--output', './brand-poster-skill.zip',
      '--as', 'bot',
    ]);
    expect(fixture.downloads[0].homeDir).toBe(fixture.larkHomeDir);
    expect(fixture.downloads[0].timeoutMs).toBe(120_000);
    expect(fixture.downloads[0].cwd).toContain(join(
      fixture.homeDir,
      'feishu-inbox',
      'om_file_1',
    ));
    expect(fixture.detailedTurns[0].text).toContain(
      '原始文件名：brand-poster-skill.zip',
    );
    expect(fixture.detailedTurns[0].text).toContain(
      '工作区相对路径：feishu-inbox/om_file_1/brand-poster-skill.zip',
    );
    expect(fixture.detailedTurns[0].text).toContain('不要自动安装、解压或执行');
    expect(fixture.detailedTurns[0].text).not.toContain(fixture.instancesRoot);
    await expect(access(join(
      fixture.homeDir,
      'feishu-inbox',
      'om_file_1',
      'brand-poster-skill.zip',
    ))).resolves.toBeUndefined();
    await fixture.gateway.dispose();
  });

  it('downloads an image and injects its inferred workspace-relative image path', async () => {
    const fixture = await createFixture({ configured: true });
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_chat',
      chat_type: 'p2p',
      content: '[Image: img_v3_photo]',
      event_id: 'event-image-1',
      message_id: 'om_image_1',
      message_type: 'image',
      sender_id: 'ou_user',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.detailedTurns.length === 1);
    expect(fixture.downloads[0].args).toEqual([
      'im', '+messages-resources-download',
      '--message-id', 'om_image_1',
      '--file-key', 'img_v3_photo',
      '--type', 'image',
      '--output', './image',
      '--as', 'bot',
    ]);
    expect(fixture.detailedTurns[0].text).toContain(
      '工作区相对路径：feishu-inbox/om_image_1/image.png',
    );
    expect(fixture.detailedTurns[0].text).not.toContain(fixture.instancesRoot);
    await fixture.gateway.dispose();
  });

  it('sanitizes traversal in an inbound file name before download and model input', async () => {
    const fixture = await createFixture({ configured: true });
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_chat',
      chat_type: 'p2p',
      content: '<file key="file_v3_escape" name="../../outside.zip"/>',
      event_id: 'event-file-escape',
      message_id: 'om_file_escape',
      message_type: 'file',
      sender_id: 'ou_user',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.detailedTurns.length === 1);
    expect(fixture.downloads[0].args).toContain('./outside.zip');
    expect(fixture.detailedTurns[0].text).toContain(
      '工作区相对路径：feishu-inbox/om_file_escape/outside.zip',
    );
    expect(fixture.detailedTurns[0].text).not.toContain('../');
    await expect(access(join(fixture.homeDir, 'outside.zip'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await fixture.gateway.dispose();
  });

  it('marks a failed download and returns a clear permission-oriented notice', async () => {
    const fixture = await createFixture({
      configured: true,
      failDownloadMessageIds: new Set(['om_file_failed']),
    });
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_chat',
      chat_type: 'p2p',
      content: '<file key="file_v3_failed" name="failed.zip"/>',
      event_id: 'event-file-failed',
      message_id: 'om_file_failed',
      message_type: 'file',
      sender_id: 'ou_user',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.failed.length === 1);
    expect(fixture.detailedTurns).toEqual([]);
    expect(fixture.failed[0][0]).toBe('event-file-failed');
    expect(fixture.replies.at(-1)?.args.join(' ')).toContain('飞书附件下载失败');
    expect(fixture.replies.at(-1)?.args.join(' ')).toContain('im:message:readonly');
    await fixture.gateway.dispose();
  });

  it('serializes a file then text in the same chat until the download completes', async () => {
    const fixture = await createFixture({
      blockedDownloadMessageIds: new Set(['om_file_ordered']),
      configured: true,
    });
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_chat',
      chat_type: 'p2p',
      content: '<file key="file_v3_ordered" name="skill.zip"/>',
      event_id: 'event-file-ordered',
      message_id: 'om_file_ordered',
      message_type: 'file',
      sender_id: 'ou_user',
      type: 'im.message.receive_v1',
    })}\n`);
    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_chat',
      chat_type: 'p2p',
      content: '可以装一下这个吗',
      event_id: 'event-text-after-file',
      message_id: 'om_text_after_file',
      message_type: 'text',
      sender_id: 'ou_user',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.downloadStarted.has('om_file_ordered'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fixture.detailedTurns).toEqual([]);

    fixture.releaseDownload('om_file_ordered');
    await waitFor(() => fixture.detailedTurns.length === 2);
    expect(fixture.detailedTurns[0].text).toContain(
      '工作区相对路径：feishu-inbox/om_file_ordered/skill.zip',
    );
    expect(fixture.detailedTurns[1]).toMatchObject({
      botInstanceId: 'bot_1',
      requestId: 'om_text_after_file',
      text: '可以装一下这个吗',
    });
    await fixture.gateway.dispose();
  });

  it('ignores duplicate events without running the external turn twice', async () => {
    const fixture = await createFixture({ configured: true });
    await fixture.gateway.runOnce();
    const payload = {
      chat_id: 'oc_chat',
      chat_type: 'p2p',
      content: 'hello',
      event_id: 'event-1',
      message_id: 'om_1',
      sender_id: 'ou_user',
      type: 'im.message.receive_v1',
    };

    fixture.children[0].stdout.write(`${JSON.stringify(payload)}\n`);
    await waitFor(() => fixture.detailedTurns.length === 1);
    fixture.children[0].stdout.write(`${JSON.stringify(payload)}\n`);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fixture.detailedTurns).toHaveLength(1);
    await fixture.gateway.dispose();
  });

  it('routes group mentions to a dedicated group session with the group persona', async () => {
    const fixture = await createFixture({ configured: true });
    fixture.appNameRef.value = '测试机器人';
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_group',
      chat_type: 'group',
      content: '@测试机器人 帮我查一下',
      event_id: 'group-event-1',
      message_id: 'om_group_1',
      sender_id: 'ou_member',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.detailedTurns.length === 1);
    expect(fixture.detailedTurns[0].options).toEqual({
      denyTools: EXPECTED_DENIED_IM_TOOLS,
      sessionKey: 'feishu-group:oc_group',
      sessionId: undefined,
      systemPrompt: expect.stringContaining('oc_group'),
      timeoutMs: EXPECTED_EXTERNAL_TURN_TIMEOUT_MS,
    });
    expect(fixture.groupSessions.upserted).toEqual([
      ['bot_1', 'oc_group', 'group-session-1'],
    ]);
    expect(fixture.replies).toHaveLength(1);
    expect(fixture.replies[0].args).toContain('om_group_1');

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_group',
      chat_type: 'group',
      content: '@测试机器人 继续',
      event_id: 'group-event-2',
      message_id: 'om_group_2',
      sender_id: 'ou_member',
      type: 'im.message.receive_v1',
    })}\n`);
    await waitFor(() => fixture.detailedTurns.length === 2);
    expect(fixture.detailedTurns[1].options).toEqual({
      denyTools: EXPECTED_DENIED_IM_TOOLS,
      sessionKey: 'feishu-group:oc_group',
      sessionId: 'group-session-1',
      systemPrompt: expect.stringContaining('oc_group'),
      timeoutMs: EXPECTED_EXTERNAL_TURN_TIMEOUT_MS,
    });
    await fixture.gateway.dispose();
  });

  it('uses the controlled timeout for a group turn and warns that timed-out work may continue', async () => {
    const fixture = await createFixture({
      configured: true,
      detailedTurnErrors: new Map([
        ['om_group_timeout', new Error('FastAgent external turn timed out.')],
      ]),
    });
    fixture.appNameRef.value = '测试机器人';
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_group',
      chat_type: 'group',
      content: '@测试机器人 执行长任务',
      event_id: 'group-timeout-event',
      message_id: 'om_group_timeout',
      message_type: 'text',
      sender_id: 'ou_member',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.failed.some(([eventId]) => eventId === 'group-timeout-event'));
    expect(fixture.detailedTurns[0].options.timeoutMs).toBe(EXPECTED_EXTERNAL_TURN_TIMEOUT_MS);
    expect(fixture.replies.at(-1)?.args.join(' ')).toContain('任务可能仍在后台继续');
    expect(fixture.replies.at(-1)?.args.join(' ')).toContain('不要重复提交');
    await fixture.gateway.dispose();
  });

  it('downloads an @mentioned group file into that group session', async () => {
    const fixture = await createFixture({ configured: true });
    fixture.appNameRef.value = '测试机器人';
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_group',
      chat_type: 'group',
      content: '@测试机器人 <file key="file_v3_group" name="group-skill.zip"/>',
      event_id: 'group-file-event',
      message_id: 'om_group_file_inbound',
      message_type: 'file',
      sender_id: 'ou_member',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.detailedTurns.length === 1);
    expect(fixture.downloads).toHaveLength(1);
    expect(fixture.detailedTurns[0].text).toContain(
      '工作区相对路径：feishu-inbox/om_group_file_inbound/group-skill.zip',
    );
    expect(fixture.detailedTurns[0].options).toEqual({
      denyTools: EXPECTED_DENIED_IM_TOOLS,
      sessionKey: 'feishu-group:oc_group',
      sessionId: undefined,
      systemPrompt: expect.stringContaining('oc_group'),
      timeoutMs: EXPECTED_EXTERNAL_TURN_TIMEOUT_MS,
    });
    await fixture.gateway.dispose();
  });

  it('ignores group messages without a mention', async () => {
    const fixture = await createFixture({ configured: true });
    fixture.appNameRef.value = '测试机器人';
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_group',
      chat_type: 'group',
      content: '普通群消息',
      event_id: 'group-event-x',
      message_id: 'om_group_x',
      sender_id: 'ou_member',
      type: 'im.message.receive_v1',
    })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fixture.detailedTurns).toEqual([]);
    expect(fixture.replies).toEqual([]);
    await fixture.gateway.dispose();
  });

  it('ignores a group file without a Bot mention before downloading it', async () => {
    const fixture = await createFixture({ configured: true });
    fixture.appNameRef.value = '测试机器人';
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_group',
      chat_type: 'group',
      content: '<file key="file_v3_ignored" name="ignored.zip"/>',
      event_id: 'group-file-ignored',
      message_id: 'om_group_file_ignored',
      message_type: 'file',
      sender_id: 'ou_member',
      type: 'im.message.receive_v1',
    })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fixture.downloads).toEqual([]);
    expect(fixture.detailedTurns).toEqual([]);
    expect(fixture.replies).toEqual([]);
    await fixture.gateway.dispose();
  });

  it('does not treat an application name inside a group file name as a Bot mention', async () => {
    const fixture = await createFixture({ configured: true });
    fixture.appNameRef.value = '测试机器人';
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_group',
      chat_type: 'group',
      content: '<file key="file_v3_named" name="测试机器人方案.zip"/>',
      event_id: 'group-file-name-match',
      message_id: 'om_group_file_name_match',
      message_type: 'file',
      sender_id: 'ou_member',
      type: 'im.message.receive_v1',
    })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fixture.downloads).toEqual([]);
    expect(fixture.detailedTurns).toEqual([]);
    expect(fixture.replies).toEqual([]);
    await fixture.gateway.dispose();
  });

  it('ignores a group message that only mentions someone else', async () => {
    const fixture = await createFixture({ configured: true });
    fixture.appNameRef.value = '测试机器人';
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_group',
      chat_type: 'group',
      content: '@其他人 帮忙看一下',
      event_id: 'group-other-mention',
      message_id: 'om_group_other_mention',
      message_type: 'text',
      sender_id: 'ou_member',
      type: 'im.message.receive_v1',
    })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fixture.detailedTurns).toEqual([]);
    expect(fixture.replies).toEqual([]);
    await fixture.gateway.dispose();
  });

  it('fails closed for group mentions when the application name is unavailable', async () => {
    const fixture = await createFixture({ configured: true });
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_group',
      chat_type: 'group',
      content: '@测试机器人 帮忙看一下',
      event_id: 'group-name-unavailable',
      message_id: 'om_group_name_unavailable',
      message_type: 'text',
      sender_id: 'ou_member',
      type: 'im.message.receive_v1',
    })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fixture.detailedTurns).toEqual([]);
    expect(fixture.replies).toEqual([]);
    await fixture.gateway.dispose();
  });

  it('records the first P2P sender as the app owner', async () => {
    const fixture = await createFixture({ configured: true });
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_chat',
      chat_type: 'p2p',
      content: '你好',
      event_id: 'p2p-event-owner',
      message_id: 'om_p2p_owner',
      sender_id: 'ou_owner',
      type: 'im.message.receive_v1',
    })}\n`);
    await waitFor(() => fixture.ownerRecords.length === 1);
    expect(fixture.ownerRecords).toEqual([['bot_1', 'ou_owner']]);
    await fixture.gateway.dispose();
  });

  it('sends generated group files to the group and strips the marker from the reply', async () => {
    const fixture = await createFixture({ configured: true });
    fixture.appNameRef.value = '测试机器人';
    await mkdir(join(fixture.homeDir, 'poster_test'), { recursive: true });
    await writeFile(join(fixture.homeDir, 'poster_test', 'september.png'), 'png', 'utf8');
    fixture.replyTextRef.value = '海报已生成。\n[群文件: poster_test/september.png]';
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_group',
      chat_type: 'group',
      content: '@测试机器人 生成海报',
      event_id: 'group-event-file',
      message_id: 'om_group_file',
      sender_id: 'ou_member',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.replies.length === 2);
    expect(fixture.replies[0].args).toContain('om_group_file');
    const replyTextIndex = fixture.replies[0].args.indexOf('海报已生成。');
    expect(replyTextIndex).toBeGreaterThanOrEqual(0);
    expect(fixture.replies[0].args.join(' ')).not.toContain('[群文件:');
    expect(fixture.replies[1].args.slice(0, 8)).toEqual([
      'im', '+messages-send',
      '--chat-id', 'oc_group',
      '--image', './september.png',
      '--as', 'bot',
    ]);
    expect(isUuidLikeIdempotencyKey(
      argumentValue(fixture.replies[1].args, '--idempotency-key'),
    )).toBe(true);
    expect(groupAttachmentFailureNotices(fixture.replies)).toEqual([]);
    await fixture.gateway.dispose();
  });

  it('does not deduplicate a failed group attachment send and allows the next event to retry', async () => {
    const fixture = await createFixture({ configured: true });
    fixture.appNameRef.value = '测试机器人';
    await mkdir(join(fixture.homeDir, 'retry'), { recursive: true });
    await writeFile(join(fixture.homeDir, 'retry', 'retry.png'), 'png', 'utf8');
    fixture.replyTextRef.value = '文件如下。\n[群文件: retry/retry.png]';
    fixture.groupAttachmentFailuresRemainingRef.value = 1;
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_group',
      chat_type: 'group',
      content: '@测试机器人 第一次发送',
      event_id: 'group-retry-first',
      message_id: 'om_group_retry_first',
      message_type: 'text',
      sender_id: 'ou_member',
      type: 'im.message.receive_v1',
    })}\n`);
    await waitFor(() => fixture.succeeded.includes('group-retry-first'));

    expect(groupAttachmentSends(fixture.larkCalls)).toHaveLength(1);
    expect(groupAttachmentSends(fixture.replies)).toHaveLength(0);
    expect(groupAttachmentFailureNotices(fixture.replies)).toHaveLength(1);
    expect(infoSpy.mock.calls.some((call) => call.join(' ').includes('Sent Feishu group attachment')))
      .toBe(false);

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_group',
      chat_type: 'group',
      content: '@测试机器人 再试一次',
      event_id: 'group-retry-second',
      message_id: 'om_group_retry_second',
      message_type: 'text',
      sender_id: 'ou_member',
      type: 'im.message.receive_v1',
    })}\n`);
    await waitFor(() => fixture.succeeded.includes('group-retry-second'));

    expect(groupAttachmentSends(fixture.larkCalls)).toHaveLength(2);
    expect(groupAttachmentSends(fixture.replies)).toHaveLength(1);
    expect(infoSpy.mock.calls.filter((call) => (
      call.join(' ').includes('Sent Feishu group attachment')
    ))).toHaveLength(1);
    await fixture.gateway.dispose();
  });

  it('deduplicates an already successful attachment only within the same group', async () => {
    const fixture = await createFixture({ configured: true });
    fixture.appNameRef.value = '测试机器人';
    await mkdir(join(fixture.homeDir, 'dedupe'), { recursive: true });
    await writeFile(join(fixture.homeDir, 'dedupe', 'shared.png'), 'png', 'utf8');
    fixture.replyTextRef.value = '文件如下。\n[群文件: dedupe/shared.png]';
    await fixture.gateway.runOnce();

    for (const [eventId, messageId, chatId] of [
      ['group-dedupe-first', 'om_group_dedupe_first', 'oc_group_a'],
      ['group-dedupe-same', 'om_group_dedupe_same', 'oc_group_a'],
      ['group-dedupe-other', 'om_group_dedupe_other', 'oc_group_b'],
    ] as const) {
      fixture.children[0].stdout.write(`${JSON.stringify({
        chat_id: chatId,
        chat_type: 'group',
        content: '@测试机器人 发送文件',
        event_id: eventId,
        message_id: messageId,
        message_type: 'text',
        sender_id: 'ou_member',
        type: 'im.message.receive_v1',
      })}\n`);
      await waitFor(() => fixture.succeeded.includes(eventId));
    }

    expect(groupAttachmentSends(fixture.larkCalls)).toHaveLength(2);
    expect(groupAttachmentFailureNotices(fixture.replies)).toEqual([]);
    await fixture.gateway.dispose();
  });

  it('rejects absolute and traversal group file markers while still sending a valid marker', async () => {
    const fixture = await createFixture({ configured: true });
    fixture.appNameRef.value = '测试机器人';
    const safeDir = join(fixture.homeDir, 'safe');
    await mkdir(safeDir, { recursive: true });
    await writeFile(join(safeDir, 'safe.png'), 'safe', 'utf8');
    const traversalTarget = join(fixture.homeDir, '..', 'outside.png');
    const windowsAbsoluteTarget = join(fixture.instancesRoot, 'windows-absolute.png');
    await writeFile(traversalTarget, 'outside', 'utf8');
    await writeFile(windowsAbsoluteTarget, 'outside', 'utf8');
    const windowsAbsoluteMarker = windowsAbsoluteTarget.replace(/\\/gu, '/');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fixture.replyTextRef.value = [
      '处理完成。',
      '[群文件: /etc/passwd]',
      '[群文件: /app/storage/secrets/private.json]',
      '[群文件: ../outside.png]',
      `[群文件: ${windowsAbsoluteMarker}]`,
      '[群文件: safe/safe.png]',
    ].join('\n');
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_group',
      chat_type: 'group',
      content: '@测试机器人 发送结果',
      event_id: 'group-invalid-paths',
      message_id: 'om_group_invalid_paths',
      message_type: 'text',
      sender_id: 'ou_member',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.succeeded.includes('group-invalid-paths'));
    expect(groupAttachmentSends(fixture.replies)).toEqual([
      expect.objectContaining({
        args: expect.arrayContaining(['--image', './safe.png']),
      }),
    ]);
    expect(errorSpy.mock.calls.filter((call) => (
      call.join(' ').includes('Rejected Feishu group attachment marker')
    ))).toHaveLength(4);
    const notices = groupAttachmentFailureNotices(fixture.replies);
    expect(notices).toHaveLength(1);
    expect(notices[0].args.join(' ')).toContain('安全拒绝 4 个');
    expect(notices[0].args.join(' ')).not.toContain('/etc/passwd');
    expect(notices[0].args.join(' ')).not.toContain('private.json');
    await fixture.gateway.dispose();
  });

  it('rejects final-file and parent-directory symlinks in group file markers', async () => {
    const fixture = await createFixture({ configured: true });
    fixture.appNameRef.value = '测试机器人';
    const safeDir = join(fixture.homeDir, 'safe-links');
    const outsideDir = join(fixture.instancesRoot, 'outside-links');
    await Promise.all([
      mkdir(safeDir, { recursive: true }),
      mkdir(outsideDir, { recursive: true }),
    ]);
    await writeFile(join(safeDir, 'safe.png'), 'safe', 'utf8');
    await writeFile(join(outsideDir, 'outside.png'), 'outside', 'utf8');
    await symlink(outsideDir, join(safeDir, 'final-link.png'), 'junction');
    await symlink(outsideDir, join(fixture.homeDir, 'parent-link'), 'junction');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fixture.replyTextRef.value = [
      '处理完成。',
      '[群文件: safe-links/final-link.png]',
      '[群文件: parent-link/outside.png]',
      '[群文件: safe-links/safe.png]',
    ].join('\n');
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_group',
      chat_type: 'group',
      content: '@测试机器人 发送结果',
      event_id: 'group-symlink-paths',
      message_id: 'om_group_symlink_paths',
      message_type: 'text',
      sender_id: 'ou_member',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.succeeded.includes('group-symlink-paths'));
    expect(groupAttachmentSends(fixture.replies)).toEqual([
      expect.objectContaining({
        args: expect.arrayContaining(['--image', './safe.png']),
      }),
    ]);
    expect(errorSpy.mock.calls.filter((call) => (
      call.join(' ').includes('Rejected Feishu group attachment marker')
    ))).toHaveLength(2);
    expect(groupAttachmentFailureNotices(fixture.replies)[0].args.join(' '))
      .toContain('安全拒绝 2 个');
    await fixture.gateway.dispose();
  });

  it('accepts relative, /workspace, and exact current-Bot workspace markers', async () => {
    const fixture = await createFixture({ configured: true });
    fixture.appNameRef.value = '测试机器人';
    const files = [
      ['relative', 'relative.png'],
      ['alias', 'alias.png'],
      ['absolute', 'absolute.png'],
    ] as const;
    for (const [directory, name] of files) {
      await mkdir(join(fixture.homeDir, directory), { recursive: true });
      await writeFile(join(fixture.homeDir, directory, name), name, 'utf8');
    }
    fixture.replyTextRef.value = [
      '处理完成。',
      '[群文件: relative/relative.png]',
      '[群文件: /workspace/alias/alias.png]',
      '[群文件: /app/storage/instances/bot_1/workspace/absolute/absolute.png]',
    ].join('\n');
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_group',
      chat_type: 'group',
      content: '@测试机器人 发送结果',
      event_id: 'group-allowed-paths',
      message_id: 'om_group_allowed_paths',
      message_type: 'text',
      sender_id: 'ou_member',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.succeeded.includes('group-allowed-paths'));
    expect(groupAttachmentSends(fixture.replies).map((call) => call.args)).toEqual([
      expect.arrayContaining(['--image', './relative.png']),
      expect.arrayContaining(['--image', './alias.png']),
      expect.arrayContaining(['--image', './absolute.png']),
    ]);
    await fixture.gateway.dispose();
  });

  it('does not send recent workspace images when no explicit group file marker is present', async () => {
    const fixture = await createFixture({ configured: true });
    fixture.appNameRef.value = '测试机器人';
    await mkdir(join(fixture.homeDir, 'poster_test'), { recursive: true });
    await writeFile(join(fixture.homeDir, 'poster_test', 'september.png'), 'png', 'utf8');
    fixture.replyTextRef.value = '海报已生成：`poster_test/september.png`。';
    await fixture.gateway.runOnce();

    fixture.children[0].stdout.write(`${JSON.stringify({
      chat_id: 'oc_group',
      chat_type: 'group',
      content: '@测试机器人 生成海报',
      event_id: 'group-event-scan',
      message_id: 'om_group_scan',
      sender_id: 'ou_member',
      type: 'im.message.receive_v1',
    })}\n`);

    await waitFor(() => fixture.succeeded.includes('group-event-scan'));
    expect(fixture.replies).toHaveLength(1);
    expect(fixture.replies[0].args).toContain('海报已生成：`poster_test/september.png`。');
    await fixture.gateway.dispose();
  });

  it('restarts sessions on revision changes and stops sessions for disabled configs', async () => {
    const fixture = await createFixture({ configured: true });
    await fixture.gateway.runOnce();
    expect(fixture.spawned).toHaveLength(1);

    fixture.configs.records[0].revision += 1;
    fixture.configs.records[0].enabled = false;
    fixture.configs.configured = [];
    await fixture.gateway.runOnce();

    expect(fixture.killed).toContain('bot_1');
    expect(fixture.spawned).toHaveLength(1);
    await fixture.gateway.dispose();
  });
});

describe('splitUtf8', () => {
  it('splits strings on UTF-8 byte boundaries without breaking characters', () => {
    const chunks = splitUtf8('a'.repeat(20) + '中'.repeat(20), 10);
    expect(chunks.join('')).toBe('a'.repeat(20) + '中'.repeat(20));
    expect(chunks.every((chunk) => Buffer.byteLength(chunk, 'utf8') <= 10)).toBe(true);
  });

  it('rejects invalid max byte values', () => {
    expect(() => splitUtf8('x', 0)).toThrow('maxBytes must be a positive integer.');
  });
});

async function createFixture(input: {
  blockedDownloadMessageIds?: Set<string>;
  configured?: boolean;
  deferredDetailedTurnRequestIds?: Set<string>;
  detailedTurnErrors?: Map<string, Error>;
  failDownloadMessageIds?: Set<string>;
  failLarkIdempotencyKeys?: Set<string>;
} = {}) {
  const instancesRoot = await mkdtemp(join(tmpdir(), 'weiling-feishu-gateway-'));
  tempDirs.push(instancesRoot);
  const homeDir = join(instancesRoot, 'bot_1', 'workspace');
  await mkdir(homeDir, { recursive: true });

  const config: SupervisorConfig = {
    databaseUrl: 'file::memory:',
    fastagentBinaryPath: 'fastagent',
    internalApiToken: 'token',
    internalPort: 8790,
    instancesRoot,
    larkConfigRoot: instancesRoot,
    larkCliPath: 'lark-cli',
    mockFastAgentFixturePath: 'mock',
    reconcileIntervalMs: 2000,
    reconcileStallTimeoutMs: 120000,
    sandboxApiKey: null,
    sandboxMode: 'remote',
    sandboxUrl: null,
    srtPoolConfigFile: null,
    srtPoolDefaults: null,
    srtPoolStatusFile: null,
    srtServiceHost: null,
    srtWorkspaceMapDir: null,
    workspaceRoot: instancesRoot,
  };

  const configs = {
    configured: input.configured
      ? [{
        appId: 'cli_app-one',
        appSecret: 'secret-one',
        botInstanceId: 'bot_1',
        createdAt: new Date(),
        enabled: true,
        eventStatus: 'connecting',
        lastConnectedAt: null,
        lastDisconnectedAt: null,
        lastError: null,
        lastInboundAt: null,
        lastOutboundAt: null,
        observedRevision: null,
        ownerOpenId: null,
        revision: 1,
        updatedAt: new Date(),
        updatedByUserId: null,
      }]
      : [],
    records: input.configured
      ? [{
        appId: 'cli_app-one',
        appSecret: 'secret-one',
        botInstanceId: 'bot_1',
        createdAt: new Date(),
        enabled: true,
        eventStatus: 'connecting',
        lastConnectedAt: null,
        lastDisconnectedAt: null,
        lastError: null,
        lastInboundAt: null,
        lastOutboundAt: null,
        observedRevision: null,
        ownerOpenId: null,
        revision: 1,
        updatedAt: new Date(),
        updatedByUserId: null,
      }]
      : [],
    upserted: [] as Array<Record<string, unknown>>,
  };
  const statuses: Array<Record<string, unknown>> = [];
  const inboundActivity: string[] = [];
  const outboundActivity: string[] = [];
  const externalTurns: string[][] = [];
  const detailedTurns: Array<{
    botInstanceId: string;
    options: {
      denyTools?: string[];
      sessionId?: string;
      sessionKey?: string;
      systemPrompt?: string;
      timeoutMs?: number;
    };
    requestId: string;
    text: string;
  }> = [];
  const succeeded: string[] = [];
  const failed: string[][] = [];
  const replies: Array<{ args: string[] }> = [];
  const larkCalls: Array<{ args: string[] }> = [];
  const groupAttachmentFailuresRemainingRef = { value: 0 };
  const downloads: RunLarkCliOnceInput[] = [];
  const downloadStarted = new Set<string>();
  const downloadResolvers = new Map<string, () => void>();
  const blockedDownloadMessageIds = input.blockedDownloadMessageIds ?? new Set<string>();
  const deferredDetailedTurnRequestIds = input.deferredDetailedTurnRequestIds ?? new Set<string>();
  const detailedTurnResolvers = new Map<string, () => void>();
  const failDownloadMessageIds = input.failDownloadMessageIds ?? new Set<string>();
  const failLarkIdempotencyKeys = input.failLarkIdempotencyKeys ?? new Set<string>();
  const spawned: Array<{ args: string[] }> = [];
  const children: FakeChild[] = [];
  const killed: string[] = [];
  const pendingEvents = new Set<string>();
  const ownerRecords: string[][] = [];
  const appNameRef = { value: null as string | null };
  const replyTextRef = { value: '' };
  const groupSessions = {
    upserted: [] as Array<[string, string, string]>,
    find: async (botInstanceId: string, chatId: string) => {
      const match = groupSessions.upserted.find(
        ([bot, chat]) => bot === botInstanceId && chat === chatId,
      );
      return match ? { sessionId: match[2] } : null;
    },
    upsert: async (botInstanceId: string, chatId: string, sessionId: string) => {
      groupSessions.upserted.push([botInstanceId, chatId, sessionId]);
    },
  };

  const gateway = new FeishuChannelGateway({
    botInstances: {
      listAllForAdministration: async () => [{ id: 'bot_1' } as never],
    },
    config,
    configs: {
      ensure: async (botInstanceId: string) => ({ botInstanceId } as never),
      findByBotInstanceId: async (botInstanceId: string) => (
        configs.records.find((record) => record.botInstanceId === botInstanceId) ?? null
      ),
      listConfigured: async () => configs.configured as never,
      recordActivity: async (input: { botInstanceId: string; inboundAt?: Date; outboundAt?: Date }) => {
        if (input.inboundAt) inboundActivity.push(input.botInstanceId);
        if (input.outboundAt) outboundActivity.push(input.botInstanceId);
      },
      recordOwnerOpenId: async (botInstanceId: string, ownerOpenId: string) => {
        ownerRecords.push([botInstanceId, ownerOpenId]);
      },
      recordEventStatus: async (input: Record<string, unknown>) => {
        statuses.push(input);
      },
      update: async (input: Record<string, unknown>) => {
        configs.upserted.push(input);
        const record = {
          ...configs.records[0],
          appId: String(input.appId),
          appSecret: String(input.appSecret),
          botInstanceId: String(input.botInstanceId),
          enabled: Boolean(input.enabled),
          revision: 2,
        };
        configs.records = [record];
        configs.configured = [record];
        return record as never;
      },
    } as never,
    groupSessions: groupSessions as never,
    events: {
      markFailed: async (eventId: string, error: string) => {
        failed.push([eventId, error]);
      },
      markSucceeded: async (eventId: string) => {
        succeeded.push(eventId);
      },
      tryAccept: async (input: { eventId: string }) => {
        if (succeeded.includes(input.eventId)) return 'succeeded';
        if (pendingEvents.has(input.eventId)) return 'processing';
        pendingEvents.add(input.eventId);
        return 'claimed';
      },
    } as never,
    messageCopy: {
      getCopy: async () => DEFAULT_GLOBAL_ADMIN_MESSAGE_COPY,
    },
    now: () => new Date('2026-08-31T10:00:00.000Z'),
    processManager: {
      runExternalTurn: async (botInstanceId: string, requestId: string, text: string) => {
        externalTurns.push([botInstanceId, requestId, text]);
        return `reply to ${text}`;
      },
      runExternalTurnDetailed: async (
        botInstanceId: string,
        requestId: string,
        text: string,
        options: {
          denyTools?: string[];
          sessionId?: string;
          sessionKey?: string;
          systemPrompt?: string;
          timeoutMs?: number;
        } = {},
      ) => {
        detailedTurns.push({ botInstanceId, options, requestId, text });
        const error = input.detailedTurnErrors?.get(requestId);
        if (error) throw error;
        if (deferredDetailedTurnRequestIds.has(requestId)) {
          await new Promise<void>((resolve) => {
            detailedTurnResolvers.set(requestId, resolve);
          });
        }
        return {
          sessionId: options.sessionId ?? 'group-session-1',
          text: replyTextRef.value || `${options.sessionKey ? 'group ' : ''}reply to ${text}`,
        };
      },
    },
    resolveBotAppName: async () => appNameRef.value,
    runLarkCapture: async (download) => {
      downloads.push(download);
      const messageId = argumentValue(download.args, '--message-id');
      const resourceType = argumentValue(download.args, '--type');
      const output = argumentValue(download.args, '--output');
      downloadStarted.add(messageId);
      if (blockedDownloadMessageIds.has(messageId)) {
        await new Promise<void>((resolve) => {
          downloadResolvers.set(messageId, resolve);
        });
      }
      if (failDownloadMessageIds.has(messageId)) {
        throw new Error('permission denied');
      }
      if (!download.cwd) throw new Error('download cwd missing');
      const extension = extname(output) || (resourceType === 'image' ? '.png' : '.bin');
      const savedName = extname(output) ? output : `${output}${extension}`;
      const savedPath = join(download.cwd, savedName.replace(/^\.\//u, ''));
      await writeFile(savedPath, 'attachment', 'utf8');
      return JSON.stringify({ saved_path: savedPath, size_bytes: 10 });
    },
    runLarkOnce: async (input: { args: string[] }) => {
      larkCalls.push({ args: input.args });
      const idempotencyKeyIndex = input.args.indexOf('--idempotency-key');
      const idempotencyKey = idempotencyKeyIndex >= 0
        ? input.args[idempotencyKeyIndex + 1]
        : undefined;
      if (
        idempotencyKey
        && (failLarkIdempotencyKeys.has(idempotencyKey) || failLarkIdempotencyKeys.has('*'))
      ) {
        throw new Error('progress update send failed');
      }
      if (
        (input.args.includes('--image') || input.args.includes('--file'))
        && groupAttachmentFailuresRemainingRef.value > 0
      ) {
        groupAttachmentFailuresRemainingRef.value -= 1;
        throw new Error('group attachment send failed');
      }
      replies.push({ args: input.args });
    },
    spawnLark: (input: { args: string[] }) => {
      spawned.push({ args: input.args });
      const child = new FakeChild();
      const originalKill = child.kill.bind(child);
      child.kill = (signal?: NodeJS.Signals) => {
        killed.push('bot_1');
        return originalKill(signal);
      };
      children.push(child);
      return child as unknown as ChildProcess;
    },
  });

  return {
    appNameRef,
    children,
    configs,
    detailedTurns,
    downloadStarted,
    downloads,
    externalTurns,
    failed,
    gateway,
    groupAttachmentFailuresRemainingRef,
    homeDir,
    instancesRoot,
    inboundActivity,
    killed,
    larkCalls,
    ownerRecords,
    larkHomeDir: join(instancesRoot, 'bot_1'),
    replyTextRef,
    outboundActivity,
    replies,
    spawned,
    statuses,
    succeeded,
    groupSessions,
    releaseDownload: (messageId: string) => {
      const release = downloadResolvers.get(messageId);
      if (!release) throw new Error(`Download is not blocked: ${messageId}`);
      blockedDownloadMessageIds.delete(messageId);
      downloadResolvers.delete(messageId);
      release();
    },
    releaseDetailedTurn: (requestId: string) => {
      const release = detailedTurnResolvers.get(requestId);
      if (!release) throw new Error(`Detailed turn is not deferred: ${requestId}`);
      deferredDetailedTurnRequestIds.delete(requestId);
      detailedTurnResolvers.delete(requestId);
      release();
    },
  };
}

function argumentValue(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing argument: ${flag}`);
  return args[index + 1];
}

function groupAttachmentSends(replies: Array<{ args: string[] }>): Array<{ args: string[] }> {
  return replies.filter(({ args }) => args.includes('--image') || args.includes('--file'));
}

function groupAttachmentFailureNotices(
  replies: Array<{ args: string[] }>,
): Array<{ args: string[] }> {
  return replies.filter(({ args }) => args.some((arg) => arg.includes('群文件未发送')));
}

function progressUpdateCalls(
  calls: Array<{ args: string[] }>,
): Array<{ args: string[] }> {
  return calls.filter(({ args }) => args.some((arg) => arg.startsWith('小灵进度：')));
}

function isUuidLikeIdempotencyKey(value: string): boolean {
  return /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(value);
}

async function flushAsyncWork(): Promise<void> {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: number | null = null;
  readonly stderr: PassThrough = new PassThrough();
  readonly stdout: PassThrough = new PassThrough();

  kill(signal?: NodeJS.Signals): boolean {
    this.exitCode = 0;
    this.signalCode = signal === 'SIGKILL' ? 9 : null;
    setImmediate(() => {
      this.emit('exit', this.exitCode, this.signalCode);
    });
    return true;
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
