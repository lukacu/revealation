#!/usr/bin/env python3
"""Keep temporary backwards-compatibility code visible and inventoried.

Compatibility is intentionally allowed during internal development, but every
compatibility-only block must carry an RV-COMPAT(<id>) marker whose id appears
in docs/COMPATIBILITY_DEBT.md. This makes the eventual pre-release deletion a
mechanical audit rather than an archaeological search through the codebase.
"""
from __future__ import annotations

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs" / "COMPATIBILITY_DEBT.md"
MARKER_RE = re.compile(r"RV-COMPAT\(([a-z0-9-]+)\)")
TABLE_ID_RE = re.compile(r"^\| `([a-z0-9-]+)` \|", re.MULTILINE)


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    doc_text = DOC.read_text("utf-8")
    documented = set(TABLE_ID_RE.findall(doc_text))
    if not documented:
        fail("compatibility inventory contains no ids")

    roots = [ROOT / "src", ROOT / "styles", ROOT / "tests"]
    files = []
    for base in roots:
        files.extend(path for path in base.rglob("*") if path.is_file() and path.suffix in {".js", ".css", ".py"})
    files.extend([ROOT / "index.html", ROOT / "preview.html", ROOT / "server.py"])

    occurrences: dict[str, list[str]] = {}
    for path in sorted(set(files)):
        if path == Path(__file__):
            continue
        text = path.read_text("utf-8")
        for line_no, line in enumerate(text.splitlines(), 1):
            for compat_id in MARKER_RE.findall(line):
                occurrences.setdefault(compat_id, []).append(f"{path.relative_to(ROOT)}:{line_no}")

    used = set(occurrences)
    unknown = sorted(used - documented)
    missing = sorted(documented - used)
    if unknown:
        fail(f"undocumented RV-COMPAT ids: {unknown}")
    if missing:
        fail(f"documented compatibility ids have no implementation/test marker: {missing}")

    print(f"compatibility debt: OK ({len(used)} ids, {sum(map(len, occurrences.values()))} markers)")


if __name__ == "__main__":
    main()
