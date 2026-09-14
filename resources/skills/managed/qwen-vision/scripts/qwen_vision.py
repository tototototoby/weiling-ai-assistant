#!/usr/bin/env python3
"""Analyze images with the Qwen vision API (DashScope compatible mode)."""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import urllib.request
from pathlib import Path

CONFIG_VERSION = 1
DEFAULT_MODEL = "qwen-vl-max"
DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"


def default_data_dir() -> Path:
    configured = os.environ.get("FASTAGENT_DATA_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    parents = Path(__file__).resolve().parents
    return parents[3] if len(parents) > 3 else Path.cwd()


def config_path(data_dir: Path) -> Path:
    return data_dir / "secrets" / "qwen-vision.json"


def load_config(data_dir: Path) -> dict[str, object]:
    path = config_path(data_dir)
    if not path.exists():
        raise FileNotFoundError(
            f"Qwen vision is not configured for this Bot: {path}. "
            "Ask an administrator to run configure_qwen_vision.py."
        )
    config = json.loads(path.read_text(encoding="utf-8"))
    if config.get("version") != CONFIG_VERSION:
        raise ValueError("Unsupported qwen-vision config version.")
    api_key = str(config.get("api_key") or "")
    model = str(config.get("model") or DEFAULT_MODEL)
    base_url = str(config.get("base_url") or DEFAULT_BASE_URL)
    if not api_key:
        raise ValueError("qwen-vision api_key is empty.")
    return {"api_key": api_key, "base_url": base_url, "model": model}


def encode_image(path: Path) -> str:
    mime = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".bmp": "image/bmp",
        ".webp": "image/webp",
    }.get(path.suffix.lower())
    if not mime:
        raise ValueError(f"Unsupported image extension: {path.suffix}")
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{data}"


def call_vision(config: dict[str, object], images: list[Path], prompt: str) -> str:
    content: list[dict[str, object]] = []
    for image in images:
        content.append({
            "type": "image_url",
            "image_url": {"url": encode_image(image)},
        })
    content.append({"type": "text", "text": prompt})
    payload = {
        "model": config["model"],
        "messages": [{"role": "user", "content": content}],
    }
    request = urllib.request.Request(
        str(config["base_url"]).rstrip("/") + "/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {config['api_key']}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        body = json.loads(response.read().decode("utf-8"))
    if "error" in body:
        raise RuntimeError(f"Qwen vision API error: {body['error']}")
    choices = body.get("choices") or []
    if not choices:
        raise RuntimeError("Qwen vision API returned no choices.")
    return str(choices[0].get("message", {}).get("content") or "").strip()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", nargs="*", type=Path, help="image paths to analyze")
    parser.add_argument("--data-dir", type=Path, default=default_data_dir())
    parser.add_argument("--prompt", default="请详细描述图片内容，并提取其中所有可见的文字。")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--status", action="store_true", help="print configuration status")
    return parser.parse_args()


def safe_status(data_dir: Path) -> dict[str, object]:
    path = config_path(data_dir)
    if not path.exists():
        return {"configured": False, "path": str(path)}
    config = json.loads(path.read_text(encoding="utf-8"))
    return {
        "configured": True,
        "model": config.get("model"),
        "base_url": config.get("base_url"),
        "api_key_configured": bool(config.get("api_key")),
        "path": str(path),
    }


def main() -> int:
    args = parse_args()
    data_dir = args.data_dir.expanduser().resolve()
    if args.status:
        print(json.dumps(safe_status(data_dir), ensure_ascii=False))
        return 0
    if not args.images:
        print("at least one image path is required", file=sys.stderr)
        return 2
    try:
        config = load_config(data_dir)
        result = call_vision(config, args.images, args.prompt)
    except Exception as exc:
        print(f"qwen-vision failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    if args.output:
        args.output.write_text(result + "\n", encoding="utf-8")
    else:
        print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
