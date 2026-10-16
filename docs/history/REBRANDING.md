# Revealation rebrand

The project is now named **Revealation**. It remains derived from **Small Reveal** by Mark Sample, whose MIT `LICENSE` is preserved unchanged.

The first-class iframe component is now called **Interactive**:

```markdown
::: interactive
src: interactive/pinhole/index.html
width: 100%
height: 480
interactive: true
preload: false
border: false
:::
```

For backwards compatibility, `::: demo` and generated `sr-demo` HTML are still read correctly, but new serialization uses `::: interactive` / `sr-interactive`.
