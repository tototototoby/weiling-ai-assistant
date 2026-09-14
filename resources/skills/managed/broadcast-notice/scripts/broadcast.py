#!/usr/bin/env python3
"""Send an internal weiling broadcast through the supervisor API."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_INTERNAL_URL = "http://supervisor:8790"
TIMEOUT_SECONDS = 30.0
VALID_SCOPES = ("group", "all", "selected")


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
        return f"无权限：{detail or '当前员工未授权发送该范围通知'}"
    if status == 429:
        return f"已限频：{detail or '广播发送过于频繁，请稍后再试'}"
    if status in {409, 500, 502, 503, 504}:
        return f"稍后重试：{detail or '广播服务暂时不可用'}"
    if status == 401:
        return f"内部接口鉴权失败：{detail or 'Unauthorized'}"
    if status == 404:
        return f"接口或发送方不存在：{detail or 'Not found'}"
    if status == 400:
        return f"请求无效：{detail or 'Invalid request'}"
    return f"HTTP {status}：{detail or '广播发送失败'}"


def send_broadcast(
    base_url: str,
    api_token: str,
    bot_instance_id: str,
    text: str,
    scope: str,
    targets: list[str],
) -> dict[str, object]:
    body: dict[str, object] = {
        "botInstanceId": bot_instance_id,
        "text": text,
        "scope": scope,
    }
    if targets:
        body["targetBotInstanceIds"] = targets

    request = Request(
        f"{base_url.rstrip('/')}/internal/broadcast",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        raw = response.read()
    try:
        result = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"广播接口返回了无法解析的 JSON：{exc}") from exc
    if not isinstance(result, dict):
        raise RuntimeError("广播接口返回格式异常")
    return {
        "ok": True,
        "accepted": result.get("accepted"),
        "skipped": result.get("skipped"),
        "response": result,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--text", required=True, help="拟发送的通知全文")
    parser.add_argument("--scope", required=True, choices=VALID_SCOPES)
    parser.add_argument("--targets", help="逗号分隔的 botInstanceId，selected/group 范围使用")
    return parser.parse_args()


def main() -> int:
    ensure_utf8_stdio()
    args = parse_args()
    bot_instance_id, api_token, base_url, missing = check_internal_env()
    if missing:
        emit_error("内部接口未配置", missing)
        return 1

    text = args.text.strip()
    if not text:
        emit_error("通知内容不能为空")
        return 1

    targets = (
        [item.strip() for item in args.targets.split(",") if item.strip()]
        if args.targets
        else []
    )
    if args.scope == "selected" and not targets:
        emit_error("selected 范围必须提供 --targets")
        return 1

    try:
        result = send_broadcast(
            base_url,
            api_token,
            bot_instance_id,
            text,
            args.scope,
            targets,
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
