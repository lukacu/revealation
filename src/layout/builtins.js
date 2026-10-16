/**
 * Revealation — built-in layout templates
 * =======================================
 *
 * Purpose
 * -------
 * Register the layouts shipped with Revealation using the same public
 * extension API available to third-party/custom layout scripts.
 *
 * Responsibilities
 * ----------------
 * - define stable layout ids and positional slot semantics;
 * - define grid geometry that works in the editor and reveal.js output.
 *
 * Does NOT
 * --------
 * - parse or serialize Markdown;
 * - render the layout picker;
 * - special-case built-ins in the editor.
 *
 * Compatibility rule
 * ------------------
 * RV-COMPAT(columns-directive): REMOVE BEFORE PUBLIC RELEASE.
 * Existing `columns 50/50`, `60/40`, `40/60` Markdown maps to the matching
 * `two-columns*` ids during import.
 *
 * Public API
 * ----------
 * No new API. Calls `Revealation.layout.register(...)` at load time.
 */
(function registerBuiltInLayouts(global) {
  'use strict';
  const layouts = global.Revealation?.layout;
  if (!layouts) throw new Error('Layout registry must be loaded before built-in layouts.');

  const register = (definition) => layouts.register(definition);

  register({
    id: 'single', label: 'Single block', icon: 'bi-square',
    slots: [{ id: 'body', label: 'Body', master: true, titleSource: true, initialBlock: 'p' }],
    grid: { areas: '"body"', columns: 'minmax(0, 1fr)' },
  });
  register({
    id: 'header-body', label: 'Header + body', icon: 'bi-layout-text-window-reverse',
    slots: [
      { id: 'header', label: 'Header', titleSource: true, initialBlock: 'h1' },
      { id: 'body', label: 'Body', master: true, initialBlock: 'p' },
    ],
    grid: { areas: '"header" "body"', columns: 'minmax(0, 1fr)', rows: 'auto minmax(0, 1fr)', gap: '0.18em' },
  });
  register({
    id: 'two-columns', label: 'Two columns', icon: 'bi-layout-split',
    slots: [
      { id: 'left', label: 'Left', master: true, titleSource: true, initialBlock: 'p' },
      { id: 'right', label: 'Right', initialBlock: 'p' },
    ],
    grid: { areas: '"left right"', columns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '0.45em' },
  });
  register({
    id: 'two-columns-60-40', label: 'Two columns 60 / 40', icon: 'bi-layout-split',
    slots: [
      { id: 'left', label: 'Left', master: true, titleSource: true, initialBlock: 'p' },
      { id: 'right', label: 'Right', initialBlock: 'p' },
    ],
    grid: { areas: '"left right"', columns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: '0.45em' },
  });
  register({
    id: 'two-columns-40-60', label: 'Two columns 40 / 60', icon: 'bi-layout-split',
    slots: [
      { id: 'left', label: 'Left', titleSource: true, initialBlock: 'p' },
      { id: 'right', label: 'Right', master: true, initialBlock: 'p' },
    ],
    grid: { areas: '"left right"', columns: 'minmax(0, 2fr) minmax(0, 3fr)', gap: '0.45em' },
  });
  register({
    id: 'header-two-columns-60-40', label: 'Header + columns 60 / 40', icon: 'bi-layout-three-columns',
    slots: [
      { id: 'header', label: 'Header', titleSource: true, initialBlock: 'h1' },
      { id: 'left', label: 'Left', master: true, initialBlock: 'p' },
      { id: 'right', label: 'Right', initialBlock: 'p' },
    ],
    grid: {
      areas: '"header header" "left right"',
      columns: 'minmax(0, 3fr) minmax(0, 2fr)',
      rows: 'auto minmax(0, 1fr)',
      gap: '0.22em 0.45em',
    },
  });
  register({
    id: 'header-two-columns-40-60', label: 'Header + columns 40 / 60', icon: 'bi-layout-three-columns',
    slots: [
      { id: 'header', label: 'Header', titleSource: true, initialBlock: 'h1' },
      { id: 'left', label: 'Left', initialBlock: 'p' },
      { id: 'right', label: 'Right', master: true, initialBlock: 'p' },
    ],
    grid: {
      areas: '"header header" "left right"',
      columns: 'minmax(0, 2fr) minmax(0, 3fr)',
      rows: 'auto minmax(0, 1fr)',
      gap: '0.22em 0.45em',
    },
  });
  register({
    id: 'header-two-columns', label: 'Header + two columns', icon: 'bi-layout-three-columns',
    slots: [
      { id: 'header', label: 'Header', titleSource: true, initialBlock: 'h1' },
      { id: 'left', label: 'Left', master: true, initialBlock: 'p' },
      { id: 'right', label: 'Right', initialBlock: 'p' },
    ],
    grid: { areas: '"header header" "left right"', columns: 'minmax(0, 1fr) minmax(0, 1fr)', rows: 'auto minmax(0, 1fr)', gap: '0.22em 0.45em' },
  });
  register({
    id: 'header-three-columns', label: 'Header + three columns', icon: 'bi-layout-three-columns',
    slots: [
      { id: 'header', label: 'Header', titleSource: true, initialBlock: 'h1' },
      { id: 'left', label: 'Left', initialBlock: 'p' },
      { id: 'center', label: 'Center', master: true, initialBlock: 'p' },
      { id: 'right', label: 'Right', initialBlock: 'p' },
    ],
    grid: {
      areas: '"header header header" "left center right"',
      columns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)',
      rows: 'auto minmax(0, 1fr)',
      gap: '0.22em 0.4em',
    },
  });
  register({
    id: 'header-two-columns-footer', label: 'Header + two columns + footer', icon: 'bi-layout-text-window-reverse',
    slots: [
      { id: 'header', label: 'Header', titleSource: true, initialBlock: 'h1' },
      { id: 'left', label: 'Left', master: true, initialBlock: 'p' },
      { id: 'right', label: 'Right', initialBlock: 'p' },
      { id: 'footer', label: 'Footer', initialBlock: 'p' },
    ],
    grid: {
      areas: '"header header" "left right" "footer footer"',
      columns: 'minmax(0, 1fr) minmax(0, 1fr)',
      rows: 'auto minmax(0, 1fr) auto',
      gap: '0.22em 0.45em',
    },
  });
  register({
    id: 'grid-2x2', label: '2 × 2 grid', icon: 'bi-grid',
    slots: [
      { id: 'top-left', label: 'Top left', master: true, titleSource: true, initialBlock: 'p' },
      { id: 'top-right', label: 'Top right', initialBlock: 'p' },
      { id: 'bottom-left', label: 'Bottom left', initialBlock: 'p' },
      { id: 'bottom-right', label: 'Bottom right', initialBlock: 'p' },
    ],
    grid: { areas: '"top-left top-right" "bottom-left bottom-right"', columns: 'minmax(0, 1fr) minmax(0, 1fr)', rows: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '0.4em' },
  });
})(window);
