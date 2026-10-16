# Developing Revealation

## No development build step

Revealation is plain browser JavaScript. Edit a source file and reload the browser. The only build-like step is `scripts/build-pages.sh`, which assembles a static PWA/GitHub Pages artifact and injects version/cache metadata; it does not bundle application code.

The application version has one source of truth: `app.version` in
`src/core/revealation.js`. The Pages build extracts that value into the
generated `dist/version.json`; do not edit generated version metadata directly.
Release history in `CHANGELOG.md` is documentation, and tests that do not
exercise version behavior should use an explicit fixture version rather than
copying the application version.

Run against a scratch workspace:

```bash
./start.sh /tmp/revealation-test-deck
```

## Where to make changes

Start with `docs/ARCHITECTURE.md` and the README inside the relevant `src/<domain>/` directory.

Typical changes:

| Change | Start here |
|---|---|
| rearrange formatting buttons | `src/config/toolbar.js` |
| rearrange topbar actions | `src/config/topbar.js` |
| slide/subslide navigation | `src/ui/sidebar.js` |
| thumbnail rendering | `src/ui/sidebar.js` + `styles/sidebar.css` |
| local Python workspace behavior | `src/storage/workspace.js`, then `server.py` if protocol changes |
| hosted/PWA directory behavior | `src/storage/directory.js`, `src/pwa/runtime.js`, `pwa/sw.template.js` |
| GitHub Pages packaging | `scripts/build-pages.sh`, `.github/workflows/pages.yml` |
| `::: interactive` semantics | `src/content/interactive.js` |
| directive parsing | `src/serialization/directives.js` |
| Markdown slide/subslide separators and navigation ranges | `src/serialization/deck.js` |
| standalone HTML / presentation ZIP packaging | `src/export/deck.js` |
| PDF opening/print defaults | `src/export/pdf.js` |
| reveal preview runtime | `src/rendering/preview.js` |
| deck mutation/history policy | `src/core/application.js`; stack mechanics in `src/core/history.js` |

## Documentation rule

New source files must start with a header containing:

1. Purpose
2. Responsibilities
3. Does NOT
4. Dependencies/contract
5. Public API (if any)

Document invariants near the functions that enforce them. Use Git/CHANGELOG for chronology; do not leave comments such as `RRZ patch` or `temporary fix` in active code.

### Temporary compatibility code

Backwards compatibility is allowed only while Revealation is being refactored internally. Every compatibility-only block must carry an `RV-COMPAT(<id>)` marker and the id must be listed in [`COMPATIBILITY_DEBT.md`](COMPATIBILITY_DEBT.md). Do not add an untracked one-off alias or migration. The intended public release has no obligation to keep these internal formats.

## Testing before packaging

Run:

```bash
./tests/check.sh
```

For deployment changes, also assemble a local Pages artifact:

```bash
./scripts/build-pages.sh /tmp/revealation-pages
```

Then launch a workspace containing:

- a normal slide;
- a subslide;
- an SVG image;
- a slide using `--- layout=...` with the exact positional `::: block` content required by that layout;
- `::: interactive`;
- a video if available.

Verify Outline/Thumbnail switching, editing/saving/reload, Present mode and PDF print view.


## Layout extension workflow

For a new visual arrangement, first ask whether it is only a new arrangement of existing blocks. If yes, register a layout in `extensions/layouts/custom.js`; do not modify the Markdown parser. Use a new stable layout id if slot count/order changes. Run `./tests/check.sh` after changes.
