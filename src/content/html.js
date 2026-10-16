/**
 * Revealation — explicit raw HTML content block
 * =============================================
 *
 * Purpose
 * -------
 * Provide the only supported escape hatch for literal HTML in deck Markdown.
 * Ordinary WYSIWYG content must have a deterministic Markdown representation;
 * it may never silently fall back to arbitrary HTML.
 *
 * Responsibilities
 * ----------------
 * - encode/decode `::: html` blocks without altering their source;
 * - create a canonical protected DOM wrapper for editor/preview use;
 * - serialize that wrapper back to the explicit Markdown block.
 *
 * Does NOT
 * --------
 * - sanitize authored HTML;
 * - make raw HTML editable in WYSIWYG;
 * - accept implicit/raw HTML outside `::: html`.
 *
 * Public API
 * ----------
 * `Revealation.content.html.createElement(source)`
 * `Revealation.content.html.fromCanonicalElement(element)`
 * `Revealation.content.html.toMarkdown(source)`
 */
(function registerHtmlContent(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  function encodeSource(source) {
    const bytes = new TextEncoder().encode(String(source || ''));
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function decodeSource(value) {
    try {
      const binary = atob(String(value || ''));
      const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch (_) {
      return '';
    }
  }

  function createElement(source) {
    const wrap = document.createElement('div');
    wrap.className = 'sr-html-block';
    wrap.dataset.htmlSource = encodeSource(source);
    const content = document.createElement('div');
    content.className = 'sr-html-content';
    content.innerHTML = String(source || '');
    wrap.appendChild(content);
    return wrap;
  }

  function fromCanonicalElement(element) {
    if (!element || element.nodeName !== 'DIV' || !element.classList.contains('sr-html-block')) return null;
    if (!element.hasAttribute('data-html-source')) return null;
    return decodeSource(element.dataset.htmlSource || '');
  }

  function toMarkdown(source) {
    return `::: html\n${String(source || '')}\n:::`;
  }

  app.content = app.content || {};
  app.content.html = Object.freeze({ createElement, fromCanonicalElement, toMarkdown, encodeSource, decodeSource });
})(window);
