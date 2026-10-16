# PDF export

Revealation uses reveal.js's print mode rather than a Node/Puppeteer PDF dependency.

## Flow

1. `src/core/application.js` builds the same deck payload used for preview.
2. `src/export/pdf.js` copies the payload to `sessionStorage` and applies print defaults.
3. It opens `preview.html?print-pdf=1`.
4. `src/rendering/preview.js` initializes reveal.js in print mode.
5. The user saves the browser print output as PDF.

Default print settings preserve the deck's visual geometry:

```js
margin: screenMargin / (1 - screenMargin)
pdfMaxPagesPerSlide: 1
pdfSeparateFragments: false
```

Reveal.js uses the `margin` number differently on screen and in print mode. In
Present mode the logical slide occupies `(1 - margin)` of the viewport. In print
mode reveal.js instead creates a page sized `slideSize * (1 + margin)`. Copying
the same numeric value therefore does **not** produce exactly the same visual
outer margin. Revealation converts the value so that the logical slide occupies
the same fraction of the PDF page that it occupies in Present mode:

```text
1 / (1 + pdfMargin) = 1 - screenMargin
pdfMargin = screenMargin / (1 - screenMargin)
```

For the default `screenMargin = 0.04`, PDF print mode receives approximately
`0.041667`. Theme `--rv-slide-padding` is unchanged, so both the outer breathing
room and the inner content padding match the presentation model.

The print dialog is opened only after reveal.js emits `pdf-ready`, meaning the
print controller has already constructed and positioned all `.pdf-page` elements.
Print mode then also waits for iframe-backed interactive content: every interactive
iframe is forced from lazy to eager loading, its `load` boundary is awaited,
same-origin iframe fonts are allowed to settle, and two paint frames are given to
the browser before `window.print()` runs. A bounded timeout prevents a broken
external frame from blocking PDF export indefinitely. This replaces the old
fixed-delay print trigger and avoids blank iframe snapshots on off-screen PDF
pages.

These are reveal.js options and can be changed in `src/export/pdf.js`.

## Why the browser creates the final PDF

This keeps Revealation dependency-free on the server side: no Node, Puppeteer or DeckTape is required. Chromium-family browsers provide the final **Print → Save as PDF** step.

## Interactive content

An iframe cannot remain interactive in a PDF, but Revealation now treats its
fully loaded visual state as part of the PDF readiness boundary. Local/same-origin
interactive documents additionally wait for their font metrics before printing.
Cross-origin documents can only be observed through the iframe `load` event.
Applications that fetch data or draw substantially later than `load` still cannot
expose a generic readiness signal to Revealation; a future `poster:` option for
`::: interactive` would provide a deterministic static representation for those
cases and for teaching handouts.

## Code blocks

Code uses the same authored geometry in editor, Present, and PDF. `pre.sr-code`
is constrained to the slide width and uses the theme token `--rv-size-code`
(default `.68em`). Highlighted code padding is normalized by Revealation rather
than inherited from whichever Highlight.js stylesheet happens to be active. Long
lines use `pre-wrap` plus `overflow-wrap: anywhere` so a PDF snapshot cannot push
a code block beyond the logical slide boundary.

## Geometry consistency

PDF uses the same logical slide `width`/`height`, theme typography and `--rv-slide-padding` as editor and Present. reveal.js's built-in print stylesheet resets slide sections to `padding: 0 !important`; Revealation explicitly restores `--rv-slide-padding` for `.rv-slide` in print mode so PDF does not acquire a different content box. The presentation outer margin is still translated to reveal.js print-space as described above.

Interactive frames are switched to eager loading as soon as print content is staged. Export waits for each frame's load boundary and, where same-origin access is available, its fonts/media plus a bounded DOM-quiet window and child/parent paint frames. This deliberately mirrors the extra settling time that made a later manual print succeed.

Highlighted code uses the same `--rv-size-code` token and constrained `pre.sr-code > code` geometry in all renderers. Width is capped to the content box and highlighted code is forced to inherit the code-block font size/line height and wrap long tokens.
