#!/usr/bin/env python3
"""Render brand posters from fixed-size HTML via Browserless, with optional AI background."""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen


RATIO_SIZES = {
    "9:16": (900, 1600),
    "16:9": (1600, 900),
    "1:1": (1200, 1200),
    "3:4": (1200, 1600),
}

BUNDLED_BACKGROUNDS = {
    "9:16": "bg-portrait-1.jpg",
    "16:9": "bg-landscape-1.jpg",
    "1:1": "bg-square-1.jpg",
    "3:4": "bg-portrait-2.jpg",
}

IMAGE_API_SIZES = {
    "9:16": "1024x1792",
    "16:9": "1792x1024",
    "1:1": "1024x1024",
    "3:4": "1024x1536",
}
BACKGROUND_TOKEN = "__POSTER_BACKGROUND_URL__"
TIMEOUT_SECONDS = 180.0


def ensure_utf8_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, OSError, ValueError):
            pass


def emit_error(message: str) -> None:
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False), file=sys.stderr)


def default_data_dir() -> Path:
    configured = os.environ.get("FASTAGENT_DATA_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return Path.cwd().resolve()


def load_imagegen_config(data_dir: Path) -> tuple[dict[str, str], Path] | None:
    path = data_dir / "secrets" / "imagegen.json"
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"imagegen 配置文件无法读取：{exc}") from exc
    if not isinstance(raw, dict):
        raise ValueError("imagegen 配置必须是 JSON 对象")
    required = ("endpoint", "apiKey", "model")
    missing = [name for name in required if not str(raw.get(name, "")).strip()]
    if missing:
        raise ValueError(f"imagegen 配置缺少字段：{', '.join(missing)}")
    return {name: str(raw[name]).strip() for name in required}, path


def post_json(
    url: str,
    payload: dict[str, object],
    api_key: str | None = None,
    timeout: float = TIMEOUT_SECONDS,
) -> dict[str, object]:
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urlopen(request, timeout=timeout) as response:
        raw = response.read()
    try:
        result = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"接口返回了无法解析的 JSON：{exc}") from exc
    if not isinstance(result, dict):
        raise RuntimeError("接口返回格式异常")
    if result.get("error"):
        raise RuntimeError(f"接口返回错误：{result['error']}")
    return result


def download_bytes(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "weiling-PosterDesign/1.0"})
    with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return response.read()


def image_from_response(data: list[object]) -> tuple[str, bytes]:
    if not data:
        raise RuntimeError("图片生成接口未返回 data")
    first = data[0]
    if isinstance(first, str):
        return first, download_bytes(first)
    if not isinstance(first, dict):
        raise RuntimeError("图片生成接口返回格式异常")
    b64 = first.get("b64_json")
    if isinstance(b64, str) and b64:
        return "base64", base64.b64decode(b64)
    url = first.get("url") or first.get("image_url")
    if isinstance(url, str) and url:
        return url, download_bytes(url)
    raise RuntimeError("图片生成接口未返回 b64_json 或 url")


def generate_background(
    config: dict[str, str],
    prompt: str,
    size: str,
    output_path: Path,
) -> Path:
    endpoint = config["endpoint"].rstrip("/")
    payload: dict[str, object] = {
        "model": config["model"],
        "prompt": prompt,
        "size": size,
        "n": 1,
    }
    response = post_json(
        f"{endpoint}/v1/images/generations",
        payload,
        api_key=config["apiKey"],
    )
    data = response.get("data")
    if not isinstance(data, list):
        raise RuntimeError("图片生成接口未返回 data 列表")
    _, content = image_from_response(data)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(content)
    return output_path


def embed_background(html: str, image_path: Path) -> str:
    encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
    mime = "image/jpeg" if image_path.suffix.lower() in {".jpg", ".jpeg"} else "image/png"
    data_uri = f"data:{mime};base64,{encoded}"
    if BACKGROUND_TOKEN in html:
        return html.replace(BACKGROUND_TOKEN, f"url('{data_uri}')")

    layer = (
        "<style>"
        ".weiling-poster-bg{position:fixed;inset:0;z-index:0;"
        f"background-image:url('{data_uri}');background-size:cover;"
        "background-position:center;pointer-events:none;}"
        "</style>"
        '<div class="weiling-poster-bg"></div>'
    )
    if "</body>" in html:
        return html.replace("</body>", f"{layer}</body>")
    return layer + html


def resolve_bundled_background(ratio: str) -> Path:
    skill_dir = Path(__file__).resolve().parents[1]
    return skill_dir / "assets" / "backgrounds" / BUNDLED_BACKGROUNDS[ratio]


def verify_image(output_path: Path, width: int, height: int) -> list[str]:
    """Optional pixel-level sanity check; returns warning lines (empty when clean)."""
    try:
        from PIL import Image
    except Exception:
        return ["Pillow 未安装，跳过像素校验"]
    try:
        with Image.open(output_path) as image:
            if image.size != (width, height):
                return [f"输出尺寸 {image.size} 与目标 {width}x{height} 不一致"]
            gray = image.convert("L")
            sample_step = max(1, height // 40)
            blank_rows: list[int] = []
            pixels = gray.load()
            for y in range(0, height, sample_step):
                row_has_ink = False
                for x in range(0, width, max(1, width // 24)):
                    if pixels[x, y] < 245:
                        row_has_ink = True
                        break
                if not row_has_ink:
                    blank_rows.append(y)
            if not blank_rows:
                return []
            run = [blank_rows[0]]
            bands: list[tuple[int, int]] = []
            for y in blank_rows[1:]:
                if y - run[-1] <= sample_step * 2:
                    run.append(y)
                else:
                    bands.append((run[0], run[-1]))
                    run = [y]
            bands.append((run[0], run[-1]))
            meaningful = [
                (start, end) for start, end in bands if (end - start) >= sample_step * 4
            ]
            if meaningful:
                bands_text = "、".join(f"{s}-{e}px" for s, e in meaningful[:5])
                return [f"检测到空白横带：{bands_text}，请检查布局是否留白异常"]
            return []
    except Exception as exc:
        return [f"像素校验失败：{exc}"]


def prepare_html(html_path: Path, background_path: Path | None) -> str:
    html = html_path.read_text(encoding="utf-8")
    if background_path:
        return embed_background(html, background_path)
    return html.replace(BACKGROUND_TOKEN, "none")


def screenshot_html(
    html: str,
    output_path: Path,
    width: int,
    height: int,
    browserless_api_url: str,
    browserless_api_key: str,
) -> Path:
    payload = {
        "html": html,
        "options": {
            "type": "png",
            "clip": {
                "x": 0,
                "y": 0,
                "width": width,
                "height": height,
            },
            "captureBeyondViewport": True,
            "omitBackground": False,
        },
    }
    launch = json.dumps({"defaultViewport": {"width": width, "height": height}})
    query = urlencode(
        {"token": browserless_api_key, "launch": launch},
        quote_via=quote,
    )
    request = Request(
        f"{browserless_api_url.rstrip('/')}/screenshot?{query}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        content = response.read()
    if not content:
        raise RuntimeError("Browserless 截图接口返回空内容")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(content)
    return output_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--html", type=Path, required=True, help="固定尺寸 HTML 文件")
    parser.add_argument("--output", type=Path, required=True, help="输出 PNG 路径")
    parser.add_argument("--ratio", required=True, choices=RATIO_SIZES.keys())
    parser.add_argument(
        "--imagegen",
        action="store_true",
        help="生成 AI 背景图并嵌入 HTML 后再截图",
    )
    parser.add_argument("--prompt", help="--imagegen 时的背景描述")
    parser.add_argument(
        "--background",
        help="嵌入素材背景：传 'auto' 按比例自动选技能内置素材，或传具体 PNG 路径",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="截图后做像素校验，检测空白横带与尺寸偏差",
    )
    parser.add_argument("--data-dir", type=Path, default=default_data_dir())
    return parser.parse_args()


def main() -> int:
    ensure_utf8_stdio()
    args = parse_args()
    html_path = args.html.expanduser().resolve()
    output_path = args.output.expanduser().resolve()
    data_dir = args.data_dir.expanduser().resolve()

    if not html_path.is_file():
        emit_error(f"HTML 文件不存在：{html_path}")
        return 1

    browserless_api_url = os.environ.get("BROWSERLESS_API_URL", "").strip()
    browserless_api_key = os.environ.get("BROWSERLESS_API_KEY", "").strip()
    if not browserless_api_url or not browserless_api_key:
        emit_error("截图服务未配置：缺少 BROWSERLESS_API_URL 或 BROWSERLESS_API_KEY")
        return 1

    background_path: Path | None = None
    warning: str | None = None
    background_source: str | None = None
    try:
        if args.imagegen:
            if not args.prompt or not args.prompt.strip():
                emit_error("--imagegen 需要 --prompt 背景描述")
                return 1
            config = load_imagegen_config(data_dir)
            if config is None:
                warning = "data/secrets/imagegen.json 不存在，已降级为纯模板出图"
            else:
                imagegen_config, _ = config
                background_path = generate_background(
                    imagegen_config,
                    args.prompt.strip(),
                    IMAGE_API_SIZES[args.ratio],
                    output_path.with_name(output_path.stem + "-background.png"),
                )
                background_source = "imagegen"
        elif args.background:
            if args.background == "auto":
                background_path = resolve_bundled_background(args.ratio)
                background_source = f"bundled:{background_path.name}"
            else:
                candidate = Path(args.background).expanduser().resolve()
                if not candidate.is_file():
                    emit_error(f"背景文件不存在：{candidate}")
                    return 1
                background_path = candidate
                background_source = "bundled:" + candidate.name

        width, height = RATIO_SIZES[args.ratio]
        html = prepare_html(html_path, background_path)
        screenshot_html(
            html,
            output_path,
            width,
            height,
            browserless_api_url,
            browserless_api_key,
        )
        if args.verify:
            verification_warnings = verify_image(output_path, width, height)
            for item in verification_warnings:
                warning = item
    except HTTPError as exc:
        emit_error(f"服务返回 HTTP {exc.code}：{exc.read().decode('utf-8', errors='replace')[:500]}")
        return 1
    except URLError as exc:
        emit_error(f"服务不可达，请稍后重试：{exc.reason}")
        return 1
    except (OSError, TimeoutError, RuntimeError, ValueError) as exc:
        emit_error(str(exc))
        return 1

    result: dict[str, object] = {
        "ok": True,
        "ratio": args.ratio,
        "width": RATIO_SIZES[args.ratio][0],
        "height": RATIO_SIZES[args.ratio][1],
        "output": str(output_path),
    }
    if background_path:
        result["background"] = str(background_path)
        result["backgroundSource"] = background_source
    if warning:
        result["warning"] = warning
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
