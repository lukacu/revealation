#!/usr/bin/env python3
"""Dependency-free checks for the static/PWA deployment artifact."""
from __future__ import annotations

from html.parser import HTMLParser
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


class ResourceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.urls: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        values = dict(attrs)
        for key in ("src", "href"):
            value = values.get(key)
            if value:
                self.urls.append(value)


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="revealation-pages-") as directory:
        dist = Path(directory) / "site"
        env = os.environ.copy()
        env["REVEALATION_BUILD_ID"] = "pwa-smoke-build"
        env["GITHUB_SHA"] = "0123456789abcdef0123456789abcdef01234567"
        subprocess.run([str(ROOT / "scripts/build-pages.sh"), str(dist)], cwd=ROOT, env=env, check=True)

        required = [
            "index.html",
            "manifest.webmanifest",
            "version.json",
            "precache-manifest.json",
            "sw.js",
            ".nojekyll",
            "__app__/preview.html",
            "__app__/src/core/revealation.js",
            "__app__/src/storage/directory.js",
            "__app__/src/storage/backup.js",
            "__app__/src/pwa/runtime.js",
            "__app__/icons/icon-192.png",
            "__app__/icons/icon-512.png",
            "__app__/icons/icon-512-maskable.png",
            "__app__/logo/revealation_logo.png",
            "__app__/logo/revealation_icon.png",
        ]
        for rel in required:
            assert (dist / rel).is_file(), f"missing PWA artifact file: {rel}"

        version = json.loads((dist / "version.json").read_text("utf-8"))
        assert version["build"] == "pwa-smoke-build"
        assert version["commit"] == env["GITHUB_SHA"]
        assert version["version"]

        index = (dist / "index.html").read_text("utf-8")
        assert 'data-revealation-static="true"' in index

        sw = (dist / "sw.js").read_text("utf-8")
        assert "__BUILD_ID__" not in sw
        assert "pwa-smoke-build" in sw
        assert "revealation-shell-" in sw
        assert "WORKSPACE_HANDLE_CHANGED" in sw
        assert "const RESERVED_ROOT_PREFIXES = ['__app__/'];" in sw

        manifest = json.loads((dist / "manifest.webmanifest").read_text("utf-8"))
        assert manifest["id"] == "./"
        assert manifest["start_url"] == "./"
        assert manifest["scope"] == "./"
        for icon in manifest["icons"]:
            assert icon["src"].startswith("./__app__/icons/")
            assert (dist / icon["src"].removeprefix("./")).is_file()

        precache = json.loads((dist / "precache-manifest.json").read_text("utf-8"))
        assert "index.html" in precache
        assert "manifest.webmanifest" in precache
        assert "__app__/src/core/revealation.js" in precache
        assert "__app__/src/storage/backup.js" in precache
        assert "__app__/icons/icon-192.png" in precache
        assert "sw.js" not in precache
        assert "version.json" not in precache
        assert "precache-manifest.json" not in precache
        assert ".nojekyll" not in precache
        assert not any(path.startswith("assets/") or path.startswith("interactive/") for path in precache)

        parser = ResourceParser()
        parser.feed(index)
        local_urls = [url for url in parser.urls if not url.startswith(("http:", "https:", "data:"))]
        assert local_urls
        assert all(not url.startswith("/") for url in local_urls), "deployment contains root-absolute app URLs"

        workflow = (ROOT / ".github/workflows/pages.yml").read_text("utf-8")
        assert "branches: [main]" in workflow
        assert "actions/checkout@v7" in workflow
        assert "actions/setup-node@v7" in workflow
        assert "actions/setup-python@v7" in workflow
        assert "actions/configure-pages@v6" in workflow
        assert "actions/upload-pages-artifact@v5" in workflow
        assert "include-hidden-files: true" in workflow
        assert "actions/deploy-pages@v5" in workflow
        assert "pages: write" in workflow and "id-token: write" in workflow

        subprocess.run([shutil.which("node") or "node", "--check", str(dist / "sw.js")], check=True)

    print("PWA build: OK")


if __name__ == "__main__":
    main()
