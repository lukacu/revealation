#!/usr/bin/env python3
"""Dependency-free smoke tests for the Revealation workspace HTTP server."""
from __future__ import annotations

import json
from pathlib import Path
import tempfile
import threading
import urllib.error
import urllib.request

import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server as revealation_server  # noqa: E402


def request_json(url: str, *, method: str = "GET", payload=None):
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def request_bytes(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=5) as response:
        return response.read()


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="revealation-test-") as directory:
        workspace = Path(directory)
        (workspace / "images").mkdir()
        (workspace / "interactive/demo").mkdir(parents=True)
        (workspace / "images/test.svg").write_text(
            '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4"/></svg>',
            encoding="utf-8",
        )
        (workspace / "interactive/demo/index.html").write_text(
            '<!doctype html><title>Interactive smoke</title><p>ok</p>',
            encoding="utf-8",
        )
        (workspace / "deck.md").write_text(
            "# Smoke\n\n--\n\n## Subslide\n\n::: interactive\n"
            "src: interactive/demo/index.html\nwidth: 80%\nheight: 320\n"
            "interactive: true\npreload: false\nborder: true\n:::\n",
            encoding="utf-8",
        )

        httpd = revealation_server.WorkspaceServer(
            ("127.0.0.1", 0), revealation_server.Handler, workspace
        )
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{httpd.server_address[1]}"
        try:
            assert request_json(base + "/api/health")["ok"] is True
            info = request_json(base + "/api/workspace")
            assert info["enabled"] is True and info["name"] == workspace.name

            deck = request_json(base + "/api/deck")
            assert "::: interactive" in deck["markdown"]

            saved_markdown = "# Saved by smoke test\n"
            saved = request_json(
                base + "/api/deck",
                method="POST",
                payload={
                    "project": {"id": "smoke", "name": "Smoke", "slides": []},
                    "markdown": saved_markdown,
                },
            )
            assert saved["ok"] is True
            deck = request_json(base + "/api/deck")
            assert deck["project"]["name"] == "Smoke"
            assert deck["markdown"] == saved_markdown
            assert deck["markdownPreferred"] is True
            state = request_json(base + "/api/workspace-state")
            assert state["revision"]["deckToken"] == deck["revision"]["deckToken"]
            (workspace / "deck.md").write_text("# Changed externally\n", encoding="utf-8")
            try:
                request_json(
                    base + "/api/deck",
                    method="POST",
                    payload={
                        "project": {"id": "smoke", "name": "Stale", "slides": []},
                        "markdown": saved_markdown,
                        "expectedRevision": deck["revision"]["deckToken"],
                    },
                )
                raise AssertionError("stale workspace save was accepted")
            except urllib.error.HTTPError as error:
                assert error.code == 409
            (workspace / "deck.md").write_text(saved_markdown, encoding="utf-8")

            # deck.md is authoritative even when deck.json happens to have a
            # newer mtime (for example after metadata-only/cache activity).
            import os, time
            md_stat = (workspace / "deck.md").stat()
            newer = max(time.time_ns(), md_stat.st_mtime_ns + 2_000_000_000)
            os.utime(workspace / "deck.json", ns=(newer, newer))
            deck = request_json(base + "/api/deck")
            assert deck["metadataNewer"] is True
            assert deck["markdownPreferred"] is True

            upload = urllib.request.Request(
                base + "/api/upload?name=note.txt&subdir=assets",
                data=b"asset smoke",
                method="POST",
                headers={
                    "Content-Type": "application/octet-stream",
                    "X-File-Type": "text/plain",
                },
            )
            with urllib.request.urlopen(upload, timeout=5) as response:
                uploaded = json.loads(response.read().decode("utf-8"))
            assert uploaded["file"]["path"] == "assets/note.txt"

            files = request_json(base + "/api/files")["files"]
            paths = {entry["path"] for entry in files}
            assert "images/test.svg" in paths
            assert "interactive/demo/index.html" in paths
            assert "assets/note.txt" in paths

            assert b"<circle" in request_bytes(base + "/images/test.svg")
            assert b"Interactive smoke" in request_bytes(base + "/interactive/demo/index.html")
            assert b"Revealation" in request_bytes(base + "/")
            manifest = json.loads(request_bytes(base + "/manifest.webmanifest"))
            assert manifest["start_url"] == "./"
            assert request_bytes(base + "/__app__/icons/icon-192.png").startswith(b"\x89PNG")
            assert request_bytes(base + "/__app__/logo/revealation_logo.png").startswith(b"\x89PNG")
            assert request_bytes(base + "/__app__/logo/revealation_icon.png").startswith(b"\x89PNG")
            assert b"Revealation" in request_bytes(base + "/__app__/src/core/revealation.js")
            assert b"Revealation" in request_bytes(base + "/__app__/src/ui/sidebar.js")
            assert b"layout registry" in request_bytes(base + "/__app__/src/layout/registry.js")
            assert b"layout editor affordances" in request_bytes(base + "/__app__/styles/layouts.css")
            assert b"local layout extensions" in request_bytes(base + "/__app__/extensions/layouts/custom.js")
            clean_theme = json.loads(request_bytes(base + "/__app__/themes/clean/theme.json"))
            assert clean_theme["id"] == "clean"
            assert b"--rv-bg" in request_bytes(base + "/__app__/themes/clean/theme.css")
            assert json.loads(request_bytes(base + "/__app__/themes/classic/theme.json"))["id"] == "classic"
            assert json.loads(request_bytes(base + "/__app__/themes/kinetic/theme.json"))["id"] == "kinetic"
            assert b"rv-block-callout" in request_bytes(base + "/__app__/themes/classic/theme.css")
            assert b"rv-block-callout" in request_bytes(base + "/__app__/themes/kinetic/theme.css")
            grid_background = json.loads(request_bytes(base + "/__app__/extensions/backgrounds/grid/extension.json"))
            assert grid_background["id"] == "grid"
        finally:
            httpd.shutdown()
            httpd.server_close()
            thread.join(timeout=3)

    print("workspace server: OK")


if __name__ == "__main__":
    main()
