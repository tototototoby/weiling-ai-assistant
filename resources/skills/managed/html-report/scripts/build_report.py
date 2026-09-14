#!/usr/bin/env python3
"""Build a safe, self-contained HTML report from a structured JSON document."""

from __future__ import annotations

import argparse
import html
import json
import re
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


ALLOWED_TONES = {"positive", "warning", "negative", "neutral", "info"}
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def text_list(value: object, field: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"{field} must be a list of strings")
    return value


def object_list(value: object, field: str) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(item, dict) for item in value):
        raise ValueError(f"{field} must be a list of objects")
    return value


def tone(value: object) -> str:
    candidate = str(value or "neutral").lower()
    return candidate if candidate in ALLOWED_TONES else "neutral"


def safe_color(value: object, fallback: str) -> str:
    candidate = str(value or fallback)
    return candidate if HEX_COLOR.fullmatch(candidate) else fallback


def safe_url(value: object) -> str | None:
    if not value:
        return None
    candidate = str(value).strip()
    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"source URL must use http or https: {candidate}")
    return candidate


def render_paragraphs(paragraphs: list[str]) -> str:
    return "".join(f"<p>{esc(item)}</p>" for item in paragraphs)


def render_bullets(items: list[str]) -> str:
    if not items:
        return ""
    return "<ul>" + "".join(f"<li>{esc(item)}</li>" for item in items) + "</ul>"


def render_table(table: object, field: str) -> str:
    if table is None:
        return ""
    if not isinstance(table, dict):
        raise ValueError(f"{field} must be an object")
    columns = table.get("columns", [])
    rows = table.get("rows", [])
    if not isinstance(columns, list) or not columns or not all(
        isinstance(item, str) for item in columns
    ):
        raise ValueError(f"{field}.columns must be a non-empty list of strings")
    if not isinstance(rows, list) or not all(isinstance(row, list) for row in rows):
        raise ValueError(f"{field}.rows must be a list of lists")
    for index, row in enumerate(rows):
        if len(row) != len(columns):
            raise ValueError(
                f"{field}.rows[{index}] has {len(row)} cells; expected {len(columns)}"
            )
    head = "".join(f"<th scope=\"col\">{esc(item)}</th>" for item in columns)
    body = "".join(
        "<tr>" + "".join(f"<td>{esc(cell)}</td>" for cell in row) + "</tr>"
        for row in rows
    )
    if not body:
        body = f'<tr><td colspan="{len(columns)}" class="empty">暂无数据</td></tr>'
    return (
        '<div class="table-wrap"><table><thead><tr>'
        + head
        + "</tr></thead><tbody>"
        + body
        + "</tbody></table></div>"
    )


def render_metrics(metrics: list[dict[str, Any]]) -> str:
    if not metrics:
        return ""
    cards: list[str] = []
    for index, metric in enumerate(metrics):
        label = str(metric.get("label", "")).strip()
        value = str(metric.get("value", "")).strip()
        if not label or not value:
            raise ValueError(f"metrics[{index}] requires label and value")
        change = str(metric.get("change", "")).strip()
        metric_tone = tone(metric.get("tone"))
        cards.append(
            '<article class="metric">'
            f'<div class="metric-label">{esc(label)}</div>'
            f'<div class="metric-value">{esc(value)}</div>'
            + (
                f'<div class="metric-change tone-{metric_tone}">{esc(change)}</div>'
                if change
                else ""
            )
            + "</article>"
        )
    return '<div class="metrics">' + "".join(cards) + "</div>"


def render_bars(bars: list[dict[str, Any]], field: str) -> str:
    if not bars:
        return ""
    rows: list[str] = []
    for index, bar in enumerate(bars):
        label = str(bar.get("label", "")).strip()
        try:
            value = float(bar.get("value"))
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{field}[{index}].value must be a number") from exc
        if not label or value < 0 or value > 100:
            raise ValueError(f"{field}[{index}] requires label and value from 0 to 100")
        display = str(bar.get("display", f"{value:g}%"))
        rows.append(
            '<div class="bar-row">'
            f'<span class="bar-label">{esc(label)}</span>'
            '<span class="bar-track" aria-hidden="true">'
            f'<span class="bar-fill" style="width:{value:g}%"></span></span>'
            f'<span class="bar-value">{esc(display)}</span>'
            "</div>"
        )
    return '<div class="bars">' + "".join(rows) + "</div>"


def render_callout(callout: object, field: str) -> str:
    if callout is None:
        return ""
    if not isinstance(callout, dict):
        raise ValueError(f"{field} must be an object")
    title = str(callout.get("title", "提示")).strip()
    body = str(callout.get("body", "")).strip()
    if not body:
        return ""
    callout_tone = tone(callout.get("tone"))
    return (
        f'<aside class="callout callout-{callout_tone}">'
        f'<p class="callout-title">{esc(title)}</p><p>{esc(body)}</p></aside>'
    )


def render_sections(sections: list[dict[str, Any]]) -> str:
    rendered: list[str] = []
    for index, section in enumerate(sections):
        title = str(section.get("title", "")).strip()
        if not title:
            raise ValueError(f"sections[{index}].title is required")
        eyebrow = str(section.get("eyebrow", "")).strip()
        paragraphs = text_list(section.get("paragraphs"), f"sections[{index}].paragraphs")
        bullets = text_list(section.get("bullets"), f"sections[{index}].bullets")
        bars = object_list(section.get("bars"), f"sections[{index}].bars")
        rendered.append(
            '<section class="section">'
            + (f'<p class="eyebrow">{esc(eyebrow)}</p>' if eyebrow else "")
            + f"<h2>{esc(title)}</h2>"
            + render_paragraphs(paragraphs)
            + render_bullets(bullets)
            + render_table(section.get("table"), f"sections[{index}].table")
            + render_bars(bars, f"sections[{index}].bars")
            + render_callout(section.get("callout"), f"sections[{index}].callout")
            + "</section>"
        )
    return "".join(rendered)


def render_actions(actions: list[dict[str, Any]]) -> str:
    if not actions:
        return ""
    rows = []
    for index, action in enumerate(actions):
        item = str(action.get("item", "")).strip()
        if not item:
            raise ValueError(f"actions[{index}].item is required")
        rows.append(
            [
                item,
                action.get("owner", ""),
                action.get("due", ""),
                action.get("status", ""),
            ]
        )
    table = {"columns": ["行动项", "负责人", "计划日期", "状态"], "rows": rows}
    return (
        '<section class="section"><p class="eyebrow">Follow-up</p>'
        '<h2>后续行动</h2>'
        + render_table(table, "actions")
        + "</section>"
    )


def render_sources(sources: list[dict[str, Any]], limitations: list[str]) -> str:
    if not sources and not limitations:
        return ""
    items: list[str] = []
    for index, source in enumerate(sources):
        label = str(source.get("label", "")).strip()
        if not label:
            raise ValueError(f"sources[{index}].label is required")
        url = safe_url(source.get("url"))
        note = str(source.get("note", "")).strip()
        label_html = (
            f'<a href="{esc(url)}" rel="noopener noreferrer">{esc(label)}</a>'
            if url
            else esc(label)
        )
        items.append(f"<li>{label_html}{' — ' + esc(note) if note else ''}</li>")
    content = ""
    if items:
        content += "<h3>来源</h3><ul>" + "".join(items) + "</ul>"
    if limitations:
        content += "<h3>限制与说明</h3>" + render_bullets(limitations)
    return (
        '<section class="section source-list"><p class="eyebrow">Notes</p>'
        "<h2>来源与口径</h2>"
        + content
        + "</section>"
    )


def build_content(document: dict[str, Any]) -> tuple[str, str, str, str]:
    title = str(document.get("title", "")).strip()
    if not title:
        raise ValueError("title is required")
    company = str(document.get("company", "部署组织")).strip()
    subtitle = str(document.get("subtitle", "")).strip()
    period = str(document.get("period", "")).strip()
    prepared_by = str(document.get("prepared_by", "微Link")).strip()
    generated_at = str(document.get("generated_at", date.today().isoformat())).strip()
    classification = str(document.get("classification", "内部资料")).strip()
    summary = text_list(document.get("executive_summary"), "executive_summary")
    metrics = object_list(document.get("metrics"), "metrics")
    sections = object_list(document.get("sections"), "sections")
    actions = object_list(document.get("actions"), "actions")
    sources = object_list(document.get("sources"), "sources")
    limitations = text_list(document.get("limitations"), "limitations")
    theme = document.get("theme") or {}
    if not isinstance(theme, dict):
        raise ValueError("theme must be an object")
    primary = safe_color(theme.get("primary"), "#124E66")
    accent = safe_color(theme.get("accent"), "#159A9C")

    topline = f"<span>{esc(company)}</span><span>{esc(classification)}</span>"
    meta_items = []
    if period:
        meta_items.append(f"<span>报告期：{esc(period)}</span>")
    if prepared_by:
        meta_items.append(f"<span>编制：{esc(prepared_by)}</span>")
    meta_items.append(f"<span>生成日期：{esc(generated_at)}</span>")
    hero = (
        '<header class="hero"><div class="hero-topline">'
        + topline
        + "</div>"
        + f"<h1>{esc(title)}</h1>"
        + (f'<p class="subtitle">{esc(subtitle)}</p>' if subtitle else "")
        + '<div class="hero-meta">'
        + "".join(meta_items)
        + "</div></header>"
    )

    body = ""
    if summary or metrics:
        body += '<section class="section"><p class="eyebrow">Executive Summary</p><h2>执行摘要</h2>'
        if summary:
            body += '<div class="summary"><div>' + render_bullets(summary) + "</div></div>"
        body += render_metrics(metrics) + "</section>"
    body += render_sections(sections)
    body += render_actions(actions)
    body += render_sources(sources, limitations)
    if not body:
        body = '<section class="section"><h2>报告内容</h2><p class="empty">暂无内容。</p></section>'
    footer = str(document.get("footer", "本报告由微Link（微Link · 微灵 AI 助手）生成，仅供授权范围内使用。")).strip()
    return title, primary, accent, hero + "<main>" + body + "</main>", footer


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="UTF-8 report JSON")
    parser.add_argument("--output", type=Path, required=True, help="output HTML path")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    document = json.loads(args.input.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError("report input must be a JSON object")
    template_path = Path(__file__).resolve().parents[1] / "assets" / "report-template.html"
    template = template_path.read_text(encoding="utf-8")
    title, primary, accent, content, footer = build_content(document)
    report = (
        template.replace("{{REPORT_TITLE}}", esc(title))
        .replace("{{PRIMARY_COLOR}}", primary)
        .replace("{{ACCENT_COLOR}}", accent)
        .replace("{{REPORT_CONTENT}}", content)
        .replace("{{REPORT_FOOTER}}", esc(footer))
    )
    if "{{" in report or "}}" in report:
        raise ValueError("unresolved template placeholder")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(report, encoding="utf-8")
    temporary.replace(args.output)
    print(
        json.dumps(
            {"created": True, "output": str(args.output.resolve()), "title": title},
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
