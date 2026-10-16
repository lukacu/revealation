# Markdown caret alignment fix

The syntax-highlighted Markdown editor uses a transparent `<textarea>` for input and a painted `<pre>` layer underneath it. Those two layers must have exactly the same text metrics.

The previous separator styling added 1 px top and bottom borders to every `---` / `--` line. Because those borders were part of the highlighted line box but not the textarea line box, the overlay became 2 px taller at every slide boundary. After several slides the visible text was displaced by roughly a full line from the actual caret.

This version makes syntax highlighting **paint-only**:

- every highlighted line has the same fixed line box as the textarea (`1.6em`);
- slide separators use inset `box-shadow` instead of borders;
- highlighted lines add no margin or padding;
- syntax classes no longer change font weight, italics, or letter spacing, because those can also change horizontal glyph metrics relative to the real caret;
- headings, directives, code, math, notes, comments and separators remain visually distinguished through color/background only.

This keeps the caret and highlighted text aligned regardless of how many slide separators occur above the current edit position.
