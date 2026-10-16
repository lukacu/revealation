/**
 * Revealation — layout block model and Markdown validation
 * ========================================================
 *
 * Purpose
 * -------
 * Implement the structural contract for slide-level layouts. Layout identity
 * belongs to the slide separator (`--- layout=<id>` / `-- layout=<id>`), while
 * slide content contains only positional `::: block` children.
 *
 * Responsibilities
 * ----------------
 * - validate positional `::: block` children against a selected slide layout;
 * - parse canonical block content without guessing missing/extra slots;
 * - RV-COMPAT(layout-wrapper): read the old `::: layout <id>` wrapper for migration only;
 * - project persistent positional block HTML to/from canonical `.sr-layout` DOM;
 * - decorate layout DOM for protected WYSIWYG editing;
 * - guard destructive browser edits at slot boundaries.
 *
 * Does NOT
 * --------
 * - parse slide separators or slide metadata (serialization/deck owns that);
 * - decide which layout ids exist (registry owns that);
 * - parse normal Markdown inside a block;
 * - persist deck state;
 * - silently repair malformed structures.
 *
 * Safety invariant
 * ----------------
 * Positional slot assignment happens only after exact structural validation.
 * Missing/extra blocks are errors; their meaning is never guessed.
 *
 * Public API
 * ----------
 * `Revealation.layout.blocks.validateSlideMarkdown(markdown, layoutId, options?)`
 * `Revealation.layout.blocks.parseSlide(markdown, layoutId)`
 * `Revealation.layout.blocks.parseLegacyLayout(markdown)`
 * `Revealation.layout.blocks.createElement(spec, renderBlockHtml)`
 * `Revealation.layout.blocks.createElementFromHtml(layoutId, blocks)`
 * `Revealation.layout.blocks.htmlBlocksFromCanonicalElement(element)`
 * `Revealation.layout.blocks.createEmptyElement(layoutId)`
 * `Revealation.layout.blocks.transferContent(fromLayoutId, toLayoutId, source)`
 * `Revealation.layout.blocks.slotInitialHtml(slotDefinition)`
 * `Revealation.layout.blocks.retemplateElement(element, layoutId)`
 * `Revealation.layout.blocks.fromCanonicalElement(element)`
 * `Revealation.layout.blocks.decorateEditor(root)`
 * `Revealation.layout.blocks.undecorateEditor(root)`
 * `Revealation.layout.blocks.guardBeforeInput(event, editorRoot)`
 */
(function registerLayoutBlocks(global) {
  'use strict';

  const app = global.Revealation;
  const registry = app?.layout;
  const directives = app?.serialization?.directives;
  const notesParser = app?.serialization?.notes;
  if (!registry || !directives || !notesParser) throw new Error('Layout blocks require directive and speaker-note serialization primitives.');

  // RV-COMPAT(layout-wrapper): REMOVE BEFORE PUBLIC RELEASE.
  // `::: layout` is intentionally legacy-only. Canonical Markdown stores the
  // layout id on the slide separator and contains only `::: block` children.
  const LEGACY_LAYOUT_RE = /^\s*:::\s+layout\s+([a-z][a-z0-9-]*)\s*$/i;
  const BLOCK_RE = /^\s*:::\s+block(?:\s+align=(left|center|right))?\s*$/i;
  const CLOSE_RE = /^\s*:::\s*$/;
  const ANY_OPEN_RE = /^\s*:::\s+\S/;
  const SLIDE_ATTR_RE = /^\s*<!--\s*\.slide:[\s\S]*?-->\s*$/;

  function diagnostic(line, code, message, severity = 'error') {
    return { line, code, message, severity };
  }

  function findMatchingClose(lines, start, limit = lines.length) {
    let depth = 1;
    let fence = '';
    for (let i = start + 1; i < limit; i += 1) {
      const line = lines[i];
      const marker = directives.fenceMarker(line);
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = '';
        continue;
      }
      if (marker) { fence = marker; continue; }
      if (ANY_OPEN_RE.test(line)) depth += 1;
      else if (CLOSE_RE.test(line)) {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  function blockCountMessage(def, count) {
    return `Layout "${def.id}" expects ${def.slots.length} block${def.slots.length === 1 ? '' : 's'}, found ${count}.`;
  }

  /**
   * Parse only the canonical block list for one slide. `layoutId` comes from
   * the slide separator and is therefore not repeated in the content.
   */
  function parseCanonicalBlocks(markdown, layoutId, lineOffset = 0) {
    const id = String(layoutId || 'single');
    const def = registry.get(id);
    const separated = notesParser.split(markdown, { lineOffset });
    const lines = String(separated.body || '').split(/\r?\n/);
    const diagnostics = [...separated.diagnostics];
    if (!def) {
      diagnostics.push(diagnostic(lineOffset + 1, 'unknown-layout', `Unknown layout "${id}".`));
      return { definition: null, blocks: [], diagnostics };
    }

    // The implicit single layout is ordinary Markdown and intentionally has
    // no `::: block` wrapper. A block wrapper without a multi-block layout is
    // structural noise and is rejected.
    if (id === 'single') {
      let fence = '';
      const stack = [];
      for (let i = 0; i < lines.length; i += 1) {
        const raw = lines[i];
        const marker = directives.fenceMarker(raw);
        if (fence) {
          if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = '';
          continue;
        }
        if (marker) { fence = marker; continue; }
        if (BLOCK_RE.test(raw) && stack.length === 0) {
          diagnostics.push(diagnostic(lineOffset + i + 1, 'block-with-single-layout', '`::: block` requires a multi-block slide layout.'));
          continue;
        }
        if (LEGACY_LAYOUT_RE.test(raw) && stack.length === 0) continue; // handled by legacy migration path
        if (ANY_OPEN_RE.test(raw)) stack.push(i);
        else if (CLOSE_RE.test(raw) && stack.length) stack.pop();
      }
      return { definition: def, blocks: [], diagnostics };
    }

    const blocks = [];
    let i = 0;
    while (i < lines.length) {
      const raw = lines[i];
      if (!raw.trim() || SLIDE_ATTR_RE.test(raw)) { i += 1; continue; }

      const head = raw.match(BLOCK_RE);
      if (!head) {
        diagnostics.push(diagnostic(
          lineOffset + i + 1,
          'layout-content-outside-block',
          `Layout "${id}" content must be inside positional \`::: block\` children.`
        ));
        i += 1;
        continue;
      }
      const end = findMatchingClose(lines, i);
      if (end < 0) {
        diagnostics.push(diagnostic(lineOffset + i + 1, 'unclosed-block', 'Unclosed layout block.'));
        break;
      }
      blocks.push({
        raw: lines.slice(i + 1, end).join('\n'),
        align: (head[1] || 'left').toLowerCase(),
        line: lineOffset + i + 1,
      });
      i = end + 1;
    }

    if (blocks.length !== def.slots.length) {
      diagnostics.push(diagnostic(lineOffset + 1, 'block-count', blockCountMessage(def, blocks.length)));
    }
    return { definition: def, blocks, diagnostics };
  }

  function validateSlideMarkdown(markdown, layoutId = 'single', options = {}) {
    const lineOffset = Number(options.lineOffset) || 0;
    const legacy = parseLegacyLayout(markdown, { lineOffset, diagnosticsOnly: true });
    if (legacy.detected) return legacy.diagnostics;
    return parseCanonicalBlocks(markdown, layoutId, lineOffset).diagnostics;
  }

  function parseSlide(markdown, layoutId = 'single') {
    const parsed = parseCanonicalBlocks(markdown, layoutId, 0);
    const errors = parsed.diagnostics.filter(item => item.severity === 'error');
    if (errors.length) {
      const first = errors[0];
      const err = new Error(`Line ${first.line}: ${first.message}`);
      err.diagnostics = parsed.diagnostics;
      throw err;
    }
    return {
      id: String(layoutId || 'single'),
      definition: parsed.definition,
      blocks: parsed.blocks,
    };
  }

  /**
   * Read the Revealation 3.1–3.3 wrapper format. This exists only so old decks
   * can be opened and rewritten to separator metadata on their next save.
   */
  // RV-COMPAT(layout-wrapper): REMOVE BEFORE PUBLIC RELEASE.
  function parseLegacyLayout(markdown, options = {}) {
    const lineOffset = Number(options.lineOffset) || 0;
    const separated = notesParser.split(markdown, { lineOffset });
    const lines = String(separated.body || '').split(/\r?\n/);
    let first = 0;
    while (first < lines.length && !lines[first].trim()) first += 1;
    if (first < lines.length && SLIDE_ATTR_RE.test(lines[first])) {
      first += 1;
      while (first < lines.length && !lines[first].trim()) first += 1;
    }
    const head = lines[first]?.match(LEGACY_LAYOUT_RE);
    if (!head) return { detected: false, diagnostics: [], spec: null };

    const id = head[1].toLowerCase();
    const def = registry.get(id);
    const diagnostics = [...separated.diagnostics];
    if (!def) diagnostics.push(diagnostic(lineOffset + first + 1, 'unknown-layout', `Unknown layout "${id}".`));
    const end = findMatchingClose(lines, first);
    if (end < 0) {
      diagnostics.push(diagnostic(lineOffset + first + 1, 'unclosed-layout', `Unclosed legacy layout "${id}".`));
      return { detected: true, diagnostics, spec: null };
    }
    const trailing = lines.slice(end + 1);
    const firstTrailing = trailing.findIndex(line => line.trim());
    if (firstTrailing >= 0) {
      diagnostics.push(diagnostic(lineOffset + end + firstTrailing + 2, 'legacy-layout-mixed-content', 'Legacy layout must occupy the complete visual slide body.'));
    }

    const blocks = [];
    let pos = first + 1;
    while (pos < end) {
      if (!lines[pos].trim()) { pos += 1; continue; }
      const blockHead = lines[pos].match(BLOCK_RE);
      if (!blockHead) {
        diagnostics.push(diagnostic(lineOffset + pos + 1, 'layout-content-outside-block', 'Legacy layout content must be inside `::: block` children.'));
        pos += 1;
        continue;
      }
      const blockEnd = findMatchingClose(lines, pos, end + 1);
      if (blockEnd < 0 || blockEnd > end) {
        diagnostics.push(diagnostic(lineOffset + pos + 1, 'unclosed-block', 'Unclosed legacy layout block.'));
        break;
      }
      blocks.push({
        raw: lines.slice(pos + 1, blockEnd).join('\n'),
        align: (blockHead[1] || 'left').toLowerCase(),
      });
      pos = blockEnd + 1;
    }
    if (def && blocks.length !== def.slots.length) {
      diagnostics.push(diagnostic(lineOffset + first + 1, 'block-count', blockCountMessage(def, blocks.length)));
    }
    const spec = def && !diagnostics.some(d => d.severity === 'error')
      ? { id, definition: def, blocks, start: first, end }
      : null;
    return { detected: true, diagnostics, spec };
  }

  function toMarkdownBlocks(spec, serializeBlock) {
    const def = typeof spec?.definition === 'object' ? spec.definition : registry.get(spec?.id);
    if (!def || !Array.isArray(spec?.blocks) || spec.blocks.length !== def.slots.length) {
      throw new Error('Cannot serialize invalid layout block structure.');
    }
    if (typeof serializeBlock !== 'function') throw new Error('Layout block serializer callback is required.');
    return spec.blocks.map((block, index) => {
      const body = String(serializeBlock(block, index) || '').trim();
      const align = String(block.align || 'left');
      const head = `::: block${align !== 'left' ? ` align=${align}` : ''}`;
      return `${head}\n${body}\n:::`;
    }).join('\n\n');
  }

  function slotInitialHtml(slotDefinition) {
    const tag = String(slotDefinition?.initialBlock || 'p').toLowerCase();
    return `<${tag}><br></${tag}>`;
  }

  function htmlHasMeaningfulContent(html) {
    const holder = document.createElement('div');
    holder.innerHTML = String(html || '');
    if (String(holder.textContent || '').trim()) return true;
    return !!holder.querySelector('img,video,audio,iframe,svg,canvas,hr,table,.sr-interactive,.sr-html-block,.sr-math');
  }

  function ensureSlotScaffold(content, slotDefinition) {
    if (!content) return;
    if (htmlHasMeaningfulContent(content.innerHTML)) return;
    content.innerHTML = slotInitialHtml(slotDefinition);
  }

  function mergeHtmlBlocks(blocks) {
    const holder = document.createElement('div');
    blocks.forEach(block => {
      const html = String(block?.html || '');
      if (!htmlHasMeaningfulContent(html)) return;
      const part = document.createElement('div');
      part.innerHTML = html;
      while (part.firstChild) holder.appendChild(part.firstChild);
    });
    return holder.innerHTML;
  }

  /**
   * Transfer slide content between layouts without positional data loss.
   *
   * Slot ids are semantic keys. Same-name fields transfer directly. Source
   * fields with no name match are merged, in their original source order, into
   * the target layout's single master slot. Empty target fields receive only an
   * editor scaffold (for example an H1 in a header field); scaffold markup is
   * intentionally content-free and therefore disappears from Markdown.
   */
  function transferContent(fromLayoutId, toLayoutId, source = {}) {
    const from = registry.get(fromLayoutId);
    const to = registry.get(toLayoutId);
    const plan = registry.transferPlan?.(fromLayoutId, toLayoutId);
    if (!from || !to || !plan) return null;

    let sourceBlocks;
    if (from.id === 'single') {
      sourceBlocks = [{ html: String(source.singleHtml ?? source.html ?? ''), align: 'left' }];
    } else {
      if (!Array.isArray(source.blocks) || source.blocks.length !== from.slots.length) return null;
      sourceBlocks = source.blocks.map(block => ({
        html: String(block?.html || ''),
        align: /^(left|center|right)$/.test(String(block?.align || 'left')) ? String(block.align || 'left') : 'left',
      }));
    }

    const targetBlocks = plan.targets.map(({ slot, sourceIndexes }) => {
      const contributions = sourceIndexes.map(index => sourceBlocks[index]).filter(Boolean);
      const meaningful = contributions.filter(block => htmlHasMeaningfulContent(block.html));
      const html = meaningful.length ? mergeHtmlBlocks(meaningful) : slotInitialHtml(slot);
      let align = 'left';
      if (meaningful.length) {
        const first = meaningful[0].align || 'left';
        if (meaningful.every(block => (block.align || 'left') === first)) align = first;
      }
      return { html, align };
    });

    if (to.id === 'single') {
      return { layout: 'single', content: targetBlocks[0]?.html || slotInitialHtml(to.slots[0]), blocks: null };
    }
    return { layout: to.id, content: '', blocks: targetBlocks };
  }

  function createElement(spec, renderBlockHtml) {
    const def = typeof spec.definition === 'object' ? spec.definition : registry.get(spec.id);
    if (!def || !Array.isArray(spec.blocks) || spec.blocks.length !== def.slots.length) return null;
    const wrap = document.createElement('div');
    registry.applyToElement(wrap, def);
    spec.blocks.forEach((block, index) => {
      const slotDef = def.slots[index];
      const slot = document.createElement('div');
      slot.className = 'sr-layout-slot';
      slot.dataset.slot = slotDef.id;
      slot.style.gridArea = slotDef.id;
      const content = document.createElement('div');
      content.className = 'sr-layout-content';
      if (block.align && block.align !== 'left') content.classList.add(`sr-align-${block.align}`);
      content.innerHTML = renderBlockHtml(block.raw.trim());
      ensureSlotScaffold(content, slotDef);
      slot.appendChild(content);
      wrap.appendChild(slot);
    });
    return wrap;
  }

  function fromCanonicalElement(element) {
    if (!element || element.nodeName !== 'DIV' || !element.classList.contains('sr-layout')) return null;
    const id = element.dataset.layout || '';
    const def = registry.get(id);
    if (!def) return null;
    const slots = Array.from(element.children);
    if (slots.length !== def.slots.length) return null;
    const blocks = [];
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i];
      const expected = def.slots[i];
      if (!slot.classList.contains('sr-layout-slot') || slot.dataset.slot !== expected.id) return null;
      const content = slot.children.length === 1 ? slot.firstElementChild : null;
      if (!content?.classList.contains('sr-layout-content')) return null;
      const alignClass = Array.from(content.classList).find(cls => /^sr-align-(left|center|right)$/.test(cls));
      blocks.push({ node: content, align: alignClass ? alignClass.slice('sr-align-'.length) : 'left' });
    }
    return { id, definition: def, blocks };
  }


  /**
   * Create canonical protected layout DOM from already-rendered block HTML.
   * This is the inverse of `htmlBlocksFromCanonicalElement()` and is used by
   * the slide model so WYSIWYG DOM is only a projection, never the source of
   * truth for block identity.
   */
  function createElementFromHtml(layoutId, blocks) {
    const def = registry.get(layoutId);
    if (!def || !Array.isArray(blocks) || blocks.length !== def.slots.length) return null;
    return createElement({
      id: def.id,
      definition: def,
      blocks: blocks.map(block => ({
        raw: String(block?.html || ''),
        align: String(block?.align || 'left'),
      })),
    }, html => html);
  }

  /**
   * Extract persistent block content from canonical protected layout DOM.
   * Returned objects contain only serializable data; live DOM nodes stay an
   * editor implementation detail.
   */
  function htmlBlocksFromCanonicalElement(element) {
    const spec = fromCanonicalElement(element);
    if (!spec) return null;
    return {
      id: spec.id,
      definition: spec.definition,
      blocks: spec.blocks.map(block => ({
        html: block.node.innerHTML,
        align: block.align || 'left',
      })),
    };
  }

  function createEmptyElement(layoutId) {
    const def = registry.get(layoutId);
    if (!def) return null;
    return createElement({
      id: def.id,
      definition: def,
      blocks: def.slots.map(slot => ({ raw: slotInitialHtml(slot), align: 'left' })),
    }, html => html);
  }

  function retemplateElement(element, layoutId) {
    const current = fromCanonicalElement(element);
    const next = registry.get(layoutId);
    if (!current || !next || next.id === 'single') return false;
    const moved = transferContent(current.id, next.id, {
      blocks: current.blocks.map(block => ({ html: block.node.innerHTML, align: block.align || 'left' })),
    });
    if (!moved?.blocks) return false;
    const replacement = createElementFromHtml(next.id, moved.blocks);
    if (!replacement) return false;
    registry.applyToElement(element, next);
    element.replaceChildren(...Array.from(replacement.childNodes));
    return true;
  }

  function decorateEditor(root) {
    if (!root) return;
    const layouts = root.classList?.contains('sr-layout')
      ? [root, ...root.querySelectorAll('.sr-layout')]
      : Array.from(root.querySelectorAll('.sr-layout'));
    layouts.forEach(layout => {
      layout.setAttribute('contenteditable', 'false');
      const def = registry.get(layout.dataset.layout || '');
      layout.querySelectorAll(':scope > .sr-layout-slot > .sr-layout-content').forEach(content => {
        const slot = content.parentElement;
        const slotDef = def?.slots.find(item => item.id === slot?.dataset.slot);
        if (slotDef) {
          ensureSlotScaffold(content, slotDef);
          content.dataset.initialBlock = slotDef.initialBlock;
          content.dataset.master = slotDef.master ? 'true' : 'false';
        }
        content.setAttribute('contenteditable', 'true');
        content.setAttribute('spellcheck', 'true');
      });
    });
  }

  function undecorateEditor(root) {
    if (!root) return;
    const nodes = [];
    if (root.classList?.contains('sr-layout') || root.classList?.contains('sr-layout-content')) nodes.push(root);
    nodes.push(...root.querySelectorAll('.sr-layout, .sr-layout-content'));
    nodes.forEach(node => {
      node.removeAttribute('contenteditable');
      node.removeAttribute('spellcheck');
      node.removeAttribute('data-initial-block');
      node.removeAttribute('data-master');
    });
  }

  function fragmentHasMeaningfulContent(fragment) {
    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.nodeType === Node.TEXT_NODE && node.nodeValue.trim()) return true;
      if (node.nodeType === Node.ELEMENT_NODE && /^(IMG|VIDEO|AUDIO|IFRAME|SVG|CANVAS|HR|TABLE)$/.test(node.nodeName)) return true;
    }
    return false;
  }

  function rangeSideHasContent(host, range, side) {
    const probe = document.createRange();
    probe.selectNodeContents(host);
    try {
      if (side === 'before') probe.setEnd(range.startContainer, range.startOffset);
      else probe.setStart(range.endContainer, range.endOffset);
    } catch {
      return true;
    }
    return fragmentHasMeaningfulContent(probe.cloneContents());
  }

  function rangeContainsLayout(range) {
    if (!range || range.collapsed) return false;
    try {
      return !!range.cloneContents().querySelector?.('.sr-layout');
    } catch (_) {
      return true;
    }
  }

  function adjacentNodeFromCaret(range, editorRoot, direction) {
    if (!range?.collapsed) return null;
    let node = range.startContainer;
    let offset = range.startOffset;

    if (node.nodeType === Node.TEXT_NODE) {
      const textLength = String(node.nodeValue || '').length;
      if (direction === 'backward' && offset > 0) return null;
      if (direction === 'forward' && offset < textLength) return null;
      offset = direction === 'backward' ? Array.prototype.indexOf.call(node.parentNode.childNodes, node) : Array.prototype.indexOf.call(node.parentNode.childNodes, node) + 1;
      node = node.parentNode;
    }

    while (node && node !== editorRoot) {
      const siblings = node.childNodes || [];
      const candidate = direction === 'backward' ? siblings[offset - 1] : siblings[offset];
      if (candidate) return candidate;
      const parent = node.parentNode;
      if (!parent) break;
      const index = Array.prototype.indexOf.call(parent.childNodes, node);
      offset = direction === 'backward' ? index : index + 1;
      node = parent;
    }

    if (node === editorRoot) {
      const candidate = direction === 'backward' ? node.childNodes[offset - 1] : node.childNodes[offset];
      return candidate || null;
    }
    return null;
  }

  function nodeIsProtectedLayout(node) {
    if (!node) return false;
    if (node.nodeType === Node.ELEMENT_NODE) {
      return node.classList.contains('sr-layout') || !!node.querySelector?.('.sr-layout');
    }
    return false;
  }

  function guardBeforeInput(event, editorRoot) {
    if (!event || !editorRoot) return false;
    const sel = global.getSelection?.();
    if (!sel || !sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    const startEl = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement;
    const endEl = range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
    const startHost = startEl?.closest?.('.sr-layout-content');
    const endHost = endEl?.closest?.('.sr-layout-content');
    const activeLayout = editorRoot.querySelector?.(':scope > .sr-layout');

    // With a multi-block layout active, the editor root is structural space,
    // not another editable body. All typing/paste/delete must happen inside
    // exactly one slot host.
    if (activeLayout && (!startHost || !endHost)) {
      event.preventDefault();
      return true;
    }

    // A browser selection can start/end outside all slot hosts yet still span
    // a protected layout as an atomic contenteditable=false object. Replacing
    // such a selection would silently destroy structure, so reject it.
    if (rangeContainsLayout(range)) {
      event.preventDefault();
      return true;
    }

    if (startHost || endHost) {
      if (!startHost || startHost !== endHost) {
        event.preventDefault();
        return true;
      }
      if (!range.collapsed) return false;
      if (event.inputType === 'deleteContentBackward' && !rangeSideHasContent(startHost, range, 'before')) {
        event.preventDefault();
        return true;
      }
      if (event.inputType === 'deleteContentForward' && !rangeSideHasContent(startHost, range, 'after')) {
        event.preventDefault();
        return true;
      }
      return false;
    }

    // contenteditable=false makes a layout atomic to Chromium; Backspace/Delete
    // immediately next to it would otherwise remove the whole tree. Structural
    // deletion must be an explicit Revealation command, never a typing side effect.
    if (range.collapsed && event.inputType === 'deleteContentBackward'
        && nodeIsProtectedLayout(adjacentNodeFromCaret(range, editorRoot, 'backward'))) {
      event.preventDefault();
      return true;
    }
    if (range.collapsed && event.inputType === 'deleteContentForward'
        && nodeIsProtectedLayout(adjacentNodeFromCaret(range, editorRoot, 'forward'))) {
      event.preventDefault();
      return true;
    }
    return false;
  }

  app.layout.blocks = Object.freeze({
    validateSlideMarkdown,
    parseSlide,
    // RV-COMPAT(layout-wrapper): REMOVE BEFORE PUBLIC RELEASE.
    parseLegacyLayout,
    toMarkdownBlocks,
    createElement,
    createElementFromHtml,
    htmlBlocksFromCanonicalElement,
    createEmptyElement,
    transferContent,
    slotInitialHtml,
    retemplateElement,
    fromCanonicalElement,
    decorateEditor,
    undecorateEditor,
    guardBeforeInput,
  });
})(window);
