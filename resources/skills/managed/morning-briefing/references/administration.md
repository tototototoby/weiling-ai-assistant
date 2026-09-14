# 集中管理协议

管理员通过 weiling `/admin/morning-briefings` 管理策略。Web 只写 SQLite 意图；Supervisor 投影 workspace 状态、计算工作日排期并直接投递微信消息。

规则：

- 管理员策略默认尊重员工的 `userOptOut=true`；只有显式强制启用才覆盖退出。
- `deliveryMode=supervisor` 时，Agent 不调用 `cron create/list/delete`，也不编辑 FastAgent 任务 journal。
- 员工通过微信修改启停、城市或时间时，只更新当前 Bot 的 `.weiling/morning-briefing.json`；Supervisor 在后续 reconcile 观察退出状态，管理员策略仍是城市和时间的控制面事实来源。
- 旧 `scheduleTaskId` 和 `scheduledFor` 可以保留到一次性任务自然执行；不再创建后继任务。
- 工作任务内容只保存在当前 Bot 的 `work-tasks.json`，不得跨 Bot 读取。
- `TZ=Asia/Shanghai` 必须进入 Supervisor 和 FastAgent child。
