#!/usr/bin/env python3
"""Revealation workspace server.

Purpose
-------
Serve the Revealation application and expose one arbitrary filesystem directory
as the active presentation workspace.

Responsibilities
----------------
- serve app resources under `/__app__/...`;
- serve ordinary workspace files from the project root;
- load/save `deck.json` and `deck.md` atomically;
- list and upload workspace assets;
- enforce project-root path containment and safe directory filtering;
- support HTTP byte ranges for local media playback.

Does NOT
--------
- parse Revealation Markdown;
- mutate slide content or editor state;
- require third-party Python packages;
- provide multi-user locking or conflict resolution.

HTTP contract
-------------
The browser adapter is documented in `src/storage/workspace.js`. Keep endpoint
changes synchronized with that file and `src/storage/CONTRACT.md`.
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import hashlib
import threading
import urllib.parse
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent
APP_FILES = {
    "index.html",
    "preview.html",
    "speaker.html",
}
APP_STATIC_DIRS = {"src", "styles", "docs", "extensions", "themes", "vendor", "icons", "logo"}
PWA_ROOT_FILES = {"manifest.webmanifest"}
SKIP_DIRS = {".git", ".hg", ".svn", "__pycache__", "node_modules", ".venv", "venv"}
DECK_FILENAME = "deck.json"
DECK_MD_FILENAME = "deck.md"


def json_bytes(data) -> bytes:
    return json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")


def quote_path(path: str) -> str:
    return "/".join(urllib.parse.quote(part) for part in Path(path).parts)


def clean_upload_name(name: str) -> str:
    name = Path(name or "asset.bin").name
    # Keep Unicode and spaces; only remove characters that are troublesome on
    # common filesystems or could be interpreted as path syntax.
    name = re.sub(r"[\\/:*?\"<>|\x00-\x1f]", "-", name).strip()
    return name or "asset.bin"


def unique_path(folder: Path, name: str) -> Path:
    target = folder / name
    if not target.exists():
        return target
    stem, suffix = target.stem, target.suffix
    n = 2
    while True:
        candidate = folder / f"{stem}-{n}{suffix}"
        if not candidate.exists():
            return candidate
        n += 1


class WorkspaceServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, addr, handler, project_root: Path):
        super().__init__(addr, handler)
        self.project_root = project_root.resolve()
        self.save_lock = threading.RLock()


class Handler(BaseHTTPRequestHandler):
    server_version = "RevealationWorkspace/1.0"

    @property
    def project_root(self) -> Path:
        return self.server.project_root  # type: ignore[attr-defined]

    @property
    def deck_path(self) -> Path:
        return self.project_root / DECK_FILENAME

    @property
    def deck_md_path(self) -> Path:
        return self.project_root / DECK_MD_FILENAME

    def log_message(self, fmt, *args):
        sys.stderr.write("[revealation] " + fmt % args + "\n")

    def _headers(self, status: int, ctype: str, length: int | None = None, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        if length is not None:
            self.send_header("Content-Length", str(length))
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()

    def _json(self, status: int, data):
        raw = json_bytes(data)
        self._headers(status, "application/json; charset=utf-8", len(raw))
        self.wfile.write(raw)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def _safe_project_path(self, rel: str) -> Path | None:
        rel = urllib.parse.unquote(rel).replace("\\", "/").lstrip("/")
        try:
            target = (self.project_root / rel).resolve()
        except OSError:
            return None
        root = self.project_root
        if target == root or root in target.parents:
            return target
        return None

    def _serve_bytes(self, raw: bytes, ctype: str):
        self._headers(HTTPStatus.OK, ctype, len(raw))
        self.wfile.write(raw)

    def _serve_file(self, path: Path):
        if not path.exists() or not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            size = path.stat().st_size
            ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            range_header = self.headers.get("Range")
            if range_header:
                m = re.match(r"bytes=(\d*)-(\d*)$", range_header.strip())
                if m:
                    start_s, end_s = m.groups()
                    if start_s:
                        start = int(start_s)
                        end = int(end_s) if end_s else size - 1
                    elif end_s:
                        count = int(end_s)
                        start = max(0, size - count)
                        end = size - 1
                    else:
                        start, end = 0, size - 1
                    if start >= size or start > end:
                        self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                        self.send_header("Content-Range", f"bytes */{size}")
                        self.end_headers()
                        return
                    end = min(end, size - 1)
                    length = end - start + 1
                    self._headers(
                        HTTPStatus.PARTIAL_CONTENT,
                        ctype,
                        length,
                        {
                            "Accept-Ranges": "bytes",
                            "Content-Range": f"bytes {start}-{end}/{size}",
                        },
                    )
                    with path.open("rb") as f:
                        f.seek(start)
                        remaining = length
                        while remaining:
                            chunk = f.read(min(1024 * 1024, remaining))
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            remaining -= len(chunk)
                    return
            self._headers(HTTPStatus.OK, ctype, size, {"Accept-Ranges": "bytes"})
            with path.open("rb") as f:
                while True:
                    chunk = f.read(1024 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
        except BrokenPipeError:
            pass

    def _workspace_files(self):
        result = []
        root = self.project_root
        for current, dirnames, filenames in os.walk(root, followlinks=False):
            current_path = Path(current)
            dirnames[:] = [
                d for d in dirnames
                if d not in SKIP_DIRS and not d.startswith(".")
                and not (current_path / d).is_symlink()
            ]
            for filename in filenames:
                if filename in {DECK_FILENAME, DECK_MD_FILENAME} or filename.startswith("."):
                    continue
                path = current_path / filename
                if path.is_symlink() or not path.is_file():
                    continue
                try:
                    rel = path.relative_to(root).as_posix()
                    st = path.stat()
                except (OSError, ValueError):
                    continue
                mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
                if mime.startswith("image/"):
                    kind = "image"
                elif mime.startswith("video/"):
                    kind = "video"
                elif mime.startswith("audio/"):
                    kind = "audio"
                else:
                    kind = "file"
                result.append({
                    "id": rel,
                    "name": filename,
                    "path": rel,
                    "type": mime,
                    "kind": kind,
                    "size": st.st_size,
                    "modifiedAt": int(st.st_mtime * 1000),
                    # Relative URLs are deliberate: they remain meaningful in
                    # deck.json and in an exported HTML file placed in root.
                    "dataUrl": quote_path(rel),
                })
        result.sort(key=lambda x: x["path"].lower())
        return result

    @staticmethod
    def _revision_token(value) -> str:
        raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return hashlib.sha256(raw).hexdigest()

    def _deck_revision(self):
        entries = {}
        for name, path in ((DECK_FILENAME, self.deck_path), (DECK_MD_FILENAME, self.deck_md_path)):
            try:
                stat = path.stat()
                entries[name] = {
                    "exists": True,
                    "size": stat.st_size,
                    "mtimeNs": stat.st_mtime_ns,
                    "inode": getattr(stat, "st_ino", 0),
                }
            except FileNotFoundError:
                entries[name] = {"exists": False}
        return self._revision_token(entries)

    def _assets_revision(self, files=None):
        files = self._workspace_files() if files is None else files
        entries = [
            {"path": item["path"], "size": item["size"], "modifiedAt": item["modifiedAt"]}
            for item in files
        ]
        return self._revision_token(entries)

    def _workspace_revision(self, files=None):
        files = self._workspace_files() if files is None else files
        return {
            "deckToken": self._deck_revision(),
            "assetsToken": self._assets_revision(files),
        }

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/workspace":
            return self._json(HTTPStatus.OK, {
                "enabled": True,
                "root": str(self.project_root),
                "name": self.project_root.name or str(self.project_root),
                "deckFile": DECK_MD_FILENAME,
                "metadataFile": DECK_FILENAME,
            })
        if path == "/api/deck":
            project = None
            markdown = None
            errors = []
            if self.deck_path.exists():
                try:
                    project = json.loads(self.deck_path.read_text("utf-8"))
                except Exception as exc:
                    errors.append(f"Cannot read {DECK_FILENAME}: {exc}")
            if self.deck_md_path.exists():
                try:
                    markdown = self.deck_md_path.read_text("utf-8")
                except Exception as exc:
                    errors.append(f"Cannot read {DECK_MD_FILENAME}: {exc}")
            json_mtime = self.deck_path.stat().st_mtime_ns if self.deck_path.exists() else 0
            md_mtime = self.deck_md_path.stat().st_mtime_ns if self.deck_md_path.exists() else 0
            return self._json(HTTPStatus.OK, {
                "exists": self.deck_path.exists() or self.deck_md_path.exists(),
                "project": project,
                "markdown": markdown,
                "markdownExists": self.deck_md_path.exists(),
                # deck.md is the authoritative workspace content format.
                # deck.json is metadata/cache and must not silently override a
                # valid human-edited deck merely because its mtime is newer.
                "markdownPreferred": bool(self.deck_md_path.exists()),
                "metadataNewer": bool(self.deck_path.exists() and self.deck_md_path.exists() and json_mtime > md_mtime),
                "jsonMtimeNs": json_mtime,
                "markdownMtimeNs": md_mtime,
                "revision": self._workspace_revision(),
                "errors": errors,
            })
        if path == "/api/workspace-state":
            files = self._workspace_files()
            return self._json(HTTPStatus.OK, {
                "ok": True,
                "revision": self._workspace_revision(files),
                "files": files,
            })
        if path == "/api/files":
            return self._json(HTTPStatus.OK, {"files": self._workspace_files()})
        if path == "/api/health":
            return self._json(HTTPStatus.OK, {"ok": True})

        # Editor files live in their own URL namespace.  The app itself is
        # served at /, while all ordinary relative paths belong to workspace.
        if path == "/":
            return self._serve_file(APP_ROOT / "index.html")

        # The web app manifest is referenced at the deployment root on static
        # hosts, so reserve the same path here instead of accidentally looking
        # for it inside the presentation workspace.
        rel_root = urllib.parse.unquote(path).lstrip("/")
        if rel_root in PWA_ROOT_FILES:
            candidate = (APP_ROOT / rel_root).resolve()
            try:
                candidate.relative_to(APP_ROOT)
            except ValueError:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            return self._serve_file(candidate)

        if path.startswith("/__app__/"):
            rel = urllib.parse.unquote(path[len("/__app__/"):]).lstrip("/")
            parts = Path(rel).parts
            allowed = (len(parts) == 1 and rel in APP_FILES) or (len(parts) > 1 and parts[0] in APP_STATIC_DIRS)
            if not allowed or any(part in {"..", "."} for part in parts):
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            candidate = (APP_ROOT / rel).resolve()
            try:
                candidate.relative_to(APP_ROOT)
            except ValueError:
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            if not candidate.is_file():
                self.send_error(HTTPStatus.NOT_FOUND)
                return
            return self._serve_file(candidate)

        # Any other URL maps directly to a file inside the project directory.
        project_file = self._safe_project_path(path)
        if project_file and project_file.is_file():
            return self._serve_file(project_file)
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/deck":
            try:
                payload = self._read_json()
                project = payload.get("project", payload)
                markdown = payload.get("markdown") if isinstance(payload, dict) else None
                expected_revision = payload.get("expectedRevision") if isinstance(payload, dict) else None
                if not isinstance(project, dict):
                    raise ValueError("project must be a JSON object")
                if markdown is not None and not isinstance(markdown, str):
                    raise ValueError("markdown must be a string")
                expected_token = expected_revision.get("deckToken") if isinstance(expected_revision, dict) else expected_revision
                with self.server.save_lock:  # type: ignore[attr-defined]
                    current_token = self._deck_revision()
                    if expected_token and expected_token != current_token:
                        return self._json(HTTPStatus.CONFLICT, {
                            "ok": False,
                            "error": "The presentation changed on disk.",
                            "revision": self._workspace_revision(),
                        })
                    self.project_root.mkdir(parents=True, exist_ok=True)
                    tmp = self.deck_path.with_name(DECK_FILENAME + ".tmp")
                    tmp.write_bytes(json_bytes(project))
                    tmp.replace(self.deck_path)
                    if markdown is not None:
                        md_tmp = self.deck_md_path.with_name(DECK_MD_FILENAME + ".tmp")
                        md_tmp.write_text(markdown, encoding="utf-8")
                        md_tmp.replace(self.deck_md_path)
                return self._json(HTTPStatus.OK, {
                    "ok": True,
                    "deckFile": DECK_MD_FILENAME,
                    "metadataFile": DECK_FILENAME,
                    "revision": self._workspace_revision(),
                })
            except Exception as exc:
                return self._json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})

        if path == "/api/upload":
            try:
                query = urllib.parse.parse_qs(parsed.query)
                ctype = self.headers.get("Content-Type", "")
                if ctype.startswith("application/json"):
                    payload = self._read_json()
                    name = clean_upload_name(str(payload.get("name") or "asset.bin"))
                    subdir = str(payload.get("subdir") or "assets").replace("\\", "/").strip("/")
                    data = str(payload.get("data") or "")
                    if "," in data and data.startswith("data:"):
                        data = data.split(",", 1)[1]
                    raw = base64.b64decode(data, validate=False)
                    hinted_type = str(payload.get("type") or "")
                else:
                    name = clean_upload_name((query.get("name") or ["asset.bin"])[0])
                    subdir = str((query.get("subdir") or ["assets"])[0]).replace("\\", "/").strip("/")
                    length = int(self.headers.get("Content-Length", "0") or 0)
                    raw = self.rfile.read(length) if length else b""
                    hinted_type = self.headers.get("X-File-Type", "")
                folder = self._safe_project_path(subdir)
                if folder is None:
                    raise ValueError("Invalid upload directory")
                folder.mkdir(parents=True, exist_ok=True)
                if not folder.is_dir():
                    raise ValueError("Upload destination is not a directory")
                target = unique_path(folder, name)
                target.write_bytes(raw)
                rel = target.relative_to(self.project_root).as_posix()
                mime = mimetypes.guess_type(target.name)[0] or hinted_type or "application/octet-stream"
                if mime.startswith("image/"):
                    kind = "image"
                elif mime.startswith("video/"):
                    kind = "video"
                elif mime.startswith("audio/"):
                    kind = "audio"
                else:
                    kind = "file"
                return self._json(HTTPStatus.OK, {
                    "ok": True,
                    "file": {
                        "id": rel,
                        "name": target.name,
                        "path": rel,
                        "type": mime,
                        "kind": kind,
                        "size": target.stat().st_size,
                        "modifiedAt": int(target.stat().st_mtime * 1000),
                        "dataUrl": quote_path(rel),
                    },
                })
            except Exception as exc:
                return self._json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(exc)})

        self.send_error(HTTPStatus.NOT_FOUND)


def main():
    parser = argparse.ArgumentParser(
        description="Run Revealation against a real directory on disk."
    )
    parser.add_argument(
        "project",
        nargs="?",
        default=os.getcwd(),
        help="Project directory (default: current working directory)",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    args = parser.parse_args()

    project_root = Path(args.project).expanduser().resolve()
    project_root.mkdir(parents=True, exist_ok=True)

    server = WorkspaceServer((args.host, args.port), Handler, project_root)
    print(f"Revealation workspace: http://{args.host}:{args.port}/")
    print(f"Project directory:      {project_root}")
    print(f"Deck markdown:          {project_root / DECK_MD_FILENAME}")
    print(f"Deck metadata:          {project_root / DECK_FILENAME}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
