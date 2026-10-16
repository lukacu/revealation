/**
 * Revealation — DOM selection helpers
 * ===================================
 *
 * Purpose
 * -------
 * Pure-ish DOM utilities used by the WYSIWYG editor to interpret a browser
 * Range in terms of Revealation blocks and fragments.
 *
 * Responsibilities
 * ----------------
 * - find the nearest editor block for a Range;
 * - find an enclosing `.fragment` for a Range;
 * - determine whether a Range covers an entire block's textual content;
 * - resolve the concrete editing host for a Range inside protected layouts.
 *
 * Does NOT
 * --------
 * - own selection state/caching;
 * - mutate editor content;
 * - record undo history;
 * - execute formatting commands.
 *
 * Public API
 * ----------
 * `Revealation.editor.domSelection`: `blockFromRange`, `fragmentFromRange`,
 * `rangeCoversBlock`, `editingHostFromRange`.
 */
(function registerDomSelection(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  function blockFromRange(range, editor, blockTags) {
    if (!range || !editor) return null;
    let node = range.startContainer;
    if (node === editor) {
      node = editor.childNodes[range.startOffset]
        || editor.childNodes[range.startOffset - 1]
        || editor.firstElementChild;
    }
    if (node?.nodeType === Node.TEXT_NODE) node = node.parentNode;
    while (node && node !== editor && node !== document.body) {
      if (node.nodeType === Node.ELEMENT_NODE
          && blockTags.has(node.tagName.toLowerCase())
          && editor.contains(node)) return node;
      node = node.parentNode;
    }
    const first = editor.firstElementChild;
    return first && blockTags.has(first.tagName.toLowerCase()) ? first : null;
  }

  function fragmentFromRange(range, editor) {
    if (!range || !editor) return null;
    let node = range.startContainer;
    if (node === editor) {
      node = editor.childNodes[range.startOffset]
        || editor.childNodes[range.startOffset - 1]
        || null;
    }
    if (node?.nodeType === Node.TEXT_NODE) node = node.parentNode;
    if (!node || !editor.contains(node)) return null;
    while (node && node !== editor) {
      if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('fragment')) return node;
      node = node.parentNode;
    }
    return null;
  }

  function rangeCoversBlock(range, block) {
    if (!range || !block) return false;
    const whole = document.createRange();
    whole.selectNodeContents(block);
    return range.toString().trim() === whole.toString().trim();
  }


  function editingHostFromRange(range, editor) {
    if (!range || !editor) return editor || null;
    let node = range.startContainer;
    if (node?.nodeType === Node.TEXT_NODE) node = node.parentNode;
    if (!node || !editor.contains(node)) return editor;
    const host = node.closest?.('.sr-layout-content[contenteditable="true"]');
    return host && editor.contains(host) ? host : editor;
  }
  app.editor.domSelection = Object.freeze({ blockFromRange, fragmentFromRange, rangeCoversBlock, editingHostFromRange });
})(window);
