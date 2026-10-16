/**
 * Revealation — top bar configuration
 * ===================================
 *
 * Purpose
 * -------
 * Declare the order and visibility of the small, stable set of deck-level
 * actions in the main application bar.
 *
 * Responsibilities
 * ----------------
 * - reference existing top-bar controls by selector;
 * - keep left (brand), center (deck identity), and right (commands) groups explicit;
 * - separate hand-edited UI arrangement from button behavior.
 *
 * Does NOT
 * --------
 * - implement deck settings, export, Present, history, settings, or help;
 * - create or remove controls;
 * - mutate application state.
 *
 * Public API
 * ----------
 * `Revealation.config.topbar` — `{ left, center, right }` selector lists.
 */
(function registerTopbarConfig(global) {
  'use strict';
  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  app.config.topbar = {
    left: [
      '#app-brand',
    '#btn-deck-settings',
    '#btn-undo',
    '#btn-redo',
    '#btn-workspace-open',
    '#btn-export',
    ],
    center: [
      '#deck-title',
    ],
    right: [
      '.present-actions',
      '#btn-settings',
      '#btn-help',
      '#btn-mobile-menu',
    ],
  };
})(window);
