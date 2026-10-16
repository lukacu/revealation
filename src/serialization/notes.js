/**
 * Revealation — slide speaker-notes Markdown block
 * =================================================
 *
 * Purpose
 * -------
 * Own the canonical slide-level speaker-notes syntax:
 *
 *   ::: notes
 *   Text shown in the Reveal.js speaker view.
 *   :::
 *
 * Responsibilities
 * ----------------
 * - find and validate the optional top-level `::: notes` block for a slide;
 * - separate speaker-note text from visual slide Markdown;
 * - serialize `slide.notes` back to canonical Markdown.
 *
 * Does NOT
 * --------
 * - parse or render Markdown inside note text;
 * - own slide separators, layouts, or Reveal.js speaker-view rendering.
 *
 * Notes are deliberately outside visual slide content. A notes block is
 * optional, may appear at most once, and must be the final top-level block of
 * a slide. Its body is stored as plain text in `slide.notes`; Revealation does
 * not interpret nested Markdown inside speaker notes.
 *
 * Public API
 * ----------
 * `Revealation.serialization.notes.split(markdown, { lineOffset? })`
 * `Revealation.serialization.notes.format(text)`
 */
(function registerNotesSerialization(global) {
  'use strict';

  const app = global.Revealation;
  const directives = app?.serialization?.directives;
  if (!app || !directives) throw new Error('Speaker-note serialization requires directive primitives.');

  const NOTES_OPEN_RE = /^\s*:::\s+notes\s*$/i;
  const ANY_OPEN_RE = /^\s*:::\s+\S/;
  const CLOSE_RE = /^\s*:::\s*$/;

  function diagnostic(line, code, message) {
    return { line, code, message, severity: 'error' };
  }

  function findClose(lines, start) {
    let depth = 1;
    let fence = '';
    for (let i = start + 1; i < lines.length; i += 1) {
      const raw = lines[i];
      const marker = directives.fenceMarker(raw);
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = '';
        continue;
      }
      if (marker) { fence = marker; continue; }
      if (ANY_OPEN_RE.test(raw)) depth += 1;
      else if (CLOSE_RE.test(raw)) {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function split(markdown, options = {}) {
    const source = String(markdown || '');
    const lines = source.split(/\r?\n/);
    const lineOffset = Number(options.lineOffset) || 0;
    const diagnostics = [];
    let fence = '';
    let depth = 0;
    let notesStart = -1;
    let notesEnd = -1;

    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i];
      const marker = directives.fenceMarker(raw);
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = '';
        continue;
      }
      if (marker) { fence = marker; continue; }

      if (depth === 0 && NOTES_OPEN_RE.test(raw)) {
        if (notesStart >= 0) {
          diagnostics.push(diagnostic(lineOffset + i + 1, 'duplicate-notes', 'A slide may contain only one `::: notes` block.'));
          continue;
        }
        notesStart = i;
        notesEnd = findClose(lines, i);
        if (notesEnd < 0) {
          diagnostics.push(diagnostic(lineOffset + i + 1, 'unclosed-notes', 'Unclosed `::: notes` block.'));
          break;
        }
        const trailingIndex = lines.slice(notesEnd + 1).findIndex(line => line.trim());
        if (trailingIndex >= 0) {
          diagnostics.push(diagnostic(
            lineOffset + notesEnd + trailingIndex + 2,
            'notes-not-last',
            '`::: notes` must be the final top-level block of a slide.'
          ));
        }
        break;
      }

      if (ANY_OPEN_RE.test(raw)) depth += 1;
      else if (CLOSE_RE.test(raw) && depth > 0) depth -= 1;
    }

    if (notesStart < 0 || notesEnd < 0) {
      return { body: source.trim(), notes: '', diagnostics, found: notesStart >= 0 };
    }

    return {
      body: lines.slice(0, notesStart).join('\n').trimEnd(),
      notes: lines.slice(notesStart + 1, notesEnd).join('\n').trim(),
      diagnostics,
      found: true,
      startLine: lineOffset + notesStart + 1,
      endLine: lineOffset + notesEnd + 1,
    };
  }

  function format(text) {
    const value = String(text || '').trim();
    return value ? `::: notes\n${value}\n:::` : '';
  }

  app.serialization.notes = Object.freeze({ split, format });
})(window);
