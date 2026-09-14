#!/usr/bin/env python3
"""Bot-scoped IMAP/SMTP client with JSON output and a send confirmation gate."""

from __future__ import annotations

import argparse
import email
import imaplib
import json
import mimetypes
import os
import re
import smtplib
import ssl
import sys
from datetime import datetime
from email.header import decode_header
from email.message import EmailMessage, Message
from email.policy import default
from email.utils import format_datetime, getaddresses, make_msgid
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


MAX_BODY_CHARS = 20_000
MAX_SCAN_MESSAGES = 200


class HTMLTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def text(self) -> str:
        return re.sub(r"\s+", " ", " ".join(self.parts)).strip()


def default_data_dir() -> Path:
    configured = os.environ.get("FASTAGENT_DATA_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    return Path(__file__).resolve().parents[3]


def credential_path(data_dir: Path) -> Path:
    return data_dir / "secrets" / "enterprise-mail.json"


def load_config(data_dir: Path) -> dict[str, Any]:
    path = credential_path(data_dir)
    if not path.exists():
        raise FileNotFoundError(f"mailbox is not configured for this Bot: {path}")
    config = json.loads(path.read_text(encoding="utf-8"))
    required = {
        "email",
        "auth_code",
        "smtp_host",
        "smtp_port",
        "imap_host",
        "imap_port",
    }
    missing = sorted(required.difference(config))
    if missing:
        raise ValueError("credential file is missing: " + ", ".join(missing))
    return config


def emit(payload: object) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def decoded_header(value: str | None) -> str:
    if not value:
        return ""
    parts: list[str] = []
    for item, charset in decode_header(value):
        if isinstance(item, bytes):
            for encoding in (charset, "utf-8", "gb18030", "latin-1"):
                if not encoding:
                    continue
                try:
                    parts.append(item.decode(encoding))
                    break
                except (LookupError, UnicodeDecodeError):
                    continue
            else:
                parts.append(item.decode("utf-8", errors="replace"))
        else:
            parts.append(item)
    return "".join(parts)


def open_imap(config: dict[str, Any]) -> imaplib.IMAP4_SSL:
    client = imaplib.IMAP4_SSL(
        str(config["imap_host"]),
        int(config["imap_port"]),
        ssl_context=ssl.create_default_context(),
    )
    client.login(str(config["email"]), str(config["auth_code"]))
    return client


def select_folder(client: imaplib.IMAP4_SSL, folder: str) -> None:
    status, _ = client.select(folder, readonly=True)
    if status != "OK":
        raise RuntimeError(f"cannot select folder: {folder}")


def header_record(uid: str, raw: bytes, flags: str) -> dict[str, object]:
    message = email.message_from_bytes(raw, policy=default)
    return {
        "uid": uid,
        "from": decoded_header(message.get("From")),
        "to": decoded_header(message.get("To")),
        "cc": decoded_header(message.get("Cc")),
        "subject": decoded_header(message.get("Subject")),
        "date": decoded_header(message.get("Date")),
        "message_id": decoded_header(message.get("Message-ID")),
        "unread": "\\Seen" not in flags,
    }


def fetch_header(client: imaplib.IMAP4_SSL, uid: str) -> dict[str, object]:
    status, rows = client.uid(
        "fetch",
        uid,
        "(BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID)] FLAGS)",
    )
    if status != "OK":
        raise RuntimeError(f"failed to fetch mail header UID {uid}")
    raw = b""
    flags = ""
    for row in rows:
        if isinstance(row, tuple):
            flags += row[0].decode("ascii", errors="ignore")
            raw += row[1]
    return header_record(uid, raw, flags)


def message_body(message: Message) -> str:
    plain: list[str] = []
    html_parts: list[str] = []
    if message.is_multipart():
        for part in message.walk():
            disposition = part.get_content_disposition()
            if disposition == "attachment":
                continue
            content_type = part.get_content_type()
            if content_type not in {"text/plain", "text/html"}:
                continue
            try:
                content = part.get_content()
            except Exception:
                payload = part.get_payload(decode=True) or b""
                content = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
            if content_type == "text/plain":
                plain.append(str(content))
            else:
                html_parts.append(str(content))
    else:
        try:
            content = str(message.get_content())
        except Exception:
            payload = message.get_payload(decode=True) or b""
            content = payload.decode(message.get_content_charset() or "utf-8", errors="replace")
        if message.get_content_type() == "text/html":
            html_parts.append(content)
        else:
            plain.append(content)
    body = "\n".join(plain).strip()
    if not body and html_parts:
        parser = HTMLTextExtractor()
        parser.feed("\n".join(html_parts))
        body = parser.text()
    return body[:MAX_BODY_CHARS]


def attachment_records(message: Message) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for part in message.walk():
        filename = part.get_filename()
        if not filename:
            continue
        payload = part.get_payload(decode=True) or b""
        records.append(
            {
                "filename": decoded_header(filename),
                "content_type": part.get_content_type(),
                "size": len(payload),
            }
        )
    return records


def command_status(args: argparse.Namespace) -> None:
    path = credential_path(args.data_dir)
    if not path.exists():
        emit({"configured": False, "credential_path": str(path)})
        return
    config = load_config(args.data_dir)
    emit(
        {
            "configured": True,
            "email": config["email"],
            "provider": config.get("provider", "tencent-exmail"),
            "credential_path": str(path),
        }
    )


def command_search(args: argparse.Namespace) -> None:
    config = load_config(args.data_dir)
    client = open_imap(config)
    try:
        select_folder(client, args.folder)
        criteria: list[str] = []
        if args.unread:
            criteria.append("UNSEEN")
        if args.since:
            since = datetime.strptime(args.since, "%Y-%m-%d")
            criteria.extend(["SINCE", since.strftime("%d-%b-%Y")])
        if not criteria:
            criteria.append("ALL")
        status, rows = client.uid("search", None, *criteria)
        if status != "OK":
            raise RuntimeError("mail search failed")
        uids = (rows[0] or b"").decode("ascii").split()
        scan_count = min(MAX_SCAN_MESSAGES, max(args.limit * 5, args.limit))
        selected = list(reversed(uids))[:scan_count]
        query = (args.query or "").casefold()
        results: list[dict[str, object]] = []
        for uid in selected:
            record = fetch_header(client, uid)
            haystack = " ".join(
                str(record[key]) for key in ("from", "to", "cc", "subject")
            ).casefold()
            if query and query not in haystack:
                continue
            results.append(record)
            if len(results) >= args.limit:
                break
        emit({"folder": args.folder, "count": len(results), "messages": results})
    finally:
        try:
            client.logout()
        except Exception:
            pass


def command_read(args: argparse.Namespace) -> None:
    config = load_config(args.data_dir)
    client = open_imap(config)
    try:
        select_folder(client, args.folder)
        status, rows = client.uid("fetch", args.uid, "(BODY.PEEK[] FLAGS)")
        if status != "OK":
            raise RuntimeError(f"failed to read mail UID {args.uid}")
        raw = b""
        flags = ""
        for row in rows:
            if isinstance(row, tuple):
                flags += row[0].decode("ascii", errors="ignore")
                raw += row[1]
        if not raw:
            raise RuntimeError(f"mail UID {args.uid} was not found")
        message = email.message_from_bytes(raw, policy=default)
        emit(
            {
                "uid": args.uid,
                "folder": args.folder,
                "from": decoded_header(message.get("From")),
                "to": decoded_header(message.get("To")),
                "cc": decoded_header(message.get("Cc")),
                "subject": decoded_header(message.get("Subject")),
                "date": decoded_header(message.get("Date")),
                "message_id": decoded_header(message.get("Message-ID")),
                "unread": "\\Seen" not in flags,
                "body": message_body(message),
                "attachments": attachment_records(message),
            }
        )
    finally:
        try:
            client.logout()
        except Exception:
            pass


def address_list(value: object, field: str) -> list[str]:
    if value is None:
        return []
    values = [value] if isinstance(value, str) else value
    if not isinstance(values, list) or not all(isinstance(item, str) for item in values):
        raise ValueError(f"{field} must be a string or list of strings")
    parsed = [address for _, address in getaddresses(values) if address]
    if len(parsed) != len(values) or any("@" not in address for address in parsed):
        raise ValueError(f"{field} contains an invalid email address")
    return parsed


def load_send_request(path: Path) -> dict[str, Any]:
    request = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(request, dict):
        raise ValueError("send request must be a JSON object")
    request["to"] = address_list(request.get("to"), "to")
    request["cc"] = address_list(request.get("cc"), "cc")
    request["bcc"] = address_list(request.get("bcc"), "bcc")
    if not request["to"]:
        raise ValueError("at least one recipient is required")
    request["subject"] = str(request.get("subject", "")).strip()
    request["text"] = str(request.get("text", ""))
    request["html"] = str(request.get("html", "")) if request.get("html") else ""
    attachments = request.get("attachments", [])
    if not isinstance(attachments, list) or not all(
        isinstance(item, str) for item in attachments
    ):
        raise ValueError("attachments must be a list of file paths")
    request["attachments"] = attachments
    return request


def send_preview(request: dict[str, Any], sender: str) -> dict[str, object]:
    attachments = []
    for item in request["attachments"]:
        path = Path(item).expanduser().resolve()
        attachments.append(
            {
                "name": path.name,
                "path": str(path),
                "exists": path.is_file(),
                "size": path.stat().st_size if path.is_file() else None,
            }
        )
    return {
        "sender": sender,
        "to": request["to"],
        "cc": request["cc"],
        "bcc": request["bcc"],
        "subject": request["subject"],
        "text": request["text"],
        "html_included": bool(request["html"]),
        "attachments": attachments,
    }


def build_message(request: dict[str, Any], sender: str) -> EmailMessage:
    message = EmailMessage()
    message["From"] = sender
    message["To"] = ", ".join(request["to"])
    if request["cc"]:
        message["Cc"] = ", ".join(request["cc"])
    message["Subject"] = request["subject"]
    message["Date"] = format_datetime(datetime.now().astimezone())
    message["Message-ID"] = make_msgid()
    message.set_content(request["text"] or "")
    if request["html"]:
        message.add_alternative(request["html"], subtype="html")
    for item in request["attachments"]:
        path = Path(item).expanduser().resolve()
        if not path.is_file():
            raise FileNotFoundError(f"attachment does not exist: {path}")
        content_type, _ = mimetypes.guess_type(path.name)
        maintype, subtype = (content_type or "application/octet-stream").split("/", 1)
        message.add_attachment(
            path.read_bytes(), maintype=maintype, subtype=subtype, filename=path.name
        )
    return message


def command_send(args: argparse.Namespace) -> None:
    config = load_config(args.data_dir)
    request_path = args.input.expanduser().resolve()
    secrets_root = (args.data_dir / "secrets").resolve()
    try:
        request_path.relative_to(secrets_root)
    except ValueError:
        pass
    else:
        raise ValueError("send request files cannot be stored under data/secrets")
    request = load_send_request(request_path)
    for item in request["attachments"]:
        attachment = Path(item).expanduser().resolve()
        try:
            attachment.relative_to(secrets_root)
        except ValueError:
            continue
        raise ValueError("files under data/secrets cannot be attached")
    preview = send_preview(request, str(config["email"]))
    if not args.confirmed:
        emit({"sent": False, "confirmation_required": True, "preview": preview})
        return
    message = build_message(request, str(config["email"]))
    recipients = request["to"] + request["cc"] + request["bcc"]
    with smtplib.SMTP_SSL(
        str(config["smtp_host"]),
        int(config["smtp_port"]),
        context=ssl.create_default_context(),
    ) as client:
        client.login(str(config["email"]), str(config["auth_code"]))
        client.send_message(message, to_addrs=recipients)
    emit(
        {
            "sent": True,
            "message_id": message["Message-ID"],
            "to": request["to"],
            "cc": request["cc"],
            "bcc": request["bcc"],
            "subject": request["subject"],
            "attachments": [Path(item).name for item in request["attachments"]],
        }
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=default_data_dir())
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("status")

    search = subparsers.add_parser("search")
    search.add_argument("--folder", default="INBOX")
    search.add_argument("--query")
    search.add_argument("--unread", action="store_true")
    search.add_argument("--since", help="YYYY-MM-DD")
    search.add_argument("--limit", type=int, default=20)

    read = subparsers.add_parser("read")
    read.add_argument("--folder", default="INBOX")
    read.add_argument("--uid", required=True)

    send = subparsers.add_parser("send")
    send.add_argument("--input", type=Path, required=True)
    send.add_argument("--confirmed", action="store_true")

    args = parser.parse_args()
    args.data_dir = args.data_dir.expanduser().resolve()
    if getattr(args, "limit", 1) < 1 or getattr(args, "limit", 1) > 100:
        parser.error("--limit must be between 1 and 100")
    return args


def main() -> int:
    args = parse_args()
    try:
        if args.command == "status":
            command_status(args)
        elif args.command == "search":
            command_search(args)
        elif args.command == "read":
            command_read(args)
        elif args.command == "send":
            command_send(args)
        return 0
    except Exception as exc:
        emit({"ok": False, "error": type(exc).__name__, "message": str(exc)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
