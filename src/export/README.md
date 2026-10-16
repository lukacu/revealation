# Export domain

`src/export/` owns **transport and packaging**, not editor state.

The core orchestrator is responsible for deciding *what project* should be exported (including unsaved WYSIWYG/Markdown edits), presenting warnings and status, and starting the browser download. Export modules receive prepared presentation data and turn it into an artifact or transport payload.

## Files

- `deck.js` — linked reveal.js HTML, standalone/self-contained HTML, visual-resource discovery, local asset inlining, and presentation ZIP assembly.
- `pdf.js` — stages the normal presentation payload in `sessionStorage`, applies print defaults, and opens reveal.js print mode.

Markdown source export still uses the full HTML↔Markdown codec owned by `application.js`; only presentation-runtime packaging was extracted here. When that codec moves to `src/serialization/`, its small download adapter can move here without introducing a dependency from export back into editor state.

## `deck.js` boundary

`deck.js` deliberately does not import or inspect mutable application state. Core creates one exporter with an explicit adapter:

```js
const deckExporter = Revealation.exporters.deck.create({
  themeDefinition,
  themePayload: themePayloadBits,
  backgrounds: backgroundResources,
  renderSections: buildSections,
  contentCss: deckContentCss,
  revealConfig: defaultRevealConfig,
});
```

The callbacks mean:

| Callback | Owner | Why export needs it |
|---|---|---|
| `themeDefinition(project)` | theme/core compatibility layer | Copy the active theme CSS and declared assets into workspace ZIPs. |
| `themePayload(project)` | theme/core compatibility layer | Resolve active theme CSS plus legacy render-only custom CSS/fonts. |
| `backgrounds(project)` | background/core | Include only background extensions actually used by the presentation. |
| `renderSections(slides, project)` | presentation rendering | Export does not own slide/layout-to-`<section>` semantics. |
| `contentCss()` | presentation rendering/layout | Keep exported semantic layouts visually identical to preview. |
| `revealConfig()` | rendering/core | Start from the same reveal.js defaults as normal presentation mode. |

This is intentionally a small adapter, not a generic dependency-injection system. The exporter is deterministic with respect to those inputs and does not mutate the project.

## Public deck exporter API

`Revealation.exporters.deck.create(adapter)` returns:

- `containsInteractive(project)` — detects Revealation interactive/demo blocks so core can warn before standalone export.
- `packagePaths(project)` — returns app-relative theme/background files required by a workspace package. Dynamic backgrounds add `src/background/runtime.js`; unused backgrounds are omitted.
- `buildLinkedHtml(project, { hash?, startAt? })` — builds an HTML entry point whose reveal.js/theme/background resources remain relative files. Workspace ZIP export uses this form.
- `buildStandaloneHtml(project)` — builds one self-contained HTML file, inlining presentation resources and local media where supported.
- `buildZip(project, { workspaceMode, workspaceStorage })` — creates the final ZIP `Blob`. Workspace mode copies the workspace tree plus linked runtime resources; browser/IndexedDB mode contains a standalone `index.html`.
- `canBuildZip()` — reports whether JSZip is available.

## Two HTML strategies

### Linked/package HTML

Workspace packages intentionally preserve relative paths. The ZIP contains reveal.js, KaTeX, the selected theme, used background extensions, and the original workspace files. This is the reliable form for interactive content because modules, `fetch()`, workers and local data files can keep their normal directory structure.

The extracted folder should be served over HTTP and `presentation.html` opened from that server.

### Standalone HTML

Standalone export aims for a convenient single file. It:

1. recursively inlines stylesheet `@import` rules;
2. converts stylesheet `url(...)` dependencies to data URLs where possible;
3. converts local slide image/video/audio/poster assets to data URLs;
4. inlines simple interactive HTML documents, their directly linked stylesheets/scripts/media, and simple legacy background media;
5. pre-renders code highlighting and KaTeX markup so those plugins are not needed at runtime;
6. embeds CSS/JS/assets for only the background extensions used by the deck.

It is **not** a JavaScript bundler. Relative ES-module imports, dynamic `import()`, runtime `fetch()`, Web Workers, WebSockets and server endpoints are not dependency-traced. For those presentations, use the workspace ZIP or bundle the interactive application separately.

## Visual-resource rule

Theme/background manifests are the packaging contract. Export copies or embeds only resources known through those manifests. Background extension runtime assets therefore belong in the manifest's `assets` array; arbitrary files discovered by executing extension JavaScript are intentionally unsupported.

This keeps the dependency direction simple:

```text
core/editor state
    │ prepares project + rendering adapter
    ▼
export/deck.js
    │ reads manifests/resources
    ▼
HTML / ZIP artifact
```

Export never writes presentation metadata or changes the selected theme/background.

## Tests

`tests/test_modules.js` exercises the deck exporter independently of `application.js`, including theme/background resource selection and the dynamic-background runtime boundary.

`tests/test_browser_regressions.js` then verifies the real application adapter: static backgrounds export only CSS, dynamic backgrounds include their JS/runtime, and unused/unknown background resources do not leak into packages.

Run the complete suite with:

```bash
./tests/check.sh
```

## Runtime geometry

Linked and standalone presentation entry points schedule one `Reveal.layout()` after `document.fonts.ready` and two animation frames. Parser-loaded CSS is already blocking in those documents, while the extra pass protects vertical centering from late web-font metrics and keeps exported presentation geometry aligned with in-editor Present mode.
