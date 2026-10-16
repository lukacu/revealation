# Toolbar and top bar

Revealation separates **deck/application commands** from **slide-content formatting**.

## Main toolbar

The main toolbar is intentionally small and stable. Its order is declared in:

```text
src/config/topbar.js
```

The visible desktop controls are arranged in three stable zones:

**Left — application identity**

- Revealation logo → About dialog.

**Center — deck identity**

- display-only deck name (edited in Deck settings);
- save-state icon (`saved`, `saving`, `error`).

**Right — commands**

- Deck settings;
- Export;
- Undo;
- Redo;
- Present / Present from here;
- Application settings;
- Help.

Do not add advanced authoring/recovery/project-management actions directly to this bar. Recovery and development tools belong in Help; visual deck settings belong in Deck settings; export formats belong in Export.

Every command button should use a recognizable icon, an accessible `aria-label`, and a `title` tooltip that includes its keyboard shortcut where one exists.

Current shortcuts:

| Action | Shortcut |
|---|---|
| Undo | `Ctrl/Cmd+Z` |
| Redo | `Ctrl/Cmd+Shift+Z` (or `Ctrl/Cmd+Y`) |
| Present | `Ctrl/Cmd+P` |
| Present from here | `Ctrl/Cmd+Shift+P` |
| Application settings | `Ctrl/Cmd+,` |
| Deck settings | `Ctrl/Cmd+Shift+,` |
| Export | `Ctrl/Cmd+Shift+E` |
| Deck Markdown | `Ctrl/Cmd+Shift+M` |
| Help | `F1` |

`src/ui/topbar.js` only applies the configured left/center/right ordering. Button behavior remains in the owning domain/core orchestration.

## Save indicator

The icon next to the deck name is **only** a persistence indicator:

- check circle — saved;
- rotating arrow — saving;
- warning triangle — save failed.

General application messages do not belong in the toolbar. They are shown as transient notifications instead.

## Formatting toolbar

Edit:

```text
src/config/toolbar.js
```

It contains slide-content formatting controls: paragraph style, text formatting, lists, alignment, insertion, fragments and view/editing helpers. Undo/redo are deliberately not part of the formatting toolbar.

The paragraph-style selector mixes structural text levels (`Body`, `Heading 1–3`) with four stable semantic presentation styles: `Emphasis`, `Muted`, `Callout`, and `Quote`. The first three persist as `rv-block-*` classes and are rendered by the active theme; Quote is a real blockquote. Do not add color/font/spacing variants here—the semantic vocabulary should remain small and theme-controlled.

The far-right `slide` group is deliberately different from formatting commands and stays visually separated with `margin-left: auto` on desktop:

- **Layout** — opens the semantic layout picker;
- **Background** — opens the curated background picker;
- **Notes** — opens/closes the right slide-notes sidebar.

The Notes sidebar is the home for the current slide's speaker notes, **Subslide**, and **WIP** toggles. Do not reintroduce a persistent footer/meta settings strip for these controls. On small screens the same actions remain part of the scrolling toolbar and the notes panel becomes an overlay.

The separation is deliberate:

- `config/toolbar.js` answers **where/how visible?**
- `ui/toolbar.js` answers **how is the layout applied?**
- editor/core/content code answers **what does the action do?**

## Adding a new button

1. Decide whether it is a deck/application command or a content-formatting command.
2. Add accessible markup to `index.html` (`title`, `aria-label`, icon/text).
3. Add its selector to `src/config/topbar.js` or `src/config/toolbar.js`.
4. Put behavior in the domain that owns the responsibility.
5. Document any non-obvious invariant/contract in that source file.

Do not add behavior to `ui/topbar.js` or `ui/toolbar.js`; they are layout components only.

## Alignment semantics

Alignment is structural rather than a transient browser style:

- on the implicit `single` layout, the caret aligns the complete current top-level block;
- on a multi-block layout, alignment applies to the complete active slot and is persisted in the slide block model;
- switching slides clears the cached DOM selection so toolbar actions cannot target nodes from the previous slide.

The direct per-slide raw-HTML source editor is intentionally not exposed. Intentional literal HTML belongs in an explicit `::: html` block in deck Markdown.

## Markdown mode

Whole-deck Markdown is intentionally not another persistent toolbar button. Open or close it with `Ctrl/Cmd+Shift+M`, or open it from **Help → Edit deck Markdown**.

While Markdown mode is open, the header inside the source editor exposes exactly two exit actions:

- **Close** — returns to slide editing. If the source differs from the buffer that was opened/applied, Revealation asks before discarding it.
- **Apply** — rebuilds the deck from valid Markdown and then returns to slide editing. Parse/validation errors keep Markdown mode open so they can be corrected. `Ctrl/Cmd+S` performs the same apply-and-close action while Markdown mode is active.

`Esc` and `Ctrl/Cmd+Shift+M` also close Markdown mode through the same dirty-buffer guard.
