# Workspace edition changes

Revealation starts from the supplied Small Reveal source plus the subsequent workspace, Markdown, media, layout, export, and interactive-content additions.

## Filesystem backend

- Added `server.py` using only Python's standard library.
- `start.sh [project-directory]` serves the editor and binds it to one real directory.
- Saves the active deck directly to `deck.json` in that directory.
- Scans project files recursively for the Workspace files dialog.
- Serves project-relative URLs directly, so slide HTML stores paths such as `images/camera.svg` rather than base64 blobs or absolute paths.
- Upload, paste, and drag/drop copy external media into `assets/`.
- Supports HTTP byte ranges for local video seeking.
- Rejects directory traversal and does not follow symlinks outside the project root.
- Skips hidden folders, VCS metadata, virtualenvs, and `node_modules` during asset scans.

## Editor integration

- Workspace mode is detected automatically through `/api/workspace`.
- Browser IndexedDB/Gist persistence is bypassed while workspace mode is active.
- Projects/New/Sync controls are hidden in workspace mode.
- Workspace files include images, videos, audio, and generic files; generic files insert as links.
- Added a Refresh button and project-root indicator to the asset dialog.
- Preview resolves project-relative paths against the project root.

## Still CDN-hosted

Reveal.js, KaTeX, highlight.js, Marked, Turndown, Bootstrap Icons, and some fonts/themes are still loaded from CDNs. The filesystem workflow is local, but full offline operation would require vendoring those static dependencies.


## Media controls

- Added interactive image/video resizing with a drag handle and percentage width slider.
- Media width is saved as a relative percentage, so it remains responsive inside slides and columns.
- Added video options for reveal-aware autoplay (`data-autoplay`), controls, loop, and muted.
- New videos default to controls on, autoplay off, loop off, and sound on.
- Legacy videos carrying plain HTML `autoplay` are migrated to reveal.js `data-autoplay`.

## Readable workspace Markdown

- `deck.md` is now the primary human-readable source for slide content in workspace mode.
- `deck.json` remains beside it for theme/config/stable IDs and backwards compatibility.
- On reload, `deck.md` overrides cached slide content from `deck.json`.
- Editor-generated 50/50, 60/40, and 40/60 layouts serialize as `::: columns ...` / `::: column` blocks.
- Resized images serialize as `![alt](path){width=N%}`.
- Videos serialize as `::: video` blocks with width, controls, autoplay, loop, and muted settings.
- Audio uses a small `::: audio` block.
- Unknown or customized structures still fall back to literal HTML instead of being guessed at.
- Slide separator parsing now ignores `---` / `--` lines inside fenced code blocks.
