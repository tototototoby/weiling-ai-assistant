#!/usr/bin/env python3
"""Validate that an HTML report is complete, printable, and free of active content."""

from __future__ import annotations

import argparse
import json
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse


MAX_REPORT_BYTES = 8 * 1024 * 1024
PLACEHOLDER = re.compile(r"{{[^{}]+}}")
ACTIVE_TAGS = {"iframe", "object", "embed", "form"}
REMOTE_ASSET_TAGS = {
    "img": "src",
    "link": "href",
    "script": "src",
    "audio": "src",
    "video": "src",
    "source": "src",
}


class ReportParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.errors: list[str] = []
        self.warnings: list[str] = []
        self.tags: dict[str, int] = {}
        self.lang = ""
        self.has_charset = False
        self.has_viewport = False
        self.has_title_text = False
        self.has_print_css = False
        self._in_title = False
        self._in_style = False

    def handle_decl(self, decl: str) -> None:
        if decl.strip().lower() != "doctype html":
            self.warnings.append("doctype is not HTML5")

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        self.tags[tag] = self.tags.get(tag, 0) + 1
        attributes = {key.lower(): (value or "") for key, value in attrs}

        if tag == "html":
            self.lang = attributes.get("lang", "").strip()
        elif tag == "meta":
            if attributes.get("charset", "").lower() == "utf-8":
                self.has_charset = True
            if attributes.get("name", "").lower() == "viewport":
                self.has_viewport = True
            if attributes.get("http-equiv", "").lower() == "refresh":
                self.errors.append("meta refresh is not allowed")
        elif tag == "title":
            self._in_title = True
        elif tag == "style":
            self._in_style = True

        if tag in ACTIVE_TAGS:
            self.errors.append(f"active element <{tag}> is not allowed")

        for name, value in attributes.items():
            if name.startswith("on"):
                self.errors.append(f"inline event handler {name} is not allowed")
            if name in {"href", "src", "action", "formaction"}:
                scheme = urlparse(value.strip()).scheme.lower()
                if scheme in {"javascript", "vbscript"}:
                    self.errors.append(f"unsafe URL scheme in {tag}[{name}]")

        asset_attribute = REMOTE_ASSET_TAGS.get(tag)
        if asset_attribute and asset_attribute in attributes:
            value = attributes[asset_attribute].strip()
            scheme = urlparse(value).scheme.lower()
            if value.startswith("//") or scheme in {"http", "https"}:
                self.errors.append(f"external asset in {tag}[{asset_attribute}] is not allowed")
            if tag == "script":
                self.errors.append("script elements are not allowed")
        elif tag == "script":
            self.errors.append("script elements are not allowed")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "title":
            self._in_title = False
        elif tag == "style":
            self._in_style = False

    def handle_data(self, data: str) -> None:
        if self._in_title and data.strip():
            self.has_title_text = True
        if self._in_style and "@media print" in data.lower():
            self.has_print_css = True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path, help="HTML report to validate")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    errors: list[str] = []
    warnings: list[str] = []

    if not args.report.is_file():
        errors.append(f"report does not exist: {args.report}")
        text = ""
    elif args.report.stat().st_size > MAX_REPORT_BYTES:
        errors.append(f"report exceeds {MAX_REPORT_BYTES} bytes")
        text = ""
    else:
        try:
            text = args.report.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            errors.append("report is not valid UTF-8")
            text = ""

    parser = ReportParser()
    if text:
        if not re.match(r"\s*<!doctype\s+html\s*>", text, re.IGNORECASE):
            errors.append("missing HTML5 doctype")
        if PLACEHOLDER.search(text):
            errors.append("unresolved template placeholder found")
        try:
            parser.feed(text)
            parser.close()
        except Exception as exc:  # HTMLParser errors are unusual but should be reported.
            errors.append(f"HTML parse failed: {exc}")

        errors.extend(parser.errors)
        warnings.extend(parser.warnings)
        if parser.tags.get("html", 0) != 1:
            errors.append("report must contain exactly one <html> element")
        if not parser.lang:
            errors.append("<html> must declare a language")
        if not parser.has_charset:
            errors.append("missing UTF-8 charset declaration")
        if not parser.has_viewport:
            errors.append("missing viewport declaration")
        if not parser.has_title_text:
            errors.append("missing non-empty <title>")
        if parser.tags.get("main", 0) != 1:
            errors.append("report must contain exactly one <main> element")
        if parser.tags.get("h1", 0) != 1:
            errors.append("report must contain exactly one <h1> element")
        if not parser.has_print_css:
            errors.append("missing @media print rules")

    result = {
        "valid": not errors,
        "report": str(args.report.resolve()),
        "errors": sorted(set(errors)),
        "warnings": sorted(set(warnings)),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
