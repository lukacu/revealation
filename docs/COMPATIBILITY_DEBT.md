# Compatibility debt

Revealation is still under internal development. For now it deliberately reads a number of formats and internal APIs produced by earlier Small Reveal / Revealation builds so development decks keep working while the architecture changes.

This compatibility layer is **temporary**. It is not part of the intended public format or extension API.

## Marker convention

Every compatibility-only implementation block must be labelled with a marker of the form:

```text
RV-COMPAT(<id>): REMOVE BEFORE PUBLIC RELEASE
```

The same id can appear in several files when one compatibility feature crosses parser, renderer, CSS and tests. Before the first public release, removing an item means removing **all** occurrences of its id and the corresponding compatibility tests/documentation.

Useful audit command:

```sh
rg -n 'RV-COMPAT\\(' . --glob '!docs/COMPATIBILITY_DEBT.md'
```

When the compatibility cleanup is complete, that command should return no implementation/test markers. `tests/check_compatibility_debt.py` keeps marker ids synchronized with this inventory while the debt exists.

## Inventory

| ID | Temporary behavior | Main removal work |
| --- | --- | --- |
| `storage-old-keys` | Reads old `reveal-editor:*` local/session storage keys and migrates localStorage projects into IndexedDB. | Rename current keys, delete localStorage migration branches, update PDF/preview payload key together. |
| `theme-reveal-aliases` | Maps old Reveal.js theme names (`black`, `white`, `night`, etc.) to curated Revealation themes. | Delete alias registrations and the alias API if no extension use remains. |
| `theme-custom` | Reads/renders/exports the retired free-form `customTheme` / `legacyCustomTheme` format, including Google Fonts and arbitrary visual overrides. | Delete custom-theme schema/helpers, render overlay, snapshot/serialization fields and export/preview support. |
| `background-reveal` | Reads/renders/exports raw Reveal background color/image/video/iframe metadata and the old `backgroundColor` slide field. | Keep only manifest background ids; remove legacy badges/notices, raw background rendering and metadata keys. |
| `layout-wrapper` | Accepts the old `::: layout <id>` wrapper and migrates it to separator layout metadata. | Delete `parseLegacyLayout`, legacy regex/diagnostics and import branches. |
| `layout-html-cache` | Infers layout/block state from old stored canonical `.sr-layout` HTML when JSON predates the persistent block model. | Require explicit `layout` + `blocks` and delete one-time DOM inference paths. |
| `columns-directive` | Accepts old `::: columns` / `::: column` layout content and migrates it to semantic layouts. | Remove directive grammar/parser branches and post-parse migration. |
| `interactive-demo` | Accepts `::: demo`, `.sr-demo`, and the old `demo` toolbar action as aliases for `interactive`. | Remove alias grammar/classes/action and compatibility CSS/export selectors. |
| `subslide-vertical` | Persists/accepts the historical `slide.vertical` field and `.vertical` CSS hook while the public concept is `subslide`. | Rename persisted field to `subslide`, delete `.vertical` hooks and compatibility coercion. |
| `slide-transition` | Reads/round-trips historical per-slide transition metadata although current authoring is presentation-wide. | Remove `slide.transition`, separator/HTML attribute parsing and section export. |
| `video-html-autoplay` | Migrates/accepts raw HTML `<video autoplay>` in addition to Reveal-aware `data-autoplay`. | Keep only `data-autoplay` and remove migration/dual-attribute reads. |
| `editor-sizing-artifacts` | Strips old editor-generated `r-fit-text` / `r-stretch` sizing artifacts on load. | Delete migration after internal decks have been resaved. |
| `align-shorthand` | Accepts old `::: center`, `::: left`, `::: right` and `.sr-center`. | Keep only canonical `::: align <direction>` / `.sr-align-*`. |
| `serialized-math-span` | Recovers old Markdown that accidentally persisted generated `.sr-math` HTML instead of LaTeX delimiters. | Delete recovery conversion and its regression fixtures. |
| `html-source-mode` | Keeps commit logic for the removed/hidden raw HTML source editor. | Delete the dormant source-mode path once no internal workflow depends on it. |
| `save-api-shim` | Keeps the old synchronous `saveProject()` / `saveLibrary()` call surface routed through dirty tracking. | Update remaining callers to the storage API and remove the shim. |
| `reveal-config-fields` | Preserves unknown/retired project-level Reveal config keys from older internal decks. Supported navigation, Present and playback settings are current features. | Stop round-tripping keys outside the documented supported config set. |
| `preview-protocol` | Keeps historic preview/PDF storage/message identifiers so already-open tabs from an older internal build continue to work. | Rename protocol/storage identifiers together and remove the old-key comments/tests. |

## Release cleanup order

1. Resave any internal decks worth keeping in the latest canonical format.
2. Remove parser/import-only items first (`layout-wrapper`, `layout-html-cache`, `columns-directive`, `interactive-demo`, `serialized-math-span`, `align-shorthand`).
3. Remove old presentation model fields (`theme-custom`, `background-reveal`, `slide-transition`, `subslide-vertical`, `reveal-config-fields`).
4. Remove browser/internal API migrations (`storage-old-keys`, `save-api-shim`, `preview-protocol`, `html-source-mode`).
5. Remove migration-only content cleanup (`video-html-autoplay`, `editor-sizing-artifacts`).
6. Run the full suite and the audit command above; there should be no `RV-COMPAT(...)` markers left.

Do not convert these markers into a permanent deprecation framework. Their purpose is to make temporary internal compatibility easy to delete.
