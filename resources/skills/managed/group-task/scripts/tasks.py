#!/usr/bin/env python3
"""List and submit tasks for the current weiling bot employee."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


DEFAULT_INTERNAL_URL = "http://supervisor:8790"
TIMEOUT_SECONDS = 30.0


def ensure_utf8_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, OSError, ValueError):
            pass


def emit_error(message: str, missing: list[str] | None = None) -> None:
    payload: dict[str, object] = {"ok": False, "error": message}
    if missing:
        payload["missingEnv"] = missing
    print(json.dumps(payload, ensure_ascii=False), file=sys.stderr)


def default_data_dir() -> Path:
    configured = os.environ.get("FASTAGENT_DATA_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    parents = Path(__file__).resolve().parents
    return parents[3] if len(parents) > 3 else Path.cwd()


def load_bridge(data_dir: Path) -> dict[str, str] | None:
    path = data_dir / "secrets" / "weiling-bridge.json"
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    return {
        "botInstanceId": str(payload.get("botInstanceId") or "").strip(),
        "internalUrl": str(payload.get("internalUrl") or "").strip(),
        "apiToken": str(payload.get("apiToken") or "").strip(),
    }


def check_internal_env() -> tuple[str, str, str, list[str]]:
    missing: list[str] = []
    bridge = load_bridge(default_data_dir())
    bot_instance_id = (
        (bridge or {}).get("botInstanceId")
        or os.environ.get("WEILING_BOT_INSTANCE_ID", "").strip()
    )
    api_token = (
        (bridge or {}).get("apiToken")
        or os.environ.get("WEILING_INTERNAL_API_TOKEN", "").strip()
    )
    base_url = (
        (bridge or {}).get("internalUrl")
        or os.environ.get("WEILING_INTERNAL_URL", "").strip()
        or DEFAULT_INTERNAL_URL
    )
    if not bot_instance_id:
        missing.append("WEILING_BOT_INSTANCE_ID")
    if not api_token:
        missing.append("WEILING_INTERNAL_API_TOKEN")
    return bot_instance_id, api_token, base_url, missing


def http_error_message(exc: HTTPError) -> str:
    detail = ""
    try:
        payload = json.loads(exc.read().decode("utf-8", errors="replace"))
        if isinstance(payload, dict) and isinstance(payload.get("message"), str):
            detail = payload["message"]
    except Exception:
        detail = ""

    status = exc.code
    if status == 403:
        return f"无权限：{detail or '当前员工无权操作该任务'}"
    if status == 404:
        return f"任务不存在或无权访问：{detail or 'Not found'}"
    if status == 429:
        return f"已限频：{detail or '任务请求过于频繁，请稍后再试'}"
    if status in {409, 500, 502, 503, 504}:
        return f"稍后重试：{detail or '任务服务暂时不可用'}"
    if status == 401:
        return f"内部接口鉴权失败：{detail or 'Unauthorized'}"
    if status == 400:
        return f"请求无效：{detail or 'Invalid request'}"
    return f"HTTP {status}：{detail or '任务操作失败'}"


def read_json(response: object) -> dict[str, object] | list[object]:
    raw = response.read()
    try:
        value = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"任务接口返回了无法解析的 JSON：{exc}") from exc
    if not isinstance(value, (dict, list)):
        raise RuntimeError("任务接口返回格式异常")
    return value


def command_list(
    base_url: str,
    api_token: str,
    bot_instance_id: str,
) -> dict[str, object]:
    url = f"{base_url.rstrip('/')}/internal/me/tasks?{urlencode({'botInstanceId': bot_instance_id})}"
    request = Request(
        url,
        headers={
            "Authorization": f"Bearer {api_token}",
            "Accept": "application/json",
        },
        method="GET",
    )
    with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        payload = read_json(response)
    result: dict[str, object] = {"ok": True}
    if isinstance(payload, dict):
        result.update(payload)
    else:
        result["tasks"] = payload
    return result


def split_evidence(values: list[str] | None) -> list[str]:
    paths: list[str] = []
    for value in values or []:
        for item in value.split(","):
            item = item.strip()
            if item:
                paths.append(item)
    return paths


def command_submit(
    base_url: str,
    api_token: str,
    bot_instance_id: str,
    task_id: str,
    summary: str,
    evidence_paths: list[str],
) -> dict[str, object]:
    body: dict[str, object] = {
        "botInstanceId": bot_instance_id,
        "summary": summary,
        "evidencePaths": evidence_paths,
    }
    url = f"{base_url.rstrip('/')}/internal/me/tasks/{quote(task_id, safe='')}/submit"
    request = Request(
        url,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        payload = read_json(response)
    result: dict[str, object] = {"ok": True, "taskId": task_id}
    if isinstance(payload, dict):
        result.update(payload)
    else:
        result["response"] = payload
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("list", help="查询当前员工的任务列表")

    submit = subparsers.add_parser("submit", help="提交当前员工的任务完成结果")
    submit.add_argument("--id", required=True, help="任务 ID")
    submit.add_argument("--summary", required=True, help="完成摘要")
    submit.add_argument(
        "--evidence",
        action="append",
        help="证据路径，可传多次或用逗号分隔",
    )
    return parser.parse_args()


def main() -> int:
    ensure_utf8_stdio()
    args = parse_args()
    bot_instance_id, api_token, base_url, missing = check_internal_env()
    if missing:
        emit_error("内部接口未配置", missing)
        return 1

    try:
        if args.command == "list":
            result = command_list(base_url, api_token, bot_instance_id)
        else:
            summary = args.summary.strip()
            if not summary:
                emit_error("完成摘要不能为空")
                return 1
            result = command_submit(
                base_url,
                api_token,
                bot_instance_id,
                args.id,
                summary,
                split_evidence(args.evidence),
            )
    except HTTPError as exc:
        emit_error(http_error_message(exc))
        return 1
    except URLError as exc:
        emit_error(f"内部接口不可达，请稍后重试：{exc.reason}")
        return 1
    except (OSError, TimeoutError, RuntimeError, ValueError) as exc:
        emit_error(str(exc))
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
