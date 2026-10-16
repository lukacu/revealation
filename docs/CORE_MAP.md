# Core application map

`src/core/application.js` is the main orchestrator. It is still large because several responsibilities are coupled to shared state/history and have not yet earned a clean extraction boundary.

Search for the section comments below when working in core:

| Section | Responsibility | Future home when/if extracted |
|---|---|---|
| `Legacy custom theme` | backwards-compatible arbitrary-style rendering only | remove when the compatibility window closes |
| `State` | deck/project normalization | `core/` |
| `Local workspace backend` | core coordination with workspace adapter | keep small in core |
| `Library` | project/library policy and dirty tracking | `core/` + storage interface |
| `Rendering` | editor orchestration | `core/` |
| `Slide context menu` | mutations requested from sidebar | `ui/` only if mutation boundary stays explicit |
| `Undo / redo` | project snapshot policy + history service coordination | core policy stays here; stack mechanics are extracted |
| `Slide operations` | add/delete/reorder/subslide invariants | `core/deck.js` candidate |
| `Toolbar / editing` | WYSIWYG commands | `editor/commands.js` candidate |
| `Deck markdown mode` | whole-deck text editing | `editor/markdown.js` candidate |
| `Selected media` | media selection/resize | `editor/media.js` candidate |
| `Project asset library` | file picker UI | `ui/assets.js` candidate |
| `Present rendering` | Present/PDF payload + slide `<section>` projection | `rendering/` candidate once the section-rendering API stabilizes |
| `HTML <-> Markdown` | full round-trip codec | `serialization/markdown.js` candidate |
| `Markdown deck parsing` | slide/subslide separators | `serialization/deck.js` candidate |
| `Deck settings config` | deck metadata plus theme/transition/canvas settings and legacy Reveal.js config defaults | `rendering/config.js` candidate |
| `Sync via GitHub Gist` | optional remote sync | `sync/gist.js` candidate |
| `Wiring` | DOM-to-core event bindings | likely stays orchestration |
| `Init` | startup composition | core |

## Already extracted

- slide numbering/coordinates → `src/core/slide-model.js`
- bounded undo/redo stack mechanics → `src/core/history.js`
- slide sidebar + thumbnails → `src/ui/sidebar.js`
- toolbar layout → `src/ui/toolbar.js`
- topbar layout → `src/ui/topbar.js`
- workspace HTTP → `src/storage/workspace.js`
- IndexedDB transactions → `src/storage/indexeddb.js`
- interactive content semantics → `src/content/interactive.js`
- directive primitives → `src/serialization/directives.js`
- Markdown slide/subslide source ranges → `src/serialization/deck.js`
- DOM range helpers → `src/editor/dom-selection.js`
- browser rich-text canonicalization → `src/editor/content-normalization.js`
- deterministic list editing / editing-host helpers → `src/editor/rich-text.js`
- HTML/ZIP resource packaging + standalone inlining → `src/export/deck.js`
- PDF print transport → `src/export/pdf.js`
- reveal preview runtime → `src/rendering/preview.js`
- curated theme registry → `src/theme/registry.js`
- background manifest registry + presentation lifecycle → `src/background/registry.js`, `src/background/runtime.js`

## Extraction checklist

Before moving a section out of core, answer:

1. What state does it need to read?
2. What state is it allowed to mutate?
3. Can mutations be expressed as callbacks/commands owned by core?
4. What exact public API will the new file expose?
5. How is the boundary tested?

If those answers are unclear, leave the code in core until the boundary is understood.
