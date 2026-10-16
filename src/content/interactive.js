/**
 * Revealation — Interactive content type
 * ======================================
 *
 * Purpose
 * -------
 * Define the stable semantics of Revealation's iframe-backed interactive
 * content. This is a content type, not a UI plugin.
 *
 * Canonical Markdown
 * ------------------
 * ::: interactive
 * src: interactive/example/index.html
 * width: 100%
 * height: 480
 * interactive: true
 * preload: false
 * border: false
 * scrollbars: false
 * :::
 *
 * Editor/presentation representation
 * ----------------------------------
 * `<div class="sr-interactive" ...><iframe ...></iframe></div>`
 *
 * Thumbnail representation
 * ------------------------
 * The sidebar intentionally renders a static placeholder and never executes
 * the iframe. See `src/ui/sidebar.js`.
 *
 * Responsibilities
 * ----------------
 * - normalize the interactive content spec;
 * - render canonical editor/presentation HTML;
 * - render canonical Markdown;
 * - read a spec back from generated DOM;
 * - parse validated directive fields.
 *
 * Does NOT
 * --------
 * - own the insert/edit dialog;
 * - fetch iframe content;
 * - bundle JavaScript for standalone export.
 *
 * Dependencies / contract
 * -----------------------
 * Parsing helpers (`parseBool`, `parseWidth`) are injected by the serializer
 * when directive fields are decoded; this content type does not depend on the
 * whole Markdown codec.
 *
 * Public API
 * ----------
 * `Revealation.content.interactive` exposes normalization, DOM/Markdown
 * conversion and strict canonical-element recognition helpers.
 */
(function registerInteractiveContent(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  function clampHeight(value) {
    const n = Number(value);
    return Math.max(120, Math.min(1200, Number.isFinite(n) ? Math.round(n) : 480));
  }

  function normalize(spec = {}) {
    return {
      src: String(spec.src || '').trim(),
      width: Math.max(10, Math.min(100, Number(spec.width) || 100)),
      height: clampHeight(spec.height),
      interactive: spec.interactive !== false,
      preload: spec.preload === true,
      border: spec.border === true,
      scrollbars: spec.scrollbars === true,
    };
  }

  function isElement(element) {
    // RV-COMPAT(interactive-demo): REMOVE `.sr-demo` BEFORE PUBLIC RELEASE.
    return !!element?.classList
      && (element.classList.contains('sr-interactive') || element.classList.contains('sr-demo'));
  }

  function escapeAttribute(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function toHtml(input) {
    const spec = normalize(input);
    const safeSrc = escapeAttribute(spec.src);
    const loading = spec.preload ? 'eager' : 'lazy';
    return `<div class="sr-interactive" data-src="${safeSrc}" data-height="${spec.height}" data-interactive="${spec.interactive ? '1' : '0'}" data-preload="${spec.preload ? '1' : '0'}" data-border="${spec.border ? '1' : '0'}" data-scrollbars="${spec.scrollbars ? '1' : '0'}" style="width: ${spec.width}%; height: ${spec.height}px;"><iframe src="${safeSrc}" title="Interactive content" loading="${loading}" scrolling="${spec.scrollbars ? 'yes' : 'no'}" allow="fullscreen"${spec.preload ? ' data-preload' : ''}></iframe></div>`;
  }

  function toMarkdown(input) {
    const spec = normalize(input);
    return [
      '::: interactive',
      `src: ${spec.src}`,
      `width: ${Math.round(spec.width * 10) / 10}%`,
      `height: ${spec.height}`,
      `interactive: ${spec.interactive ? 'true' : 'false'}`,
      `preload: ${spec.preload ? 'true' : 'false'}`,
      `border: ${spec.border ? 'true' : 'false'}`,
      `scrollbars: ${spec.scrollbars ? 'true' : 'false'}`,
      ':::',
    ].join('\n');
  }

  /** Read the loose editor spec from an interactive DOM element. */
  function fromElement(element) {
    if (!isElement(element)) return null;
    const iframe = element.querySelector(':scope > iframe');
    if (!iframe) return null;
    return normalize({
      src: element.dataset.src || iframe.getAttribute('src') || '',
      width: parseFloat(element.style.width) || 100,
      height: Number(element.dataset.height) || parseFloat(element.style.height) || 480,
      interactive: element.dataset.interactive !== '0',
      preload: element.dataset.preload === '1',
      border: element.dataset.border === '1',
      scrollbars: element.dataset.scrollbars === '1',
    });
  }

  /**
   * Strictly read DOM produced by Revealation for lossless Markdown output.
   * Unknown classes/attributes return null so the serializer can preserve the
   * element as non-canonical so the Markdown conversion layer can report an error instead of guessing and losing information.
   */
  function fromCanonicalElement(node, hasOnlyAttributes) {
    if (!node || node.nodeName !== 'DIV' || !isElement(node)) return null;
    if (!hasOnlyAttributes(node, ['class', 'data-src', 'data-height', 'data-interactive', 'data-preload', 'data-border', 'data-scrollbars', 'style'])) return null;
    // RV-COMPAT(interactive-demo): REMOVE `.sr-demo` BEFORE PUBLIC RELEASE.
    if (Array.from(node.classList).some((c) => c !== 'sr-interactive' && c !== 'sr-demo')) return null;
    const iframe = node.querySelector(':scope > iframe');
    if (!iframe || node.children.length !== 1) return null;
    if (!hasOnlyAttributes(iframe, ['src', 'title', 'loading', 'scrolling', 'allow', 'data-preload'])) return null;
    const styleProps = Array.from(node.style || []).map((x) => String(x).toLowerCase());
    if (styleProps.some((prop) => prop !== 'width' && prop !== 'height')) return null;
    const width = String(node.style.width || '').trim().match(/^(\d+(?:\.\d+)?)%$/);
    const height = String(node.style.height || '').trim().match(/^(\d+(?:\.\d+)?)px$/);
    if (!width || !height) return null;
    const spec = fromElement(node);
    if (!spec?.src || spec.width <= 0 || spec.width > 100 || spec.height < 120 || spec.height > 1200) return null;
    return spec;
  }

  function fromDirectiveFields(fields, { parseBool, parseWidth }) {
    if (!fields?.src) return null;
    const allowed = new Set(['src', 'width', 'height', 'interactive', 'preload', 'border', 'scrollbars']);
    if (Object.keys(fields).some((key) => !allowed.has(key))) return null;
    const width = fields.width ? parseWidth(fields.width) : '100';
    if (width === null) return null;
    const height = fields.height == null || fields.height === '' ? 480 : Number(fields.height);
    if (!Number.isFinite(height) || height < 120 || height > 1200) return null;
    const interactive = parseBool(fields.interactive, true);
    const preload = parseBool(fields.preload, false);
    const border = parseBool(fields.border, false);
    const scrollbars = parseBool(fields.scrollbars, false);
    if ([interactive, preload, border, scrollbars].some((value) => value === null)) return null;
    return normalize({ src: fields.src, width: Number(width || 100), height, interactive, preload, border, scrollbars });
  }

  app.content.interactive = Object.freeze({
    clampHeight,
    normalize,
    isElement,
    toHtml,
    toMarkdown,
    fromElement,
    fromCanonicalElement,
    fromDirectiveFields,
  });
})(window);
