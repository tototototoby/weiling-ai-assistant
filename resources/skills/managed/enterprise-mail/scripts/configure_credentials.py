#!/usr/bin/env python3
"""Configure one Bot's private Tencent enterprise-mail credential."""

from __future__ import annotations

import argparse
import getpass
import imaplib
import json
import os
import smtplib
import ssl
import sys
from pathlib import Path


def default_data_dir() -> Path:
    configured = os.environ.get("FASTAGENT_DATA_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parents[3]


def secret_path(data_dir: Path) -> Path:
    return data_dir / "secrets" / "enterprise-mail.json"


def safe_status(path: Path) -> dict[str, object]:
    if not path.exists():
        return {"configured": False, "path": str(path)}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        "configured": True,
        "email": data.get("email"),
        "provider": data.get("provider"),
        "smtp_host": data.get("smtp_host"),
        "smtp_port": data.get("smtp_port"),
        "imap_host": data.get("imap_host"),
        "imap_port": data.get("imap_port"),
        "path": str(path),
    }


def test_connection(config: dict[str, object]) -> None:
    context = ssl.create_default_context()
    email = str(config["email"])
    auth_code = str(config["auth_code"])
    with imaplib.IMAP4_SSL(
        str(config["imap_host"]), int(config["imap_port"]), ssl_context=context
    ) as client:
        client.login(email, auth_code)
        client.logout()
    with smtplib.SMTP_SSL(
        str(config["smtp_host"]), int(config["smtp_port"]), context=context
    ) as client:
        client.login(email, auth_code)


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
    parser.add_argument("--email")
    parser.add_argument("--allowed-domain", default="example.com")
    parser.add_argument("--smtp-host", default="smtp.exmail.qq.com")
    parser.add_argument("--smtp-port", type=int, default=465)
    parser.add_argument("--imap-host", default="imap.exmail.qq.com")
    parser.add_argument("--imap-port", type=int, default=993)
    parser.add_argument("--skip-test", action="store_true")
    parser.add_argument(
        "--auth-code-stdin",
        action="store_true",
        help="read one authorization-code line from stdin instead of prompting",
    )
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--remove", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    path = secret_path(args.data_dir.expanduser().resolve())
    if args.status:
        print(json.dumps(safe_status(path), ensure_ascii=False))
        return 0
    if args.remove:
        path.unlink(missing_ok=True)
        print(json.dumps({"removed": True, "path": str(path)}, ensure_ascii=False))
        return 0
    if not args.email:
        print("--email is required when configuring credentials", file=sys.stderr)
        return 2

    email = args.email.strip().lower()
    expected_suffix = "@" + args.allowed_domain.strip().lower()
    if "@" not in email or not email.endswith(expected_suffix):
        print(f"email must belong to {args.allowed_domain}", file=sys.stderr)
        return 2
    if args.auth_code_stdin:
        auth_code = sys.stdin.readline().strip()
    else:
        auth_code = getpass.getpass("Client authorization code (hidden): ").strip()
    if not auth_code:
        print("authorization code cannot be empty", file=sys.stderr)
        return 2

    config: dict[str, object] = {
        "version": 1,
        "provider": "tencent-exmail",
        "email": email,
        "auth_code": auth_code,
        "smtp_host": args.smtp_host,
        "smtp_port": args.smtp_port,
        "imap_host": args.imap_host,
        "imap_port": args.imap_port,
    }
    try:
        if not args.skip_test:
            test_connection(config)
        save_config(path, config)
    except Exception as exc:
        print(f"configuration failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        config["auth_code"] = ""
        auth_code = ""
    print(json.dumps(safe_status(path), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
