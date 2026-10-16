/**
 * Revealation — structured Markdown directive primitives
 * =====================================================
 *
 * Purpose
 * -------
 * Provide the low-level parser utilities shared by Revealation's readable
 * Markdown content extensions (`block`, `emphasis`, `muted`, `callout`,
 * RV-COMPAT(layout-wrapper)/RV-COMPAT(columns-directive) legacy
 * `layout`/`columns`/`column`, `align`, `video`, `audio`, `interactive`, and
 * slide-level `notes`). Slide-separator metadata is parsed separately by
 * `deck.js`.
 *
 * Responsibilities
 * ----------------
 * - recognize fenced-code regions so directives inside code are ignored;
 * - normalize tolerant trailing `:::` closers;
 * - find nested directive boundaries;
 * - parse simple `key: value` directive bodies;
 * - validate boolean and percentage values.
 *
 * Does NOT
 * --------
 * - decide which content types exist beyond the recognized opener grammar;
 * - convert whole slides to/from Markdown;
 * - render HTML.
 *
 * Compatibility rule
 * ------------------
 * RV-COMPAT(interactive-demo): accepts old `::: demo` as `::: interactive`.
 * RV-COMPAT(layout-wrapper): recognizes old `::: layout` openers for migration.
 * RV-COMPAT(columns-directive): recognizes old `::: columns` / `::: column` forms.
 *
 * Public API
 * ----------
 * `Revealation.serialization.directives`: fenced-code detection, tolerant
 * normalization, boundary/field parsing, value parsing and exact-offset scans.
 */
(function registerDirectivePrimitives(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  // RV-COMPAT(layout-wrapper), RV-COMPAT(columns-directive), RV-COMPAT(interactive-demo): REMOVE legacy alternatives before public release.
  const OPEN_RE = /^\s*:::\s+(?:layout\s+[a-z][a-z0-9-]*|block(?:\s+align=(?:left|center|right))?|emphasis|muted|callout|columns\s+(?:50\/50|60\/40|40\/60)|column(?:\s+(?:left|center|right))?|align\s+(?:left|center|right)|center|right|left|fragment(?:\s+effect=[a-z][a-z0-9-]*)?|animate\s+id=[a-z][a-z0-9_-]*|video|audio|interactive|demo|notes)\s*$/i;

  function fenceMarker(line) {
    const match = String(line || '').match(/^\s*(`{3,}|~{3,})/);
    return match ? match[1] : '';
  }

  function normalizeLines(markdown) {
    const input = String(markdown || '').split(/\r?\n/);
    const output = [];
    let fence = '';
    let depth = 0;

    for (const raw of input) {
      const marker = fenceMarker(raw);
      if (fence) {
        output.push(raw);
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = '';
        continue;
      }
      if (marker) {
        fence = marker;
        output.push(raw);
        continue;
      }
      if (OPEN_RE.test(raw)) {
        depth += 1;
        output.push(raw.replace(/\s+$/, ''));
        continue;
      }
      if (/^\s*:::\s*$/.test(raw)) {
        if (depth > 0) depth -= 1;
        output.push(':::');
        continue;
      }
      const inlineClose = depth > 0 ? raw.match(/^(.*\S)\s+:::\s*$/) : null;
      if (inlineClose) {
        output.push(inlineClose[1], ':::');
        depth -= 1;
        continue;
      }
      output.push(raw);
    }
    return output;
  }

  function findEnd(lines, start, limit = lines.length) {
    let depth = 1;
    let fence = '';
    for (let i = start + 1; i < limit; i += 1) {
      const line = lines[i];
      const marker = fenceMarker(line);
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = '';
        continue;
      }
      if (marker) { fence = marker; continue; }
      if (/^\s*:::\s+\S/.test(line)) depth += 1;
      else if (/^\s*:::\s*$/.test(line)) {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function fields(lines) {
    const result = {};
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const colon = line.indexOf(':');
      if (colon <= 0) return null;
      const key = line.slice(0, colon).trim().toLowerCase();
      if (!/^[a-z][a-z0-9-]*$/.test(key) || Object.hasOwn(result, key)) return null;
      result[key] = line.slice(colon + 1).trim();
    }
    return result;
  }

  function parseBool(value, fallback = false) {
    if (value == null || value === '') return fallback;
    if (/^(true|yes|1|on)$/i.test(value)) return true;
    if (/^(false|no|0|off)$/i.test(value)) return false;
    return null;
  }

  function parseWidth(value) {
    if (!value) return '';
    const match = String(value).trim().match(/^(\d+(?:\.\d+)?)%$/);
    if (!match) return null;
    const number = Number(match[1]);
    if (!Number.isFinite(number) || number <= 0 || number > 100) return null;
    return String(Math.round(number * 10) / 10);
  }


  function parseHead(raw) {
    // RV-COMPAT(layout-wrapper): REMOVE BEFORE PUBLIC RELEASE.
    let match = raw.match(/^\s*:::\s+layout\s+([a-z][a-z0-9-]*)\s*$/i);
    if (match) return { kind: 'layout', id: match[1].toLowerCase() };
    match = raw.match(/^\s*:::\s+block(?:\s+align=(left|center|right))?\s*$/i);
    if (match) return { kind: 'block', align: (match[1] || 'left').toLowerCase() };
    match = raw.match(/^\s*:::\s+(emphasis|muted|callout)\s*$/i);
    if (match) return { kind: match[1].toLowerCase() };
    // RV-COMPAT(columns-directive): REMOVE BEFORE PUBLIC RELEASE.
    match = raw.match(/^\s*:::\s+columns\s+(50\/50|60\/40|40\/60)\s*$/i);
    if (match) return { kind: 'columns', ratio: match[1] };
    match = raw.match(/^\s*:::\s+column(?:\s+(left|center|right))?\s*$/i);
    if (match) return { kind: 'column', align: (match[1] || 'left').toLowerCase() };
    match = raw.match(/^\s*:::\s+align\s+(left|center|right)\s*$/i);
    if (match) return { kind: 'align', align: match[1].toLowerCase() };
    match = raw.match(/^\s*:::\s+(left|center|right)\s*$/i);
    if (match) return { kind: 'align', align: match[1].toLowerCase(), alias: true };
    match = raw.match(/^\s*:::\s+notes\s*$/i);
    if (match) return { kind: 'notes' };
    // RV-COMPAT(interactive-demo): remove `demo` alternative before public release.
    match = raw.match(/^\s*:::\s+(video|audio|interactive|demo)\s*$/i);
    if (match) {
      const kind = match[1].toLowerCase();
      return { kind: kind === 'demo' ? 'interactive' : kind };
    }
    match = raw.match(/^\s*:::\s+fragment(?:\s+effect=([a-z][a-z0-9-]*))?\s*$/i);
    if (match) return { kind: 'fragment', effect: (match[1] || '').toLowerCase() };
    match = raw.match(/^\s*:::\s+animate\s+id=([a-z][a-z0-9_-]*)\s*$/i);
    if (match) return { kind: 'animate', id: match[1] };
    return null;
  }

  /** Scan recognized directive ranges while preserving exact textarea offsets. */
  function scanRanges(text) {
    const src = String(text || '');
    const lines = src.split(/\n/);
    const ranges = [];
    const stack = [];
    let offset = 0;
    let fence = '';

    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i].replace(/\r$/, '');
      const lineStart = offset;
      const lineEnd = offset + lines[i].length;
      const nextOffset = lineEnd + (i < lines.length - 1 ? 1 : 0);
      const marker = fenceMarker(raw);
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = '';
        offset = nextOffset;
        continue;
      }
      if (marker) { fence = marker; offset = nextOffset; continue; }

      const head = parseHead(raw);
      if (head) {
        const item = {
          ...head, start: lineStart, headerStart: lineStart, headerEnd: lineEnd,
          contentStart: nextOffset, endStart: src.length, end: src.length,
        };
        stack.push(item);
        ranges.push(item);
        offset = nextOffset;
        continue;
      }
      if (/^\s*:::\s*$/.test(raw) && stack.length) {
        const item = stack.pop();
        item.endStart = lineStart;
        item.end = nextOffset;
        offset = nextOffset;
        continue;
      }
      if (stack.length && /\S\s+:::\s*$/.test(raw)) {
        const item = stack.pop();
        item.endStart = lineEnd;
        item.end = nextOffset;
      }
      offset = nextOffset;
    }
    return ranges;
  }

  app.serialization.directives = Object.freeze({
    fenceMarker,
    normalizeLines,
    findEnd,
    fields,
    parseBool,
    parseWidth,
    parseHead,
    scanRanges,
  });
})(window);
