/**
 * Revealation — formatting toolbar layout
 * =======================================
 *
 * Purpose
 * -------
 * Build the visible WYSIWYG toolbar from declarative configuration. The
 * toolbar is core editor UI; configuration is separate only so its grouping
 * and order can be changed without touching event-handling code.
 *
 * Responsibilities
 * ----------------
 * - read `Revealation.config.toolbar`;
 * - move existing toolbar controls into configured groups;
 * - apply visibility and accessibility labels.
 *
 * Does NOT
 * --------
 * - implement formatting commands;
 * - register button click behavior;
 * - create new editing features.
 *
 * Depends on
 * ----------
 * `src/config/toolbar.js` and markup already present in `index.html`.
 *
 * Public API
 * ----------
 * `Revealation.ui.applyToolbarLayout()`
 */
(function registerToolbarLayout(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  function first(selector, root = document) {
    try { return root.querySelector(selector); } catch (_) { return null; }
  }

  function normalizeEntry(entry) {
    return typeof entry === 'string' ? { selector: entry } : entry;
  }

  function applyToolbarLayout() {
    const toolbar = document.getElementById('toolbar');
    const config = app.config.toolbar;
    if (!toolbar || !Array.isArray(config)) return;

    const nodes = new Map();
    config.forEach((group) => {
      (group.items || []).forEach((entry) => {
        const spec = normalizeEntry(entry);
        if (!spec?.selector || nodes.has(spec.selector)) return;
        nodes.set(spec.selector, first(spec.selector, toolbar) || first(spec.selector));
      });
    });

    toolbar.querySelectorAll(':scope > .tb-group').forEach((group) => group.remove());

    config.forEach((group) => {
      if (group.visible === false) return;
      const wrap = document.createElement('div');
      wrap.className = group.className || 'tb-group';
      wrap.dataset.toolbarGroup = group.id || '';
      wrap.setAttribute('role', 'group');
      if (group.label) wrap.setAttribute('aria-label', group.label);

      (group.items || []).forEach((entry) => {
        const spec = normalizeEntry(entry);
        if (!spec || spec.visible === false) return;
        const node = nodes.get(spec.selector);
        if (node) wrap.appendChild(node);
      });
      if (wrap.children.length) toolbar.appendChild(wrap);
    });
  }

  app.ui.applyToolbarLayout = applyToolbarLayout;
})(window);
