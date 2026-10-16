# Interactive embeds

Revealation can embed local HTML/JavaScript interactive content from the workspace.

```markdown
::: interactive
src: interactive/example/index.html
width: 100%
height: 480
interactive: true
preload: false
border: false
scrollbars: false
:::
```

The entry point is served directly from the workspace directory. The WYSIWYG editor disables pointer events inside the iframe so the interactive frame can be selected, resized, deleted, aligned, or moved into a column. Present/export restore normal iframe interaction when `interactive: true`.

`height` is measured in the presentation's logical Reveal slide pixels, not in the current editor viewport. The WYSIWYG stage scales that logical height together with the slide canvas, while Present/export keep the authored value and let Reveal scale the complete slide. This keeps the iframe viewport aspect ratio consistent between editing and presenting.

Present mode also waits for the active theme stylesheet and font metrics before Reveal performs its first slide measurement. This matters most for tall interactive embeds: if theme padding or heading metrics arrive after Reveal has vertically centered the section, the whole slide can appear shifted downward and clip at the bottom even though the iframe's own height is correct. Revealation performs one additional post-paint layout pass after initialization as a guard against that timing boundary.

Scrollbars are hidden by default for a clean presentation. Set `scrollbars: true` when the embedded content needs its own scrolling viewport. The setting is available in the Interactive dialog and the selected-embed toolbar.

The **ZIP** export is the reliable format for complex applications. It writes a `presentation.html` entry point together with the complete workspace file tree, preserving each interactive iframe's relative entry-point path. Serve the extracted folder over HTTP (for example, with `python3 -m http.server 8000`) before opening `presentation.html`; this preserves module imports, `fetch()` calls, workers and local data files.

Standalone HTML export attempts to inline the interactive HTML, linked stylesheets, ordinary `script src` files and directly referenced image/video/audio assets. Complex bundler-style interactive apps that depend on relative ES-module imports, dynamic `import()`, runtime `fetch()` calls, workers or server endpoints may still need their original workspace directory or a dedicated bundle step.

## Editor height and PDF readiness

`height` is stored as a logical Reveal-pixel value in `data-height`/Markdown. The editor shows a scaled projection of that value; inspector edits must update the canonical `data-height` first so a subsequent editor reflow cannot restore the old height.

For PDF, iframe `load` alone is not treated as a painted snapshot boundary. Revealation also waits for same-origin fonts/media, a bounded DOM-quiet period, child/parent animation frames and a short compositor settle before invoking the native print dialog.
