import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_FILE = fileURLToPath(import.meta.url);
const FULL_PATCH_MARKER = '/* weiling-fastagent-compat-v26 */';
const SUPERVISOR_ROOT = path.resolve(path.dirname(CURRENT_FILE), '..');
const DEFAULT_FASTAGENT_CLI_FILE = path.join(
  SUPERVISOR_ROOT,
  'node_modules',
  '@fastagent',
  'cli',
  'cli.js',
);

const V19_PATCHES = [
  {
    name: 'sandbox activity JSON body',
    before:
      'async updateActivity($){await this.request("POST",`/sessions/${$}/activity`)}',
    after:
      'async updateActivity($){await this.request("POST",`/sessions/${$}/activity`,{})}',
  },
  {
    name: 'fetch failure classification',
    before:
      '_G6=["temporarily unavailable","try again later","timeout","timed out","econnreset","socket hang up","network error"]',
    after:
      '_G6=["temporarily unavailable","try again later","timeout","timed out","econnreset","socket hang up","network error","fetch failed"]',
  },
  {
    name: 'fetch failure final-delivery retry',
    before:
      'return J.includes("temporarily unavailable")||J.includes("try again later")}',
    after:
      'return J.includes("temporarily unavailable")||J.includes("try again later")||J.includes("fetch failed")}',
  },
  {
    name: 'gateway timed-out error classification',
    before:
      'if(J.includes("timeout")||J.includes("etimedout")||J.includes("econnreset"))return"timeout";',
    after:
      'if(J.includes("timeout")||J.includes("timed out")||J.includes("etimedout")||J.includes("econnreset"))return"timeout";',
  },
  {
    name: 'gateway transient retry delay',
    before:
      'function wx($,J){let X={auth_failure:30000,rate_limit:30000,context_overflow:0,unsupported_image_input:0,timeout:30000,network_error:30000,model_unavailable:0,unknown:30000}[$];',
    after:
      'function wx($,J){let X={auth_failure:30000,rate_limit:30000,context_overflow:0,unsupported_image_input:0,timeout:2000,network_error:3000,model_unavailable:0,unknown:30000}[$];',
  },
  {
    name: 'weixin progress pacing interval',
    before:
      'Cc0,xc0=1000,Sc0=15000,Tc0=60000,Ac0,Ic0=30000,wc0,Ec0=8,Pc0,bc0,vc0,N60=3,kc0=2000,gc0=30000',
    after:
      'Cc0,xc0=1000,Sc0=15000,Tc0=60000,Ac0,Ic0=12000,wc0,Ec0=8,Pc0,bc0,vc0,N60=3,kc0=2000,gc0=30000',
  },
  {
    name: 'weixin progress pacing backoff',
    before:
      'vc0=[30000,60000,60000]',
    after:
      'vc0=[12000,30000,60000]',
  },
  {
    name: 'weixin QR request retry',
    before:
      'async getBotQrcode($){let J=await this.getJson(`ilink/bot/get_bot_qrcode?bot_type=${mD6}`,$,dD6);return{qrCodeId:J.qrcode??"",qrCodeUrl:J.qrcode_img_content??""}}',
    after:
      'async getBotQrcode($){let J;for(let Q=0;Q<3;Q++){try{J=await this.getJson(`ilink/bot/get_bot_qrcode?bot_type=${mD6}`,$,dD6);break}catch(X){if(Q===2)throw X;await new Promise(G=>setTimeout(G,500*(Q+1)))}}return{qrCodeId:J.qrcode??"",qrCodeUrl:J.qrcode_img_content??""}}',
  },
  {
    name: 'weixin QR request timeout',
    before:
      'var mD6="3",lD6="0.0.1",dD6=5000,pD6=35000,VL=15000,iD6=1e4,nD6=35000,Ys0=-14',
    after:
      'var mD6="3",lD6="0.0.1",dD6=15000,pD6=35000,VL=15000,iD6=1e4,nD6=35000,Ys0=-14',
  },
  {
    name: 'weixin safe tool progress visibility',
    before:
      'function mZ6($,J,Q,X){if(!$)return!0;if(J.phase==="tool_running"||J.phase==="tool_text_progress"||J.phase==="tool_family_progress")return!1;if(J.phase==="retrying")return Q<1;if(Vu0(J))return X<1;return!0}',
    after:
      'function mZ6($,J,Q,X){if(!$)return!0;if(J.phase==="tool_running"||J.phase==="tool_text_progress")return!1;if(J.phase==="tool_family_progress")return /^(mcp|web|skill|task|cron|agent_run)(:|$)/.test(J.detail);if(J.phase==="retrying")return Q<1;if(Vu0(J))return X<1;return!0}',
  },
  {
    name: 'slow turn visible acknowledgement call',
    before:
      'k=this.runDelayedHiddenAckPacing(T,yJ(H,v.signal))',
    after:
      'k=this.runDelayedVisibleAckPacing($,J,Q,X,Y,T,yJ(H,v.signal))',
  },
  {
    name: 'slow turn visible acknowledgement delivery',
    before:
      'async runDelayedHiddenAckPacing($,J){try{if(await this.dependencies.wait(xc0,J),this.dependencies.isStopped()||J?.aborted)return;$.markDelivered("ack",Date.now())}catch(Q){if(!c$(Q));}}',
    after:
      'async runDelayedVisibleAckPacing($,J,Q,X,G,Z,Y){try{if(await this.dependencies.wait(xc0,Y),this.dependencies.isStopped()||Y?.aborted)return;let H=await this.sendControlAck($,J,Q,"收到，我是微Link，正在处理，完成后把结果发给你。",`ack:${X}:processing:v1`,G,Y);if(H.status==="sent")Z.markDelivered("ack",Date.now())}catch(H){if(!c$(H));}}',
  },
  {
    name: 'supervisor proactive message IPC',
    before:
      'Y=new l80({bindingStore:X,resolveAccount:(W0)=>Ht0(W0,G,Z),deliveryOrchestrator:k});',
    after:
      'Y=new l80({bindingStore:X,resolveAccount:(W0)=>Ht0(W0,G,Z),deliveryOrchestrator:k});process.on("message",async(W0)=>{if(!W0||typeof W0!=="object"||W0.type!=="weclaws_admin_message")return;let O0=typeof W0.deliveryId==="string"?W0.deliveryId:"",C0=typeof W0.text==="string"?W0.text.trim():"",E0=(S0)=>process.send?.({type:"weclaws_admin_message_result",deliveryId:O0,...S0});try{if(!O0||!C0)throw Error("Invalid admin message request.");let S0=X.list().filter((e)=>e.status==="active");if(S0.length!==1)throw Error(`Expected exactly one active binding, found ${S0.length}.`);let e=S0[0],R0=Ht0(e.accountId,G,Z)??{accountId:e.accountId};let A0=typeof W0.semanticKey==="string"&&W0.semanticKey.trim()?W0.semanticKey.trim():`admin:${O0}`,N0=M.listByConversation(e.bindingIdentityKey).find((r)=>r.semanticKey===A0&&r.status==="sent");if(N0){E0({ok:!0});return}let x0=await k.send(R0,{conversationKey:e.bindingIdentityKey,bindingId:e.bindingId,sessionId:e.sessionId},{kind:"proactive",channelId:e.channel,accountId:e.accountId,peer:{id:e.peerId,scope:"direct"},content:G5(C0),semanticKey:A0});if(x0.status!=="sent")throw Error(x0.failure?.message??"FastAgent proactive delivery failed.");E0({ok:!0})}catch(S0){E0({ok:!1,error:S0 instanceof Error?S0.message:String(S0)})}});process.on("message",async(W0)=>{if(!W0||typeof W0!=="object"||W0.type!=="weclaws_external_turn")return;let O0=typeof W0.requestId==="string"?W0.requestId:"",C0=typeof W0.text==="string"?W0.text.trim():"",E0=(S0)=>process.send?.({type:"weclaws_external_turn_result",requestId:O0,...S0});try{if(!O0||!C0)throw Error("Invalid external turn request.");let S0=X.list().filter((e)=>e.status==="active");if(S0.length!==1)throw Error(`Expected exactly one active binding, found ${S0.length}.`);let e=S0[0],R0=await L0.conversationScheduler.schedule(e.bindingIdentityKey,"default",()=>weclawsRuntimeBridge.runFinalTurn(e,C0),Date.now());E0({ok:!0,text:R0.finalText})}catch(S0){E0({ok:!1,error:S0 instanceof Error?S0.message:String(S0)})}});',
  },
  {
    name: 'external turn runtime bridge declaration',
    before:
      'async function MP($,J={}){let Q=$.host,X,G,Z,Y,H=new d2',
    after:
      'async function MP($,J={}){let Q=$.host,X,G,Z,Y,weclawsRuntimeBridge,H=new d2',
  },
  {
    name: 'external turn runtime bridge capture',
    before:
      'runtimeBridge:new ZD(s,W),inboundMessageStore:j',
    after:
      'runtimeBridge:weclawsRuntimeBridge=new ZD(s,W),inboundMessageStore:j',
  },
  {
    name: 'completed inbound turn activity IPC',
    before:
      'async resolveScheduledInboundResult($,J,Q,X,G){try{return await $}catch(Z){return this.mapScheduledInboundError(Z,J,Q,X,G)}}',
    after:
      'async resolveScheduledInboundResult($,J,Q,X,G){try{let Z=await $;try{process.send?.({type:"weclaws_user_active"},()=>{})}catch{}return Z}catch(Z){return this.mapScheduledInboundError(Z,J,Q,X,G)}}',
  },
];

const V20_INCREMENTAL_PATCHES = [
  {
    name: 'dynamic branded welcome copy',
    before:
      'Cc0=["欢迎使用 **FastAgent**，我会继续处理你刚才的消息。","我可以帮你处理文件和命令、调用各种工具，并支持长对话整理、记忆、定时任务和任务管理。","你可以直接描述需求、布置各类任务。当前内置命令有：","- **/new**：开启新会话","- **/sessions**：查看当前 IM 对话的历史会话","- **/switch <编号>**：切换到已有历史会话","- **/abort**：中止当前进行中的任务","- **/context**：查看当前上下文用量","- **/compact**：手动上下文压缩（默认自动压缩）","- **/dream**：手动触发一次记忆整理（自动 dream 仍在后台执行）"].join(`\n`)',
    after:
      'Cc0=`欢迎使用${process.env.WECLAWS_ASSISTANT_NAME?.trim()||"微Link · 微灵 AI 助手"}。`',
  },
  {
    name: 'dynamic slow-turn acknowledgement copy',
    before:
      'async runDelayedVisibleAckPacing($,J,Q,X,G,Z,Y){try{if(await this.dependencies.wait(xc0,Y),this.dependencies.isStopped()||Y?.aborted)return;let H=await this.sendControlAck($,J,Q,"收到，我是微Link，正在处理，完成后把结果发给你。",`ack:${X}:processing:v1`,G,Y);if(H.status==="sent")Z.markDelivered("ack",Date.now())}catch(H){if(!c$(H));}}',
    after:
      'async runDelayedVisibleAckPacing($,J,Q,X,G,Z,Y){try{if(await this.dependencies.wait(xc0,Y),this.dependencies.isStopped()||Y?.aborted)return;let H=await this.sendControlAck($,J,Q,process.env.WECLAWS_PROCESSING_ACK||"收到，我是微Link，正在处理，完成后把结果发给你。",`ack:${X}:processing:v1`,G,Y);if(H.status==="sent")Z.markDelivered("ack",Date.now())}catch(H){if(!c$(H));}}',
  },
  {
    name: 'supervisor message-copy IPC',
    before:
      'process.on("message",async(W0)=>{if(!W0||typeof W0!=="object"||W0.type!=="weclaws_admin_message")return;let O0=',
    after:
      'process.on("message",async(W0)=>{if(W0&&typeof W0==="object"&&W0.type==="weclaws_message_copy"){if(typeof W0.assistantName==="string"&&W0.assistantName.trim())process.env.WECLAWS_ASSISTANT_NAME=W0.assistantName.trim();if(typeof W0.processingAck==="string"&&W0.processingAck.trim())process.env.WECLAWS_PROCESSING_ACK=W0.processingAck.trim()}});process.on("message",async(W0)=>{if(!W0||typeof W0!=="object"||W0.type!=="weclaws_admin_message")return;let O0=',
  },
  {
    name: 'file attachments enter runtime input',
    before:
      'D=await this.persistInboundAttachments(Q),L=await Qu0(Q,D,Z);if(!this.hasRuntimeInput(L)&&this.shouldShortCircuitWithAttachmentReceipt(D))',
    after:
      'D=await this.persistInboundAttachments(Q),L=await Qu0(Q,D,Z);{let weclawsFiles=D.filter((i)=>i.kind==="file"||i.kind==="image");if(weclawsFiles.length>0){let weclawsReference=this.buildAttachmentReferenceText(weclawsFiles);if(L.prompt){let weclawsFirstText=L.prompt[0]?.type==="text"?L.prompt[0]:void 0,weclawsText=weclawsFirstText?.text&&weclawsFirstText.text!==_Z6?`${weclawsFirstText.text}\\n\\n${weclawsReference}`:weclawsReference;L={...L,prompt:[{type:"text",text:weclawsText},...L.prompt.slice(weclawsFirstText?1:0)]}}else L={...L,userMessage:L.userMessage?`${L.userMessage}\\n\\n${weclawsReference}`:weclawsReference}}}if(!this.hasRuntimeInput(L)&&this.shouldShortCircuitWithAttachmentReceipt(D))',
  },
  {
    name: 'inject current date and time into every turn context',
    before:
      'Rf={name:"time",priority:70,condition($){return!!$.userTimezone},build($){let J=["## Current Date & Time",`Time zone: ${$.userTimezone}`];return J.push("If you need the current date, time, or day of week, use the session_status tool."),J}}})',
    after:
      'Rf={name:"time",priority:70,condition($){return true},build($){let J=["## Current Date & Time",`Time zone: ${$.userTimezone||"Asia/Shanghai"}`];return J.push(`Current date and time: ${new Date().toLocaleString("zh-CN",{timeZone:$.userTimezone||"Asia/Shanghai",dateStyle:"full",timeStyle:"short"})}`),J.push("If you need the current date, time, or day of week, use the session_status tool."),J}}})',
  },
];

const V21_EXTERNAL_TURN_BEFORE =
  'process.on("message",async(W0)=>{if(!W0||typeof W0!=="object"||W0.type!=="weclaws_external_turn")return;let O0=typeof W0.requestId==="string"?W0.requestId:"",C0=typeof W0.text==="string"?W0.text.trim():"",E0=(S0)=>process.send?.({type:"weclaws_external_turn_result",requestId:O0,...S0});try{if(!O0||!C0)throw Error("Invalid external turn request.");let S0=X.list().filter((e)=>e.status==="active");if(S0.length!==1)throw Error(`Expected exactly one active binding, found ${S0.length}.`);let e=S0[0],R0=await L0.conversationScheduler.schedule(e.bindingIdentityKey,"default",()=>weclawsRuntimeBridge.runFinalTurn(e,C0),Date.now());E0({ok:!0,text:R0.finalText})}catch(S0){E0({ok:!1,error:S0 instanceof Error?S0.message:String(S0)})}});';

const V21_EXTERNAL_TURN_AFTER =
  'process.on("message",async(W0)=>{if(!W0||typeof W0!=="object"||W0.type!=="weclaws_external_turn")return;let O0=typeof W0.requestId==="string"?W0.requestId:"",C0=typeof W0.text==="string"?W0.text.trim():"",P0=typeof W0.forwardEvents==="boolean"?W0.forwardEvents:!0,E0=(S0)=>process.send?.({type:"weclaws_external_turn_result",requestId:O0,...S0});try{if(!O0||!C0)throw Error("Invalid external turn request.");let S0=X.list().filter((e)=>e.status==="active");if(S0.length!==1)throw Error(`Expected exactly one active binding, found ${S0.length}.`);let e=S0[0],R0=await L0.conversationScheduler.schedule(e.bindingIdentityKey,"default",async()=>{let T0=await weclawsRuntimeBridge.runTurn(e,{userMessage:C0}),U0=null;if(P0)U0=await weclawsRuntimeBridge.subscribeProgress(null,T0.runId,(Z0)=>process.send?.({type:"weclaws_external_turn_event",requestId:O0,event:Z0}));try{return await weclawsRuntimeBridge.awaitRunResult(T0.runId)}finally{U0?.()}},Date.now());E0({ok:!0,text:R0.finalText})}catch(S0){E0({ok:!1,error:S0 instanceof Error?S0.message:String(S0)})}});';

const V21_INCREMENTAL_PATCHES = [
  {
    name: 'external turn streaming events',
    before: V21_EXTERNAL_TURN_BEFORE,
    after: V21_EXTERNAL_TURN_AFTER,
  },
];

const V22_WECHAT_MEDIA_MERGE_HELPERS = `async weclawsMergeWindowInbound($,j,J,H,G,V,X,O0){let M0=this.pendingWeixinMerge.get(j.bindingIdentityKey);if(M0){let W0=G.attachments??[],F0=G.text&&G.text.trim()?G.text.trim():"";if(W0.length>0||F0){M0.messages.push(J);if(F0)(M0.texts??[]).push(F0);await this.dependencies.inboundMessageStore.markAttached(H,j.bindingId,M0.queueItemId,void 0,G.timestampMs);await this.weclawsDebugLog({t:"merged",key:j.bindingIdentityKey,queueItemId:M0.queueItemId,msgs:M0.messages.length})}return!0}let v=await this.dependencies.conversationQueueStore.appendEnqueued({type:"queue_item_enqueued",queueItemId:KD(),conversationKey:j.bindingIdentityKey,bindingId:j.bindingId,sessionId:j.sessionId,activationId:j.activationId,sourceInboundIds:[H],kind:"user_message",normalizedInput:O0??"",priority:1,enqueueTime:G.timestampMs});await this.dependencies.inboundMessageStore.markQueued(H,j.bindingId,v.queueItemId,G.timestampMs);M0={key:j.bindingIdentityKey,queueItemId:v.queueItemId,primaryMessageKey:H,account:$,binding:j,messages:[J],texts:[],ownerLeaseEpoch:V,signal:X,windowMs:Number(process.env.WECLAWS_WECHAT_MERGE_WINDOW_MS||2000)};this.pendingWeixinMerge.set(M0.key,M0);let k=this.conversationScheduler.schedule(M0.key,"default",async()=>{await this.wait(M0.windowMs,M0.signal).catch(()=>{return});return this.weclawsExecuteMergedWeixinTurn(M0)},G.timestampMs);k.catch(()=>{return});await this.weclawsDebugLog({t:"window_start",key:M0.key,queueItemId:M0.queueItemId,windowMs:M0.windowMs});return!0}async weclawsExecuteMergedWeixinTurn($){await this.weclawsDebugLog({t:"exec",key:$.key,queueItemId:$.queueItemId,msgs:$.messages.length});if(this.stopped)return{outcome:"cancelled",bindingId:$.binding.bindingId};if(this.pendingWeixinMerge.get($.key)!==$)return{outcome:"cancelled",bindingId:$.binding.bindingId};this.pendingWeixinMerge.delete($.key);let v=this.dependencies.conversationQueueStore.get($.queueItemId);if(!v||v.status==="cancelled")return{outcome:"cancelled",bindingId:$.binding.bindingId};let texts=[],attachments=[];for(let W0 of $.messages){let T0=W0.message?.text??"";if(T0&&T0.trim()&&T0.trim()!=="[Image]")texts.push(T0.trim());for(let F0 of (W0.message?.attachments??[]))if(!attachments.some((X0)=>X0.path===F0.path))attachments.push(F0)}let text=texts.join("\\n"),primary=$.messages[0]??$.binding,merged={...primary,text,message:{...primary.message,text,kind:attachments.length>0?"rich":"text",...(attachments.length>0?{attachments}:{})}};try{let R0=await this.turnExecutor.executeQueuedTurn($.account,$.binding,merged,$.primaryMessageKey,$.queueItemId,text,$.ownerLeaseEpoch,$.signal);try{process.send?.({type:"weclaws_user_active"},()=>{})}catch(G1){}await this.weclawsDebugLog({t:"exec_done",key:$.key,queueItemId:$.queueItemId,outcome:R0?.outcome});return R0}catch(G0){await this.weclawsDebugLog({t:"exec_error",key:$.key,queueItemId:$.queueItemId,error:String(G0&&G0.stack||G0)});throw G0}}async weclawsDebugLog($){try{let F0=await import("node:fs");F0.appendFileSync("/tmp/weclaws-merge-debug.log",JSON.stringify({...$,ts:Date.now()})+String.fromCharCode(10))}catch(G0){}}async weclawsPersistSteerAttachments($){let A0=$.message?.attachments??[];if(A0.length===0||!this.dependencies.inboundMediaService)return[];let Z0=q8($),U0=B$($),M1=$.message?.messageId??$.messageId;try{let F0=await this.dependencies.inboundMediaService.persist({channelId:U0,accountId:$.accountId,peerId:Z0.id,messageId:M1,attachments:A0});try{let F1=await import("node:fs");F1.appendFileSync("/tmp/weclaws-steer-debug.log",JSON.stringify({ok:!0,messageId:M1,count:A0.length,paths:A0.map((X0)=>X0.path),accountId:$.accountId,peerId:Z0.id,ts:Date.now()})+String.fromCharCode(10))}catch(G1){}return F0}catch(G0){try{let F1=await import("node:fs");F1.appendFileSync("/tmp/weclaws-steer-debug.log",JSON.stringify({ok:!1,messageId:M1,count:A0.length,attachments:A0,messageKeys:$.message?Object.keys($.message):null,error:String(G0),ts:Date.now()})+String.fromCharCode(10))}catch(G1){}return[]}}`;

const V22_WECHAT_MEDIA_MERGE_PATCHES = [
  {
    name: 'weixin pending media merge state',
    before:
      'liveManualDreamTasks=new Map;constructor($){this.dependencies=$;let J=$.singleFlightGuard??new VD;',
    after:
      'liveManualDreamTasks=new Map;pendingWeixinMerge=new Map;constructor($){this.dependencies=$;let J=$.singleFlightGuard??new VD;',
  },
  {
    name: 'weixin text/media merge window before dispatch',
    before:
      'if((await this.tryAttachSteerTurn({binding:j,messageKey:H,normalizedInput:P.normalizedInput,timestampMs:G.timestampMs,conversationRunState:T})).attached)return{outcome:"queued",bindingId:j.bindingId};let v=await this.dependencies.conversationQueueStore.appendEnqueued({type:"queue_item_enqueued",queueItemId:KD(),conversationKey:j.bindingIdentityKey,bindingId:j.bindingId,sessionId:j.sessionId,activationId:j.activationId,sourceInboundIds:[H],kind:P.kind==="follow_up"?"follow_up":"user_message",normalizedInput:P.normalizedInput,priority:1,enqueueTime:G.timestampMs});',
    after:
      'if(Y==="weixin"&&P.kind==="user_message"&&!T.hasActiveRun&&!T.suspendedWork){if(await this.weclawsMergeWindowInbound($,j,J,H,G,V,X,P.normalizedInput))return{outcome:"queued",bindingId:j.bindingId}}if((await this.tryAttachSteerTurn({binding:j,messageKey:H,normalizedInput:P.normalizedInput,timestampMs:G.timestampMs,conversationRunState:T,inbound:J})).attached)return{outcome:"queued",bindingId:j.bindingId};let v=await this.dependencies.conversationQueueStore.appendEnqueued({type:"queue_item_enqueued",queueItemId:KD(),conversationKey:j.bindingIdentityKey,bindingId:j.bindingId,sessionId:j.sessionId,activationId:j.activationId,sourceInboundIds:[H],kind:P.kind==="follow_up"?"follow_up":"user_message",normalizedInput:P.normalizedInput,priority:1,enqueueTime:G.timestampMs});',
  },
  {
    name: 'weixin steer attachments persisted and referenced',
    before:
      'async tryAttachSteerTurn($){if(this.dependencies.runAdmissionMode!=="steer")return{attached:!1};let J=$.conversationRunState.runningWork;if(!J)return{attached:!1};try{if(!(await this.dependencies.runtimeBridge.steerTurn($.binding,{runId:J.run.runId,message:$.normalizedInput})).accepted)return{attached:!1}}catch{return{attached:!1}}',
    after:
      V22_WECHAT_MEDIA_MERGE_HELPERS +
      'async tryAttachSteerTurn($){if(this.dependencies.runAdmissionMode!=="steer")return{attached:!1};let J=$.conversationRunState.runningWork;if(!J)return{attached:!1};let W0=$.normalizedInput||"";try{if($.inbound){let F0=await this.weclawsPersistSteerAttachments($.inbound);if(F0.length>0){let A0=F0.map((e)=>`${e.filename??e.path}：${e.path}`).join("\\n"),R0=`用户补发了${F0.length>1?"以下附件":"一个附件"}，已保存到：\\n${A0}\\n如果后续需要查阅，请按这些路径读取。`;W0=W0&&W0.trim()?`${W0}\\n\\n${R0}`:R0}}if(!(await this.dependencies.runtimeBridge.steerTurn($.binding,{runId:J.run.runId,message:W0})).accepted)return{attached:!1}}catch{return{attached:!1}}',
  },
  {
    name: 'weixin attachment kind naming for image references',
    before:
      'describeAttachmentKind($){return $.mimeType.toLowerCase().startsWith("video/")?"视频":"文件"}',
    after:
      'describeAttachmentKind($){return $.mimeType.toLowerCase().startsWith("video/")?"视频":$.mimeType.toLowerCase().startsWith("image/")?"图片":"文件"}',
  },
  {
    name: 'weixin attachment reference drives direct reading',
    before:
      '我上传了${this.describeAttachmentKind(Q)} ${X}，已保存到：${Q.path}。如果后续需要查阅，请按这个路径读取。',
    after:
      '用户发来了${this.describeAttachmentKind(Q)} ${X}，已保存到：${Q.path}。请立即读取并处理：图片请调用 qwen-vision 技能识别内容，文档请用 office-files 技能解析文本。',
  },
  {
    name: 'weixin attachment reference drives direct reading (multiple)',
    before:
      '如果后续需要查阅，请按这些路径读取。`}describeAttachmentKind($){',
    after:
      '请立即按这些路径读取：图片调用 qwen-vision 技能识别，文档用 office-files 技能解析。`}describeAttachmentKind($){',
  },
];

const V23_GROUP_SESSION_HANDLER_AFTER =
  'process.on("message",async(W0)=>{if(!W0||typeof W0!=="object"||W0.type!=="weclaws_external_turn")return;let O0=typeof W0.requestId==="string"?W0.requestId:"",C0=typeof W0.text==="string"?W0.text.trim():"",P0=typeof W0.forwardEvents==="boolean"?W0.forwardEvents:!0,G0=typeof W0.systemPrompt==="string"&&W0.systemPrompt.trim()?W0.systemPrompt.trim():"",V0=typeof W0.sessionId==="string"&&W0.sessionId.trim()?W0.sessionId.trim():"",A0=typeof W0.sessionKey==="string"&&W0.sessionKey.trim()?W0.sessionKey.trim():"",E0=(S0)=>process.send?.({type:"weclaws_external_turn_result",requestId:O0,...S0});try{if(!O0||!C0)throw Error("Invalid external turn request.");let S0=X.list().filter((e)=>e.status==="active");if(S0.length!==1)throw Error(`Expected exactly one active binding, found ${S0.length}.`);let e=S0[0],e2={...e,sessionId:V0||void 0};if(A0)e2={...e2,channel:"feishu-group",accountId:A0,peerId:A0,bindingIdentityKey:`feishu-group:${A0}`};let F1=V0;if(!F1){let F2=await weclawsRuntimeBridge.ensureSession(e2);F1=F2.sessionId;e2={...e2,sessionId:F1}}let R0=await L0.conversationScheduler.schedule(e.bindingIdentityKey,"default",async()=>{let T0=await weclawsRuntimeBridge.runTurn(e2,{userMessage:C0,systemPrompt:G0||void 0}),U0=null;if(P0)U0=await weclawsRuntimeBridge.subscribeProgress(null,T0.runId,(Z0)=>process.send?.({type:"weclaws_external_turn_event",requestId:O0,event:Z0}));try{return await weclawsRuntimeBridge.awaitRunResult(T0.runId)}finally{U0?.()}},Date.now());E0({ok:!0,text:R0.finalText,sessionId:F1})}catch(S0){E0({ok:!1,error:S0 instanceof Error?S0.message:String(S0)})}});';

const V23_RUN_TURN_BEFORE =
  'async runTurn($,J){let Q=await this.getOrLoadRuntime($),X=DG6();return this.runs.set(X,{sessionId:Q.sessionId,runtime:Q,input:MG6(J),events:[],subscribers:new Set,started:!1,settled:!1,resultConsumed:!1}),{runId:X}}';

const V23_RUN_TURN_AFTER =
  'async runTurn($,J){let Q=await this.getOrLoadRuntime($),X=DG6(),W0=typeof J?.systemPrompt==="string"&&J.systemPrompt.trim()?[{role:"system",parts:[{type:"text",text:J.systemPrompt.trim()}]}]:[];return this.runs.set(X,{sessionId:Q.sessionId,runtime:Q,input:{...MG6(J),context:{...(J?.context??{}),injectedMessages:[...W0,...(J?.context?.injectedMessages??[])]}},events:[],subscribers:new Set,started:!1,settled:!1,resultConsumed:!1}),{runId:X}}';

const V23_CONTEXT_BEFORE = 'for await(let W of J.runtime.run({...J.input,context:{traceId:$}})){';

const V23_CONTEXT_AFTER = 'for await(let W of J.runtime.run({...J.input,context:{traceId:$,...J.input?.context}})){';

const V23_GROUP_SESSION_PATCHES = [
  {
    name: 'external turn group session support',
    before: V21_EXTERNAL_TURN_AFTER,
    after: V23_GROUP_SESSION_HANDLER_AFTER,
  },
  {
    name: 'external turn system prompt injection',
    before: V23_RUN_TURN_BEFORE,
    after: V23_RUN_TURN_AFTER,
  },
  {
    name: 'external turn context preservation',
    before: V23_CONTEXT_BEFORE,
    after: V23_CONTEXT_AFTER,
  },
];

const V24_MODEL_VISIBLE_TOOL_FILTER_ANCHOR =
  'Vg0(J00(this.config.sessionToolView),$.currentRunContextRef.value?.visibleToolNames??$.currentRunContextRef.value?.tools';
const V24_EXECUTION_VISIBLE_TOOL_GUARD_ANCHOR =
  'if(X.visibleToolNames&&!X.visibleToolNames.includes(J))return{id:$,name:J,input:Q,error:`Tool not available in current model tool set: ${J}`,durationMs:Date.now()-G};';

const V24_EXTERNAL_TURN_HANDLER_AFTER =
  'process.on("message",async(W0)=>{if(!W0||typeof W0!=="object"||W0.type!=="weclaws_external_turn")return;let O0=typeof W0.requestId==="string"?W0.requestId:"",C0=typeof W0.text==="string"?W0.text.trim():"",P0=typeof W0.forwardEvents==="boolean"?W0.forwardEvents:!0,G0=typeof W0.systemPrompt==="string"&&W0.systemPrompt.trim()?W0.systemPrompt.trim():"",V0=typeof W0.sessionId==="string"&&W0.sessionId.trim()?W0.sessionId.trim():"",A0=typeof W0.sessionKey==="string"&&W0.sessionKey.trim()?W0.sessionKey.trim():"",N0=W0.denyTools,E0=(S0)=>process.send?.({type:"weclaws_external_turn_result",requestId:O0,...S0});try{if(!O0||!C0)throw Error("Invalid external turn request.");if(N0!==void 0){if(!Array.isArray(N0)||N0.length>32||N0.some((S1)=>typeof S1!=="string"||!/^[a-z0-9][a-z0-9_.:-]{0,127}$/u.test(S1.trim().toLowerCase())))throw Error("Invalid external turn denyTools.");N0=[...new Set(N0.map((S1)=>S1.trim().toLowerCase()))]}let S0=X.list().filter((e)=>e.status==="active");if(S0.length!==1)throw Error(`Expected exactly one active binding, found ${S0.length}.`);let e=S0[0],e2={...e,sessionId:V0||void 0};if(A0)e2={...e2,channel:"feishu-group",accountId:A0,peerId:A0,bindingIdentityKey:`feishu-group:${A0}`};let F1=V0;if(!F1){let F2=await weclawsRuntimeBridge.ensureSession(e2);F1=F2.sessionId;e2={...e2,sessionId:F1}}let R0=await L0.conversationScheduler.schedule(e.bindingIdentityKey,"default",async()=>{let T0=await weclawsRuntimeBridge.runTurn(e2,{userMessage:C0,systemPrompt:G0||void 0,denyTools:N0}),U0=null;if(P0)U0=await weclawsRuntimeBridge.subscribeProgress(null,T0.runId,(Z0)=>process.send?.({type:"weclaws_external_turn_event",requestId:O0,event:Z0}));try{return await weclawsRuntimeBridge.awaitRunResult(T0.runId)}finally{U0?.()}},Date.now());E0({ok:!0,text:R0.finalText,sessionId:F1})}catch(S0){E0({ok:!1,error:S0 instanceof Error?S0.message:String(S0)})}});';

const V24_RUN_TURN_AFTER =
  'async runTurn($,J){let Q=await this.getOrLoadRuntime($),X=DG6(),W0=typeof J?.systemPrompt==="string"&&J.systemPrompt.trim()?[{role:"system",parts:[{type:"text",text:J.systemPrompt.trim()}]}]:[],N0=J?.denyTools,I0;if(N0!==void 0){if(!Array.isArray(N0)||N0.length>32||N0.some((S1)=>typeof S1!=="string"||!/^[a-z0-9][a-z0-9_.:-]{0,127}$/u.test(S1.trim().toLowerCase())))throw Error("Invalid runtime denyTools.");N0=new Set(N0.map((S1)=>S1.trim().toLowerCase()))}if(N0?.size){let F0=Q?.sessionEnvironment?.toolView;if(!F0||typeof F0.getVisible!=="function")throw Error("Unable to enforce external turn denied tools: trusted tool view unavailable.");let R0=F0.getVisible();if(!Array.isArray(R0)||R0.some((S1)=>!S1||typeof S1.name!=="string"||!S1.name.trim()))throw Error("Unable to enforce external turn denied tools: trusted tool view is invalid.");let A0=J?.context?.visibleToolNames;if(A0!==void 0&&(!Array.isArray(A0)||A0.some((S1)=>typeof S1!=="string")))throw Error("Unable to enforce external turn denied tools: existing visible tool list is invalid.");let H0=Array.isArray(A0)?new Set(A0.map((S1)=>S1.trim().toLowerCase())):null;I0=R0.map((S1)=>S1.name).filter((S1)=>!N0.has(S1.trim().toLowerCase())&&(!H0||H0.has(S1.trim().toLowerCase())))}return this.runs.set(X,{sessionId:Q.sessionId,runtime:Q,input:{...MG6(J),context:{...(J?.context??{}),...(I0?{visibleToolNames:I0}:{}),injectedMessages:[...W0,...(J?.context?.injectedMessages??[])]}},events:[],subscribers:new Set,started:!1,settled:!1,resultConsumed:!1}),{runId:X}}';

const V25_SANDBOX_ENSURE_CONNECTED_BEFORE =
  'async ensureConnected($){while(this.connecting)try{await this.connecting}catch{}if(this.client?.isConnected()&&this.connectedUserId===$)return;this.connecting=this.doConnect($);try{await this.connecting}finally{this.connecting=null}}';

const V25_SANDBOX_ENSURE_CONNECTED_AFTER =
  'async ensureConnected($){let J=(X)=>{if(X&&typeof X.authenticate==="function"&&!X.__weclawsV25AuthWrapped){let G=X.authenticate.bind(X),Z;X.authenticate=(...Y)=>{if(Z)return Z;let H=G(...Y);return Z=Promise.resolve(H).finally(()=>{Z=void 0})};try{Object.defineProperty(X,"__weclawsV25AuthWrapped",{value:!0})}catch{}}};J(this.client);if(this.client?.isConnected()&&this.connectedUserId===$&&this.client.authenticated)return;let Q=this.connecting;if(Q)await Q;J(this.client);if(this.client?.isConnected()&&this.connectedUserId===$&&this.client.authenticated)return;let X=this.client?.isConnected()&&this.connectedUserId===$?this.client.authenticate($,this.config.apiKey):this.doConnect($);this.connecting=X;try{await X}finally{if(this.connecting===X)this.connecting=null}J(this.client);if(!this.client?.isConnected()||this.connectedUserId!==$||!this.client.authenticated)throw Error("Sandbox client authentication was not established.")}';

const V25_SANDBOX_AUTH_PATCHES = [
  {
    name: 'sandbox authentication recovery single-flight',
    before: V25_SANDBOX_ENSURE_CONNECTED_BEFORE,
    after: V25_SANDBOX_ENSURE_CONNECTED_AFTER,
  },
];

const V24_PER_TURN_TOOL_DENY_PATCHES = [
  {
    name: 'external turn per-run denied tools IPC',
    before: V23_GROUP_SESSION_HANDLER_AFTER,
    after: V24_EXTERNAL_TURN_HANDLER_AFTER,
  },
  {
    name: 'external turn per-run visible tool filtering',
    before: V23_RUN_TURN_AFTER,
    after: V24_RUN_TURN_AFTER,
  },
];

const V26_OPENCODE_SESSION_HEADER_BEFORE =
  'headers:{"user-agent":Y}});YG(Z,X,G);';
const V26_OPENCODE_SESSION_HEADER_AFTER =
  'headers:{"user-agent":Y,...(X==="opencode-go"&&process.env.WECLAWS_OPENCODE_SESSION_ID?.trim()?{"x-opencode-session":process.env.WECLAWS_OPENCODE_SESSION_ID.trim()}:{})}});YG(Z,X,G);';
const V26_OPENCODE_SESSION_RUNTIME_BRIDGE_BEFORE =
  'headers:{"user-agent":Q.runtime.userAgent}';
const V26_OPENCODE_SESSION_RUNTIME_BRIDGE_AFTER =
  'headers:{"user-agent":Q.runtime.userAgent,...(Q.runtime.provider==="opencode-go"&&process.env.WECLAWS_OPENCODE_SESSION_ID?.trim()?{"x-opencode-session":process.env.WECLAWS_OPENCODE_SESSION_ID.trim()}:{})}';
const V26_OPENCODE_SESSION_HEADER_PATCHES = [
  {
    name: 'opencode-go stable session request header',
    before: V26_OPENCODE_SESSION_HEADER_BEFORE,
    after: V26_OPENCODE_SESSION_HEADER_AFTER,
  },
  {
    name: 'opencode-go runtime bridge stable session request header',
    before: V26_OPENCODE_SESSION_RUNTIME_BRIDGE_BEFORE,
    after: V26_OPENCODE_SESSION_RUNTIME_BRIDGE_AFTER,
  },
];

function countOccurrences(source, value) {
  return source.split(value).length - 1;
}

function assertV24SafetyAnchors(source) {
  for (const [name, anchor] of [
    ['model visible-tool filter', V24_MODEL_VISIBLE_TOOL_FILTER_ANCHOR],
    ['execution visible-tool guard', V24_EXECUTION_VISIBLE_TOOL_GUARD_ANCHOR],
  ]) {
    const count = countOccurrences(source, anchor);
    if (count !== 1) {
      throw new Error(`Unable to apply FastAgent CLI v24 safety patch: expected one ${name} anchor, found ${count}.`);
    }
  }
}

function hasAnyPatchedAnchor(source, patches) {
  return patches.some((patch) => countOccurrences(source, patch.after) > 0);
}

export function patchFastAgentCliSource(source, options = {}) {
  if (options.idempotent && (
    source.startsWith(FULL_PATCH_MARKER)
    || hasTerminalPatchSet(source)
  )) {
    return source;
  }

  const initialV26State = classifyPatchSet(source, V26_OPENCODE_SESSION_HEADER_PATCHES);
  if (initialV26State === 'patched') {
    throw new Error('Unable to apply FastAgent CLI v26 incremental patch: already applied.');
  }
  if (initialV26State === 'invalid' && hasAnyPatchedAnchor(source, V26_OPENCODE_SESSION_HEADER_PATCHES)) {
    throw new Error('Unable to apply FastAgent CLI v26 incremental patch: partially or unexpectedly patched.');
  }

  const initialV25State = classifyPatchSet(source, V25_SANDBOX_AUTH_PATCHES);
  if (initialV25State === 'patched') {
    throw new Error('Unable to apply FastAgent CLI v25 incremental patch: already applied.');
  }
  if (initialV25State === 'invalid' && hasAnyPatchedAnchor(source, V25_SANDBOX_AUTH_PATCHES)) {
    throw new Error('Unable to apply FastAgent CLI v25 incremental patch: partially or unexpectedly patched.');
  }

  const initialV24State = classifyPatchSet(source, V24_PER_TURN_TOOL_DENY_PATCHES);
  if (initialV24State === 'patched') {
    throw new Error('Unable to apply FastAgent CLI v24 incremental patch: already applied.');
  }
  if (initialV24State === 'invalid' && hasAnyPatchedAnchor(source, V24_PER_TURN_TOOL_DENY_PATCHES)) {
    throw new Error('Unable to apply FastAgent CLI v24 incremental patch: partially or unexpectedly patched.');
  }
  const initialV23State = classifyPatchSet(source, V23_GROUP_SESSION_PATCHES);
  if (initialV23State === 'patched') {
    throw new Error('Unable to apply FastAgent CLI v23 incremental patch: already applied.');
  }
  const initialV22State = classifyPatchSet(source, V22_WECHAT_MEDIA_MERGE_PATCHES);
  if (initialV22State === 'patched') {
    throw new Error('Unable to apply FastAgent CLI v22 incremental patch: already applied.');
  }
  const initialV21State = classifyPatchSet(source, V21_INCREMENTAL_PATCHES);
  if (initialV21State === 'patched') {
    throw new Error('Unable to apply FastAgent CLI v21 incremental patch: already applied.');
  }

  const v19State = classifyPatchSet(source, V19_PATCHES);
  let patchedSource;

  if (v19State === 'unpatched') {
    patchedSource = applyPatchSet(source, V19_PATCHES);
  } else if (v19State === 'patched') {
    patchedSource = source;
  } else {
    throw new Error('Unable to apply FastAgent CLI v19 baseline: source is partially or unexpectedly patched.');
  }

  const v20State = classifyPatchSet(patchedSource, V20_INCREMENTAL_PATCHES);
  if (v20State === 'invalid') {
    const v21State = classifyPatchSet(patchedSource, V21_INCREMENTAL_PATCHES);
    if (v21State === 'patched') {
      throw new Error('Unable to apply FastAgent CLI v21 incremental patch: already applied.');
    }
    throw new Error('Unable to apply FastAgent CLI v20 incremental patch: source is partially or unexpectedly patched.');
  }

  if (v20State === 'unpatched') {
    patchedSource = applyPatchSet(patchedSource, V20_INCREMENTAL_PATCHES);
  }

  const v21State = classifyPatchSet(patchedSource, V21_INCREMENTAL_PATCHES);
  if (v21State !== 'unpatched') {
    const detail = v21State === 'patched' ? 'already applied' : 'partially or unexpectedly patched';
    throw new Error(`Unable to apply FastAgent CLI v21 incremental patch: ${detail}.`);
  }

  patchedSource = applyPatchSet(patchedSource, V21_INCREMENTAL_PATCHES);

  const v22State = classifyPatchSet(patchedSource, V22_WECHAT_MEDIA_MERGE_PATCHES);
  if (v22State !== 'unpatched') {
    const detail = v22State === 'patched' ? 'already applied' : 'partially or unexpectedly patched';
    throw new Error(`Unable to apply FastAgent CLI v22 incremental patch: ${detail}.`);
  }

  patchedSource = applyPatchSet(patchedSource, V22_WECHAT_MEDIA_MERGE_PATCHES);

  const v23State = classifyPatchSet(patchedSource, V23_GROUP_SESSION_PATCHES);
  if (v23State !== 'unpatched') {
    const detail = v23State === 'patched' ? 'already applied' : 'partially or unexpectedly patched';
    throw new Error(`Unable to apply FastAgent CLI v23 incremental patch: ${detail}.`);
  }

  patchedSource = applyPatchSet(patchedSource, V23_GROUP_SESSION_PATCHES);
  patchedSource = patchFastAgentCliV23ToV24Source(patchedSource);
  patchedSource = patchFastAgentCliV24ToV25Source(patchedSource);
  patchedSource = patchFastAgentCliV25ToV26Source(patchedSource);
  return patchedSource.startsWith(FULL_PATCH_MARKER)
    ? patchedSource
    : `${FULL_PATCH_MARKER}\n${patchedSource}`;
}

export function patchFastAgentCliV23ToV24Source(source) {
  assertV24SafetyAnchors(source);
  const v24State = classifyPatchSet(source, V24_PER_TURN_TOOL_DENY_PATCHES);
  if (v24State === 'patched') {
    throw new Error('Unable to apply FastAgent CLI v24 incremental patch: already applied.');
  }
  if (v24State === 'invalid') {
    if (hasAnyPatchedAnchor(source, V24_PER_TURN_TOOL_DENY_PATCHES)) {
      throw new Error('Unable to apply FastAgent CLI v24 incremental patch: partially or unexpectedly patched.');
    }
    throw new Error('Unable to apply FastAgent CLI v24 incremental patch: requires an exactly V23-patched source.');
  }

  const v23State = classifyPatchSet(source, V23_GROUP_SESSION_PATCHES);
  if (v23State !== 'patched') {
    throw new Error('Unable to apply FastAgent CLI v24 incremental patch: requires an exactly V23-patched source.');
  }

  return applyPatchSet(source, V24_PER_TURN_TOOL_DENY_PATCHES);
}

export function patchFastAgentCliV24ToV25Source(source) {
  const v25State = classifyPatchSet(source, V25_SANDBOX_AUTH_PATCHES);
  if (v25State === 'patched') {
    throw new Error('Unable to apply FastAgent CLI v25 incremental patch: already applied.');
  }
  if (v25State === 'invalid') {
    if (hasAnyPatchedAnchor(source, V25_SANDBOX_AUTH_PATCHES)) {
      throw new Error('Unable to apply FastAgent CLI v25 incremental patch: partially or unexpectedly patched.');
    }
    throw new Error('Unable to apply FastAgent CLI v25 incremental patch: requires an exactly V24-patched source.');
  }

  const v24State = classifyPatchSet(source, V24_PER_TURN_TOOL_DENY_PATCHES);
  if (v24State !== 'patched') {
    throw new Error('Unable to apply FastAgent CLI v25 incremental patch: requires an exactly V24-patched source.');
  }

  return applyPatchSet(source, V25_SANDBOX_AUTH_PATCHES);
}

export function patchFastAgentCliV25ToV26Source(source) {
  const v26State = classifyPatchSet(source, V26_OPENCODE_SESSION_HEADER_PATCHES);
  if (v26State === 'patched') {
    throw new Error('Unable to apply FastAgent CLI v26 incremental patch: already applied.');
  }
  if (v26State === 'invalid') {
    if (hasAnyPatchedAnchor(source, V26_OPENCODE_SESSION_HEADER_PATCHES)) {
      throw new Error('Unable to apply FastAgent CLI v26 incremental patch: partially or unexpectedly patched.');
    }
    throw new Error('Unable to apply FastAgent CLI v26 incremental patch: requires an exactly V25-patched source.');
  }

  const v25State = classifyPatchSet(source, V25_SANDBOX_AUTH_PATCHES);
  if (v25State !== 'patched') {
    throw new Error('Unable to apply FastAgent CLI v26 incremental patch: requires an exactly V25-patched source.');
  }

  return applyPatchSet(source, V26_OPENCODE_SESSION_HEADER_PATCHES);
}

function classifyPatchSet(source, patches) {
  const states = patches.map((patch) => {
    const beforeCount = countOccurrences(source, patch.before);
    const afterCount = countOccurrences(source, patch.after);
    if (beforeCount === 1 && afterCount === 0) return 'unpatched';
    const embeddedBeforeCount = countOccurrences(patch.after, patch.before);
    if (beforeCount === embeddedBeforeCount && afterCount === 1) return 'patched';
    return 'invalid';
  });
  if (states.every((state) => state === 'unpatched')) return 'unpatched';
  if (states.every((state) => state === 'patched')) return 'patched';
  return 'invalid';
}

function applyPatchSet(source, patches) {
  let patchedSource = source;

  for (const patch of patches) {
    const beforeCount = countOccurrences(patchedSource, patch.before);
    const afterCount = countOccurrences(patchedSource, patch.after);

    if (beforeCount !== 1 || afterCount !== 0) {
      throw new Error(
        `Unable to apply FastAgent CLI patch "${patch.name}": expected one source anchor and no patched anchor, found ${beforeCount} and ${afterCount}`,
      );
    }

    patchedSource = patchedSource.replace(patch.before, () => patch.after);
  }

  return patchedSource;
}

export function patchFastAgentCliFile(filePath = DEFAULT_FASTAGENT_CLI_FILE, options = {}) {
  const source = readFileSync(filePath, 'utf8');
  const patchedSource = patchFastAgentCliSource(source, options);

  if (!options.check) {
    writeFileSync(filePath, patchedSource, 'utf8');
  }

  return { filePath, changed: patchedSource !== source };
}

export function patchFastAgentCliV23ToV24File(filePath = DEFAULT_FASTAGENT_CLI_FILE, options = {}) {
  const source = readFileSync(filePath, 'utf8');
  const patchedSource = patchFastAgentCliV23ToV24Source(source);

  if (!options.check) {
    writeFileSync(filePath, patchedSource, 'utf8');
  }

  return { filePath, changed: patchedSource !== source };
}

export function patchFastAgentCliV24ToV25File(filePath = DEFAULT_FASTAGENT_CLI_FILE, options = {}) {
  const source = readFileSync(filePath, 'utf8');
  const patchedSource = patchFastAgentCliV24ToV25Source(source);

  if (!options.check) {
    writeFileSync(filePath, patchedSource, 'utf8');
  }

  return { filePath, changed: patchedSource !== source };
}

export function patchFastAgentCliV25ToV26File(filePath = DEFAULT_FASTAGENT_CLI_FILE, options = {}) {
  const source = readFileSync(filePath, 'utf8');
  const patchedSource = patchFastAgentCliV25ToV26Source(source);

  if (!options.check) {
    writeFileSync(filePath, patchedSource, 'utf8');
  }

  return { filePath, changed: patchedSource !== source };
}

export {
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
  V25_SANDBOX_AUTH_PATCHES,
  V25_SANDBOX_ENSURE_CONNECTED_AFTER,
  V25_SANDBOX_ENSURE_CONNECTED_BEFORE,
  V26_OPENCODE_SESSION_HEADER_AFTER,
  V26_OPENCODE_SESSION_HEADER_BEFORE,
  V26_OPENCODE_SESSION_HEADER_PATCHES,
  V26_OPENCODE_SESSION_RUNTIME_BRIDGE_AFTER,
  V26_OPENCODE_SESSION_RUNTIME_BRIDGE_BEFORE,
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(CURRENT_FILE)) {
  const check = process.argv.includes('--check');
  const idempotent = process.argv.includes('--idempotent');
  const fromV23 = process.argv.includes('--from-v23');
  const fromV24 = process.argv.includes('--from-v24');
  const fromV25 = process.argv.includes('--from-v25');
  const fileArgumentIndex = process.argv.indexOf('--file');
  const filePath = fileArgumentIndex >= 0 ? process.argv[fileArgumentIndex + 1] : DEFAULT_FASTAGENT_CLI_FILE;
  if (!filePath || filePath.startsWith('--')) {
    throw new Error('--file requires a FastAgent cli.js path.');
  }
  const fromVersionFlags = [fromV23, fromV24, fromV25].filter(Boolean).length;
  if (fromVersionFlags > 1) {
    throw new Error('--from-v23, --from-v24 and --from-v25 are mutually exclusive.');
  }
  const result = fromV25
    ? patchFastAgentCliV25ToV26File(filePath, { check })
    : fromV24
      ? patchFastAgentCliV24ToV25File(filePath, { check })
      : fromV23
        ? patchFastAgentCliV23ToV24File(filePath, { check })
    : patchFastAgentCliFile(filePath, { check, idempotent });
  const action = check ? 'validated' : result.changed ? 'patched' : 'already patched';
  const scope = fromV25
    ? 'V25-to-V26 compatibility patch'
    : fromV24
      ? 'V24-to-V25 compatibility patch'
      : fromV23
        ? 'V23-to-V24 compatibility patch'
        : 'compatibility patches';
  process.stdout.write(`FastAgent CLI ${scope} ${action}: ${result.filePath}\n`);
}

function hasTerminalPatchSet(source) {
  return [
    classifyPatchSet(source, V24_PER_TURN_TOOL_DENY_PATCHES),
    classifyPatchSet(source, V25_SANDBOX_AUTH_PATCHES),
    classifyPatchSet(source, V26_OPENCODE_SESSION_HEADER_PATCHES),
  ].every((state) => state === 'patched');
}
