#!/usr/bin/env python3
"""Extract readable content from office and document files by type."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

SCAN_TEXT_THRESHOLD = 30

SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
PRESENTATION_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"

TEXT_EXTENSIONS = {
    ".docx",
    ".odt",
    ".rtf",
    ".epub",
    ".md",
    ".markdown",
    ".txt",
    ".html",
    ".htm",
}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"}
UNSUPPORTED_EXTENSIONS = {".doc", ".xls"}


def run(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, capture_output=True, text=True, timeout=300)


def extract_text_file(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def extract_with_pandoc(path: Path) -> str:
    result = run(["pandoc", str(path), "-t", "plain"])
    if result.returncode != 0:
        raise RuntimeError(f"pandoc failed: {result.stderr.strip()}")
    return result.stdout.strip()


def extract_pdf(path: Path) -> dict[str, object]:
    if not path.exists():
        raise FileNotFoundError(f"PDF file not found: {path}")
    result = run(["pdftotext", "-layout", str(path), "-"])
    if result.returncode != 0:
        raise RuntimeError(f"pdftotext failed: {result.stderr.strip()}")
    text = result.stdout.strip()
    if len(text) >= SCAN_TEXT_THRESHOLD:
        return {"type": "text", "text": text}
    if shutil.which("pdftoppm") is None:
        raise RuntimeError("pdftoppm is required for scanned PDFs.")
    with tempfile.TemporaryDirectory(prefix="weiling-scan-") as tmp:
        prefix = str(Path(tmp) / "page")
        render = run(["pdftoppm", "-png", "-r", "150", str(path), prefix])
        if render.returncode != 0:
            raise RuntimeError(f"pdftoppm failed: {render.stderr.strip()}")
        pages = sorted(Path(tmp).glob("page-*.png"))
        if not pages:
            raise RuntimeError("pdftoppm produced no pages.")
        return {"type": "vision", "images": [str(page) for page in pages]}


def extract_xlsx(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        shared: list[str] = []
        try:
            shared_xml = archive.read("xl/sharedStrings.xml")
            for si in ET.fromstring(shared_xml).iter(f"{{{SPREADSHEET_NS}}}si"):
                shared.append("".join(
                    t.text or "" for t in si.iter(f"{{{SPREADSHEET_NS}}}t")
                ))
        except KeyError:
            pass

        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        rel_map = {
            rel.get("Id"): rel.get("Target")
            for rel in rels.iter(f"{{{PACKAGE_REL_NS}}}Relationship")
        }
        sheets: list[tuple[str, str]] = []
        for sheet in workbook.iter(f"{{{SPREADSHEET_NS}}}sheet"):
            target = rel_map.get(sheet.get(f"{{{REL_NS}}}id") or "")
            if target:
                target = target.lstrip("/")
                if not target.startswith("xl/"):
                    target = f"xl/{target}"
                sheets.append((sheet.get("name") or "Sheet", target))

        output: list[str] = []
        for name, target in sheets:
            output.append(f"### {name}")
            try:
                sheet_xml = archive.read(target)
            except KeyError:
                output.append("(sheet missing)")
                continue
            rows = ET.fromstring(sheet_xml).iter(f"{{{SPREADSHEET_NS}}}row")
            for row in rows:
                cells: list[str] = []
                for cell in row.iter(f"{{{SPREADSHEET_NS}}}c"):
                    cell_type = cell.get("t")
                    value = cell.find(f"{{{SPREADSHEET_NS}}}v")
                    inline = cell.find(f"{{{SPREADSHEET_NS}}}is")
                    if cell_type == "s" and value is not None:
                        index = int(value.text or "0")
                        cells.append(shared[index] if index < len(shared) else "")
                    elif cell_type == "inlineStr" and inline is not None:
                        cells.append("".join(
                            t.text or "" for t in inline.iter(f"{{{SPREADSHEET_NS}}}t")
                        ))
                    elif cell_type == "str" and value is not None:
                        cells.append(value.text or "")
                    elif value is not None:
                        cells.append(value.text or "")
                    else:
                        cells.append("")
                while cells and not cells[-1]:
                    cells.pop()
                if cells:
                    output.append("\t".join(cells))
        return "\n".join(output).strip()


def extract_pptx(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        slides = sorted(
            (int(match.group(1)), name)
            for name in archive.namelist()
            if (match := re.fullmatch(r"ppt/slides/slide(\d+)\.xml", name))
        )
        output: list[str] = []
        for number, name in slides:
            output.append(f"--- Slide {number} ---")
            root = ET.fromstring(archive.read(name))
            texts = [t.text or "" for t in root.iter(f"{{{PRESENTATION_NS}}}t")]
            output.append("\n".join(text.strip() for text in texts if text.strip()))
        return "\n".join(output).strip()


def extract(path: Path) -> dict[str, object]:
    suffix = path.suffix.lower()
    if suffix in IMAGE_EXTENSIONS:
        return {"type": "vision", "images": [str(path)]}
    if suffix in UNSUPPORTED_EXTENSIONS:
        return {
            "type": "unsupported",
            "extension": suffix,
            "message": (
                f"旧版 {suffix} 二进制格式需要 LibreOffice 转换器，当前沙箱未安装，"
                "请让用户另存为 .docx / .xlsx 后重试。"
            ),
        }
    if suffix == ".pdf":
        return extract_pdf(path)
    if suffix == ".xlsx":
        return {"type": "text", "text": extract_xlsx(path)}
    if suffix == ".pptx":
        return {"type": "text", "text": extract_pptx(path)}
    if suffix in {".md", ".markdown", ".txt"}:
        return {"type": "text", "text": extract_text_file(path)}
    if suffix in TEXT_EXTENSIONS:
        return {"type": "text", "text": extract_with_pandoc(path)}
    return {
        "type": "unsupported",
        "extension": suffix,
        "message": f"暂不支持的文件类型：{suffix}",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--format", choices=("json", "text"), default="json")
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        result = extract(args.input.expanduser().resolve())
    except Exception as exc:
        result = {
            "type": "error",
            "message": f"{type(exc).__name__}: {exc}",
        }
    if args.format == "json" or result.get("type") != "text":
        rendered = json.dumps(result, ensure_ascii=False, indent=2)
    else:
        rendered = str(result.get("text") or "")
    if args.output:
        args.output.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
