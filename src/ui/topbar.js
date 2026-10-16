/**
 * Revealation — top bar layout
 * ============================
 *
 * Purpose
 * -------
 * Apply the configurable order/visibility of the compact main application bar.
 *
 * Responsibilities
 * ----------------
 * - read `Revealation.config.topbar`;
 * - reorder existing controls into left, center, and right groups;
 * - hide controls explicitly disabled by configuration.
 *
 * Does NOT
 * --------
 * - implement any top-bar action;
 * - own application or deck state;
 * - create toolbar controls.
 *
 * Public API
 * ----------
 * `Revealation.ui.applyTopbarLayout()`
 */
(function registerTopbarLayout(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  function query(selector) {
    try { return document.querySelector(selector); } catch (_) { return null; }
  }

  function applyList(containerSelector, entries) {
    const container = query(containerSelector);
    if (!container || !Array.isArray(entries)) return;
    entries.forEach((entry) => {
      const spec = typeof entry === 'string' ? { selector: entry } : entry;
      if (!spec?.selector) return;
      const node = query(spec.selector);
      if (!node) return;
      node.hidden = spec.visible === false;
      if (spec.visible !== false) container.appendChild(node);
    });
  }

  function applyTopbarLayout() {
    const config = app.config.topbar || {};
    applyList('.topbar-left', config.left);
    applyList('.topbar-center', config.center);
    applyList('.topbar-right', config.right);
  }

  app.ui.applyTopbarLayout = applyTopbarLayout;
})(window);
