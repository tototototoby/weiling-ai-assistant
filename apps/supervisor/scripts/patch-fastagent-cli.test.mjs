import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  patchFastAgentCliSource,
  patchFastAgentCliV23ToV24Source,
  patchFastAgentCliV24ToV25Source,
  patchFastAgentCliV25ToV26Source,
  V21_EXTERNAL_TURN_AFTER,
  V21_EXTERNAL_TURN_BEFORE,
  V22_WECHAT_MEDIA_MERGE_HELPERS,
  V23_CONTEXT_AFTER,
  V23_CONTEXT_BEFORE,
  V23_GROUP_SESSION_HANDLER_AFTER,
  V23_RUN_TURN_AFTER,
  V23_RUN_TURN_BEFORE,
  V24_EXECUTION_VISIBLE_TOOL_GUARD_ANCHOR,
  V24_EXTERNAL_TURN_HANDLER_AFTER,
  V24_MODEL_VISIBLE_TOOL_FILTER_ANCHOR,
  V24_RUN_TURN_AFTER,
  V25_SANDBOX_ENSURE_CONNECTED_BEFORE,
  V25_SANDBOX_ENSURE_CONNECTED_AFTER,
  V26_OPENCODE_SESSION_HEADER_AFTER,
  V26_OPENCODE_SESSION_HEADER_BEFORE,
  V26_OPENCODE_SESSION_RUNTIME_BRIDGE_AFTER,
  V26_OPENCODE_SESSION_RUNTIME_BRIDGE_BEFORE,
} from './patch-fastagent-cli.mjs';

const require = createRequire(import.meta.url);

const V20_WELCOME_SOURCE =
  'Cc0=["欢迎使用 **FastAgent**，我会继续处理你刚才的消息。","我可以帮你处理文件和命令、调用各种工具，并支持长对话整理、记忆、定时任务和任务管理。","你可以直接描述需求、布置各类任务。当前内置命令有：","- **/new**：开启新会话","- **/sessions**：查看当前 IM 对话的历史会话","- **/switch <编号>**：切换到已有历史会话","- **/abort**：中止当前进行中的任务","- **/context**：查看当前上下文用量","- **/compact**：手动上下文压缩（默认自动压缩）","- **/dream**：手动触发一次记忆整理（自动 dream 仍在后台执行）"].join(`\n`)';
const V20_WELCOME_PATCHED =
  'Cc0=`欢迎使用${process.env.WECLAWS_ASSISTANT_NAME?.trim()||"微Link · 微灵 AI 助手"}。`';
const V20_ATTACHMENT_SOURCE =
  'D=await this.persistInboundAttachments(Q),L=await Qu0(Q,D,Z);if(!this.hasRuntimeInput(L)&&this.shouldShortCircuitWithAttachmentReceipt(D))';
const V20_ATTACHMENT_PATCHED =
  'D=await this.persistInboundAttachments(Q),L=await Qu0(Q,D,Z);{let weclawsFiles=D.filter((i)=>i.kind==="file"||i.kind==="image");if(weclawsFiles.length>0){let weclawsReference=this.buildAttachmentReferenceText(weclawsFiles);if(L.prompt){let weclawsFirstText=L.prompt[0]?.type==="text"?L.prompt[0]:void 0,weclawsText=weclawsFirstText?.text&&weclawsFirstText.text!==_Z6?`${weclawsFirstText.text}\\n\\n${weclawsReference}`:weclawsReference;L={...L,prompt:[{type:"text",text:weclawsText},...L.prompt.slice(weclawsFirstText?1:0)]}}else L={...L,userMessage:L.userMessage?`${L.userMessage}\\n\\n${weclawsReference}`:weclawsReference}}}if(!this.hasRuntimeInput(L)&&this.shouldShortCircuitWithAttachmentReceipt(D))';
const V23_TIME_CONTEXT_SOURCE =
  'Rf={name:"time",priority:70,condition($){return!!$.userTimezone},build($){let J=["## Current Date & Time",`Time zone: ${$.userTimezone}`];return J.push("If you need the current date, time, or day of week, use the session_status tool."),J}}})';
const V23_TIME_CONTEXT_PATCHED =
  'Rf={name:"time",priority:70,condition($){return true},build($){let J=["## Current Date & Time",`Time zone: ${$.userTimezone||"Asia/Shanghai"}`];return J.push(`Current date and time: ${new Date().toLocaleString("zh-CN",{timeZone:$.userTimezone||"Asia/Shanghai",dateStyle:"full",timeStyle:"short"})}`),J.push("If you need the current date, time, or day of week, use the session_status tool."),J}}})';

const V22_MERGE_STATE_SOURCE =
  'liveManualDreamTasks=new Map;constructor($){this.dependencies=$;let J=$.singleFlightGuard??new VD;';
const V22_STEER_CALL_SOURCE =
  'if((await this.tryAttachSteerTurn({binding:j,messageKey:H,normalizedInput:P.normalizedInput,timestampMs:G.timestampMs,conversationRunState:T})).attached)return{outcome:"queued",bindingId:j.bindingId};let v=await this.dependencies.conversationQueueStore.appendEnqueued({type:"queue_item_enqueued",queueItemId:KD(),conversationKey:j.bindingIdentityKey,bindingId:j.bindingId,sessionId:j.sessionId,activationId:j.activationId,sourceInboundIds:[H],kind:P.kind==="follow_up"?"follow_up":"user_message",normalizedInput:P.normalizedInput,priority:1,enqueueTime:G.timestampMs});';
const V22_STEER_BODY_SOURCE =
  'async tryAttachSteerTurn($){if(this.dependencies.runAdmissionMode!=="steer")return{attached:!1};let J=$.conversationRunState.runningWork;if(!J)return{attached:!1};try{if(!(await this.dependencies.runtimeBridge.steerTurn($.binding,{runId:J.run.runId,message:$.normalizedInput})).accepted)return{attached:!1}}catch{return{attached:!1}}';
const V22_KIND_SOURCE =
  'describeAttachmentKind($){return $.mimeType.toLowerCase().startsWith("video/")?"视频":"文件"}';
const V22_KIND_PATCHED =
  'describeAttachmentKind($){return $.mimeType.toLowerCase().startsWith("video/")?"视频":$.mimeType.toLowerCase().startsWith("image/")?"图片":"文件"}';
const V22_REF_SINGLE_SOURCE =
  '我上传了${this.describeAttachmentKind(Q)} ${X}，已保存到：${Q.path}。如果后续需要查阅，请按这个路径读取。';
const V22_REF_SINGLE_PATCHED =
  '用户发来了${this.describeAttachmentKind(Q)} ${X}，已保存到：${Q.path}。请立即读取并处理：图片请调用 qwen-vision 技能识别内容，文档请用 office-files 技能解析文本。';
const V22_REF_MULTI_SOURCE = '如果后续需要查阅，请按这些路径读取。`}describeAttachmentKind($){';
const V22_REF_MULTI_PATCHED =
  '请立即按这些路径读取：图片调用 qwen-vision 技能识别，文档用 office-files 技能解析。`}describeAttachmentKind($){';

const V23_RUN_TURN_SOURCE = V23_RUN_TURN_BEFORE;
const V23_CONTEXT_SOURCE = V23_CONTEXT_BEFORE;

const V26_OPENCODE_SESSION_HEADER_SOURCE = V26_OPENCODE_SESSION_HEADER_BEFORE;
const V26_OPENCODE_SESSION_HEADER_PATCHED = V26_OPENCODE_SESSION_HEADER_AFTER;
const V26_OPENCODE_SESSION_RUNTIME_BRIDGE_SOURCE = V26_OPENCODE_SESSION_RUNTIME_BRIDGE_BEFORE;
const V26_OPENCODE_SESSION_RUNTIME_BRIDGE_PATCHED = V26_OPENCODE_SESSION_RUNTIME_BRIDGE_AFTER;

const SOURCE = [
  'async updateActivity($){await this.request("POST",`/sessions/${$}/activity`)}',
  '_G6=["temporarily unavailable","try again later","timeout","timed out","econnreset","socket hang up","network error"]',
  'return J.includes("temporarily unavailable")||J.includes("try again later")}',
  'if(J.includes("timeout")||J.includes("etimedout")||J.includes("econnreset"))return"timeout";',
  'function wx($,J){let X={auth_failure:30000,rate_limit:30000,context_overflow:0,unsupported_image_input:0,timeout:30000,network_error:30000,model_unavailable:0,unknown:30000}[$];',
  'Cc0,xc0=1000,Sc0=15000,Tc0=60000,Ac0,Ic0=30000,wc0,Ec0=8,Pc0,bc0,vc0,N60=3,kc0=2000,gc0=30000',
  'vc0=[30000,60000,60000]',
  'async getBotQrcode($){let J=await this.getJson(`ilink/bot/get_bot_qrcode?bot_type=${mD6}`,$,dD6);return{qrCodeId:J.qrcode??"",qrCodeUrl:J.qrcode_img_content??""}}',
  'var mD6="3",lD6="0.0.1",dD6=5000,pD6=35000,VL=15000,iD6=1e4,nD6=35000,Ys0=-14',
  'function mZ6($,J,Q,X){if(!$)return!0;if(J.phase==="tool_running"||J.phase==="tool_text_progress"||J.phase==="tool_family_progress")return!1;if(J.phase==="retrying")return Q<1;if(Vu0(J))return X<1;return!0}',
  'k=this.runDelayedHiddenAckPacing(T,yJ(H,v.signal))',
  'async runDelayedHiddenAckPacing($,J){try{if(await this.dependencies.wait(xc0,J),this.dependencies.isStopped()||J?.aborted)return;$.markDelivered("ack",Date.now())}catch(Q){if(!c$(Q));}}',
  V20_WELCOME_SOURCE,
  'Y=new l80({bindingStore:X,resolveAccount:(W0)=>Ht0(W0,G,Z),deliveryOrchestrator:k});',
  'async function MP($,J={}){let Q=$.host,X,G,Z,Y,H=new d2',
  'runtimeBridge:new ZD(s,W),inboundMessageStore:j',
  'async resolveScheduledInboundResult($,J,Q,X,G){try{return await $}catch(Z){return this.mapScheduledInboundError(Z,J,Q,X,G)}}',
  V20_ATTACHMENT_SOURCE,
  V23_TIME_CONTEXT_SOURCE,
  V22_MERGE_STATE_SOURCE,
  V22_STEER_CALL_SOURCE,
  V22_STEER_BODY_SOURCE,
  V22_KIND_SOURCE,
  V22_REF_SINGLE_SOURCE,
  V22_REF_MULTI_SOURCE,
  V23_RUN_TURN_SOURCE,
  V23_CONTEXT_SOURCE,
  V24_MODEL_VISIBLE_TOOL_FILTER_ANCHOR,
  V24_EXECUTION_VISIBLE_TOOL_GUARD_ANCHOR,
  V25_SANDBOX_ENSURE_CONNECTED_BEFORE,
  V26_OPENCODE_SESSION_HEADER_SOURCE,
  V26_OPENCODE_SESSION_RUNTIME_BRIDGE_SOURCE,
].join(';');

const V20_MESSAGE_COPY_IPC =
  'process.on("message",async(W0)=>{if(W0&&typeof W0==="object"&&W0.type==="weclaws_message_copy"){if(typeof W0.assistantName==="string"&&W0.assistantName.trim())process.env.WECLAWS_ASSISTANT_NAME=W0.assistantName.trim();if(typeof W0.processingAck==="string"&&W0.processingAck.trim())process.env.WECLAWS_PROCESSING_ACK=W0.processingAck.trim()}});';

function mergeFileAttachmentInputFromPatchedSource(patchedSource, runtimeInput, attachments) {
  const blockStart = patchedSource.indexOf('{let weclawsFiles=');
  const blockEnd = patchedSource.indexOf('if(!this.hasRuntimeInput(L)', blockStart);
  if (blockStart < 0 || blockEnd < 0) throw new Error('Patched attachment merge block not found.');

  const mergeBlock = patchedSource.slice(blockStart, blockEnd);
  const runMerge = new Function('L', 'D', '_Z6', `${mergeBlock};return L;`);
  return runMerge.call(
    {
      buildAttachmentReferenceText(files) {
        return `FILES:${files.map((file) => file.path).join(',')}`;
      },
    },
    runtimeInput,
    attachments,
    '[Image]',
  );
}

function createV24RunTurnHarness(toolNames) {
  const methodPrefix = 'async runTurn($,J){';
  if (!V24_RUN_TURN_AFTER.startsWith(methodPrefix) || !V24_RUN_TURN_AFTER.endsWith('}')) {
    throw new Error('Unexpected V24 runTurn source shape.');
  }
  const methodBody = V24_RUN_TURN_AFTER.slice(methodPrefix.length, -1);
  let nextRunId = 0;
  const runtime = {
    sessionEnvironment: {
      toolView: {
        getVisible: () => toolNames.map((name) => ({ name })),
      },
    },
    sessionId: 'session_1',
  };
  const bridge = {
    getOrLoadRuntime: async () => runtime,
    runs: new Map(),
  };
  const runTurn = new Function(
    'DG6',
    'MG6',
    `return async function($,J){${methodBody}};`,
  )(
    () => `run_${++nextRunId}`,
    (input) => ({
      ...(input.userMessage !== undefined ? { userMessage: input.userMessage } : {}),
      ...(input.prompt ? { prompt: [...input.prompt] } : {}),
    }),
  );
  return {
    bridge,
    runTurn: (input) => runTurn.call(bridge, { sessionId: 'session_1' }, input),
    runtime,
  };
}

function createV25EnsureConnectedHarness({ authenticated = false, connected = true, authOutcome = 'pending' } = {}) {
  const methodPrefix = 'async ensureConnected($){';
  if (!V25_SANDBOX_ENSURE_CONNECTED_AFTER.startsWith(methodPrefix) || !V25_SANDBOX_ENSURE_CONNECTED_AFTER.endsWith('}')) {
    throw new Error('Unexpected V25 ensureConnected source shape.');
  }
  const methodBody = V25_SANDBOX_ENSURE_CONNECTED_AFTER.slice(methodPrefix.length, -1);
  let authCalls = 0;
  let resolveAuth;
  let rejectAuth;
  const authPromise = new Promise((resolve, reject) => {
    resolveAuth = resolve;
    rejectAuth = reject;
  });
  const client = {
    connected,
    authenticated,
    isConnected() {
      return this.connected;
    },
    authenticate() {
      authCalls += 1;
      if (authOutcome === 'success') {
        this.authenticated = true;
        return Promise.resolve({ success: true });
      }
      if (authOutcome === 'failure') return Promise.reject(new Error('auth failed'));
      return authPromise.then((result) => {
        this.authenticated = true;
        return result;
      });
    },
  };
  const registry = {
    client,
    connectedUserId: 'user_1',
    connecting: null,
    config: { apiKey: 'test-key' },
    doConnect: async (userId) => {
      client.connected = true;
      client.authenticated = true;
      registry.connectedUserId = userId;
    },
  };
  const ensureConnected = new Function(
    `return async function($){${methodBody}};`,
  )();
  return {
    registry,
    ensureConnected: (userId) => ensureConnected.call(registry, userId),
    get authCalls() {
      return authCalls;
    },
    resolveAuth,
    rejectAuth,
  };
}

describe('patchFastAgentCliSource', () => {
  it('patches activity requests, retryable fetch failures, and slow-turn acknowledgement', () => {
    const patched = patchFastAgentCliSource(SOURCE);

    expect(patched).toContain(
      'async updateActivity($){await this.request("POST",`/sessions/${$}/activity`,{})}',
    );
    expect(patched).toContain('"network error","fetch failed"');
    expect(patched).toContain(
      'J.includes("try again later")||J.includes("fetch failed")',
    );
    expect(patched).toContain(
      'J.includes("timeout")||J.includes("timed out")||J.includes("etimedout")',
    );
    expect(patched).toContain('timeout:2000,network_error:3000');
    expect(patched).toContain('Ic0=12000');
    expect(patched).toContain('vc0=[12000,30000,60000]');
    expect(patched).toContain('for(let Q=0;Q<3;Q++)');
    expect(patched).toContain('500*(Q+1)');
    expect(patched).toContain('dD6=15000,pD6=35000');
    expect(patched).toContain(
      '/^(mcp|web|skill|task|cron|agent_run)(:|$)/.test(J.detail)',
    );
    expect(patched).toContain(
      'if(J.phase==="tool_running"||J.phase==="tool_text_progress")return!1',
    );
    expect(patched).toContain(
      'k=this.runDelayedVisibleAckPacing($,J,Q,X,Y,T,yJ(H,v.signal))',
    );
    expect(patched).toContain(V20_WELCOME_PATCHED);
    expect(patched).toContain('process.env.WECLAWS_PROCESSING_ACK||"收到，我是微Link，正在处理，完成后把结果发给你。"');
    expect(patched).toContain('W0.type==="weclaws_message_copy"');
    expect(patched).toContain('process.env.WECLAWS_ASSISTANT_NAME=W0.assistantName.trim()');
    expect(patched).toContain('process.env.WECLAWS_PROCESSING_ACK=W0.processingAck.trim()');
    expect(patched).toContain(V20_ATTACHMENT_PATCHED);
    expect(patched).toContain('Current date and time:');
    expect(patched).toContain('condition($){return true}');
    expect(patched).toContain('$.userTimezone||"Asia/Shanghai"');
    expect(patched).toContain('`ack:${X}:processing:v1`');
    expect(patched).toContain('W0.type!=="weclaws_admin_message"');
    expect(patched).toContain('S0.length!==1');
    expect(patched).toContain('R0=Ht0(e.accountId,G,Z)??{accountId:e.accountId}');
    expect(patched).toContain('M.listByConversation(e.bindingIdentityKey)');
    expect(patched).toContain('semanticKey:A0');
    expect(patched).toContain('scope:"direct"');
    expect(patched).toContain('W0.semanticKey');
    expect(patched).toContain('W0.type!=="weclaws_external_turn"');
    expect(patched).toContain(
      'weclawsRuntimeBridge.runTurn(e2,{userMessage:C0,systemPrompt:G0||void 0,denyTools:N0})',
    );
    expect(patched).toContain('await weclawsRuntimeBridge.subscribeProgress(null,T0.runId,');
    expect(patched).toContain('type:"weclaws_external_turn_event"');
    expect(patched).toContain('typeof W0.forwardEvents==="boolean"');
    expect(patched).toContain('weclawsRuntimeBridge,H=new d2');
    expect(patched).toContain('runtimeBridge:weclawsRuntimeBridge=new ZD(s,W)');
    expect(patched).toContain(
      'try{process.send?.({type:"weclaws_user_active"},()=>{})}catch{}return Z',
    );
    expect(patched).toContain('pendingWeixinMerge=new Map;constructor($)');
    expect(patched).toContain('weclawsMergeWindowInbound($,j,J,H,G,V,X,P.normalizedInput)');
    expect(patched).toContain('conversationRunState:T,inbound:J');
    expect(patched).toContain('WECLAWS_WECHAT_MERGE_WINDOW_MS||2000');
    expect(patched).toContain('weclawsPersistSteerAttachments($.inbound)');
    expect(patched).toContain('用户补发了');
    expect(patched).toContain('请按这些路径读取');
    expect(patched).toContain(V22_KIND_PATCHED);
    expect(patched).toContain(V22_REF_SINGLE_PATCHED);
    expect(patched).toContain(V22_REF_MULTI_PATCHED);
    expect(patched).toContain('weclawsRuntimeBridge.ensureSession(e2)');
    expect(patched).toContain('sessionId:F1');
    expect(patched).toContain('typeof W0.sessionId==="string"');
    expect(patched).toContain('typeof W0.systemPrompt==="string"');
    expect(patched).toContain('systemPrompt:G0||void 0');
    expect(patched).toContain('W0.denyTools');
    expect(patched).toContain('Q?.sessionEnvironment?.toolView');
    expect(patched).toContain('visibleToolNames:I0');
    expect(patched).toContain('injectedMessages:[...W0,...(J?.context?.injectedMessages??[])]');
    expect(patched).toContain('context:{traceId:$,...J.input?.context}');
    expect(patched).toContain(V25_SANDBOX_ENSURE_CONNECTED_AFTER);
    expect(patched).toContain(V26_OPENCODE_SESSION_HEADER_PATCHED);
    expect(patched).toContain(V26_OPENCODE_SESSION_RUNTIME_BRIDGE_PATCHED);
  });

  it('returns quickly for an already connected and authenticated sandbox client', async () => {
    const harness = createV25EnsureConnectedHarness({ authenticated: true });

    await harness.ensureConnected('user_1');

    expect(harness.authCalls).toBe(0);
  });

  it('waits for and starts one authentication recovery when connected but unauthenticated', async () => {
    const harness = createV25EnsureConnectedHarness();
    const pending = harness.ensureConnected('user_1');

    expect(harness.authCalls).toBe(1);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    harness.resolveAuth({ success: true });
    await pending;
    expect(settled).toBe(true);
    expect(harness.registry.client.authenticated).toBe(true);
  });

  it('coalesces concurrent authentication recovery calls', async () => {
    const harness = createV25EnsureConnectedHarness();
    const first = harness.ensureConnected('user_1');
    const second = harness.ensureConnected('user_1');

    expect(harness.authCalls).toBe(1);
    harness.resolveAuth({ success: true });
    await Promise.all([first, second]);
    expect(harness.authCalls).toBe(1);
  });

  it('reuses authentication already started by a Socket.IO reconnect', async () => {
    const harness = createV25EnsureConnectedHarness({ authenticated: true });

    await harness.ensureConnected('user_1');
    harness.registry.client.authenticated = false;

    const reconnectAuthentication = harness.registry.client.authenticate('user_1', 'test-key');
    const ensuredConnection = harness.ensureConnected('user_1');
    const sameAuthentication = harness.registry.client.authenticate('user_1', 'test-key');

    expect(sameAuthentication).toBe(reconnectAuthentication);
    expect(harness.authCalls).toBe(1);

    harness.resolveAuth({ success: true });
    await Promise.all([reconnectAuthentication, ensuredConnection]);
    expect(harness.registry.client.authenticated).toBe(true);
    expect(harness.authCalls).toBe(1);
  });

  it('propagates authentication recovery failure', async () => {
    const harness = createV25EnsureConnectedHarness({ authOutcome: 'failure' });

    await expect(harness.ensureConnected('user_1')).rejects.toThrow('auth failed');
    expect(harness.authCalls).toBe(1);
  });

  it('denies tools for only one run without mutating the persistent session tool view', async () => {
    const harness = createV24RunTurnHarness(['read', 'send_im', 'send_im_media', 'bash']);

    await harness.runTurn({
      denyTools: ['send_im', 'send_im_media'],
      userMessage: 'feishu p2p',
    });
    await harness.runTurn({ userMessage: 'weixin' });

    const trackedRuns = [...harness.bridge.runs.values()];
    expect(trackedRuns[0].input.context.visibleToolNames).toEqual(['read', 'bash']);
    expect(trackedRuns[1].input.context.visibleToolNames).toBeUndefined();
    expect(harness.runtime.sessionEnvironment.toolView.getVisible().map((tool) => tool.name)).toEqual([
      'read',
      'send_im',
      'send_im_media',
      'bash',
    ]);
  });

  it('intersects an existing visible-tool list and never expands it', async () => {
    const harness = createV24RunTurnHarness(['read', 'bash', 'send_im_media']);

    await harness.runTurn({
      context: { visibleToolNames: ['read', 'send_im_media'] },
      denyTools: ['send_im_media'],
      userMessage: 'feishu p2p',
    });

    const trackedRun = [...harness.bridge.runs.values()][0];
    expect(trackedRun.input.context.visibleToolNames).toEqual(['read']);
  });

  it('fails closed when a deny request cannot inspect a trusted runtime tool view', async () => {
    const harness = createV24RunTurnHarness(['read']);
    delete harness.runtime.sessionEnvironment.toolView;

    await expect(harness.runTurn({
      denyTools: ['send_im_media'],
      userMessage: 'feishu p2p',
    })).rejects.toThrow('trusted tool view unavailable');
    expect(harness.bridge.runs).toHaveLength(0);
  });

  it('passes a pure file attachment into the runtime as a user message', () => {
    const patched = patchFastAgentCliSource(SOURCE);

    expect(
      mergeFileAttachmentInputFromPatchedSource(patched, {}, [
        { kind: 'file', path: '/workspace/report.pdf' },
      ]),
    ).toEqual({ userMessage: 'FILES:/workspace/report.pdf' });
  });

  it('appends file references to accompanying text before entering the runtime', () => {
    const patched = patchFastAgentCliSource(SOURCE);

    expect(
      mergeFileAttachmentInputFromPatchedSource(
        patched,
        { userMessage: '请总结这个文件' },
        [{ kind: 'file', path: '/workspace/report.docx' }],
      ),
    ).toEqual({ userMessage: '请总结这个文件\n\nFILES:/workspace/report.docx' });
  });

  it('keeps image prompt parts while adding file references', () => {
    const patched = patchFastAgentCliSource(SOURCE);
    const imagePart = { type: 'image', data: 'image-data' };

    expect(
      mergeFileAttachmentInputFromPatchedSource(
        patched,
        { prompt: [{ type: 'text', text: '[Image]' }, imagePart] },
        [{ kind: 'file', path: '/workspace/notes.txt' }],
      ),
    ).toEqual({
      prompt: [{ type: 'text', text: 'FILES:/workspace/notes.txt' }, imagePart],
    });
  });

  it('adds file references for image attachments alongside the image part', () => {
    const patched = patchFastAgentCliSource(SOURCE);
    const imagePart = { type: 'image', data: 'image-data' };

    expect(
      mergeFileAttachmentInputFromPatchedSource(
        patched,
        { prompt: [{ type: 'text', text: '解读一下' }, imagePart] },
        [{ kind: 'image', path: '/workspace/photo.png' }],
      ),
    ).toEqual({
      prompt: [
        { type: 'text', text: '解读一下\n\nFILES:/workspace/photo.png' },
        imagePart,
      ],
    });
  });

  it('fails closed when the installed FastAgent source no longer matches', () => {
    expect(() => patchFastAgentCliSource(SOURCE.replace('network error', 'network issue'))).toThrow(
      /v19 baseline/,
    );
  });

  it('fails closed instead of patching an already modified dependency twice', () => {
    const patched = patchFastAgentCliSource(SOURCE);

    expect(() => patchFastAgentCliSource(patched)).toThrow(
      /v26 incremental patch: already applied/,
    );
  });

  it('supports an explicit idempotent mode for local preparation commands', () => {
    const patched = patchFastAgentCliSource(SOURCE);

    expect(patchFastAgentCliSource(patched, { idempotent: true })).toBe(patched);
  });

  it('upgrades an exactly V23-patched source to V24 without replaying earlier patches', () => {
    const fullyPatched = patchFastAgentCliSource(SOURCE);
    const v23Source = fullyPatched
      .replace(V24_EXTERNAL_TURN_HANDLER_AFTER, V23_GROUP_SESSION_HANDLER_AFTER)
      .replace(V24_RUN_TURN_AFTER, V23_RUN_TURN_AFTER);

    expect(patchFastAgentCliV23ToV24Source(v23Source)).toBe(fullyPatched);
  });

  it('fails closed for repeated, partial, or non-V23 incremental patch inputs', () => {
    const fullyPatched = patchFastAgentCliSource(SOURCE);
    const v23Source = fullyPatched
      .replace(V24_EXTERNAL_TURN_HANDLER_AFTER, V23_GROUP_SESSION_HANDLER_AFTER)
      .replace(V24_RUN_TURN_AFTER, V23_RUN_TURN_AFTER);
    const partiallyPatched = v23Source.replace(
      V23_GROUP_SESSION_HANDLER_AFTER,
      V24_EXTERNAL_TURN_HANDLER_AFTER,
    );

    expect(() => patchFastAgentCliV23ToV24Source(fullyPatched)).toThrow(
      /v24 incremental patch: already applied/,
    );
    expect(() => patchFastAgentCliV23ToV24Source(partiallyPatched)).toThrow(
      /v24 incremental patch: partially or unexpectedly patched/,
    );
    expect(() => patchFastAgentCliV23ToV24Source(SOURCE)).toThrow(
      /requires an exactly V23-patched source/,
    );
  });

  it('fails closed when only the v22 incremental patch is already applied', () => {
    const fullyPatched = patchFastAgentCliSource(SOURCE);
    const v22PatchedOnly = fullyPatched
      .replace(
        V26_OPENCODE_SESSION_RUNTIME_BRIDGE_AFTER,
        V26_OPENCODE_SESSION_RUNTIME_BRIDGE_BEFORE,
      )
      .replace(V26_OPENCODE_SESSION_HEADER_AFTER, V26_OPENCODE_SESSION_HEADER_BEFORE)
      .replace(V25_SANDBOX_ENSURE_CONNECTED_AFTER, V25_SANDBOX_ENSURE_CONNECTED_BEFORE)
      .replace(V24_EXTERNAL_TURN_HANDLER_AFTER, V23_GROUP_SESSION_HANDLER_AFTER)
      .replace(V24_RUN_TURN_AFTER, V23_RUN_TURN_AFTER)
      .replace(V23_GROUP_SESSION_HANDLER_AFTER, V21_EXTERNAL_TURN_AFTER)
      .replace(V23_RUN_TURN_AFTER, V23_RUN_TURN_BEFORE)
      .replace(V23_CONTEXT_AFTER, V23_CONTEXT_BEFORE);

    expect(() => patchFastAgentCliSource(v22PatchedOnly)).toThrow(
      /v22 incremental patch: already applied/,
    );
  });

  it('upgrades an exactly V24-patched source to V25 without replaying earlier patches', () => {
    const v25Source = patchFastAgentCliSource(SOURCE);
    const v24Source = v25Source.replace(V25_SANDBOX_ENSURE_CONNECTED_AFTER, V25_SANDBOX_ENSURE_CONNECTED_BEFORE);

    expect(patchFastAgentCliV24ToV25Source(v24Source)).toBe(v25Source);
  });

  it('fails closed for repeated, partial, or non-V24 V25 incremental patch inputs', () => {
    const v25Source = patchFastAgentCliSource(SOURCE);
    const v24Source = v25Source.replace(V25_SANDBOX_ENSURE_CONNECTED_AFTER, V25_SANDBOX_ENSURE_CONNECTED_BEFORE);
    const partialSource = `${v24Source};${V25_SANDBOX_ENSURE_CONNECTED_AFTER}`;

    expect(() => patchFastAgentCliV24ToV25Source(v25Source)).toThrow(
      /v25 incremental patch: already applied/,
    );
    expect(() => patchFastAgentCliV24ToV25Source(partialSource)).toThrow(
      /v25 incremental patch: partially or unexpectedly patched/,
    );
    expect(() => patchFastAgentCliV24ToV25Source(SOURCE)).toThrow(
      /requires an exactly V24-patched source/,
    );
  });

  it('upgrades an exactly V25-patched source to V26 without replaying earlier patches', () => {
    const v26Source = patchFastAgentCliSource(SOURCE);
    const v25Source = v26Source.replace(
      V26_OPENCODE_SESSION_HEADER_AFTER,
      V26_OPENCODE_SESSION_HEADER_BEFORE,
    ).replace(
      V26_OPENCODE_SESSION_RUNTIME_BRIDGE_AFTER,
      V26_OPENCODE_SESSION_RUNTIME_BRIDGE_BEFORE,
    );

    expect(patchFastAgentCliV25ToV26Source(v25Source)).toBe(v26Source);
  });

  it('fails closed for repeated, partial, or non-V25 V26 incremental patch inputs', () => {
    const v26Source = patchFastAgentCliSource(SOURCE);
    const v25Source = v26Source.replace(
      V26_OPENCODE_SESSION_HEADER_AFTER,
      V26_OPENCODE_SESSION_HEADER_BEFORE,
    ).replace(
      V26_OPENCODE_SESSION_RUNTIME_BRIDGE_AFTER,
      V26_OPENCODE_SESSION_RUNTIME_BRIDGE_BEFORE,
    );
    const partialSource = `${v25Source}${V26_OPENCODE_SESSION_HEADER_AFTER}`;

    expect(() => patchFastAgentCliV25ToV26Source(v26Source)).toThrow(
      /v26 incremental patch: already applied/,
    );
    expect(() => patchFastAgentCliV25ToV26Source(partialSource)).toThrow(
      /v26 incremental patch: partially or unexpectedly patched/,
    );
    expect(() => patchFastAgentCliV25ToV26Source(SOURCE)).toThrow(
      /requires an exactly V25-patched source/,
    );
  });

  it('applies only the incremental changes to a v19-patched source', () => {
    const fullyPatched = patchFastAgentCliSource(SOURCE);
    const v19Source = fullyPatched
      .replace(
        V26_OPENCODE_SESSION_RUNTIME_BRIDGE_AFTER,
        V26_OPENCODE_SESSION_RUNTIME_BRIDGE_BEFORE,
      )
      .replace(V26_OPENCODE_SESSION_HEADER_AFTER, V26_OPENCODE_SESSION_HEADER_BEFORE)
      .replace(V25_SANDBOX_ENSURE_CONNECTED_AFTER, V25_SANDBOX_ENSURE_CONNECTED_BEFORE)
      .replace(V24_EXTERNAL_TURN_HANDLER_AFTER, V23_GROUP_SESSION_HANDLER_AFTER)
      .replace(V24_RUN_TURN_AFTER, V23_RUN_TURN_AFTER)
      .replace('process.env.WECLAWS_PROCESSING_ACK||', '')
      .replace(V20_MESSAGE_COPY_IPC, '')
      .replace(V20_WELCOME_PATCHED, V20_WELCOME_SOURCE)
      .replace(V20_ATTACHMENT_PATCHED, V20_ATTACHMENT_SOURCE)
      .replace(V23_TIME_CONTEXT_PATCHED, V23_TIME_CONTEXT_SOURCE)
      .replace(V23_GROUP_SESSION_HANDLER_AFTER, V21_EXTERNAL_TURN_AFTER)
      .replace(V23_RUN_TURN_AFTER, V23_RUN_TURN_BEFORE)
      .replace(V23_CONTEXT_AFTER, V23_CONTEXT_BEFORE)
      .replace(V21_EXTERNAL_TURN_AFTER, V21_EXTERNAL_TURN_BEFORE)
      .replace(
        'liveManualDreamTasks=new Map;pendingWeixinMerge=new Map;constructor($){this.dependencies=$;let J=$.singleFlightGuard??new VD;',
        V22_MERGE_STATE_SOURCE,
      )
      .replace(
        'if(Y==="weixin"&&P.kind==="user_message"&&!T.hasActiveRun&&!T.suspendedWork){if(await this.weclawsMergeWindowInbound($,j,J,H,G,V,X,P.normalizedInput))return{outcome:"queued",bindingId:j.bindingId}}if((await this.tryAttachSteerTurn({binding:j,messageKey:H,normalizedInput:P.normalizedInput,timestampMs:G.timestampMs,conversationRunState:T,inbound:J})).attached)return{outcome:"queued",bindingId:j.bindingId};let v=await this.dependencies.conversationQueueStore.appendEnqueued({type:"queue_item_enqueued",queueItemId:KD(),conversationKey:j.bindingIdentityKey,bindingId:j.bindingId,sessionId:j.sessionId,activationId:j.activationId,sourceInboundIds:[H],kind:P.kind==="follow_up"?"follow_up":"user_message",normalizedInput:P.normalizedInput,priority:1,enqueueTime:G.timestampMs});',
        V22_STEER_CALL_SOURCE,
      )
      .replace(
        V22_WECHAT_MEDIA_MERGE_HELPERS +
          'async tryAttachSteerTurn($){if(this.dependencies.runAdmissionMode!=="steer")return{attached:!1};let J=$.conversationRunState.runningWork;if(!J)return{attached:!1};let W0=$.normalizedInput||"";try{if($.inbound){let F0=await this.weclawsPersistSteerAttachments($.inbound);if(F0.length>0){let A0=F0.map((e)=>`${e.filename??e.path}：${e.path}`).join("\\n"),R0=`用户补发了${F0.length>1?"以下附件":"一个附件"}，已保存到：\\n${A0}\\n如果后续需要查阅，请按这些路径读取。`;W0=W0&&W0.trim()?`${W0}\\n\\n${R0}`:R0}}if(!(await this.dependencies.runtimeBridge.steerTurn($.binding,{runId:J.run.runId,message:W0})).accepted)return{attached:!1}}catch{return{attached:!1}}',
        V22_STEER_BODY_SOURCE,
      )
      .replace(V22_KIND_PATCHED, V22_KIND_SOURCE)
      .replace(V22_REF_SINGLE_PATCHED, V22_REF_SINGLE_SOURCE)
      .replace(V22_REF_MULTI_PATCHED, V22_REF_MULTI_SOURCE);

    expect(patchFastAgentCliSource(v19Source)).toBe(fullyPatched);
  });

  it('matches every anchor in the installed pinned FastAgent CLI', () => {
    const packageRoot = dirname(require.resolve('@fastagent/cli/package.json'));
    const installedSource = readFileSync(join(packageRoot, 'cli.js'), 'utf8');

    expect(() => patchFastAgentCliSource(installedSource, { idempotent: true })).not.toThrow();
  });
});
