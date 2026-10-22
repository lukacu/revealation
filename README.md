<div align="center">

<img src="logo/revealation_logo.png" alt="Revealation logo" width="520">

---

### A local-first Markdown editor for polished reveal.js presentations

Create, edit, present, and export technical presentations from a Git-friendly workspace. Bring your ideas, your Markdown, and perhaps a comforting beverage.

[![MIT License](https://img.shields.io/badge/license-MIT-2563eb?style=flat-square)](LICENSE)
[![Online version](https://img.shields.io/badge/online-PWA-2563eb?style=flat-square)](https://lukacu.github.io/revealation/)

[Quick start](#quick-start) · [Features](#features) · [Documentation](#documentation) · [Development](#development-and-testing)

</div>

Revealation is a local-first web editor for creating technical [reveal.js](https://revealjs.com/) presentations. The presentation source is human-readable Markdown. A workspace stores slide content in `deck.md`, project metadata in `deck.json`, and media or other resources as ordinary files with relative paths. This makes presentations easy to edit, move, back up, and version with Git.

## Why this exists

Prompted with passion and lack of time, Revealation began as a “let’s see what we can get with AI over the weekend” project. Naturally, it spiraled out of control and became a real slide editor.

I have not looked at 99% of the code. I am, however, actively using it and polishing its rough edges iteratively ... which is either a development methodology or just an avoidance strategy.

The end goal is simple: finally have full control over my slides without going insane while writing them. Revealation is deliberately heavily opinionated and limited in customization by choice, partly because good defaults are lovely and partly because I have seen some dreadful PowerPoint abominations.

Markdown is the secret ingredient. It makes conversations with AI dramatically easier: the source is readable, portable, diffable, and much less mysterious than a pile of presentation-editor internals.

The project is based on [Small Reveal](https://github.com/samplereality/small-reveal/), which showed me what was possible and gave this weekend experiment somewhere wonderful to start.

## Features

- Visual slide editing with a whole-deck Markdown editor
- Full-screen Present mode directly from the editor and browser-based PDF export
- Subslides, `::: notes` speaker notes, fragments, presentation-wide transitions, and curated slide backgrounds
- Curated light/dark presentation themes with a manifest-based theme extension API
- Protected single- and multi-block layouts with custom layout extensions
- Local images, video, audio, and iframe-backed interactive content
- Syntax-highlighted code and LaTeX equation editing
- Workspace file browser and relative asset paths
- Installable PWA mode with direct access to a user-selected local presentation folder on supported browsers
- Import and export for `.revealation` presentations, Markdown, standalone HTML, and PDF
- Responsive editor layout for desktop and mobile screens

## Quick start

For the local workspace server, requirements are Python 3 and a modern browser.

Start Revealation with a presentation directory as its workspace:

```bash
./start.sh /path/to/presentation
```

Then open [http://127.0.0.1:8000/](http://127.0.0.1:8000/) in a browser. If no directory is supplied, the current directory is used.

For local development, use a temporary or scratch workspace:

```bash
./start.sh /tmp/revealation-workspace
```

No Node.js, npm, database, or Python packages are required for normal local use.

Revealation can also be deployed as an installable static PWA. On supported Chromium-family browsers it opens a local presentation folder directly through the File System Access API; on other browsers it retains browser-storage fallback. The repository includes a GitHub Pages workflow for `main`. See [`docs/PWA_DEPLOYMENT.md`](docs/PWA_DEPLOYMENT.md).

For the alpha release, Chromium-family browsers are preferred for local-folder
PWA access. Standalone HTML cannot reliably bundle complex interactive apps,
and PDF export depends on the browser's native **Print → Save as PDF** dialog.
See the complete [release limitations](docs/RELEASE_LIMITATIONS.md).

## Workspace structure

A typical presentation project looks like this:

```text
presentation/
├── deck.md
├── deck.json
├── assets/
│   ├── diagram.svg
│   └── example.png
├── media/
│   └── clip.mp4
└── interactive/
    └── example/
        ├── index.html
        ├── app.js
        └── style.css
```

`deck.md` is the source of truth for slide content. `deck.json` stores project metadata and editor state; it does not replace the Markdown document. Assets remain regular files and are referenced using paths relative to the workspace.

## Markdown example

Most content uses ordinary Markdown. Revealation adds small, readable directives for presentation-specific structures:

```markdown
--- layout=two-columns

::: block
## Main point

Text, lists, code, equations, and images.
:::

::: block align=center
![Diagram](assets/diagram.svg){width=70%}
:::
```

See [`docs/MARKDOWN.md`](docs/MARKDOWN.md), [`docs/LAYOUTS.md`](docs/LAYOUTS.md), and [`docs/THEMES_AND_BACKGROUNDS.md`](docs/THEMES_AND_BACKGROUNDS.md) for the complete syntax and extension rules.

## Documentation

The [`docs/`](docs/) directory contains the detailed documentation:

- [`docs/README.md`](docs/README.md) — documentation index
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — development workflow and where to make changes
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — source-tree responsibilities and boundaries
- [`docs/MARKDOWN.md`](docs/MARKDOWN.md) — Markdown format and directives
- [`docs/LAYOUTS.md`](docs/LAYOUTS.md) — built-in layouts and extension API
- [`docs/THEMES_AND_BACKGROUNDS.md`](docs/THEMES_AND_BACKGROUNDS.md) — curated themes, design tokens and background extensions
- [`docs/INTERACTIVE.md`](docs/INTERACTIVE.md) — interactive content
- [`docs/PDF_EXPORT.md`](docs/PDF_EXPORT.md) — PDF export behavior
- [`docs/RELEASE_LIMITATIONS.md`](docs/RELEASE_LIMITATIONS.md) — alpha release limitations and export/deployment caveats
- [`docs/PWA_DEPLOYMENT.md`](docs/PWA_DEPLOYMENT.md) — static/PWA deployment, updates and local-directory access
- [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) — vendored libraries, versions, licenses, and source links
- [`docs/TESTING.md`](docs/TESTING.md) — checks and smoke tests
- [`docs/COMPATIBILITY_DEBT.md`](docs/COMPATIBILITY_DEBT.md) — temporary internal compatibility paths scheduled for removal before public release

Historical notes, architecture decisions, and preserved upstream material are also kept under `docs/`.

## Development and testing

Revealation has no mandatory development build system. Edit the source, reload the browser, and run the checks before packaging:

```bash
./tests/check.sh
```

The dependency-free checks always run. If `chromium` is available, the command
also runs the headless Chromium regression suites; otherwise
those browser tests are skipped. See [`docs/TESTING.md`](docs/TESTING.md) for
the browser-test commands and prerequisites.

Source code is organized by responsibility under [`src/`](src/). Explicit extension registrations live under [`extensions/`](extensions/); built-in theme packages live under [`themes/`](themes/). `./scripts/build-pages.sh` is a deployment-only assembly step that creates the static PWA artifact in `dist/`; it does not bundle or transform the browser source.

## Attribution

Revealation started from [Small Reveal](https://github.com/samplereality/small-reveal) by Mark Sample. The original MIT license and attribution are preserved; Revealation adds the filesystem workspace, layout, interactive-content, and export features. Unfortunately, the projects are not compatible anymore due to heavy divergence, but Small Reveal remains a wonderful reference for reveal.js usage and design.

## License

[MIT License](LICENSE)
