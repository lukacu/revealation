# Testing Revealation

Run the permanent dependency-free checks first (this includes a temporary workspace server smoke test):

```bash
./tests/check.sh
```


There is no development bundling step, so tests focus on source syntax, contracts and a real local workspace smoke test. `tests/test_directory_registry.js` verifies multiple remembered directory handles, permission reconnect, deduplication and history removal. `tests/test_storage_roundtrip.js` verifies a complete IndexedDB-adapter → backup ZIP → fresh IndexedDB-adapter round trip, including assets and metadata, plus corrupt-backup rejection and transaction rollback. `tests/test_native_package.js` verifies `.revealation` archive ordering, native asset round trips, and invalid MIME rejection. The suite also assembles a temporary GitHub Pages/PWA artifact and validates its manifest, service worker, cache manifest and subdirectory-safe resource paths. `tests/check_compatibility_debt.py` also verifies that every temporary `RV-COMPAT(...)` marker has a documented cleanup id and that every inventory id is still represented in code/tests.

## Static checks

```bash
find src -name '*.js' -print0 | xargs -0 -n1 node --check
python3 -m py_compile server.py
sh -n start.sh
sh -n scripts/build-pages.sh
python3 tests/test_pwa_build.py
```

Also verify that every `$('#id')`/configuration selector resolves to an element in `index.html`.

## Smoke deck

Use a temporary workspace containing at least:

```markdown
# Slide

![](images/test.svg){width=45%}

-- layout=two-columns

::: block
## Speaker notes

Regression coverage verifies that `::: notes ... :::` is removed from visual content, round-trips through the deck Markdown serializer, and remains independent of layout validation. It also explicitly verifies that `Note:` has no special meaning and remains visible slide content. Browser coverage checks that notes, Subslide, WIP and Hidden live in the right sidebar and that Layout/Background/Notes form the rightmost slide-toolbar group.

## Subslide

Text
:::

::: block align=center
![](images/test.svg){width=70%}
:::

---

## Interactive

::: interactive
src: interactive/test/index.html
width: 80%
height: 360
interactive: true
preload: false
border: true
scrollbars: false
:::
```

Verify:

- reload preserves `deck.md`;
- Slide/Subslide numbering is correct;
- Thumbnail/Outline switch works;
- thumbnails do not execute interactive content;
- SVG/media paths resolve;
- alignment/layout round-trip and invalid-layout diagnostics;
- Present mode opens;
- PDF opens print mode;
- workspace file browser can insert assets.

## Architecture regression

When extracting code from `core/application.js`, add a focused test or smoke assertion for the new contract. A successful `node --check` is necessary but not sufficient: the component must also load in the actual `index.html` dependency order.

The deck exporter is tested first as `Revealation.exporters.deck` with a small fake rendering adapter, then again through the real application adapter in Chromium. Keep both layers when changing HTML/ZIP packaging.
## Chromium regression checks

On systems with `chromium`, `./tests/check.sh` additionally
runs two real-browser suites. For fast WYSIWYG/layout debugging, run only:

```bash
node tests/test_editor_regressions.js
```

That focused suite covers Tab/Shift+Tab nested lists, caret preservation, field-scoped Ctrl/Cmd+A, selection-to-block resolution, browser list repair, inline paste normalization, semantic layout transfer/master merging and field scaffolds. `test_browser_regressions.js` then tests the same boundaries through the real application wiring, including selection-scoped text/media alignment, cross-field rich/media paste, stable async paste targets, nested-list Markdown round-trip and WYSIWYG/Markdown layout switching.

The general real-browser suite runs in standards mode (matching the real editor)
so KaTeX DOM rendering is exercised as well as serialization. It includes exact
multiline `cases` regressions with `&`, `\\`, `\left/\right`, and fractions
in both display and inline math. The inline case deliberately follows the
equation dialog's default path through HTML ↔ Markdown, workspace `deck.md`
save/reload, and a full slide remount; this guards against Markdown consuming
`\(` delimiters or collapsing TeX row separators. KaTeX runtime DOM must never
be persisted.

The general real-browser suite specifically covers protected layout deletion,
rich-content normalization, thumbnail visibility/theme colors, synchronized active/selected slide navigation, schema-driven sidebar title sources, current-layout picker state, hidden-slide presentation filtering, and long Markdown
textarea rendering without the retired highlight overlay. It also checks dark-mode form-control
contrast, delayed-media editor recentering, curated theme fallback/selection boundaries, semantic background metadata, export resource
pruning and dynamic-background start/stop cleanup. Present-runtime coverage deliberately holds the theme stylesheet load event and verifies that `Reveal.initialize()` cannot run early; it also probes heading/paragraph computed geometry so browser-default top margins cannot reintroduce iframe-heavy vertical drift. The browser test is skipped
cleanly when those executables are unavailable.


## Workspace source-of-truth regression

`deck.md` must remain authoritative for slide content even when `deck.json` has a newer timestamp. The server smoke test explicitly covers this case. A parse failure may fall back to the JSON cache, but the editor must surface that fallback as a warning.

## WYSIWYG persistence regressions

Browser regression coverage must include ordinary text editing, not only toolbar commands. A text change in both a `single` slide and a multi-block layout must survive `input -> change slide -> return`. The multi-block case also injects an empty top-level `<br>` beside the protected layout to cover a Chromium artifact that previously caused the block-model refresh to fail silently.

The same browser suite verifies that only editing hosts carry editor outlines and that generated presentation payloads use registered Revealation theme CSS. Temporary compatibility fixtures are explicitly marked with their `RV-COMPAT(...)` ids; see `COMPATIBILITY_DEBT.md`. The normal UI has no arbitrary font/color/size controls.


## WYSIWYG persistence regression

The Chromium suite explicitly edits both an implicit single-body slide and a `header-body` slot, dispatches a real `input` event, switches away and back, and verifies that the edit is still present. The layout case also injects harmless browser-style `<br>` siblings so persistence is tested against non-perfect `contenteditable` DOM rather than only ideal canonical markup.

## Main-toolbar regression

The Chromium regression suite also checks the shell hierarchy: the main toolbar keeps only the Revealation logo on the left, deck title/save state in the center, and deck settings/export/history/Present/application settings/help on the right; undo/redo do not leak back into the formatting toolbar; advanced Markdown/recovery/project/sync actions live outside the main bar; Deck settings owns curated visual controls; and Export contains the standalone-interactive warning. It also exercises Markdown exit semantics: clean Close is immediate, dirty Close requires discard confirmation, and successful Apply returns to slide editing.

- Built-in theme semantic/table styling and semantic block round-trip coverage.

Editor/PDF geometry regression coverage verifies scaled theme padding/body font metrics, canonical interactive height editing, and that reveal.js print mode restores the theme content box. PDF regression coverage verifies that the screen-space deck margin is converted to an equivalent print-space margin (preserving the same visible outer breathing room), and that the preview runtime waits for reveal.js `pdf-ready` **and** pending interactive iframe loads before invoking the browser print dialog. The same suite probes code-block computed font size, width, padding/wrapping behavior, and a long unbroken highlighted token so code cannot overflow the logical slide in PDF.
