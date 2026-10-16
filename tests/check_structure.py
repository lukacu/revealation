#!/usr/bin/env python3
"""Static structure checks for Revealation.

Checks invariants that do not require a browser or network:
- no duplicate DOM ids in index.html;
- every `$('#id')` core reference exists;
- local `./__app__/...` script/style references resolve to files;
- every active JavaScript source file carries the documented file contract.
"""
from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]


class IndexParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: list[str] = []
        self.classes: set[str] = set()
        self.attributes: dict[str, set[str]] = {}
        self.scripts: list[str] = []
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        values = dict(attrs)
        if "id" in values:
            self.ids.append(values["id"])
        for class_name in str(values.get("class") or "").split():
            self.classes.add(class_name)
        for name, value in attrs:
            if value is not None:
                self.attributes.setdefault(name, set()).add(value)
        if tag == "script" and values.get("src"):
            self.scripts.append(values["src"])
        if tag == "link" and values.get("href"):
            self.links.append(values["href"])


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    parser = IndexParser()
    parser.feed((ROOT / "index.html").read_text("utf-8"))

    duplicates = sorted({item for item in parser.ids if parser.ids.count(item) > 1})
    if duplicates:
        fail(f"duplicate DOM ids: {duplicates}")

    index_source = (ROOT / "index.html").read_text("utf-8")
    if not re.search(r'data-action="math"[^>]*>\s*<i class="bi bi-braces-asterisk"', index_source):
        fail("math toolbar action is missing the formula/braces icon")

    application = (ROOT / "src/core/application.js").read_text("utf-8")
    if "data.markdownPreferred !== false" in application:
        fail("workspace content still lets deck.json mtime override deck.md")
    if "data.markdownExists && typeof data.markdown === 'string'" not in application:
        fail("workspace load does not explicitly prefer existing deck.md content")
    # Canonical Markdown must store layout identity on the slide separator.
    # `::: layout` may remain only in legacy-reading comments/parsers, never in
    # the active application writer.
    if re.search(r"[`\"]:::\s+layout\s+\$?\{?", application):
        fail("application writer still contains canonical ::: layout output")
    # Only treat a simple `$('#id')` call as an ID lookup. Calls such as
    # `$('#layout-modal .modal-head strong')` are valid compound selectors and
    # must be left to the browser's selector engine rather than compared with
    # the set of literal DOM ids.
    id_refs = set(re.findall(r"\$\('#([A-Za-z][A-Za-z0-9_-]*)'\)", application))
    missing_ids = sorted(id_refs - set(parser.ids))
    if missing_ids:
        fail(f"application references missing DOM ids: {missing_ids}")

    for url in parser.scripts + parser.links:
        prefix = "./__app__/" if url.startswith("./__app__/") else "/__app__/" if url.startswith("/__app__/") else ""
        if not prefix:
            continue
        target = ROOT / url[len(prefix) :]
        if not target.is_file():
            fail(f"missing local app resource: {url}")

    # Config files are intentionally hand-edited. Validate the selector forms
    # used by current configuration without needing a browser CSS engine.
    selector_strings: set[str] = set()
    for config_name in ("src/config/toolbar.js", "src/config/topbar.js"):
        source = (ROOT / config_name).read_text("utf-8")
        selector_strings.update(re.findall(r"['\"]((?:#[A-Za-z][^'\"]*)|(?:\.[A-Za-z][^'\"]*)|(?:\[[^'\"]+\]))['\"]", source))
    for selector in sorted(selector_strings):
        if selector.startswith("#") and re.fullmatch(r"#[A-Za-z0-9_-]+", selector):
            if selector[1:] not in parser.ids:
                fail(f"configuration selector not found: {selector}")
        elif selector.startswith("["):
            match = re.fullmatch(r'\[([A-Za-z0-9_-]+)="([^"]+)"\]', selector)
            if match and match.group(2) not in parser.attributes.get(match.group(1), set()):
                fail(f"configuration selector not found: {selector}")
        elif selector.startswith("."):
            # Current class selectors are simple or descendant pairs such as
            # `.topbar-actions .field`; checking every named class catches
            # stale renames without embedding a CSS selector engine in tests.
            for class_name in re.findall(r"\.([A-Za-z0-9_-]+)", selector):
                if class_name not in parser.classes:
                    fail(f"configuration selector class not found: {selector}")

    js_files = sorted((ROOT / "src").rglob("*.js"))
    for source in js_files:
        header = source.read_text("utf-8")[:5500]
        for section in ("Purpose", "Responsibilities", "Does NOT"):
            if section not in header:
                fail(f"{source.relative_to(ROOT)}: missing {section!r} header section")
        if not any(section in header for section in ("Public API", "Entry point", "Entry point / contract")):
            fail(f"{source.relative_to(ROOT)}: missing Public API / Entry point header section")

    print(f"structure: OK ({len(parser.ids)} DOM ids, {len(selector_strings)} config selectors, {len(js_files)} documented JS files)")


if __name__ == "__main__":
    main()
