# Slide sidebar

The sidebar is a first-class Revealation UI component implemented in:

```text
src/ui/sidebar.js
styles/sidebar.css
```

It is **not an optional feature module**.

## Views

Two views share the same slide/subslide navigation model:

- **Thumbnails** — default visual overview;
- **Outline** — compact labels/numbers.

The selected view is stored locally as `revealation.sidebarView`.

## Responsibilities

`ui/sidebar.js` owns:

- rendering rows;
- slide/subslide numbering display;
- active-row visual state;
- keyboard/context-menu interaction mechanics;
- drag/drop zones;
- Thumbnail/Outline controls;
- lazy thumbnail DOM rendering.
- visible `WIP` markers for slides marked under construction;
- eye-slash markers for slides hidden from presentation output;
- one primary active/selected row during ordinary keyboard or pointer navigation (multi-selection exists only after an explicit Cmd/Ctrl/Shift selection gesture).

It does **not** reorder/delete state directly. The core provides callbacks (`onMove`, `onDelete`, `onSelect`, ...), which keeps history and deck invariants centralized.

## Thumbnails

Thumbnails are real scaled DOM slide surfaces, not screenshots. `IntersectionObserver` renders them lazily near the visible sidebar area.

Interactive iframes, video and audio are replaced with static placeholders. This is intentional: a large deck must not start dozens of demos/media players just because the sidebar is open.

## Subslides

Public terminology is slide/subslide. The legacy project field `slide.vertical` is interpreted through `src/core/slide-model.js`.


## Slide notes sidebar

The editor also has a separate, hideable **right** sidebar for options tied to the current slide. It is not part of `ui/sidebar.js`'s slide-list navigation responsibilities.

Open it with the Notes button at the far right of the slide formatting toolbar. It contains:

- the current slide's speaker-notes editor;
- a **Subslide** toggle;
- a **WIP** toggle;
- a **Hidden** toggle that keeps the slide editable but omits it from Present/PDF/HTML/ZIP presentation output.

Notes are persisted as the canonical final `::: notes ... :::` block documented in [`MARKDOWN.md`](MARKDOWN.md). The sidebar writes `slide.notes`; it does not place notes in the visible slide DOM. On narrow screens the panel uses the same content as a full editor overlay rather than introducing a separate mobile settings sheet.
