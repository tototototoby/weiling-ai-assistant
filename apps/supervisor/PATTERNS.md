# PATTERNS

## Per-Bot Sandbox Runtime Pools

- Remote sandbox pool identity is `botInstanceId`. `ownerUserId` is display metadata only and must never be used as the child-process, credential, port, capacity, workspace-map, health, or restart key.
- `ProcessManager` must resolve sandbox credentials through `BotSandboxRuntimePoolRepository.ensureForBot()` before spawning a Bot. A disabled pool fails only that Bot with `SRT_POOL_DISABLED`.
- The private pool config and status documents are version 2 and contain one entry per Bot. Each workspace-map file is named `<botInstanceId>.json` and may register only that Bot's workspace.
- The default per-Bot capacity is `poolSize=1` and `minReadyProcesses=1`; administrators may increase capacity for an individual Bot.
- The sandbox-runtime manager remains one container, but it must key child processes by `botInstanceId` so health failure, restart, and capacity changes do not affect sibling Bots owned by the same user.
- A successful `/pool/status` HTTP response is not enough to keep a Bot pool: the inner runtime must report `initialized=true`, `shuttingDown=false`, complete non-negative stats, no `stopped` / `error` worker, and enough `ready + busy` capacity. Terminal workers restart only that Bot child immediately; a capacity deficit must persist for ten seconds before replacement. A same-config replacement receives a 30-second per-Bot cooldown so a persistent inner/outer crash cannot create a two-second restart storm; explicit config/restart intent bypasses the cooldown.
- FastAgent V25 must not treat a reconnected Socket.IO transport as ready until the per-Bot sandbox client is authenticated again. Automatic reconnect authentication and concurrent session/tool requests share one promise; an already connected and authenticated client stays on the fast path, while authentication failure propagates instead of creating an unauthenticated session.

## Sandbox Runtime Resource Sampling

- CPU percentages require two `/proc/<pid>/stat` samples. The first manager or pool sample may be unavailable; later reconcile passes publish the delta-derived value.
- Manager and per-pool resource samples are projected into the shared status document. Web reads that document and does not inspect container processes directly.

## Proactive Message Delivery

- Web writes `admin_message_deliveries`; Supervisor claims pending rows, sends through the child FastAgent IPC channel, and marks `sent` only after the child reports a successful native `proactive` delivery.
- The FastAgent patch requires exactly one active binding before an admin or meal message can leave the process. Missing or ambiguous bindings fail the row and retry rather than guessing a recipient.
- Delivery IDs are stable across retries. The patched child checks its durable delivery journal for a sent semantic key before sending again, covering supervisor timeouts after the platform accepted a message.
- Missed scheduled-task recovery separates model generation from delivery: the returned final text must pass through the IM-only sender with `scheduled-recovery:<recoveryId>` as both delivery ID and semantic key. Only a successful sender result may mark the recovery `delivered`; model completion alone is not delivery evidence.
- When deferred delivery is enabled, an exhausted row becomes durable `waiting_for_user` state instead of entering a blind periodic retry loop. Disabling the policy converts existing waiting rows to terminal `failed`.
- A successfully completed Weixin or WeCom inbound turn wakes only that Bot's waiting rows and immediately attempts them once. The child activity IPC carries no Bot identity; Supervisor derives identity from the child registry and treats wakeup callbacks as best-effort.

## WeCom Long Connection

- Supervisor is the only owner of the official WeCom WebSocket client. Web writes global credentials, Bot bindings, and reconnect intent to SQLite; it must never open a second connection.
- A WeCom `userid` binds directly to one Bot. Optional employee metadata does not participate in routing. WeCom and Weixin turns use the same FastAgent binding session, workspace, memory, tools, and per-Bot sandbox.
- Unbound or disabled employees stay in the Supervisor-owned onboarding flow. The first prompt and submitted name never enter FastAgent; all user-facing onboarding text comes from the dynamic administrator-message copy.
- A successful name match must pass the rendered response and inbound `msgid` into the repository so the binding and completed onboarding receipt commit in one immediate transaction. Supervisor must not complete the receipt again after `bindByName()` succeeds.
- WeCom inbound `msgid` values are accepted durably before a model turn. Duplicate callbacks receive a completed acknowledgement and never run the model twice.
- The gateway sends one immediate non-final stream acknowledgement, runs the external turn through child IPC, then finishes the same stream. Oversized UTF-8 replies finish with the first chunk and continue through proactive WeCom messages.
- Proactive delivery prefers the connected, enabled Bot WeCom binding. SDK delivery errors are recorded by Bot ID and return control to the existing Weixin sender.
- The FastAgent patch schedules external turns on the active binding's existing conversation scheduler. Stdout JSONL remains lifecycle-only and must never be used to recover model reply text.

## Feishu Inbound Resources

- Feishu file and image events are downloaded with the Bot identity into `workspace/feishu-inbox/<messageId>` before the external turn. The Agent receives only the sanitized original name and workspace-relative path; receiving an attachment alone must never install, extract, or execute it.
- Resource identifiers, filenames, real paths, regular-file type, symlink boundaries, a 50 MiB size cap, and a 120-second timeout are validated before the file enters the conversation. Failed downloads mark the event failed and return a permission-oriented notice.
- Event handling is serialized by `botInstanceId + chatId`, so a file finishes staging before immediately following text enters the same session; unrelated chats remain independent. Non-mentioned group resources are ignored before download.
- Feishu P2P and group external turns use a 20-minute controlled timeout. P2P keeps the employee's main session but passes per-run `denyTools=[send_im,send_im_media]`; the pinned FastAgent patch filters those names from that run's visible tool context without mutating the persistent session tool view. Generated P2P files primarily return through explicit `[飞书文件: ...]` markers. Only when no explicit marker exists may the current final reply's Markdown inline-code relative image paths act as a narrow fallback; nonexistent or invalid implicit references are ignored, the gateway never scans the workspace, keeps those paths in the text reply, and still requires the canonical workspace sender's containment and non-symlink checks.
- The P2P system prompt treats creating, sending, resending, and viewing an existing file identically: every physical delivery requires a valid `[飞书文件: 工作区相对路径]` marker. A model may not claim that a file was sent or delivered when it has no valid workspace-relative path and marker.
- A pending Feishu P2P external turn sends generic, non-sensitive progress replies at 2, 5, and 10 minutes. Each update uses a stable per-message idempotency key, progress-send failures never fail the main turn, and all not-yet-fired timers are cancelled when the turn resolves or rejects. Raw model text, tool names, commands, and tool output are never forwarded as progress.
- Group output attachments require an explicit `[群文件: ...]` marker from the current turn. The marker may resolve only inside that Bot's canonical workspace; arbitrary absolute paths, traversal and final/parent symlinks are rejected per item without blocking the text reply or other valid attachments. The gateway never scans recent workspace images as an implicit fallback.
- Group attachment dedupe is scoped by `chatId + canonicalPath + mtime` and is recorded only after the Lark send succeeds. Failed or rejected markers do not block valid siblings and produce a count-only follow-up notice; logs must never claim `Sent` before the send call resolves.
- Group mention detection is fail closed and requires the rendered text to contain the exact `@<appName>` mention boundary; filenames containing the app name, mentions of other users, or an unavailable app name must not enter the group session.

## Meal Reminder Scheduler

- `MealReminderScheduler` is the source of truth for meal reminders; Agents must not create FastAgent cron jobs for this feature.
- Workday checks use the versioned China calendar asset and fail closed for uncovered years. Rain is determined from Xiamen Open-Meteo hourly amount, probability, or WMO rain codes.
- Daily reminders enter `admin_message_deliveries` with the stable `meal:<botId>:<date>` ID before `lastReminderDate` is written. Queue retries and `waiting_for_user` recovery own physical delivery; duplicate scheduler passes reuse the same row.
- Scheduled queue rows preserve their stable semantic key when handed to FastAgent. Ordinary administrator messages keep their existing `admin:<deliveryId>` behavior.
- Failed consent prompts use bounded 5-minute to 24-hour backoff instead of minute-level blind retries. A successful inbound Weixin or WeCom turn clears only that Bot's backoff and retries its unasked prompt immediately.

## Global Agent Config Projection

## Dify MCP Projection

- `global_dify_configs` is the control-plane source of truth; `DifyConfigReconciler` ensures the managed `weclaws_managed` stdio server exists in each Bot `data/settings.json` while preserving employee-owned fields and servers.
- The managed settings entry contains only the fixed container command and script path. Dify API keys and database URLs are injected into the child environment at process start and never persisted in settings or returned by Web DTOs.
- A Dify revision is marked applied only after the settings projection succeeds. Active desired-running Bots receive a durable restart intent so the next FastAgent process observes the latest environment; stopped Bots are picked up on their next start.
- Invalid or symlinked settings targets fail closed and leave the existing file untouched; each Bot sync error is isolated from the remaining reconciliation pass.
- The managed Dify tool is the first route for named company-person lookups (name, department, title, phone, email, or other contact details). Local employee-list completeness is not a prerequisite; the Agent reports a Dify no-result instead of guessing.

## RAGFlow MCP Projection

- `global_ragflow_configs` is the control-plane source of truth. `RagflowConfigReconciler` reuses the managed `weclaws_managed` stdio server and records each Bot's applied revision independently from Dify.
- RAGFlow API keys, dataset IDs, and base URLs are injected only into enabled Bot child environments. Bot `settings.json` contains only the fixed managed MCP command and never stores these secrets.
- `ragflow_knowledge_query` calls the configured RAGFlow `/api/v1/retrieval` endpoint, caps returned chunks and content length, and exposes only content, document name, and similarity.
- A RAGFlow revision change requests a durable restart for active desired-running Bots. Stopped Bots receive the current environment on their next start.

- SQLite owns the global `AGENTS.md`, `SOUL.md`, Skill enablement policy, and per-Bot applied revision. Web changes intent; supervisor is the only publisher into Bot workspaces.
- A missing global config is seeded from `resources/agent/global/{AGENTS.md,SOUL.md}` and the managed-Skill manifest. Existing database content is never silently replaced by seed files.
- Every reconcile pass ensures a sync-state row for every Bot. New Bots therefore inherit the current global revision without an administrator opening the management page.
- `AGENTS.md` and `SOUL.md` are written through same-directory temporary files and atomic rename; symbolic links and non-regular targets are rejected.
- Enabled Skill names are passed to the shared managed-Skill synchronizer. Disabled directories are removed only when weiling ownership markers/metadata prove they are managed; user-owned conflicts remain untouched.
- A Bot with a current database revision is still checked for document and managed-Skill metadata drift, so manual full Skill sync cannot permanently re-enable centrally disabled Skills.
- Bot-specific administrator appendices are loaded from SQLite and appended after the global `AGENTS.md` / `SOUL.md` baseline. They cannot remove the global safety baseline, are drift-checked like global documents, and use an independent per-Bot revision.
- Global publication failure is isolated per Bot and does not block morning-briefing policy projection or Bot process reconciliation.

## Morning Briefing Policy Projection

- SQLite policy rows are durable intent; only supervisor projects them into each Bot workspace.
- Every reconcile pass first ensures a policy row exists for every Bot, then writes `workspace/.gaozhiling/morning-briefing.json` through `resolveBotInstancePaths()` and an atomic rename.
- Workspace-owned legacy fields such as `scheduleTaskId`, `scheduledFor`, and `createdAt` survive policy projection during migration.
- Every projected state uses `deliveryMode=supervisor`, `needsSchedule=false`, and `needsCleanup=false`; Agents must not create or reconcile morning-briefing cron tasks.
- `policyVersion` remains the managed Skill contract version (`2026.2`); the database intent revision is projected separately as `adminPolicyRevision` so the Skill initializer and the admin control plane do not overwrite each other's version marker.
- Employee `userOptOut` is observed back into SQLite and disables the effective policy unless the administrator explicitly sets `forceEnabled`; force mode clears the workspace opt-out.
- A managed configuration change invalidates `centralScheduledFor`; the central scheduler recomputes it without editing FastAgent scheduled-task storage.
- One malformed Bot state file is recorded as that policy's sync error and must not block the remaining Bot policies or the normal runtime reconcile pass.

## Central Morning Briefing Delivery

- When native Weixin/WeCom delivery fails because no conversation is available, `MorningBriefingScheduler` may enqueue one stable `morning-email:<botId>:<date>` delivery for the claimed employee's company email. The email contains the briefing and a prompt to re-open interaction in Weixin; SMTP remains owned by `EmailDeliveryDispatcher`.
- Open-Meteo geocoding tries the configured city verbatim, then adds `市` for an unresolved 2-12 character Chinese place name without an administrative suffix. Network failures, HTTP 429, and 5xx responses use three bounded attempts; rejected requests must leave the same-day cache so a later delivery can recover. Forecast failure still degrades only the weather section and never blocks the task briefing.

## Global Email Delivery

- Web creates `email_deliveries` and writes the global sender intent; Supervisor alone reads the private password file, claims ready rows, invokes Nodemailer, and records retry state.
- A missing or disabled global email configuration is a no-op for the dispatcher. Passwords and authentication errors are never included in queue payloads or normal logs.

- `MorningBriefingScheduler` owns current scheduling and direct delivery. It uses the approved China workday calendar, per-Bot time and location, per-Bot work tasks, and stable `morning:<botId>:<date>` semantic keys.
- Successful delivery records the local delivery date, delivered timestamp, and next workday schedule. Failed delivery must persist a future `centralScheduledFor` before the next reconcile pass: transient failures retry after five minutes, unavailable Bot processes after fifteen minutes, and unavailable Weixin binding/context failures wait until the next workday slot.
- Weather lookup failure must not block the work plan. A missing task file means no tasks; invalid, oversized, or symlinked task files are isolated to that Bot.
- At most five Bot deliveries run concurrently. A valid same-day legacy one-shot cron defers central delivery to the next workday to avoid a migration-day duplicate.

## Runtime Ownership

- `apps/supervisor` 是唯一的 bot runtime owner
- 对内 workspace package/import 名称统一使用 `@weiling-ai/supervisor`、`@weiling-ai/db`、`@weiling-ai/shared`
- web 层只写 `desiredState` / `restartRequestedAt` / `qrReissueRequestedAt` 这类 durable intent，不直接起停本地进程，也不直接删 FastAgent 登录态文件
- 所有 child process 生命周期和 crash 恢复都由 supervisor 收敛

## Runtime Flow

- reconcile loop 只消费数据库中的期望状态、restart marker 和 qr reissue marker
- stdout JSONL 是唯一机器事件输入；stderr 只做日志，不参与状态机
- runtime 状态变更统一通过 event applier 落到 `bot_instances` 和 `bot_events`
- `ProcessManager.startInstance()` 在真正 spawn 前必须先尝试一次 managed skills 同步，但同步失败或锁 busy 不阻断 FastAgent 启动
- `ProcessManager.startInstance()` 在真正 spawn 前还必须先解析 bot 当前绑定的 LLM profile：只允许读取 `bot_instances.llm_config_id -> user_llm_profiles`，不再回退 supervisor 进程里的 `FASTAGENT_*` 默认值；缺少或找不到 profile 时必须把 bot 收敛成 `failed`
- `ProcessManager.startInstance()` 在 `FASTAGENT_SANDBOX_MODE=remote` 时必须先通过 `BotSandboxRuntimePoolRepository.ensureForBot()` 确认当前 Bot 的独立 SRT pool；pool 被禁用时必须把该 Bot 收敛成 `failed + SRT_POOL_DISABLED`
- `ProcessManager.startInstance()` 在拿到本次生效 LLM 配置后，必须先把 `provider / model` runtime 快照写回 `bot_instances`，再继续 spawn；web 展示只认这份快照
- `ProcessManager.startInstance()` 在 spawn 前阶段如果遇到 bot 级启动失败（例如 binary 不可执行、spawn spec 准备失败），必须记录 supervisor 日志并把该实例收敛成 `failed + FASTAGENT_START_FAILED`；这类失败不能再向外抛到整轮 reconcile
- 已消费的 restart 请求通过 `status=stopping` 区分于 crash；后续 `stopped` 不进入 backoff，而是等待下一轮 reconcile 立即拉起
- `qrReissueRequestedAt` 的处理顺序固定为“先停活进程/孤儿进程，再删登录态文件，再 consume intent，再重新启动”；只要清理或停机没完成，就不能提前消费 intent
- `failed` 不是永久死状态；只要后续写入有效 restart intent，repository 必须先把实例转回可 reconcile 状态，再由 reconcile loop 正常拉起
- `desired_state=stopped` 的实例如果还停留在 `provisioning` 且尚未拉起 child，也必须在 reconcile 中直接落成稳定 `stopped`

## Process Safety

- A successfully applied `stopped` event is terminal even when the OS child remains alive. Supervisor keeps registry ownership, requests termination, escalates to `SIGKILL` after the grace period, and releases ownership only after stdout closes and the apply chain drains.
- Registry cleanup is entry-identity guarded so a delayed callback from an old child cannot remove a replacement child.

- supervisor 启动必须先拿到工作区级单实例锁；同一 `workspaceRoot` 只允许一个存活的 supervisor 进程
- supervisor 进程入口在收到 `SIGINT` / `SIGTERM` 时，必须等待 `startSupervisor()` 启动链 settle；即使信号落在首轮 `reconciler.runOnce()` 期间，也不能直接 `process.exit()` 绕过 `runtime.close()`，否则已经拉起的 FastAgent child 会变成 orphan
- 单实例锁文件固定在 `storage/supervisor.lock`；如果锁文件里的 pid 还活着且看起来像同工作区 supervisor，新实例会先打印 warn、尝试停掉旧实例，再继续启动
- 单实例锁里的 `startedAt` 必须记录操作系统观察到的真实进程 birth time；自动替换旧 supervisor 只能在 live pid 的实际 birth time 与锁文件完全一致时发生，不能只靠 pid 或宽松 command 匹配判断
- 如果锁文件里的 pid 已不存在，新实例会直接回收 stale lock；只有同一进程内重复启动或无法安全停掉旧实例时才会拒绝启动
- 每个 `botInstanceId` 在 supervisor 内只允许一个活动 child process
- 实例操作统一走进程内锁，不在当前基线里引入跨进程分布式锁
- managed skills 同步额外使用 bot 目录下的文件锁，供 `supervisor` 自动同步与 `web` 手动同步串行化
- reconcile 发现 DB 里残留 `processPid + processStartedAt`、但内存 registry 没有该实例时，必须先按真实进程身份回收或确认进程已死，再决定 `markStopped()` 或后续 restart，避免 supervisor 崩溃恢复后重复拉起同一 bot
- `process_started` 事件写入 `processStartedAt` 时，优先使用 supervisor 从操作系统读取到的真实 process birth time；不能直接信任 JSONL 事件时间戳，否则后续 `pid + startedAt` 身份校验会误判 live orphan 为已失效
- 如果只剩 `processPid` 没有 `processStartedAt`，不能盲杀该 pid；活进程要保守跳过并记录错误，死 pid 才允许直接收敛到 `stopped`
- restart backoff 与失败阈值由 restart policy 统一计算，其他模块不自行推导
- child process 退出后，registry 释放必须晚于 stdout 事件 apply 链排空；否则 reconciler 可能在 `stopped` / backoff 尚未落库前抢先拉起新进程
- 非法 JSONL 和 event apply 异常都要走同一条 fatal 收敛路径：记录 runtime error、终止 child、等待既有 `stopped/backoff/failed` 规则接管
- fatal 之后只允许继续处理 `stopping/stopped` 这类终止事件，避免 child 在被杀前继续吐出脏状态覆盖数据库
- 周期性 reconcile 调度必须显式消费 rejected promise；不能再让定时器里的异步收敛错误直接变成未处理拒绝

- A single-flight reconcile pass must retain exclusive ownership while it is pending. If it exceeds `RECONCILE_STALL_TIMEOUT_MS`, Supervisor exits and relies on the container restart policy; it must not clear the in-flight marker and overlap a second lifecycle pass.
- A singleton lock whose PID equals the new process PID is only current when its recorded `startedAt` also matches the OS-observed birth time. Container PID 1 reuse with a different birth time is a stale lock and must be removed.

- The four-attempt terminal threshold still applies to non-network runtime failures. Explicit transient transport errors (`fetch failed`, DNS lookup failure, connection reset, or timeout) stay recoverable after the threshold with one attempt per minute; a successful `running` event resets the counter.

## Mock Runtime

- supervisor 默认从 `apps/supervisor/node_modules/.bin/fastagent` 解析 repo-local FastAgent CLI；`FASTAGENT_BINARY_PATH` 只作为显式 override，且仍不从数据库读取 per-bot binary override
- bot 的 `data/workspace/logs` 目录统一通过 `resolveBotInstancePaths(config.instancesRoot, botId)` 派生
- mock fixture 只用于测试显式传入 `mockScenario` 的场景，child process 通过 `process.execPath` + 绝对 `tsx` import path 启动
- mock fixture 负责输出 `process_started -> qr_code -> login_confirmed -> running`
- crash 场景由 fixture 主动输出 `runtime_error -> stopped(exitCode=1)`，优雅停机输出 `stopping -> stopped(exitCode=0)`

## Real FastAgent Contract

- 真实 FastAgent 启动参数默认是 `fastagent --channel weixin --sandbox remote --sandbox-url <bot-srt-url> --output jsonl`
- `FASTAGENT_SANDBOX_MODE=disabled` 时改为 `fastagent --channel weixin --output jsonl`，并且不再要求 `SANDBOX_URL` / `SANDBOX_API_KEY`，也不能把继承自父进程的 `SANDBOX_*` 继续透传给 child
- `cwd`、`IM_GATEWAY_DATA_DIR`、`IM_GATEWAY_WORKSPACE_DIR` 必须由 `resolveBotInstancePaths(config.instancesRoot, botId)` 派生，不依赖数据库持久化路径
- weiling 当前只托管 `IM_GATEWAY_DATA_DIR/skills`；`workspace/.fastagent/skills` 仍留给用户自管
- `IM_GATEWAY_*` 与 bot 运行所需的 `FASTAGENT_API_KEY` / `FASTAGENT_PROVIDER` / `FASTAGENT_MODEL`（以及 profile 自带的 `FASTAGENT_BASE_URL` / `FASTAGENT_API_TYPE`）都由 supervisor 在 spawn 前统一注入；`SANDBOX_*` 仅在 `FASTAGENT_SANDBOX_MODE=remote` 时从当前 Bot 的独立 SRT pool 注入
- `FASTAGENT_SANDBOX_MODE=remote` 时，supervisor 必须从 `bot_sandbox_runtime_pools` 渲染 `storage/sandbox-runtime-private/srt-pools.json`，并把每个 Bot workspace 登记到 `storage/sandbox-runtime-private/workspace-map/<botInstanceId>.json`；这些文件只允许 supervisor 和 sandbox-runtime 共享，不能暴露在 `instances` 根目录下
- supervisor 不再把一个全局 `SANDBOX_URL` / `SANDBOX_API_KEY` 当作 remote mode 配置；remote mode 的 URL/API key 必须来自 Bot-specific SRT pool
- repo-local sandbox child wrapper 返回给 FastAgent host/tool 层的 session `workspacePath` 必须保持真实 bot `workspace` 路径；`/workspace` 只允许作为 sandbox 内部 bwrap alias 和命令 `cwd` 虚拟根存在，`/state` 约定映射当前 bot `dataDir`
- repo-local sandbox child wrapper 除了翻译 `cwd=/workspace|/state` 之外，还必须在最终 bwrap argv 里把真实 bot `workspace` / `data` 额外 bind 到字面 `/workspace` / `/state`；否则 `bash /workspace/...` 和上游文件工具写入的绝对虚拟路径仍会落到不存在或只读的别名上
- 如果 restored session 在后续命令执行路径里丢失了 weiling 注入的内部真实路径 marker，wrapper 仍必须能根据 `workspaceId + SANDBOX_WORKSPACE_MAP_FILE` 恢复真实 bot `workspace`，再继续把 `/state` 推导回同级 `dataDir`；不能把字面 `/workspace` 直接透传给上游 cwd 解析
- remote sandbox 的主限制必须对目录本身和递归内容同时做 deny-then-allow 收口：`storageRoot`、`instancesRoot`、`SRT_WORKSPACE_BASE_ROOT`、当前 pool `basePath`、`sandbox-runtime-private` 与 `metadataRoot` 都必须进入 deny；否则 session 仍可能通过父目录枚举看到其他 bot、private config 或其他用户的 runtime workspace
- remote sandbox 还必须 deny OS 身份备份文件、mount 表入口和敏感 proc 入口：`/etc/passwd-`、`/etc/shadow-`、`/etc/group*`、`/etc/gshadow*`、`/proc/*/mountinfo`、`/proc/*/mounts`、`/proc/*/mountstats`、`/proc/*/cmdline`、`/proc/*/environ`、`/proc/kallsyms` 与 cgroup 枚举入口；Linux 下不能再直接 deny `/etc/mtab`，因为它是指向 `/proc/mounts` 的符号链接，`bwrap --ro-bind /dev/null /etc/mtab` 会在启动阶段直接失败
- supervisor 渲染 `srt-pools.json` 时必须净化历史 pool `defaultDenyRead` 里的 `/etc/mtab`；运行时 mount 信息降敏统一依赖标准化 `${WEILING_DATA_ROOT}` 宿主路径和敏感 `/proc` 入口 deny，不能再把旧 DB 值原样透传给 sandbox child
- 不能只靠上游默认的 read re-allow 回开当前 bot 根目录；当前 bot 的 `workspace` / `data` / `stateRoot` 可写性必须由 worker 侧在最终 bwrap 命令里再追加一次 `--bind` 恢复，否则 broad deny 会把这些路径重新压回只读
- supervisor app config 不再读取 repo-wide LLM 默认 env；`FASTAGENT_API_KEY`、`FASTAGENT_MODEL` / `FASTAGENT_PROVIDER` 及其 `FASTAGENT_DEFAULT_*` 等价变量现在只属于 contract smoke / 手工 CLI tooling，不属于 runtime 配置面
- child 继承自 supervisor 的父进程环境必须走 allowlist；只能保留系统运行所需变量和常见代理变量（含小写 `http_proxy` / `https_proxy` / `no_proxy` / `all_proxy`），不能把 `DATABASE_URL`、`BETTER_AUTH_SECRET`、管理员白名单或额外全局 `FASTAGENT_*` 默认值泄露给 bot child
- 本地开发入口在直接读取 `process.env` 时，会先尝试加载工作区根目录 `.env` 里的缺省配置；显式传入的自定义 env 不走这个回退
- `src/runtime/resolve-fastagent-binary-path.ts` 是真实 CLI 入口的唯一解析器；默认指向 repo-local `apps/supervisor/node_modules/.bin/fastagent`，`FASTAGENT_BINARY_PATH` 只作 override
- `src/runtime/fastagent-cli-contract.ts` 负责 external smoke 所需的 bare / runtime 命令拼装、stdout JSONL 校验，并复用同一套 FastAgent binary 解析/可运行性判断；只有 binary 可执行且 `FASTAGENT_API_KEY`、模型、provider 运行时配置齐备时，真实 smoke 才允许启用
- `src/runtime/resolve-fastagent-runtime-config.ts` 是 bot 级运行配置的唯一解析入口；它只允许读取 `bot_instances.llm_config_id -> user_llm_profiles`。缺少 `provider / model / apiKey` 时必须抛出 typed error，并让上层把实例收敛成 `failed`
- `qr_code` 事件必须先通过 shared QR validator；当前只接受 `https://liteapp.weixin.qq.com/q/...`
- “重新扫码/重新出码”当前依赖删除 `IM_GATEWAY_DATA_DIR` 下的 `accounts-roster.jsonl`、`accounts-runtime.jsonl` 和 `bindings.jsonl`；这些文件的生命周期只允许 supervisor 管理
- bot 一旦已经记录当前 `processPid`，来自其他 pid 的非 `process_started` 事件必须忽略，避免旧 runtime 的 `qr_code` / `runtime_error` / `stopped` 污染当前状态
- `runtime_error` 事件优先消费结构化 `data.error` 作为 `lastErrorMessage`，`message` 仅作回退
- `running` 事件如果自带 `accountId`，event applier 会顺带回填 `weixinAccountId`，用于 restored session 直接进入 steady state 的路径
- remote sandbox session 当前是懒建立的：`SANDBOX_URL` / `SANDBOX_API_KEY` 只有在首条真实 runtime turn 需要 sandbox 时才会被真正使用，不属于 child process 启动期健康检查

## Container Packaging

- `apps/supervisor/scripts/patch-fastagent-cli.mjs` is the only supported local patch point for the pinned FastAgent CLI package. Every replacement must match exactly once and fail the image build when upstream source changes; runtime container startup must never rewrite dependencies.
- The current `@fastagent/cli@0.8.4` patch keeps sandbox activity POST requests compatible with Fastify 5, routes native `fetch failed` final-delivery errors through FastAgent's existing bounded retry schedule, and gives the initial Weixin QR request a 15-second timeout with three bounded attempts. The production Compose overlay sets the same explicit resolvers and `dns_opt: use-vc` on both `supervisor` and `sandbox-runtime`, so Weixin delivery and sandbox tools such as weather lookup can resolve external hosts over TCP when UDP DNS packets are dropped.
- The pinned patch must classify both `timeout` and `timed out` gateway messages as retryable. Timeout/network gateway retries stay bounded by FastAgent's three-attempt limit and use short 2/3-second initial delays; rate-limit and authentication backoff remains unchanged.
- The same build-time patch turns FastAgent's hidden one-second acknowledgement pacing into one visible, deduplicated Weixin acknowledgement for slow turns. The timer is cancelled when a final or progress response wins the race, and acknowledgement delivery failure never suppresses the final reply.
- Supervisor sends both `assistantName` and the rendered `processingAck` through `weclaws_message_copy` IPC. The child updates `WECLAWS_ASSISTANT_NAME` and `WECLAWS_PROCESSING_ACK`, so both the short first-contact welcome and delayed acknowledgement use the current global copy.
- Saved inbound file attachments must enter the normal FastAgent turn as trusted file references. Pure-file, file-plus-text, and file-plus-image messages may not take the legacy receipt-only short circuit; the model must receive the persisted path and decide which sandbox extraction tool to use.
- Weixin non-final progress is paced at 12 seconds with a 12/30/60-second backoff. Only high-level MCP, web, skill, task, cron, and agent-run progress may become visible; raw tool output, shell commands, and generic tool names remain suppressed. Final replies continue through the existing single deduplicated retry path.

- 当前容器入口固定为 `node apps/supervisor/dist/index.js`
- `apps/supervisor/scripts/build.mjs` 是 supervisor Docker 运行产物的唯一构建入口：它会 bundle `src/index.ts` 以及 workspace 内的 `@weiling-ai/db` / `@weiling-ai/shared`，并把 `packages/db/src/migrations` 复制到 `apps/supervisor/dist/migrations`
- The production bundle must keep `@wecom/aibot-node-sdk` external. It is a CommonJS package that uses Node built-ins through `require`, and the runtime image already carries it in `apps/supervisor/node_modules`.
- `apps/supervisor` 自己声明 `@fastagent/cli@0.8.2` 运行时依赖；Compose 构建直接复用包级 `node_modules/.bin/fastagent`，不再额外全局安装或固定注入 `FASTAGENT_BINARY_PATH`
- repo-local `@fastagent/cli` 版本升级时，`apps/supervisor/package.json`、根 `pnpm-lock.yaml`、`docs/manuals/fastagent-cli-contract.md`、`docs/manuals/version-matrix.md`、`docs/manuals/docker-deployment-runbook.md` 必须在同一次改动里同步，并由 `apps/supervisor/src/__tests__/compose-config.test.ts` 锁住
- Compose 默认会在本仓库内构建 `sandbox-runtime` 运行镜像，并通过 `infra/docker/sandbox-runtime.versions.env` 固定 `@fastagent/sandbox-runtime` 版本；当前默认基线是 `0.5.7`
- `sandbox-runtime` 镜像构建时必须删除 Debian 账号数据库备份文件 `/etc/passwd-`、`/etc/shadow-`、`/etc/group-` 和 `/etc/gshadow-`；session denyRead 仍保留这些路径作为运行期兜底
- `sandbox-runtime` 的发布镜像构建任务不能硬编码或传入 `SANDBOX_RUNTIME_NPM_VERSION`；生产 `latest` 镜像必须走同一个 Dockerfile 版本文件默认值
- Compose 默认还会通过 `AGENT_BROWSER_NPM_VERSION` 固定 `agent-browser` 版本；当前基线是 `0.27.0`
- Compose 默认还会通过 `LARK_CLI_NPM_VERSION` 固定官方 Feishu/Lark CLI；当前基线是 `@larksuite/cli@1.0.32`
- CNB 远程 `sandbox-runtime` 发布任务如果显式传入 `AGENT_BROWSER_NPM_VERSION`，必须与 `infra/docker/sandbox-runtime.Dockerfile` 的默认值保持一致，并由 `compose-config` 回归测试锁住；不能让远程镜像 build-arg 覆盖回旧版本
- CNB 远程 `sandbox-runtime` 发布任务如果显式传入 `LARK_CLI_NPM_VERSION`，也必须与 `infra/docker/sandbox-runtime.Dockerfile` 的默认值保持一致，并由 `compose-config` 回归测试锁住；不能让远程镜像 build-arg 静默漂到不同的 Feishu/Lark CLI 基线
- Compose 默认还会通过 `BUN_VERSION`、`PNPM_VERSION`、`UV_VERSION` 固定额外预装的 JS / Python 工具链基线；当前默认分别是 `bun@1.3.13`、`pnpm@9.15.4`、`uv@0.11.7`
- 上游 `sandbox-runtime` 现在只给 session command 注入系统目录 PATH 基线；`sandbox-runtime` 镜像自身必须默认导出 `SANDBOX_COMMAND_EXTRA_PATHS=/usr/local/bin`，Compose 也必须显式透传同一个值给 per-Bot SRT child，才能让镜像里通过 npm/curl 安装到 `/usr/local/bin` 的 `node`、`lark-cli`、`bun`、`pnpm`、`uv` 等 CLI 在 sandbox 命令执行里继续可见
- `sandbox-runtime` 镜像里的 `bun` 必须安装在 sandbox session 可见的系统路径（当前固定 `/usr/local/bin`）；不要再装到 `/root/.bun/bin`，因为 remote sandbox 本身会 deny `/root`
- Linux `amd64` 上的 `bun` 必须固定使用官方 `linux-x64-baseline` 资产，而不是让安装脚本按构建机 CPU 自动挑版本；否则镜像如果在支持 AVX2 的 builder 上构建，部署到不支持 AVX2 的老 x64 CPU 会直接 `Illegal instruction` / core dump
- Compose 的 per-Bot SRT 默认基线固定为 `SRT_DEFAULT_POOL_SIZE=1`、`SRT_DEFAULT_SESSION_TIMEOUT_MS=600000`、`SRT_DEFAULT_MIN_READY_PROCESSES=1`、`SRT_DEFAULT_MAX_CONCURRENT_INIT=1`；管理员可以按 Bot 提升容量，这些默认值必须同时注入 `web` 和 `supervisor`
- Compose 默认还会提供 `browserless` sidecar 作为受支持的远程浏览器后端；浏览器自动化的产品路径固定为 `sandbox-runtime` 内的 `agent-browser -p browserless` 或显式远程 `--cdp` 连接远程浏览器后端，不再支持在 nested sandbox 内直接 launch 本地 Chromium
- 一次性截图、PDF、scrape 这类 one-shot 远程浏览器任务可以直接调用 Browserless；但当前托管 skill 仍统一放在 `agent-browser` 下，不额外拆分 Browserless skill
- 如果 Browserless 或远程 CDP 连接不可用，browser automation 必须直接报阻塞；不要回退到本地浏览器启动、本地浏览器安装或宿主机浏览器会话
- 官方公开的 Feishu/Lark skill bundle 当前已进入 managed bundle 默认同步清单：收编范围固定为 24 个 `lark-*` skills（与官方公开 catalog 对齐，不包含 `lark-vc-agent`）；为降低上游同步漂移，必须连同 `references/`、`scripts/`、`assets/` 一起 vendor，不要只同步 `SKILL.md`
- `ppt-skill` is intentionally external and is not part of the managed bundle or default-sync set; its assets must be reviewed for redistribution before an operator installs it separately.
- `editorial-card-screenshot` 当前已进入 managed bundle 默认同步清单；其截图链路固定为 Browserless direct：skill 侧只允许用 `curl + python3` 把自包含 HTML 提交到远程 `/screenshot` API，不允许本地 Chrome / Chromium、宿主机浏览器或 `file://` 路径回退；如果卡片依赖图片或图标，必须内联或使用远程可访问资源
- repo-local `sandbox-runtime` 镜像入口固定走 `infra/sandbox-runtime/entry.mjs` manager；manager 读取 `srt-pools.json`，按 enabled Bot pool 启停 `srt-child-entry.mjs`
- sandbox-runtime manager 的 `/health` 必须返回最近一次 `srt-pool-status.json` 同源的聚合状态；单个 Bot pool `starting` / `degraded` / `failed` 时 manager 可以保持 HTTP 200，但 body 里的 `state` 必须反映降级。
- sandbox-runtime manager 判断 per-Bot SRT child 是否可复用时，不能只看 Node child process 是否存在；必须探测 child `/pool/status` 并把 pool stats 与 `lastHealthAt` 写入 status 文件，启动宽限期后探活失败必须重启 child。
- sandbox-runtime manager 停 per-Bot SRT child 必须先 `SIGTERM`、等待退出宽限期、再用 `SIGKILL` 兜底；`child.killed` 只能表示信号已发送，不能当作进程已退出。
- sandbox-runtime manager 的 reconcile / stopAll 必须在 manager 进程内串行执行；interval、file watcher 或 shutdown 不能并发修改 `children` map，也不能并发写同一个 status 临时文件。
- `srt-child-entry.mjs` 是唯一允许启动 `SandboxAPI` 的子进程入口；它会读取 `SANDBOX_WORKSPACE_MAP_FILE`，保留对外 session root 为真实 bot `workspace`，并在命令执行前把虚拟 cwd `/workspace` / `/state` 翻译回真实 bot `workspace` / `data`
- child wrapper 还会通过 `NODE_OPTIONS=--import=.../worker-bootstrap.mjs` 给 sandbox worker 预加载 weiling bootstrap；这个 bootstrap 负责在 Linux 下把当前 session 的 `allowWrite` 根追加回最终 bwrap 参数，避免对 `storageRoot`、`instancesRoot`、`SRT_WORKSPACE_BASE_ROOT`、pool `basePath` 等父级目录的 deny 重新把当前 bot 压成只读
- worker bootstrap 还必须把 `virtualPathAliases` 追加成最终 bwrap `--bind <real> /workspace|/state`；如果上游重建 config 时剥离自定义字段，bootstrap 必须从当前 bot 的 `workspace` / `data` write roots 推导同样的 alias bind，让 sandbox 内命令正文里直接引用 `/workspace/...`、`/state/...` 时也命中当前 bot 的真实目录，而不是只靠 `cwd` 翻译兜底
- worker bootstrap 在追加 `/workspace` / `/state` alias bind 前必须先确保这些根级挂载点已存在；Linux bwrap 在 `--ro-bind / /` 后不能再创建缺失的根级目标目录，否则任何后续 `bash` / `glob` 命令都会在执行用户命令前失败
- Linux writable rebind 只能插在最终 bwrap argv 的 filesystem bind 阶段末尾、PID namespace 阶段之前；不能简单按 `--` 分隔符回插，否则会把 `--bind` 放到 `--unshare-pid` / `--proc` 之后，直接打坏真实命令执行链
- sandbox-runtime manager 必须只通过 supervisor 渲染的 private config 文件管理 per-Bot SRT child；不要让 manager 读取 SQLite，也不要直接执行未打 weiling patch 的全局 `fastagent-sandbox`
- 当前 wrapper 仍直接 patch 已发布 `sandbox-runtime` tarball 里的内部 `dist/**` 模块；升级 `SANDBOX_RUNTIME_NPM_VERSION` 时必须确认发布包仍包含 `dist/core/WorkspaceManager.js`、`dist/core/SandboxProcessPool.js`、`dist/api/SandboxAPI.js`、`dist/config/default.js`、`dist/utils/errors.js`，以及上游 `@anthropic-ai/sandbox-runtime/dist/sandbox/sandbox-manager.js`
- Compose 的 per-Bot SRT 默认网络策略跟随上游 denylist contract：使用 `SRT_DEFAULT_DENIED_DOMAINS`，空值表示 allow-by-default；不要再加回 `SANDBOX_DEFAULT_ALLOWED_DOMAINS` 兼容层
- Compose 的 `supervisor` 服务必须显式透传 `FASTAGENT_SANDBOX_MODE`；不要依赖 compose 插值变量自动进入容器环境
- Compose 的 `sandbox-runtime` 服务必须和 `web` / `supervisor` 共享同一份 `claws_instances` 卷，并挂到同一个 `/app/storage/instances` 路径；否则真实 workspace 映射即使命中，runtime 也无法访问 bot 工作区
- Compose 的 `sandbox-runtime` 服务还必须和 `web` / `supervisor` 共享私有 `sandbox_runtime_private` 卷，并挂到 `/app/storage/sandbox-runtime-private`；`srt-pools.json`、`srt-pool-status.json` 和 per-Bot workspace map 只能放在这条私有共享路径下
- Compose 的 `sandbox-runtime` 服务入口是 manager health port；只注入 `SRT_POOL_CONFIG_FILE`、`SRT_POOL_STATUS_FILE`、`SRT_MANAGER_PORT` 这类 manager 配置，不再注入全局 `API_KEY` / `POOL_SIZE` / `SANDBOX_DEFAULT_*` 单池 env；`LOG_LEVEL` 必须继续透传到 per-Bot child，保证 manager 与 child runtime 观测粒度一致；远程浏览器路径允许额外透传 `BROWSERLESS_API_URL` / `BROWSERLESS_API_KEY`，并由 weiling wrapper 显式补进 session command env，保证 `agent-browser -p browserless` 与 Browserless direct skill 在 nested sandbox 内可见
- Compose 的 `sandbox-runtime` 服务必须先 `cap_drop: [ALL]`，再只加回 `SYS_ADMIN` 和 `NET_ADMIN`，并使用 `cgroup: private`；同时除了 `seccomp=unconfined` 之外，还必须显式设置 `apparmor=unconfined`。Ubuntu 24 默认的 `docker-default` AppArmor profile 会让 bubblewrap 在 mount namespace 阶段直接拒绝命令执行
- 生产环境如果切到 `infra/compose/docker-compose.prod.yml`，必须用 `${WEILING_DATA_ROOT}` bind mount 显式把 `sqlite`、`instances`、`sandbox-user-workspaces` 和 `sandbox-runtime-private` 落到宿主机目录；不要把生产运行态继续藏在 Docker named volume 里
- 生产发布使用的有序 Compose 文件集必须被视为不可拆分的部署身份；站点/release 部署在 `config`、`up`、`logs`、`exec` 和回滚时都要重复同一组 `-f`。单服务 `up --no-deps` 也不能省略 `docker-compose.prod.yml`，否则基础 Compose 会把真实 bind mount 静默替换为 named volume，容器可能 healthy 但 Bot 列表为空
- 滚动 Supervisor 前必须从最终 `docker compose ... config --format json` 核对镜像和 `services.supervisor.volumes`，并在启动后同时验证挂载源、业务 Bot 数量、子进程数量和 SQLite 完整性；只看容器状态不构成发布成功
- 生产 Compose override 现在同时拉起 `browserless` sidecar；不要把受支持的远程浏览器执行路径重新收回到 supervisor 或宿主机
- 公开仓库的 `docker-compose.prod.yml` 默认拉取 `ghcr.io/yokingma/weclaws/{web,supervisor,sandbox-runtime}:latest`；如果切换到别的镜像仓库，必须连同 Compose 回归测试和部署手册一起更新
- AI 在 remote sandbox 内直接调用的浏览器、媒体、文档和文件处理 CLI 必须收口到 `sandbox-runtime`，不要继续把这类能力加到 `supervisor` 镜像里
- 当前 `sandbox-runtime` 运行镜像会额外预装 `agent-browser`、`lark-cli`、`bun`、`pnpm`、`uv`、系统 `python3`、`gh`、`ffmpeg`、`jq`、`zip`、`unzip`、`file`、`poppler-utils`、`pandoc`；其中 PDF / `.docx` 仅覆盖纯文本提取，不包含 OCR 或 `.doc` 兼容链；浏览器自动化的受支持路径固定为 Browserless sidecar，`--cdp` 仅保留为运维/调试兜底
- Compose 相关回归测试要锁住跨服务的环境注入 contract；当前至少需要覆盖 `web` 容器的 `WEB_ADMIN_EMAILS` / `WEB_USER_BOT_LIMIT` 和核心 web env，避免 `standalone` 运行层因为拿不到宿主机根 `.env` 而静默漂移
- 即使 sandbox 改为 repo-local packaging，应用层边界也不变；FastAgent child 只依赖 Bot-specific `SANDBOX_URL` / `SANDBOX_API_KEY` 和既有 HTTP / Socket.IO contract
- Compose 部署路径固定为仓库内四服务拓扑（`web`、`supervisor`、`sandbox-runtime`、`browserless`）；不要重新引入 external sandbox override 或 `SANDBOX_RUNTIME_IMAGE`
- `resolve-fastagent-binary-path` 的默认 repo-local binary 解析不能依赖源码目录层级；必须同时兼容 source path 和 `dist/index.js` bundle path
- 使用 pnpm workspace 分阶段构建镜像时，不能只复制 root `node_modules`；运行层至少还要保留 `apps/supervisor/node_modules`，供 dist 入口解析 `fastagent` 与 `better-sqlite3`
- 当前 `supervisor` 运行镜像会额外预装 `curl`、`gh`、`ffmpeg` 作为首批官方托管 skills 的基础工具层；这类通用 CLI 可以进镜像，但用户 API key、OAuth token、设备配对态等敏感或个性化状态不能烤进镜像
- `supervisor` 运行镜像还必须包含 `procps`，因为单实例锁和 runtime process identity 依赖容器内 `ps` 读取真实进程 birth time；缺它会在容器里直接报 `Unable to determine process start time for pid 1`
- 当前 supervisor 容器至少需要保留：
  - `apps/supervisor/node_modules`，提供 repo-local `fastagent`、`better-sqlite3` 和开发态 `tsx`
  - `packages/db/node_modules`，供容器内手工执行 `pnpm --filter @weiling-ai/db db:migrate` 之类运维命令
  - `packages/shared/node_modules`，供 workspace 源码运维命令复用依赖解析
