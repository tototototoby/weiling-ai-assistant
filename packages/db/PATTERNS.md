# PATTERNS

## Source Imports

- workspace 对外入口统一使用 `@weiling-ai/db` 与 `@weiling-ai/shared`
- 包级测试通过 [`vitest.config.ts`](./vitest.config.ts) 把 `@weiling-ai/shared` 指回 workspace 源码，避免 Vitest 在包目录下丢失 monorepo alias
- `packages/db/src` 内部相对导入统一使用 extensionless path
- 原因：
  - `tsc` / `vitest` 可以接受多种写法
  - 但当 Next.js 直接消费 workspace TS 源码时，`.js` 后缀相对导入更容易触发 Turbopack 解析失败

## Migration Path Resolution

- migration 默认目录通过当前文件绝对路径推导：
  - `fileURLToPath(import.meta.url)` -> `path.dirname(...)` -> `path.join(..., 'migrations')`
- 源码直跑时默认目录是 `src/migrations`；如果 db 代码被 bundle 进 supervisor Docker 产物，调用方必须把 migration 文件一并复制到 bundle 输出旁边的 `dist/migrations`
- 不直接在模块顶层写 `new URL('./migrations', import.meta.url)`，避免 bundler 把 migrations 目录视为待解析模块

## Runtime Boundaries

- Global email configuration is durable administrator intent in `global_email_configs`; the SMTP password is server-only file state under `storage/secrets` and never belongs in SQLite or browser DTOs.
- `EmailDeliveryRepository` owns idempotent `semanticKey` queue rows and atomic claim/sent/failure transitions. SMTP transport and retry scheduling remain in Supervisor.

- Bot-level sandbox runtime pools use `src/schema/bot-sandbox-runtime-pools.ts` and `src/repositories/bot-sandbox-runtime-pool-repository.ts`. The legacy user pool table remains available only for rollback and migration `0015` backfill; the Bot repository never reads or allocates against it.
- `BotSandboxRuntimePoolRepository` owns one pool per `bot_instance_id`, including unique child/API/proxy allocation, restart intent, and Bot-scoped policy updates. Bot deletion cascades the pool row.

- Employee onboarding state is durable SQLite state: reusable links are separate from legacy one-time registration invites, employee claims are reserved and finalized atomically, and a normalized name match must resolve to exactly one enabled unclaimed employee.
- Morning briefing policy intent, workspace projection, and central delivery facts are independent fields. Administrator changes invalidate `centralScheduledFor`; successful direct delivery atomically advances the next schedule, while failures preserve the due schedule for retry.
- `claimReservationWithoutUser()` finalizes a claim without populating `claimed_by_user_id`; it still records `claimed_at`, preserves the invite audit link, and increments invite usage in the same immediate transaction.
- Public-QR claims also persist `claimed_bot_instance_id` so the web layer can recover the same Bot after a lost response; this is an association for recovery, not a repository-owned Bot lifecycle operation.
- Employee onboarding must not delete a Bot after `claimReservationWithoutUser()` succeeds. A later start failure leaves the durable Bot claim intact so the same invite and name can retry and request the running intent again.
- `EmployeeDirectoryRepository.deleteById()` is the administrator maintenance delete and may remove claimed or unclaimed rows. It does not own Bot deletion; that lifecycle remains in the web service layer.

- `createDatabaseClient()` 负责 SQLite 连接、父目录兜底创建和 Drizzle schema 注入；fresh 环境不依赖仓库内预置 `db.sqlite`
- `migrateDatabase()` 负责应用迁移，默认读取“当前运行文件同级的 `migrations` 目录”
- repository 层保持纯 DB 读写，不夹带 web/runtime 逻辑
- `UserRepository.countAll()` 只暴露用户总数聚合，不下沉“谁可以首个注册”这类 auth 规则；白名单和 bootstrap 判定继续留在 web 层
- 用户级 LLM profile 统一走 [`src/schema/user-llm-profiles.ts`](./src/schema/user-llm-profiles.ts) + [`src/repositories/user-llm-profile-repository.ts`](./src/repositories/user-llm-profile-repository.ts)
- `user_llm_profiles` 保存 owner-scoped 的命名 profile；每条 profile 必须完整携带 `provider / model / api_key`，是否能被 bot 绑定、何时触发 restart 都由 web / supervisor 上层决定，不下沉到 repository
- 旧版用户级 sandbox-runtime pool 仍保留 [`src/schema/user-sandbox-runtime-pools.ts`](./src/schema/user-sandbox-runtime-pools.ts) + [`src/repositories/user-sandbox-runtime-pool-repository.ts`](./src/repositories/user-sandbox-runtime-pool-repository.ts)，仅用于回滚；当前运行时不得从旧 repository 解析 pool

## Bootstrap Claims

- 首个管理员自举注册统一走 [`src/schema/registration-bootstrap-claims.ts`](./src/schema/registration-bootstrap-claims.ts) + [`src/repositories/registration-bootstrap-claim-repository.ts`](./src/repositories/registration-bootstrap-claim-repository.ts)
- bootstrap claim 只维护一条 singleton 行；repository 必须在 SQLite `immediate` 事务里同时检查“当前用户总数是否仍为 0”以及“现有 claim 是否已释放或过期”
- `claim()` 抢到后返回 server-only `claimToken`；`release()` 只清空当前 token 对应的活动 claim，不负责上层 auth 规则判断

## Registration Invites

- 邀请码持久化统一走 [`src/schema/registration-invites.ts`](./src/schema/registration-invites.ts) + [`src/repositories/registration-invite-repository.ts`](./src/repositories/registration-invite-repository.ts)
- `registration_invites.code` 必须保持唯一；邀请码生成策略在 web 层，db 层只保证唯一约束和消费原子性
- `registration_invites.reservation_token` 必须保持唯一；reservation 通过 `reservation_token / reserved_at / reserved_by_email` 表示，不引入额外状态枚举
- `reserve()` 只能命中“尚未使用且未被占用，或现有 reservation 已过期”的记录；抢占失败时必须返回 `null`
- `deleteUnusedById()` 只能删除 `unused + unreserved` 的记录；只要存在 `usedAt`、`reservationToken`、`reservedAt` 或 `reservedByEmail`，repository 都必须返回 `null`
- `releaseReservation()` 只清空仍未消费的邀请码 reservation 字段，不碰已经 `usedAt` 的审计数据
- `consumeReservation()` 只能完成仍绑定在同一 `reservation_token` 下的记录；如果 reservation 丢失、已释放或已消费，repository 必须返回 `null`
- 邀请码记录保留 `createdByUserId / usedByUserId / usedAt` 审计字段，不做软删除

## Bot Runtime Persistence

- Global WeCom long-connection state is durable SQLite intent. `GlobalWecomConfigRepository.update()` advances the singleton revision only for material configuration changes, while `requestReconnect()` is the explicit operator-intent exception: it requires an enabled config, always advances revision, sets `connecting`, and clears `lastError` plus `observedRevision`. Runtime status writes must still match the current revision.
- `BotWecomBindingRepository` owns one WeCom identity per Bot. The employee association is optional display metadata with `ON DELETE SET NULL`; Bot deletion cascades the binding. `WecomMessageReceiptRepository` uses the upstream message ID as an idempotency key; a receipt claim returns `claimed | processing | succeeded`, reclaims only stale `processing` or `failed` rows, and terminal updates refresh `updatedAt` without allowing a later terminal state to overwrite an earlier one.
- `WecomOnboardingRepository.bindByName()` requires the claimed inbound `messageId` and rendered success response. A successful name match writes the Bot binding, completes that receipt, and removes the onboarding session in one `immediate` transaction; callers must not complete the success receipt in a later step.
- Completed onboarding sessions are disposable coordination state, not binding truth. Successful binding removes them, and a historical `bound` session is reset to a fresh prompt when its active Bot binding no longer exists, so administrator unbinding is never silently reversed.
- `WecomProactiveDeliveryRepository` is the generic outbound ledger for administrator messages, morning briefings, and meal reminders. Callers supply stable `semanticKey` and `deliveryId`; `sent` is terminal for normal retries, while stale `delivering` or `failed` rows can be reclaimed. The ledger does not perform WeCom network calls.
- WeCom inbound and outbound ledgers are Bot-owned and do not store or require employee IDs. Their `bot_instance_id` foreign keys cascade so Bot deletion removes channel history without coupling it to employee-directory lifecycle.

- 全局 Dify 配置统一走 `GlobalDifyConfigRepository`，只有实际配置变化才递增 revision，并把已有 `bot_dify_sync_states` 置为 pending；连接测试状态不推进发布 revision。
- `BotDifySyncRepository` 只记录每个 Bot 的 applied revision、同步状态和错误，不读取 `settings.json`，也不暴露 Dify API Key。文件投影和活动进程重启仍由 Supervisor 负责。
- Global RAGFlow configuration follows the same durable-intent boundary through `GlobalRagflowConfigRepository`: only material configuration changes advance its singleton revision and mark existing `bot_ragflow_sync_states` pending; connection-test results never advance the revision.
- `BotRagflowSyncRepository` owns only per-Bot applied revision, convergence status, and sanitized projection errors. It does not call RAGFlow, read Bot workspace files, expose the API key, or restart runtime processes.

- 全局 Agent 发布配置统一走 [`src/schema/global-agent-configs.ts`](./src/schema/global-agent-configs.ts)、[`src/schema/global-agent-skill-policies.ts`](./src/schema/global-agent-skill-policies.ts) 与 [`src/repositories/global-agent-config-repository.ts`](./src/repositories/global-agent-config-repository.ts)。`AGENTS.md`、`SOUL.md` 和公共 Skill 启停策略共用一个 singleton revision；只有实际值变化时 revision 才推进一次，并在同一 `immediate` transaction 内把已有 Bot 同步状态置为 `pending`。
- 每 Bot 发布结果统一走 [`src/schema/bot-agent-config-sync-states.ts`](./src/schema/bot-agent-config-sync-states.ts) + [`src/repositories/bot-agent-config-sync-repository.ts`](./src/repositories/bot-agent-config-sync-repository.ts)。repository 只记录 applied revision、同步状态、错误和时间；不读取或写入 Bot 文件，不下沉管理员认证或 supervisor 文件投影逻辑。
- Bot 专属 Agent 预设统一走 `bot_agent_config_overrides` 当前快照和 `bot_agent_config_override_revisions` 不可变历史。每次保存、恢复历史或清空覆盖都生成新的 Bot override revision，记录管理员邮箱和修改原因；同步状态必须同时匹配全局 revision 与 Bot override revision。
- `GlobalAgentConfigRepository.ensure()` 的初始文档与 manifest Skill 集合必须由上层显式传入；DB 层不读取 `resources` 或宿主机路径。`BotAgentConfigSyncRepository.ensureForAllBots()` 为已有 Bot 物化待发布状态，Bot 删除后依赖外键级联清理。
- Bot 级晨报管理策略统一走 [`src/schema/bot-morning-briefing-policies.ts`](./src/schema/bot-morning-briefing-policies.ts) + [`src/repositories/morning-briefing-policy-repository.ts`](./src/repositories/morning-briefing-policy-repository.ts)。管理员期望值写入时推进 `desired_revision` 并置为 `pending`；supervisor 通过 `markObservedUserOptOut()`、`markSyncSucceeded()`、`markSyncFailed()` 回写策略同步与最小运行时排期观测。
- `ensureForAllBots()` 负责为已有 Bot 物化默认晨报策略；`BotInstanceRepository.listAllForAdministration()` 只提供管理员全量 Bot 清单，不下沉认证规则或管理页 DTO 拼装。
- SRT pool 默认值来自 `@weiling-ai/shared` 的 `SandboxRuntimePoolDefaults`；repository 在 `ensureForBot()` 时把默认值物化进 `bot_sandbox_runtime_pools`
- `ensureForBot()` 必须在 SQLite `immediate` 事务里分配主端口和 proxy port range，确保同机多个 Bot 不会抢到重叠端口段
- `updateByBotInstanceId()` 必须在写入前显式校验 child `port` 和 proxy port range 与其他 Bot pool 不冲突，不要把 SQLite unique constraint 当作业务错误处理
- per-Bot SRT API key 由 DB repository 生成并持久化，只返回给 server-side supervisor/web service；不要暴露给浏览器 DTO
- `workspace_base_path` 是 sandbox-runtime 容器内 Bot pool workspace root，末段必须为 Bot ID；它不能替代 `workspaces` / `bot_instances` 的逻辑关系，也不能引入宿主机路径持久化
- `BotInstanceRepository` 对 runtime 状态迁移暴露语义化窄方法，不对上层开放通用 `updateBotInstance()` 一类接口
- `BotInstanceRepository.countByOwnerUserId()` 只暴露 owner-scoped Bot 数量聚合，供 web 层做每用户创建额度判断；不要把更宽泛的任意条件计数接口下沉到 repository
- `UserLlmProfileRepository` 同样保持窄接口：只允许 owner-scoped `create/list/find/update/delete`；不要在 DB 层引入“解析生效配置”或“批量换绑 bot”这类跨边界逻辑
- `bot_instances.llm_config_id` 是 bot 当前绑定 profile 的唯一持久化真相；`listByOwnerUserIdAndLlmConfigId()` / `updateLlmConfigBinding()` 用于 profile 级 restart 和换绑收敛，不扩展成通用条件更新
- `BotInstanceRepository.updateNameForOwner()` 是 Bot 展示名称的唯一修改入口；必须保持 owner-scoped 且只写 `name / updatedAt`，不要扩展成通用 bot patch 接口
- `BotInstanceRepository.requestQrReissue()` / `consumeQrReissueRequest()` 是二维码重出码 intent 的唯一持久化入口；前者只写 durable intent，且如果命中 `failed` bot 必须先转回可 reconcile 状态，后者在 supervisor 完成 runtime 清理后统一清空 `qrReissueRequestedAt / lastQrCode* / weixinAccountId`
- A trusted `recordQrCode()` transition is positive runtime health evidence and clears stale `lastError*`; untrusted QR events continue through the runtime-error path and must not clear diagnostics.
- restart/backoff/failed 的判定在 supervisor；repository 只负责把已经确定的状态原子写回 SQLite
- `requestRestart()` 如果命中 `failed` bot，必须把它先转回可 reconcile 状态并清零连续 restart 计数；显式二维码重出码同样获得新的 restart budget。“能否再次启动”仍由 supervisor 后续按当前配置和 runtime contract 判断
- `recordRuntimeConfigSnapshot()` 只负责回写 bot 最近一次将应用的 `provider / model` 快照，不在 DB 层解析用户配置或 env fallback
- `findReconcileCandidates()` 只返回可启动或可恢复的 `desired_state=running` 实例，`failed` 由人工或后续命令干预
- `findStopCandidates()` 必须覆盖 `provisioning`，因为 web 创建 bot 后可能在 supervisor 首轮拉起 child 前就收到 stop 命令
- `markRunning()` 可以消费 `running` 事件里已有的 `accountId`，但只做单字段回填，不把登录/恢复判定逻辑下沉到 repository
- 二维码公开分享统一走 [`src/schema/bot-qr-shares.ts`](./src/schema/bot-qr-shares.ts) + [`src/repositories/bot-qr-share-repository.ts`](./src/repositories/bot-qr-share-repository.ts)；每个 bot 当前最多只有一条 active share，`upsertActiveByBotInstanceId()` 必须用 SQLite upsert 收敛并发开启请求，`revokeByBotInstanceId()` 没有 active share 时必须返回 `null`，public lookup 只允许按 `token_hash` 命中
- `bot_instances` / `workspaces` 不持久化任何宿主机绝对路径，包括 FastAgent binary、workspace/data/log 目录
- runtime 目录结构由 web / supervisor 在 DB 外部派生；repository 只维护逻辑主键、所属关系和 runtime 状态
- `WorkspaceRepository.deleteById()` 负责删除 bot 所属 workspace，并依赖现有外键级联一起清掉 `bot_instances` / `bot_events`；“只有完全停止的 bot 才允许删除”这类规则继续留在 web 层

## Deferred Admin Messages

- Migration `0019_deferred_admin_messages` materializes the `global` administrator-message config with deferred delivery enabled. `ensure()` preserves that migration-created row, and `update()` changes `updatedAt` only when the switch value actually changes.
- `AdminMessageDeliveryRepository.createBatch()` is idempotent by delivery ID. A matching existing Bot/message row is reused, while an ID collision with a different Bot or message fails explicitly.
- Exhausted delivery attempts may enter `waiting_for_user` only when the global switch is enabled. Waiting rows are excluded from `claimReady()`; `resumeWaitingForBot()` requeues only the matching Bot after user activity and resets its attempt budget, while `failWaiting()` terminally fails all waiting rows when deferral is disabled.
- Delivery completion and failure transitions are valid only from `delivering`. Failure classification runs inside an `immediate` transaction, so a late worker cannot move a terminal `sent` delivery back to `pending`, `waiting_for_user`, or `failed`, and `markSent()` cannot overwrite a waiting or failed record.

## Bot Sandbox Runtime Pools

- New SRT pool provisioning uses `ensureForBot()` and materializes `SandboxRuntimePoolDefaults` into `bot_sandbox_runtime_pools`. The workspace path is always `workspaceBaseRoot/<botInstanceId>` and the Bot ID must be a safe path segment.
- Migration `0015` creates a distinct API key, child port, and non-overlapping proxy range for every existing Bot. It copies the owner pool's operational policy, normalizes per-Bot capacity to `poolSize=1` and `minReadyProcesses=1`, and replaces a trailing owner path segment with the Bot ID.
- A malformed legacy workspace path falls back to `/app/apps/sandbox-runtime/user-workspaces/<botInstanceId>`. The legacy `user_sandbox_runtime_pools` table is intentionally retained for rollback, but new repository methods must not read it.

## Migration Metadata

- 当前项目的 Drizzle migration baseline 必须能在全新 SQLite 上直接建出当前 schema
- destructive schema reset 时，必须同步更新 `src/migrations/*.sql` 与 `src/migrations/meta/*`
- 当功能已经 hard cut 掉旧表时，当前 migration 链的最终 schema 也必须移除该旧表；不能让废弃表只因为历史 migration 仍存在就继续出现在 fresh migrate 结果里
- 不允许保留只存在于 snapshot、但 fresh baseline 已删除的旧列；否则后续 `drizzle-kit generate` 会产出错误 migration
- 仓库不再提交运行态 `storage/sqlite/db.sqlite`；schema 正确性统一由 migration 文件、`_journal.json` 和 fresh migrate 测试保证

## Bot Event Access

- `append()` 只负责写入并返回新增事件，不在写路径上回查整条历史
- `listByBotInstanceId()` 继续返回倒序全历史，供详情页初始加载这类一次性读取使用
- `append()` 返回的增量游标必须使用 SQLite `rowid`，不能再用 `(createdAt, id)` 这类会受同毫秒时间戳和随机 id 排序影响的组合键
- `listByBotInstanceIdAfterCursor()` 专供持续轮询/流式同步，必须按 `rowid` 升序返回，保证事件流严格跟随插入顺序
