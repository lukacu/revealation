# Revealation architecture

Revealation is a standalone local-first PWA presentation editor built around reveal.js. It originated from Small Reveal, but **Small Reveal is historical upstream, not an architectural layer**.

The project intentionally has **no development bundling/compilation step**. Browser source files are loaded directly and register APIs under `window.Revealation`. Static/PWA deployment uses a small assembly script only to create the deployment tree and generated service-worker/version metadata.

## Source structure

```text
revealation/
├── index.html
├── preview.html
├── server.py
├── start.sh
│
├── src/
│   ├── core/
│   │   ├── revealation.js
│   │   ├── slide-model.js
│   │   ├── history.js
│   │   └── application.js
│   ├── ui/
│   │   ├── sidebar.js
│   │   ├── toolbar.js
│   │   └── topbar.js
│   ├── editor/
│   │   ├── dom-selection.js
│   │   └── content-normalization.js
│   ├── rendering/
│   │   └── preview.js
│   ├── serialization/
│   │   ├── directives.js
│   │   └── deck.js
│   ├── storage/
│   │   ├── CONTRACT.md
│   │   ├── workspace.js
│   │   ├── directory.js
│   │   └── indexeddb.js
│   ├── pwa/
│   │   └── runtime.js
│   ├── content/
│   │   └── interactive.js
│   ├── layout/
│   │   ├── registry.js
│   │   ├── builtins.js
│   │   └── blocks.js
│   ├── theme/
│   │   └── registry.js
│   ├── background/
│   │   ├── registry.js
│   │   └── runtime.js
│   ├── export/
│   │   └── pdf.js
│   └── config/
│       ├── toolbar.js
│       └── topbar.js
│
├── extensions/
│   ├── layouts/
│   │   └── custom.js
│   ├── themes/
│   │   └── register.js
│   └── backgrounds/
│       ├── register.js
│       └── grid/
├── themes/
│   ├── clean/
│   └── dark/
├── styles/
│   ├── app.css
│   ├── sidebar.css
│   ├── layouts.css
│   └── interactive.css
└── docs/
```

## Architecture rule

A file exists because it owns a coherent responsibility, **not because a feature was added later**.

Examples:

- the sidebar is core UI, therefore it lives in `src/ui/sidebar.js`;
- the Python workspace protocol is an implementation of persistence, therefore it lives in `src/storage/workspace.js`;
- `interactive` is a content type with stable Markdown/DOM semantics, therefore it lives in `src/content/interactive.js`;
- PDF is one export path, therefore it lives in `src/export/pdf.js`.

## Core ownership

Core owns state mutations and invariants:

- current project/deck;
- current slide;
- undo/redo;
- save scheduling;
- slide/subslide hierarchy mutations;
- coordination between WYSIWYG and Markdown modes.

Other domains must not bypass those rules. For example, `ui/sidebar.js` can request a move via `onMove(from, target, mode)`, but it does not directly reorder `state.slides`.

## Visual-system boundary

Presentation appearance follows a one-way dependency: content is interpreted through Revealation's semantic layouts, then styled by one presentation-level theme. A slide may additionally select an independent background extension. The editor does not generate arbitrary visual CSS from font/color/spacing controls.

`src/theme/registry.js` and `src/background/registry.js` are deliberately small manifest registries. Installed manifests are declared under `extensions/themes/register.js` and `extensions/backgrounds/register.js`; this explicit catalog is necessary because the application has no build step and a static browser cannot enumerate directories portably. `src/background/runtime.js` is presentation-only lifecycle glue for optional animated effects; editor mode uses background CSS as a static preview and does not execute extension JavaScript.

Themes style stable `--rv-*` design tokens plus semantic `.rv-slide` / `.rv-layout-*` and existing `.sr-*` hooks. Layout definitions are shared across themes. See [`THEMES_AND_BACKGROUNDS.md`](THEMES_AND_BACKGROUNDS.md) and ADR 009.

### Settings boundary

The normal UI keeps application preferences and presentation styling separate:

- **Application settings** contain application-facing preferences and functional Present behavior. Interface light/dark mode is local to the editor; Reveal controls/navigation/link-preview/playback options are deck configuration and are serialized with the presentation.
- **Deck settings** own presentation metadata and deck-level visual/runtime appearance: deck name, author, curated theme, presentation-wide transitions, and slide-canvas geometry. The deck name shown in the main toolbar is display-only. These values are serialized with the project and apply consistently to Present/export.
- **Slide editing controls** stay close to the slide rather than occupying a footer strip. The formatting toolbar ends with Layout, Background, and Notes actions. Layout/Background open focused pickers; Notes toggles a right sidebar containing speaker notes plus the Subslide, WIP, and Hidden toggles. Per-slide transition authoring is intentionally not exposed. Temporary `RV-COMPAT(slide-transition)` support still reads old per-slide transition metadata.

Presentation configuration is intentionally split by meaning: visual choices (theme, transitions, canvas geometry and centering) live in **Deck settings**, while functional presentation behavior (controls, progress/slide numbers, navigation, Present-mode link previews and auto-advance) lives in **Application settings** alongside the editor light/dark preference. `RV-COMPAT(reveal-config-fields)` now applies only to unknown/retired configuration keys still round-tripped from older internal decks. All temporary compatibility boundaries are inventoried in [`COMPATIBILITY_DEBT.md`](COMPATIBILITY_DEBT.md).

Speaker notes have a dedicated serialization primitive in `src/serialization/notes.js`. The canonical `::: notes ... :::` block is stripped from visual/layout parsing, stored as `slide.notes`, and emitted back as the final top-level block of that slide. There is intentionally no `Note:` compatibility parser.

## Slide / subslide model

Revealation's public terminology is **slide / subslide**.

For multi-block slides, the core slide model also owns `layout` plus ordered `blocks`. Each block stores canonical content HTML and alignment. Protected `.sr-layout` DOM is rebuilt from that data for WYSIWYG/preview and is never the persistence boundary. During WYSIWYG editing, a cleaned clone of that protected DOM is committed directly back into `slide.blocks`; the core does not flatten and reparse the whole editor as an intermediate persistence step. The default `single` layout keeps ordinary `slide.content` and has `blocks: null`.

`RV-COMPAT(subslide-vertical)` currently keeps the historic project field:

```js
slide.vertical === true
```

until the pre-release model cleanup. New code should use `Revealation.core.slideModel.isSubslide()` rather than treating `vertical` as product terminology.

## Storage boundary

The editor core decides *what* and *when* to save. Storage adapters decide *how* persistence happens.

`workspace.js` owns all `/api/...` calls. `directory.js` owns File System Access directory operations and the recent-folder handle registry for hosted/PWA mode. `indexeddb.js` owns browser transaction mechanics. `backup.js` owns the versioned browser-library backup format. None parses Revealation Markdown or mutates editor state.

Launch mode chooses the filesystem adapter: the hosted PWA is the primary deployment and connects a local directory in a secure browser context; the Python workspace is retained for development and offline use. Multiple recent directory handles can be remembered in IndexedDB, while exactly one is marked active for the service worker and presentation content remains ordinary files. The PWA service worker maps presentation-relative requests back to that directory so assets and iframe-backed interactive content keep the same URL semantics as the Python server.

See `src/storage/README.md`, ADR 002 and ADR 010.

## WYSIWYG editing boundary

The browser `contenteditable` DOM is treated as an editing surface, not as an unconstrained document model. `src/editor/content-normalization.js` repairs/sanitizes browser and clipboard markup into the canonical content vocabulary before persistence. `src/editor/rich-text.js` owns deterministic interactions that browsers do not implement consistently, currently including Tab/Shift+Tab list indentation and selection preservation during structural list moves.

Internal Revealation copy/paste has a canonical clipboard flavor so structured content and media can move between layout fields without passing through the deliberately lossy external-HTML sanitizer. Application/core still owns history and async asset persistence, but it snapshots the destination Range before an asynchronous pasted file is processed.

Layout slots are semantic editing hosts. Their stable ids are used when changing layouts; unmatched source fields flow into the target layout's single master slot rather than being dropped. One slot may be declared `titleSource: true`, which is the only field used to derive the sidebar label. The layout id is shown by selection state in the Layout picker rather than as an overlay on the slide. See `docs/LAYOUTS.md`.

Editor geometry is a projection of the same logical Reveal canvas used by Present/export. Theme length tokens such as `--rv-slide-padding` and `--rv-size-body` are resolved to concrete scaled pixels by `updateStageScale()`; do not express this as `calc(<length> * <scale>)`, which is not portable CSS. Vertical centering preserves the theme padding baseline and adds only Reveal's centering offset. PDF print mode explicitly restores theme slide padding because reveal.js's built-in print stylesheet resets section padding with `!important`.

`slide.hidden` is authoring metadata. Core keeps hidden slides in state/history/storage and only projects a filtered presentation slide sequence at the Present/export boundary. That projection preserves original slide/subslide stack boundaries; if a hidden horizontal parent has visible subslides, the first remaining subslide becomes the visible stack root rather than attaching to the previous stack.

## Content-type boundary

A content type should ideally own:

- canonical Markdown form;
- canonical editor/presentation DOM form;
- validation and normalization rules;
- strict recognition for lossless serialization.

`src/content/interactive.js` is the first extracted example. Image/video/audio/code/math can migrate to the same pattern when their contracts are clear.

## UI configuration

Toolbar and top-bar behavior are core UI, but their **layout** is declarative:

- `src/config/toolbar.js`
- `src/config/topbar.js`

This makes hand-editing button order/visibility safe without mixing layout decisions into event-handling code.

## Loading order

`index.html` loads:

1. third-party browser libraries;
2. `src/core/revealation.js` namespace;
3. core/config/storage/content/layout/theme/background/editor/UI/export components and local layout/theme/background registrations;
4. `src/core/application.js` last.

No source file should depend on a file loaded after it.

`src/export/deck.js` is loaded before the application orchestrator. Core supplies
a narrow rendering adapter when it creates the exporter; the export module does
not reach back into mutable application state.

## Extracting more from `application.js`

`application.js` remains large, but it is now an orchestrator rather than the definition of the architecture. Extract more code only when a complete responsibility has a clear API boundary.

Good candidates:

- media-selection controller;
- full Markdown codec;
- Gist synchronization service.

Bad refactor:

> move 300 arbitrary lines to another file only to make `application.js` shorter.

Good refactor:

> define a content/storage/editor contract, move all rules for that responsibility together, and leave core with a small adapter/callback surface.

## File documentation standard

Every source file starts with a header describing:

- purpose;
- responsibilities;
- what it explicitly does **not** do;
- dependencies/contracts;
- public API when relevant.

Public or non-obvious functions use JSDoc/comments for invariants and rationale. Comments should explain **why**, not restate obvious JavaScript.

Large architectural choices are recorded under `docs/decisions/`.

## Architecture decisions

Long-lived decisions are recorded under `docs/decisions/`. Read these before changing a subsystem boundary, storage model, Markdown contract, or the no-build-step policy.


## Layout domain

`src/layout/` is core application structure. A layout id is slide-level metadata serialized on `---` / `--` separators; positional `::: block` content is validated against the registered template. `registry.js` defines the extension boundary, `builtins.js` registers built-in templates through that same boundary, and `blocks.js` owns block validation plus the protected WYSIWYG layout DOM. Layouts are not editor plugins: they are part of the presentation document model. Custom definitions may be registered from `extensions/layouts/custom.js`.
