#!/usr/bin/env python3
"""Configure one Bot's private Qwen vision credential (DashScope compatible mode)."""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from pathlib import Path


def default_data_dir() -> Path:
    configured = os.environ.get("FASTAGENT_DATA_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    parents = Path(__file__).resolve().parents
    return parents[3] if len(parents) > 3 else Path.cwd()


def config_path(data_dir: Path) -> Path:
    return data_dir / "secrets" / "qwen-vision.json"


def safe_status(path: Path) -> dict[str, object]:
    if not path.exists():
        return {"configured": False, "path": str(path)}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        "configured": True,
        "model": data.get("model"),
        "base_url": data.get("base_url"),
        "api_key_configured": bool(data.get("api_key")),
        "path": str(path),
    }


def save_config(path: Path, config: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        path.parent.chmod(0o700)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    if os.name != "nt":
        temporary.chmod(0o600)
    temporary.replace(path)
    if os.name != "nt":
        path.chmod(0o600)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=default_data_dir())
    parser.add_argument("--model", default="qwen-vl-max")
    parser.add_argument("--base-url", default="https://dashscope.aliyuncs.com/compatible-mode/v1")
    parser.add_argument(
        "--api-key-stdin",
        action="store_true",
        help="read one API key line from stdin instead of prompting",
    )
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--remove", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    path = config_path(args.data_dir.expanduser().resolve())
    if args.status:
        print(json.dumps(safe_status(path), ensure_ascii=False))
        return 0
    if args.remove:
        path.unlink(missing_ok=True)
        print(json.dumps({"removed": True, "path": str(path)}, ensure_ascii=False))
        return 0
    if args.api_key_stdin:
        api_key = sys.stdin.readline().strip()
    else:
        api_key = getpass.getpass("DashScope API key (hidden): ").strip()
    if not api_key:
        print("API key cannot be empty", file=sys.stderr)
        return 2
    config: dict[str, object] = {
        "version": 1,
        "provider": "dashscope",
        "api_key": api_key,
        "model": args.model,
        "base_url": args.base_url,
    }
    save_config(path, config)
    api_key = ""
    print(json.dumps(safe_status(path), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
