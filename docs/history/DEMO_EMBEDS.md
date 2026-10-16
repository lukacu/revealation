# Interactive demo embeds

Small Reveal can embed a local HTML/JavaScript demo from the workspace.

```markdown
::: demo
src: demos/pinhole/index.html
width: 100%
height: 480
interactive: true
preload: false
border: false
:::
```

The entry point is served directly from the workspace directory. The WYSIWYG editor disables pointer events inside the iframe so the demo can be selected, resized, deleted, aligned, or moved into a column. Preview/export restore normal iframe interaction when `interactive: true`.

Standalone HTML export attempts to inline the demo HTML, linked stylesheets, ordinary `script src` files and directly referenced image/video/audio assets. Complex bundler-style demos that depend on relative ES-module imports, dynamic `import()`, runtime `fetch()` calls, workers or server endpoints may still need their original workspace directory or a dedicated bundle step.
