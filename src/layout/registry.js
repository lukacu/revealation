/**
 * Revealation — layout registry
 * =============================
 *
 * Purpose
 * -------
 * Define the extension boundary for slide layouts. A layout is a named,
 * ordered set of slots plus presentation metadata. The slide separator stores the
 * layout id; Markdown body content contains generic positional `::: block`
 * children whose semantic slot names come from template order.
 *
 * Responsibilities
 * ----------------
 * - validate and register layout definitions;
 * - expose immutable definitions by id;
 * - provide the ordered catalog used by the picker and validator;
 * - apply a layout definition to a canonical layout DOM element.
 *
 * Does NOT
 * --------
 * - parse Markdown;
 * - edit slide content;
 * - own application state;
 * - require reveal.js internals.
 *
 * Extension contract
 * ------------------
 * `Revealation.layout.register({ id, label, slots, className?, grid? })`
 *
 * Each slot has a stable semantic `id`. Exactly one slot is the layout's
 * `master`; unmatched content is routed there when a slide changes layouts.
 * At most one slot may declare `titleSource: true`; the sidebar uses only
 * that slot when deriving a human-facing slide label. A slot may also declare
 * `initialBlock` (`p`, `h1` … `h6`) to define the
 * empty WYSIWYG scaffold without persisting placeholder content. Registration
 * may be called by a script loaded after this file and before application.js.
 * Slot order is part of the persisted Markdown contract.
 *
 * Public API
 * ----------
 * `Revealation.layout.register(definition)`
 * `Revealation.layout.get(id)`
 * `Revealation.layout.list()`
 * `Revealation.layout.applyToElement(element, definition)`
 * `Revealation.layout.transferPlan(fromId, toId)`
 * `Revealation.layout.cssText()`
 */
(function registerLayoutRegistry(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  const definitions = new Map();
  const ID_RE = /^[a-z][a-z0-9-]*$/;

  const INITIAL_BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

  function normalizeSlot(slot, index) {
    const value = typeof slot === 'string' ? { id: slot } : { ...(slot || {}) };
    const id = String(value.id || '').trim();
    if (!ID_RE.test(id)) throw new Error(`Invalid layout slot id at position ${index + 1}: ${id || '(empty)'}`);
    const initialBlock = String(value.initialBlock || 'p').trim().toLowerCase();
    if (!INITIAL_BLOCKS.has(initialBlock)) {
      throw new Error(`Layout slot "${id}" has unsupported initialBlock "${initialBlock}".`);
    }
    return Object.freeze({
      id,
      label: String(value.label || id),
      description: String(value.description || ''),
      master: value.master === true,
      titleSource: value.titleSource === true,
      initialBlock,
    });
  }

  function normalizeGrid(grid) {
    if (!grid) return null;
    const result = {};
    for (const key of ['areas', 'columns', 'rows', 'gap', 'alignItems']) {
      if (grid[key] != null && grid[key] !== '') result[key] = String(grid[key]);
    }
    return Object.freeze(result);
  }

  function normalizeDefinition(input) {
    const source = { ...(input || {}) };
    const id = String(source.id || '').trim();
    if (!ID_RE.test(id)) throw new Error(`Invalid layout id: ${id || '(empty)'}`);
    if (!Array.isArray(source.slots) || source.slots.length < 1) {
      throw new Error(`Layout "${id}" must define at least one slot.`);
    }
    const slots = source.slots.map(normalizeSlot);
    const seen = new Set();
    slots.forEach(slot => {
      if (seen.has(slot.id)) throw new Error(`Layout "${id}" contains duplicate slot "${slot.id}".`);
      seen.add(slot.id);
    });
    const masters = slots.filter(slot => slot.master);
    if (masters.length !== 1) {
      throw new Error(`Layout "${id}" must define exactly one master slot; found ${masters.length}.`);
    }
    const titleSources = slots.filter(slot => slot.titleSource);
    if (titleSources.length > 1) {
      throw new Error(`Layout "${id}" may define at most one titleSource slot; found ${titleSources.length}.`);
    }
    const className = source.className ? String(source.className).trim() : `sr-layout-${id}`;
    if (className && !/^[a-zA-Z_][\w-]*$/.test(className)) {
      throw new Error(`Layout "${id}" has an invalid className.`);
    }
    return Object.freeze({
      id,
      label: String(source.label || id),
      description: String(source.description || ''),
      icon: String(source.icon || 'bi-grid'),
      className,
      slots: Object.freeze(slots),
      grid: normalizeGrid(source.grid),
      css: String(source.css || '').trim(),
    });
  }

  function register(definition) {
    const normalized = normalizeDefinition(definition);
    if (definitions.has(normalized.id)) throw new Error(`Layout "${normalized.id}" is already registered.`);
    definitions.set(normalized.id, normalized);
    if (normalized.css && global.document?.head) {
      const style = global.document.createElement('style');
      style.dataset.revealationLayout = normalized.id;
      style.textContent = normalized.css;
      global.document.head.appendChild(style);
    }
    return normalized;
  }

  function get(id) {
    return definitions.get(String(id || '')) || null;
  }

  function list() {
    return Array.from(definitions.values());
  }

  function cssText() {
    return list().map(def => def.css).filter(Boolean).join('\n');
  }


  /**
   * Build a representation-independent content transfer plan. Matching slot
   * ids retain their content. Any source slot without a name match is routed
   * to the target layout's single master slot. Source indexes assigned to one
   * target are kept in original source order so merged content is not shuffled.
   */
  function transferPlan(fromId, toId) {
    const from = get(fromId);
    const to = get(toId);
    if (!from || !to) return null;
    const targets = to.slots.map(slot => ({ slot, sourceIndexes: [] }));
    const assigned = new Set();

    to.slots.forEach((slot, targetIndex) => {
      const sourceIndex = from.slots.findIndex(source => source.id === slot.id);
      if (sourceIndex < 0) return;
      targets[targetIndex].sourceIndexes.push(sourceIndex);
      assigned.add(sourceIndex);
    });

    const masterIndex = to.slots.findIndex(slot => slot.master);
    from.slots.forEach((slot, sourceIndex) => {
      if (!assigned.has(sourceIndex)) targets[masterIndex].sourceIndexes.push(sourceIndex);
    });
    targets[masterIndex].sourceIndexes.sort((a, b) => a - b);
    return Object.freeze({
      from,
      to,
      masterIndex,
      targets: Object.freeze(targets.map(item => Object.freeze({
        slot: item.slot,
        sourceIndexes: Object.freeze(item.sourceIndexes.slice()),
      }))),
    });
  }

  function applyToElement(element, definition) {
    const def = typeof definition === 'string' ? get(definition) : definition;
    if (!element || !def) return false;
    Array.from(element.classList || []).filter(cls => cls.startsWith('sr-layout-')).forEach(cls => element.classList.remove(cls));
    element.classList.add('sr-layout');
    if (def.className) element.classList.add(def.className);
    element.dataset.layout = def.id;
    const grid = def.grid || {};
    const style = element.style;
    style.removeProperty('grid-template-areas');
    style.removeProperty('grid-template-columns');
    style.removeProperty('grid-template-rows');
    style.removeProperty('gap');
    style.removeProperty('align-items');
    if (grid.areas) style.gridTemplateAreas = grid.areas;
    if (grid.columns) style.gridTemplateColumns = grid.columns;
    if (grid.rows) style.gridTemplateRows = grid.rows;
    if (grid.gap) style.gap = grid.gap;
    if (grid.alignItems) style.alignItems = grid.alignItems;
    return true;
  }

  app.layout = app.layout || {};
  Object.assign(app.layout, { register, get, list, cssText, applyToElement, transferPlan });
})(window);
