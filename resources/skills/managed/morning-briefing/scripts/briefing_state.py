#!/usr/bin/env python3
"""Manage per-Bot morning briefing state, workdays, and personal work tasks."""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import tempfile
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any


STATE_DIR_NAME = ".weiling"
CONFIG_FILE_NAME = "morning-briefing.json"
TASKS_FILE_NAME = "work-tasks.json"
MAX_JSON_BYTES = 1024 * 1024
ALLOWED_PRIORITIES = {"high", "normal", "low"}
TIME_PATTERN = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MARKER = "[GAOZHILING:MORNING_BRIEFING:v1]"
SHANGHAI_TIMEZONE = timezone(timedelta(hours=8), name="Asia/Shanghai")


def skill_root() -> Path:
    return Path(__file__).resolve().parents[1]


def load_json_object(path: Path, label: str) -> dict[str, Any]:
    if not path.is_file():
        raise ValueError(f"{label} does not exist: {path}")
    if path.stat().st_size > MAX_JSON_BYTES:
        raise ValueError(f"{label} exceeds {MAX_JSON_BYTES} bytes: {path}")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object: {path}")
    return value


def atomic_write_json(path: Path, value: dict[str, Any], mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        try:
            os.chmod(temporary_name, mode)
        except OSError:
            pass
        os.replace(temporary_name, path)
    except Exception:
        Path(temporary_name).unlink(missing_ok=True)
        raise


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def workspace_path(value: str) -> Path:
    path = Path(value).expanduser().resolve()
    if not path.is_dir():
        raise ValueError(f"workspace does not exist or is not a directory: {path}")
    return path


def state_paths(workspace: Path) -> tuple[Path, Path]:
    state_dir = workspace / STATE_DIR_NAME
    if state_dir.is_symlink() or (state_dir.exists() and not state_dir.is_dir()):
        raise ValueError(f"briefing state directory is unsafe: {state_dir}")
    config_path = state_dir / CONFIG_FILE_NAME
    tasks_path = state_dir / TASKS_FILE_NAME
    if config_path.is_symlink() or tasks_path.is_symlink():
        raise ValueError("briefing state files must not be symbolic links")
    return config_path, tasks_path


def load_policy() -> dict[str, Any]:
    policy = load_json_object(skill_root() / "assets" / "default-policy.json", "default policy")
    if policy.get("scheduleMarker") != MARKER:
        raise ValueError("default policy schedule marker is invalid")
    validate_time(str(policy.get("time", "")))
    validate_timezone(str(policy.get("timezone", "")))
    return policy


def default_config(policy: dict[str, Any]) -> dict[str, Any]:
    timestamp = utc_now_iso()
    return {
        "schemaVersion": 1,
        "policyVersion": policy["policyVersion"],
        "deliveryMode": "supervisor",
        "enabled": bool(policy["enabledByDefault"]),
        "userOptOut": False,
        "location": policy["defaultLocation"],
        "time": policy["time"],
        "timezone": policy["timezone"],
        "calendarFile": policy["calendarFile"],
        "scheduleMarker": policy["scheduleMarker"],
        "scheduleTaskId": None,
        "scheduledFor": None,
        "needsSchedule": False,
        "needsCleanup": False,
        "createdAt": timestamp,
        "updatedAt": timestamp,
    }


def validate_time(value: str) -> str:
    if not TIME_PATTERN.fullmatch(value):
        raise ValueError("time must use HH:MM in 24-hour format")
    return value


def validate_timezone(value: str) -> str:
    if value != "Asia/Shanghai":
        raise ValueError("morning briefing timezone must be Asia/Shanghai")
    return value


def validate_location(value: str) -> str:
    candidate = value.strip()
    if not candidate or len(candidate) > 80 or any(char in candidate for char in "\r\n\x00"):
        raise ValueError("location must be a single non-empty line up to 80 characters")
    return candidate


def validate_config(config: dict[str, Any]) -> dict[str, Any]:
    if config.get("schemaVersion") != 1:
        raise ValueError("unsupported morning briefing schemaVersion")
    if config.get("scheduleMarker") != MARKER:
        raise ValueError("invalid morning briefing schedule marker")
    if not isinstance(config.get("enabled"), bool) or not isinstance(config.get("userOptOut"), bool):
        raise ValueError("enabled and userOptOut must be booleans")
    if config.get("deliveryMode", "cron") not in {"cron", "supervisor"}:
        raise ValueError("deliveryMode must be cron or supervisor")
    validate_location(str(config.get("location", "")))
    validate_time(str(config.get("time", "")))
    validate_timezone(str(config.get("timezone", "")))
    calendar_file = str(config.get("calendarFile", ""))
    if not re.fullmatch(r"china-workdays-\d{4}\.json", calendar_file):
        raise ValueError("calendarFile must be a managed china-workdays-YYYY.json file")
    return config


def load_config(workspace: Path, create: bool = False) -> dict[str, Any]:
    config_path, _ = state_paths(workspace)
    if not config_path.is_file():
        if not create:
            raise ValueError(f"morning briefing is not initialized: {config_path}")
        config = default_config(load_policy())
        atomic_write_json(config_path, config)
        return config
    return validate_config(load_json_object(config_path, "morning briefing config"))


def save_config(workspace: Path, config: dict[str, Any]) -> dict[str, Any]:
    config["updatedAt"] = utc_now_iso()
    validate_config(config)
    config_path, _ = state_paths(workspace)
    atomic_write_json(config_path, config)
    return config


def initialize_workspace(
    workspace: Path,
    *,
    location: str | None = None,
    force_defaults: bool = False,
) -> tuple[str, dict[str, Any]]:
    policy = load_policy()
    config_path, tasks_path = state_paths(workspace)
    action = "created"
    if config_path.is_file() and not force_defaults:
        config = load_config(workspace)
        action = "kept"
        if config.get("policyVersion") != policy["policyVersion"]:
            config["policyVersion"] = policy["policyVersion"]
            config["timezone"] = policy["timezone"]
            config["calendarFile"] = policy["calendarFile"]
            config["scheduleMarker"] = policy["scheduleMarker"]
            config["needsSchedule"] = bool(config["enabled"] and config.get("deliveryMode", "cron") == "cron")
            config["needsCleanup"] = bool(config.get("scheduleTaskId"))
            action = "updated-policy"
    else:
        config = default_config(policy)
        if config_path.is_file():
            action = "reset-defaults"
    if location is not None:
        candidate = validate_location(location)
        if config.get("location") != candidate:
            config["location"] = candidate
            action = "updated-location" if action == "kept" else action
    save_config(workspace, config)
    if not tasks_path.is_file():
        atomic_write_json(tasks_path, {"schemaVersion": 1, "tasks": []})
    return action, config


def calendar_path(config: dict[str, Any]) -> Path:
    return skill_root() / "assets" / str(config["calendarFile"])


def parse_iso_date(value: str, field: str) -> date:
    if not DATE_PATTERN.fullmatch(value):
        raise ValueError(f"{field} must use YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(f"{field} is not a valid date") from exc


def load_calendar(config: dict[str, Any]) -> dict[str, Any]:
    calendar = load_json_object(calendar_path(config), "workday calendar")
    year = calendar.get("year")
    if not isinstance(year, int):
        raise ValueError("calendar.year must be an integer")
    holidays = calendar.get("holidays")
    adjusted = calendar.get("adjustedWorkdays")
    if not isinstance(holidays, list) or not all(isinstance(item, str) for item in holidays):
        raise ValueError("calendar.holidays must be a list of dates")
    if not isinstance(adjusted, list) or not all(isinstance(item, str) for item in adjusted):
        raise ValueError("calendar.adjustedWorkdays must be a list of dates")
    holiday_dates = {parse_iso_date(item, "holiday") for item in holidays}
    adjusted_dates = {parse_iso_date(item, "adjustedWorkday") for item in adjusted}
    if any(item.year != year for item in holiday_dates | adjusted_dates):
        raise ValueError("all calendar dates must belong to calendar.year")
    if holiday_dates & adjusted_dates:
        raise ValueError("calendar holidays and adjusted workdays must not overlap")
    return {**calendar, "_holidays": holiday_dates, "_adjusted": adjusted_dates}


def workday_status(target: date, calendar: dict[str, Any]) -> tuple[bool, str]:
    if target.year != calendar["year"]:
        raise ValueError(f"approved workday calendar does not cover {target.year}")
    if target in calendar["_adjusted"]:
        return True, "adjusted_workday"
    if target in calendar["_holidays"]:
        return False, "statutory_holiday"
    if target.weekday() < 5:
        return True, "weekday"
    return False, "weekend"


def parse_now(value: str | None, timezone_name: str) -> datetime:
    validate_timezone(timezone_name)
    zone = SHANGHAI_TIMEZONE
    if value is None:
        return datetime.now(zone)
    candidate = value.strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(candidate)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=zone)
    return parsed.astimezone(zone)


def next_workday_slot(now: datetime, config: dict[str, Any], calendar: dict[str, Any]) -> datetime:
    hour, minute = (int(part) for part in str(config["time"]).split(":"))
    target = now.date()
    last_date = date(calendar["year"], 12, 31)
    while target <= last_date:
        is_workday, _ = workday_status(target, calendar)
        candidate = datetime.combine(target, time(hour, minute), tzinfo=now.tzinfo)
        if is_workday and candidate > now:
            return candidate
        target += timedelta(days=1)
    raise ValueError(
        f"no future workday remains in approved {calendar['year']} calendar; install next year's calendar"
    )


def schedule_for(now: datetime, config: dict[str, Any]) -> dict[str, Any] | None:
    if not config["enabled"] or config.get("deliveryMode") == "supervisor":
        return None
    calendar = load_calendar(config)
    slot = next_workday_slot(now, config, calendar)
    marker = config["scheduleMarker"]
    scheduled_for = slot.isoformat()
    date_marker = f"[DATE:{slot.date().isoformat()}]"
    prompt = (
        f"{marker}{date_marker} 使用 $morning-briefing 执行当前员工的工作日晨报。"
        "严格按照 Run A Scheduled Briefing 流程，先保证下一工作日的单次任务，再返回本次私聊晨报；不要提问。"
    )
    return {
        "marker": marker,
        "dateMarker": date_marker,
        "cron": f"{slot.minute} {slot.hour} {slot.day} {slot.month} *",
        "prompt": prompt,
        "recurring": False,
        "scheduledFor": scheduled_for,
        "localDisplay": slot.strftime("%Y-%m-%d %H:%M"),
        "timezone": config["timezone"],
    }


def load_tasks(workspace: Path) -> dict[str, Any]:
    _, tasks_path = state_paths(workspace)
    if not tasks_path.is_file():
        value = {"schemaVersion": 1, "tasks": []}
        atomic_write_json(tasks_path, value)
        return value
    value = load_json_object(tasks_path, "work task store")
    if value.get("schemaVersion") != 1 or not isinstance(value.get("tasks"), list):
        raise ValueError("unsupported work task store")
    for index, task in enumerate(value["tasks"]):
        if not isinstance(task, dict) or not isinstance(task.get("id"), str):
            raise ValueError(f"tasks[{index}] is invalid")
    return value


def save_tasks(workspace: Path, value: dict[str, Any]) -> None:
    _, tasks_path = state_paths(workspace)
    atomic_write_json(tasks_path, value)


def add_task(workspace: Path, title: str, due: str | None, priority: str) -> dict[str, Any]:
    title = title.strip()
    if not title or len(title) > 300 or any(char in title for char in "\r\n\x00"):
        raise ValueError("task title must be a single non-empty line up to 300 characters")
    if priority not in ALLOWED_PRIORITIES:
        raise ValueError("priority must be high, normal, or low")
    if due is not None:
        parse_iso_date(due, "due")
    store = load_tasks(workspace)
    task = {
        "id": "task_" + secrets.token_hex(6),
        "title": title,
        "dueDate": due,
        "priority": priority,
        "status": "pending",
        "createdAt": utc_now_iso(),
        "completedAt": None,
    }
    store["tasks"].append(task)
    save_tasks(workspace, store)
    return task


def find_task(store: dict[str, Any], task_id: str) -> dict[str, Any]:
    matches = [task for task in store["tasks"] if task.get("id") == task_id]
    if len(matches) != 1:
        raise ValueError(f"task id not found or not unique: {task_id}")
    return matches[0]


def task_context(workspace: Path, today: date, policy: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    store = load_tasks(workspace)
    pending = [task for task in store["tasks"] if task.get("status") == "pending"]
    rank = {"high": 0, "normal": 1, "low": 2}
    pending.sort(key=lambda item: (rank.get(str(item.get("priority")), 9), str(item.get("dueDate") or "9999"), str(item.get("createdAt") or "")))
    overdue = [task for task in pending if task.get("dueDate") and parse_iso_date(str(task["dueDate"]), "dueDate") < today]
    today_tasks = [task for task in pending if task.get("dueDate") == today.isoformat()]
    undated = [task for task in pending if not task.get("dueDate")]
    return {
        "overdueTasks": overdue[: int(policy["maxOverdueTasks"])],
        "todayTasks": today_tasks[: int(policy["maxTodayTasks"])],
        "undatedTasks": undated[: int(policy["maxUndatedTasks"])],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_workspace(subparser: argparse.ArgumentParser) -> None:
        subparser.add_argument("--workspace", required=True)

    init_parser = subparsers.add_parser("init", help="initialize per-Bot briefing state")
    add_workspace(init_parser)
    init_parser.add_argument("--location")
    init_parser.add_argument("--force-defaults", action="store_true")

    for command in ("plan", "context"):
        subparser = subparsers.add_parser(command)
        add_workspace(subparser)
        subparser.add_argument("--now", help="ISO timestamp for deterministic testing")

    register = subparsers.add_parser("register")
    add_workspace(register)
    register.add_argument("--task-id", required=True)
    register.add_argument("--scheduled-for", required=True)

    set_parser = subparsers.add_parser("set")
    add_workspace(set_parser)
    set_parser.add_argument("--enabled", choices=["true", "false"])
    set_parser.add_argument("--location")
    set_parser.add_argument("--time")
    set_parser.add_argument("--admin", action="store_true", help="do not mark a disable as user opt-out")

    task_add = subparsers.add_parser("task-add")
    add_workspace(task_add)
    task_add.add_argument("--title", required=True)
    task_add.add_argument("--due")
    task_add.add_argument("--priority", choices=sorted(ALLOWED_PRIORITIES), default="normal")

    task_list = subparsers.add_parser("task-list")
    add_workspace(task_list)
    task_list.add_argument("--all", action="store_true")

    task_complete = subparsers.add_parser("task-complete")
    add_workspace(task_complete)
    task_complete.add_argument("--id", required=True)

    task_delete = subparsers.add_parser("task-delete")
    add_workspace(task_delete)
    task_delete.add_argument("--id", required=True)

    calendar_check = subparsers.add_parser("calendar-check")
    calendar_check.add_argument("--file", type=Path)
    calendar_check.add_argument("--date")
    return parser


def output(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def main() -> int:
    args = build_parser().parse_args()

    if args.command == "calendar-check":
        policy = load_policy()
        config = default_config(policy)
        if args.file:
            candidate = args.file.resolve()
            if candidate.parent != (skill_root() / "assets").resolve():
                raise ValueError("calendar file must be inside this Skill's assets directory")
            config["calendarFile"] = candidate.name
        calendar = load_calendar(config)
        result: dict[str, Any] = {
            "valid": True,
            "year": calendar["year"],
            "holidays": len(calendar["_holidays"]),
            "adjustedWorkdays": len(calendar["_adjusted"]),
            "source": calendar.get("source"),
        }
        if args.date:
            target = parse_iso_date(args.date, "date")
            is_workday, reason = workday_status(target, calendar)
            result["date"] = target.isoformat()
            result["isWorkday"] = is_workday
            result["reason"] = reason
        output(result)
        return 0

    workspace = workspace_path(args.workspace)

    if args.command == "init":
        action, config = initialize_workspace(
            workspace, location=args.location, force_defaults=args.force_defaults
        )
        output({"ok": True, "action": action, "config": config})
        return 0

    config = load_config(workspace, create=False)

    if args.command == "plan":
        now = parse_now(args.now, config["timezone"])
        output({"ok": True, "enabled": config["enabled"], "schedule": schedule_for(now, config)})
        return 0

    if args.command == "context":
        now = parse_now(args.now, config["timezone"])
        calendar = load_calendar(config)
        is_workday, reason = workday_status(now.date(), calendar)
        policy = load_policy()
        tasks = task_context(workspace, now.date(), policy)
        output(
            {
                "ok": True,
                "deliver": bool(config["enabled"] and is_workday),
                "reason": "workday" if config["enabled"] and is_workday else ("disabled" if not config["enabled"] else reason),
                "date": now.date().isoformat(),
                "weekday": now.strftime("%A"),
                "location": config["location"],
                "deliveryMode": config.get("deliveryMode", "cron"),
                "timezone": config["timezone"],
                **tasks,
            }
        )
        return 0

    if args.command == "register":
        task_id = args.task_id.strip()
        if not task_id or len(task_id) > 200:
            raise ValueError("task id is invalid")
        datetime.fromisoformat(args.scheduled_for.replace("Z", "+00:00"))
        config["scheduleTaskId"] = task_id
        config["scheduledFor"] = args.scheduled_for
        config["needsSchedule"] = False
        config["needsCleanup"] = False
        save_config(workspace, config)
        output({"ok": True, "registered": True, "taskId": task_id, "scheduledFor": args.scheduled_for})
        return 0

    if args.command == "set":
        changed: list[str] = []
        if args.enabled is not None:
            enabled = args.enabled == "true"
            if config["enabled"] != enabled:
                config["enabled"] = enabled
                changed.append("enabled")
            if not args.admin:
                config["userOptOut"] = not enabled
            config["needsSchedule"] = bool(enabled and config.get("deliveryMode", "cron") == "cron")
            config["needsCleanup"] = bool(not enabled and config.get("deliveryMode", "cron") == "cron" and config.get("scheduleTaskId"))
        if args.location is not None:
            location = validate_location(args.location)
            if config["location"] != location:
                config["location"] = location
                changed.append("location")
        if args.time is not None:
            briefing_time = validate_time(args.time)
            if config["time"] != briefing_time:
                config["time"] = briefing_time
                config["needsSchedule"] = bool(config["enabled"] and config.get("deliveryMode", "cron") == "cron")
                config["needsCleanup"] = bool(config.get("deliveryMode", "cron") == "cron" and config.get("scheduleTaskId"))
                changed.append("time")
        save_config(workspace, config)
        output({"ok": True, "changed": changed, "config": config})
        return 0

    if args.command == "task-add":
        output({"ok": True, "task": add_task(workspace, args.title, args.due, args.priority)})
        return 0

    if args.command == "task-list":
        store = load_tasks(workspace)
        tasks = store["tasks"] if args.all else [task for task in store["tasks"] if task.get("status") == "pending"]
        output({"ok": True, "count": len(tasks), "tasks": tasks})
        return 0

    if args.command == "task-complete":
        store = load_tasks(workspace)
        task = find_task(store, args.id)
        task["status"] = "completed"
        task["completedAt"] = utc_now_iso()
        save_tasks(workspace, store)
        output({"ok": True, "task": task})
        return 0

    if args.command == "task-delete":
        store = load_tasks(workspace)
        task = find_task(store, args.id)
        store["tasks"] = [item for item in store["tasks"] if item.get("id") != args.id]
        save_tasks(workspace, store)
        output({"ok": True, "deleted": task})
        return 0

    raise ValueError(f"unsupported command: {args.command}")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2))
        raise SystemExit(1)
