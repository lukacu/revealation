/**
 * Revealation — toolbar configuration
 * ===================================
 *
 * Purpose
 * -------
 * Declare the visible grouping, order and optional visibility of WYSIWYG toolbar controls.
 *
 * Responsibilities
 * ----------------
 * - reference controls already defined in `index.html` by CSS selector;
 * - provide one obvious hand-editable place for toolbar organization;
 * - keep presentation of commands separate from their implementation.
 *
 * Does NOT
 * --------
 * - implement formatting commands;
 * - attach editor event handlers;
 * - mutate deck state.
 *
 * Public API
 * ----------
 * `Revealation.config.toolbar` — an ordered array of toolbar group descriptors.
 *
 * Editing note
 * ------------
 * This file is intentionally declarative and is the preferred place to
 * rearrange/hide controls without changing editor behavior.
 */
(function registerToolbarConfig(global) {
  'use strict';
  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  app.config.toolbar = [
    { id: 'style', label: 'Paragraph style', items: ['#block-style'] },
    { id: 'text', label: 'Text formatting', items: ['[data-cmd="bold"]', '[data-cmd="italic"]', '[data-cmd="underline"]', '[data-cmd="strikeThrough"]'] },
    { id: 'lists', label: 'Lists', items: ['[data-cmd="insertUnorderedList"]', '[data-cmd="insertOrderedList"]'] },
    {
      id: 'alignment', label: 'Alignment',
      items: ['[data-action="align-left"]', '[data-action="align-center"]', '[data-action="align-right"]'],
    },
    {
      id: 'insert', label: 'Insert',
      items: [
        '[data-action="link"]',
        '[data-action="image"]',
        '[data-action="video"]',
        '[data-action="audio"]',
        '[data-action="interactive"]',
        '[data-action="math"]',
        '[data-action="code-block"]',
        '[data-action="hr"]',
        '[data-cmd="removeFormat"]',
      ],
    },
    {
      id: 'slide', label: 'Slide settings', className: 'tb-group tb-slide-actions',
      items: ['#btn-slide-layout', '#btn-slide-background', '#btn-notes-toggle', '#btn-markdown-toolbar'],
    },
  ];
})(window);
