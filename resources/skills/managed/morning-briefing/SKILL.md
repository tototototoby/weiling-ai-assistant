---
name: morning-briefing
description: Manage 微Link · 微灵 AI 助手 workday morning briefings and personal work tasks for an employee's private WeChat session. Use for briefing preferences, China workday behavior, task tracking, and administrator-managed policy reconciliation.
---

# 工作日晨报

weiling Supervisor owns morning-briefing scheduling and direct WeChat delivery. The Agent manages employee preferences and personal tasks only. Never create, renew, or delete a morning-briefing cron task.

## Initialize After Onboarding

Run from this Skill directory:

```bash
python3 scripts/briefing_state.py init --workspace /workspace
python3 scripts/briefing_state.py plan --workspace /workspace
```

In `deliveryMode=supervisor`, `plan` intentionally returns `schedule: null`. Tell the employee the configured location, delivery time, and workday behavior. Do not call the `cron` tool.

Use `/workspace` in remote sandbox mode. If the current tool exposes a different verified current workspace root, use that root instead. Never use another Bot's path.

## Handle A Legacy Scheduled Briefing

An existing one-shot task from the previous cron-based version may run once during migration. Its prompt contains `[GAOZHILING:MORNING_BRIEFING:v1]` and an intended date.

1. Run `context`:

   ```bash
   python3 scripts/briefing_state.py context --workspace /workspace
   ```

2. If `deliver` is false, stop without sending a user-facing message.
3. If `deliveryMode` is `supervisor`, deliver this intended-date briefing once but do not call `plan`, `register`, or `cron`; Supervisor starts direct delivery on the next workday to avoid a duplicate migration-day message.
4. Invoke the managed `weather` Skill for `location`. If weather retrieval fails, continue with the work plan and state the failure briefly.
5. Use only `todayTasks`, `overdueTasks`, and `undatedTasks` from `context`. Never read another employee's tasks or invent missing work.
6. Return a concise private message in this order: date and weekday, weather and commute note, overdue items, today's prioritized work plan, and one short planning suggestion.

When no tasks are registered, say `今天暂无已登记的工作任务` and explain that the employee can send `新增任务：……，截止……`.

## Manage Employee Tasks

Use the deterministic task store instead of free-form memory:

```bash
python3 scripts/briefing_state.py task-add --workspace /workspace \
  --title '准备项目周报' --due 2026-07-24 --priority high
python3 scripts/briefing_state.py task-list --workspace /workspace
python3 scripts/briefing_state.py task-complete --workspace /workspace --id '<task-id>'
python3 scripts/briefing_state.py task-delete --workspace /workspace --id '<task-id>'
```

Confirm the exact task before deletion. Report task changes clearly.

## Change Or Disable The Briefing

Update the managed state; Supervisor observes the employee opt-out and recomputes the central schedule.

```bash
python3 scripts/briefing_state.py set --workspace /workspace --enabled false
python3 scripts/briefing_state.py set --workspace /workspace --enabled true
python3 scripts/briefing_state.py set --workspace /workspace --location '泉州'
python3 scripts/briefing_state.py set --workspace /workspace --time 08:45
```

- `关闭晨报`: set `enabled=false` and confirm the preference.
- `开启晨报`: set `enabled=true` and confirm the configured time.
- Changing location or time never requires a cron operation.
- Administrator policy projection may override location/time. Employee opt-out remains protected unless an administrator explicitly force-enables the policy.

## Reconcile Central Changes

At the start of a registered employee's ordinary conversation, inspect `.weiling/morning-briefing.json`. When `deliveryMode=supervisor`, do not act on legacy `needsSchedule`, `needsCleanup`, `scheduleTaskId`, or `scheduledFor` fields. Supervisor owns current scheduling state in SQLite.

Read [references/administration.md](references/administration.md) for the central management contract and [references/state-schema.md](references/state-schema.md) when repairing files or adding a new annual calendar.

## Guardrails

- Morning briefings are private per Bot; never read or include another employee's tasks.
- Never edit FastAgent's internal `scheduled-tasks/**/tasks.jsonl` files.
- Never create a morning-briefing cron while `deliveryMode=supervisor`.
- Keep the server and FastAgent child timezone at `Asia/Shanghai`.
- Fail closed when the approved annual calendar has no coverage. Do not guess future statutory holidays or adjusted workdays.
