# 状态与日历结构

## 员工状态

每个 Bot 的事实来源是 `workspace/.weiling/morning-briefing.json`：

- `schemaVersion`：当前为 `1`；
- `policyVersion`：最后一次应用的统一策略版本；
- `deliveryMode`：当前为 `supervisor`，表示由 weiling 中央调度和投递；
- `enabled`：是否继续晨报链；
- `userOptOut`：员工是否主动关闭；管理员批量应用默认尊重该值；
- `location`：天气城市；开源版默认关闭晨报，管理员或用户必须先配置真实城市；
- `time`：`HH:MM`；
- `timezone`：必须为 `Asia/Shanghai`；
- `calendarFile`：当前批准的年度日历文件；
- `scheduleMarker`：只允许 `[GAOZHILING:MORNING_BRIEFING:v1]`；
- `scheduleTaskId`、`scheduledFor`：迁移前最后观测到的 FastAgent 单次任务，仅用于平滑迁移；
- `needsSchedule`、`needsCleanup`：旧 cron 模式兼容字段；中央模式固定为 `false`，Agent 不执行对账；
- `createdAt`、`updatedAt`：UTC ISO 时间。

员工工作任务保存在 `workspace/.weiling/work-tasks.json`。每项包含 `id`、`title`、`dueDate`、`priority`、`status`、`createdAt`、`completedAt`。不在聊天记忆中维护另一份任务事实。

## 工作日日历

年度文件位于 `assets/china-workdays-YYYY.json`：

- `holidays` 明确覆盖法定放假日期；
- `adjustedWorkdays` 明确覆盖周末调休上班日期；
- 其他周一至周五视为普通工作日，其他周六周日视为休息日；
- 两个数组不得重叠，所有日期必须属于 `year`；
- `source` 必须记录国务院办公厅正式通知的名称、文号、发布日期和 URL。

只有正式年度通知发布并经管理员核对后才能新增下一年文件。日历没有覆盖时，任务链停止并返回可审计错误，不能猜测。
