/**
 * Revealation — whole-deck Markdown structure
 * ===========================================
 *
 * Purpose
 * -------
 * Interpret top-level slide/subslide separators and their slide-level metadata
 * without parsing the Markdown content inside each slide.
 *
 * Responsibilities
 * ----------------
 * - recognize `---` / `--` separators outside fenced code blocks;
 * - parse optional separator metadata such as `layout=two-columns`;
 * - split Markdown into exact slide/subslide source ranges;
 * - report malformed separator metadata with line numbers;
 * - format canonical separator lines for the Markdown writer;
 * - derive conservative fallback navigation labels from raw Markdown.
 *
 * Does NOT
 * --------
 * - validate whether a referenced layout id exists;
 * - parse slide content into HTML;
 * - understand `::: block` contents;
 * - mutate editor text or deck state.
 *
 * Format contract
 * ---------------
 * `---` starts a slide and `--` starts a subslide. Metadata is a whitespace-
 * separated list of `key=value` tokens. Revealation 3.4 currently writes only
 * `layout=<id>`, but the parser keeps the representation generic so future
 * slide-level metadata does not require a new separator grammar.
 *
 * Public API
 * ----------
 * `Revealation.serialization.deck.parseSeparator(line)`
 * `Revealation.serialization.deck.formatSeparator({ subslide, layout })`
 * `Revealation.serialization.deck.validateSeparators(markdown)`
 * `Revealation.serialization.deck.scanSlideRanges(markdown)`
 * `Revealation.serialization.deck.fallbackLabel(markdownChunk, index)`
 */
(function registerDeckMarkdownStructure(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');
  const directives = app.serialization.directives;
  const notes = app.serialization.notes;
  if (!directives || !notes) throw new Error('Revealation Markdown directives and notes serialization must be loaded first.');

  const SEPARATOR_HEAD_RE = /^\s*(---|--)(?:\s+(.*?))?\s*$/;
  const META_KEY_RE = /^[a-z][a-z0-9-]*$/i;
  const META_VALUE_RE = /^[a-zA-Z0-9._:/#%?&=+@~-]+$/;
  const SUPPORTED_METADATA = new Set([
    'layout', 'background',
    // RV-COMPAT(slide-transition): REMOVE per-slide transition metadata BEFORE PUBLIC RELEASE.
    'transition',
    // RV-COMPAT(background-reveal): REMOVE raw Reveal background metadata BEFORE PUBLIC RELEASE.
    'background-color', 'background-image', 'background-video', 'background-iframe', 'background-size',
    'auto-animate', 'auto-animate-id', 'auto-animate-duration',
    'auto-animate-easing', 'auto-animate-unmatched', 'under-construction', 'hidden',
  ]);

  function parseMetadataTokens(tail) {
    const metadata = {};
    let pos = 0;
    while (pos < tail.length) {
      while (/\s/.test(tail[pos] || '')) pos += 1;
      if (pos >= tail.length) break;
      const keyStart = pos;
      while (pos < tail.length && !/[=\s]/.test(tail[pos])) pos += 1;
      const key = tail.slice(keyStart, pos);
      while (/\s/.test(tail[pos] || '')) pos += 1;
      if (tail[pos] !== '=') return { error: `Invalid slide metadata token near "${tail.slice(keyStart)}".` };
      pos += 1;
      while (/\s/.test(tail[pos] || '')) pos += 1;
      let value = '';
      if (tail[pos] === '"') {
        pos += 1;
        let closed = false;
        while (pos < tail.length) {
          if (tail[pos] === '\\' && pos + 1 < tail.length) { value += tail[pos + 1]; pos += 2; }
          else if (tail[pos] === '"') { pos += 1; closed = true; break; }
          else value += tail[pos++];
        }
        if (!closed) return { error: `Unclosed quoted value for slide metadata key "${key}".` };
        if (pos < tail.length && !/\s/.test(tail[pos])) return { error: `Invalid quoted value for slide metadata key "${key}".` };
      } else {
        const valueStart = pos;
        while (pos < tail.length && !/\s/.test(tail[pos])) pos += 1;
        value = tail.slice(valueStart, pos);
      }
      if (!META_KEY_RE.test(key) || !value || (!value.includes(' ') && !META_VALUE_RE.test(value))) {
        return { error: `Invalid slide metadata token "${key}=${value}".` };
      }
      if (Object.prototype.hasOwnProperty.call(metadata, key)) return { error: `Duplicate slide metadata key "${key}".` };
      metadata[key] = value;
    }
    return { metadata };
  }

  function parseSeparator(line) {
    const match = String(line || '').match(SEPARATOR_HEAD_RE);
    if (!match) return null;
    const marker = match[1];
    const tail = String(match[2] || '').trim();
    const parsed = tail ? parseMetadataTokens(tail) : { metadata: {} };
    const metadata = parsed.metadata || {};
    if (parsed.error) return { valid: false, marker, subslide: marker === '--', metadata, error: parsed.error };
    return {
      valid: true,
      marker,
      subslide: marker === '--',
      metadata,
      layout: metadata.layout || 'single',
    };
  }

  function formatSeparator({ subslide = false, layout = 'single', metadata = {} } = {}) {
    const marker = subslide ? '--' : '---';
    const values = { ...(metadata || {}) };
    const id = String(layout || values.layout || 'single').trim() || 'single';
    if (id === 'single') delete values.layout;
    else values.layout = id;
    const tokens = Object.entries(values).filter(([, value]) => value !== '' && value != null).map(([key, value]) => {
      const text = String(value);
      return `${key}=${/^[a-zA-Z0-9._:/#%?&=+@~-]+$/.test(text) ? text : `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`}`;
    });
    return tokens.length ? `${marker} ${tokens.join(' ')}` : marker;
  }

  function validateSeparators(markdown) {
    const lines = String(markdown || '').split(/\r?\n/);
    const diagnostics = [];
    let fence = '';
    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i];
      const marker = directives.fenceMarker(raw);
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = '';
        continue;
      }
      if (marker) { fence = marker; continue; }
      if (!/^\s*(?:---|--)(?:\s|$)/.test(raw)) continue;
      const parsed = parseSeparator(raw);
      if (!parsed) continue;
      if (!parsed.valid) {
        diagnostics.push({ line: i + 1, code: 'invalid-slide-metadata', message: parsed.error, severity: 'error' });
        continue;
      }
      const unsupported = Object.keys(parsed.metadata).filter(key => !SUPPORTED_METADATA.has(key));
      unsupported.forEach(key => diagnostics.push({
        line: i + 1,
        code: 'unsupported-slide-metadata',
        message: `Unsupported slide metadata key "${key}".`,
        severity: 'error',
      }));
    }
    return diagnostics;
  }

  /**
   * Return exact textarea offsets for each top-level slide/subslide.
   *
   * `start` / `end` cover only slide content. If a slide has an explicit
   * separator, `separatorStart` / `separatorEnd` cover that line so callers can
   * safely edit metadata without guessing source offsets.
   */
  function scanSlideRanges(markdown) {
    const text = String(markdown || '');
    const lines = text.split(/\n/);
    const ranges = [];
    let fence = '';
    let start = 0;
    let startLine = 1;
    let offset = 0;
    let pending = { subslide: false, layout: 'single', metadata: {}, separatorStart: null, separatorEnd: null, separatorLine: null, marker: null };
    let pendingExplicit = false;

    const commit = (end, force = false) => {
      const chunk = text.slice(start, end);
      if (!chunk.trim() && !force) return;
      ranges.push({
        start,
        end,
        startLine,
        subslide: ranges.length > 0 && !!pending.subslide,
        layout: pending.layout || 'single',
        metadata: { ...(pending.metadata || {}) },
        separatorStart: pending.separatorStart,
        separatorEnd: pending.separatorEnd,
        separatorLine: pending.separatorLine,
        separatorMarker: pending.marker,
        chunk,
      });
    };

    for (let i = 0; i < lines.length; i += 1) {
      const rawWithCr = lines[i];
      const raw = rawWithCr.replace(/\r$/, '');
      const lineLength = rawWithCr.length + (i < lines.length - 1 ? 1 : 0);
      const fenceMarker = directives.fenceMarker(raw);
      if (fence) {
        if (fenceMarker && fenceMarker[0] === fence[0] && fenceMarker.length >= fence.length) fence = '';
      } else if (fenceMarker) {
        fence = fenceMarker;
      } else {
        const separator = parseSeparator(raw);
        if (separator?.valid) {
          commit(offset, pendingExplicit && ranges.length === 0 ? false : false);
          pending = {
            subslide: separator.subslide,
            layout: separator.layout || 'single',
            metadata: separator.metadata || {},
            separatorStart: offset,
            separatorEnd: offset + lineLength,
            separatorLine: i + 1,
            marker: separator.marker,
          };
          pendingExplicit = true;
          start = offset + lineLength;
          startLine = i + 2;
          offset += lineLength;
          continue;
        }
      }
      offset += lineLength;
    }

    // Empty documents still represent one empty slide. A trailing/leading
    // explicit separator also represents a slide even when its body is empty.
    commit(text.length, pendingExplicit || ranges.length === 0);
    return ranges;
  }

  /**
   * Derive a navigation label without requiring a successful full parse.
   * This keeps Markdown navigation useful while the user is temporarily
   * editing syntactically incomplete content.
   */
  function fallbackLabel(chunk, index) {
    const source = notes.split(chunk).body;
    const lines = source.split(/\r?\n/);
    let fence = '';
    for (const line of lines) {
      const marker = directives.fenceMarker(line);
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = '';
        continue;
      }
      if (marker) { fence = marker; continue; }
      const heading = line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/);
      if (heading) return heading[1].replace(/[*_`~]/g, '').trim();
    }

    const image = source.match(/!\[([^\]]+)\]\(/);
    if (image) return image[1].trim();

    for (const raw of lines) {
      const line = raw.trim();
      if (!line || /^<!--|^:::/i.test(line) || /^\\[[(]/.test(line)) continue;
      return line.replace(/^[-*+>]\s*/, '').replace(/[*_`~]/g, '').slice(0, 70)
        || `Slide ${index + 1}`;
    }
    return `Slide ${index + 1}`;
  }

  app.serialization.deck = Object.freeze({
    parseSeparator,
    formatSeparator,
    validateSeparators,
    scanSlideRanges,
    fallbackLabel,
    supportedMetadata: Object.freeze(Array.from(SUPPORTED_METADATA)),
  });
})(window);
