/**
 * Revealation — WYSIWYG content normalization
 * ===========================================
 *
 * Purpose
 * -------
 * Keep browser-generated rich-text DOM inside Revealation's canonical content
 * model so WYSIWYG edits round-trip to readable Markdown instead of leaking
 * incidental Chromium `<div>` wrappers as raw HTML.
 *
 * Responsibilities
 * ----------------
 * - request `<p>` as the browser's default paragraph separator;
 * - normalize attribute-free browser paragraph `<div>` wrappers before save;
 * - sanitize rich HTML and normalize plain text at the paste boundary;
 * - unwrap attribute-free grouping `<div>` wrappers around real block nodes;
 * - leave structured Revealation nodes and authored attributed HTML untouched.
 *
 * Does NOT
 * --------
 * - parse Markdown;
 * - mutate layout structure or slot order;
 * - strip classes/styles from authored elements;
 * - decide whether arbitrary raw HTML is safe or valid.
 *
 * Canonicalization rule
 * ---------------------
 * Only attribute-free `<div>` elements directly inside a known rich-text host
 * are candidates. Inline-only wrappers become `<p>`; wrappers containing only
 * block children are unwrapped. A `<div>` carrying any attribute is preserved
 * verbatim so intentional/custom HTML remains lossless.
 *
 * Public API
 * ----------
 * `Revealation.editor.contentNormalization.setDefaultParagraphSeparator()`
 * `Revealation.editor.contentNormalization.normalizeForSerialization(root, options?)`
 * `Revealation.editor.contentNormalization.sanitizePastedHtml(html)`
 * `Revealation.editor.contentNormalization.plainTextToHtml(text)`
 * `Revealation.editor.contentNormalization.toInlinePasteHtml(html)`
 */
(function registerContentNormalization(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  const HOST_SELECTOR = [
    '.sr-layout-content',
    // RV-COMPAT(columns-directive): REMOVE old `.sr-col` host BEFORE PUBLIC RELEASE.
    '.sr-col',
    '.sr-align-left',
    '.sr-align-center',
    '.sr-align-right',
    // RV-COMPAT(align-shorthand): REMOVE old `.sr-center` host BEFORE PUBLIC RELEASE.
    '.sr-center',
  ].join(',');

  const BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CANVAS', 'DL', 'FIELDSET',
    'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5',
    'H6', 'HEADER', 'HR', 'IFRAME', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION',
    'TABLE', 'UL', 'VIDEO', 'AUDIO',
  ]);

  // HTML pasted from office applications and browsers is usually much richer
  // than the small DOM vocabulary that Revealation can serialize to Markdown.
  // Keep this list deliberately narrower than the HTML parser's vocabulary:
  // unsupported formatting is either unwrapped or discarded at the paste
  // boundary instead of becoming a permanent conversion error later.
  const PASTE_ALLOWED_TAGS = new Set([
    'A', 'BLOCKQUOTE', 'BR', 'CODE', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'HR', 'IMG', 'LI', 'OL', 'P', 'PRE', 'STRONG', 'TABLE', 'TBODY', 'TD',
    'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
  ]);
  const PASTE_REMOVE_TAGS = new Set([
    'AUDIO', 'CANVAS', 'EMBED', 'FORM', 'IFRAME', 'OBJECT', 'SCRIPT', 'STYLE',
    'SVG', 'VIDEO',
  ]);
  const PASTE_BLOCK_TAGS = new Set([
    'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'LI', 'OL', 'P',
    'PRE', 'TABLE', 'TR', 'UL',
  ]);
  const PASTE_BLOCK_WRAPPERS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'DD', 'DIV', 'DL', 'DT', 'FIGURE', 'FOOTER',
    'HEADER', 'MAIN', 'NAV', 'SECTION',
  ]);
  function isSafePasteUrl(value, { image = false } = {}) {
    const source = String(value || '').trim();
    if (!source) return false;
    if (source.startsWith('#') || source.startsWith('/') || source.startsWith('./') || source.startsWith('../')) return true;
    if (/^https?:\/\//i.test(source)) return true;
    if (/^mailto:/i.test(source) && !image) return true;
    if (/^tel:/i.test(source) && !image) return true;
    if (image && /^data:image\/(?:gif|jpe?g|png|webp|svg\+xml);/i.test(source)) return true;
    return false;
  }

  function copyPasteAttributes(source, target) {
    const tag = source.nodeName;
    if (tag === 'A') {
      const href = source.getAttribute('href');
      if (isSafePasteUrl(href)) target.setAttribute('href', href.trim());
      const title = source.getAttribute('title');
      if (title) target.setAttribute('title', title);
      return;
    }
    if (tag === 'IMG') {
      const src = source.getAttribute('src');
      if (isSafePasteUrl(src, { image: true })) target.setAttribute('src', src.trim());
      const alt = source.getAttribute('alt');
      const title = source.getAttribute('title');
      if (alt) target.setAttribute('alt', alt);
      if (title) target.setAttribute('title', title);
      return;
    }
    if (tag === 'CODE') {
      const language = Array.from(source.classList || []).find(name => /^language-[a-z0-9_-]+$/i.test(name));
      if (language) target.setAttribute('class', language);
      return;
    }
    if (tag === 'TH' || tag === 'TD') {
      const align = String(source.getAttribute('align') || '').toLowerCase();
      if (['left', 'center', 'right'].includes(align)) target.setAttribute('align', align);
    }
  }

  function appendPasteChildren(source, target, doc) {
    for (const child of Array.from(source.childNodes || [])) {
      if (child.nodeType === Node.TEXT_NODE) {
        target.appendChild(doc.createTextNode(child.nodeValue || ''));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.nodeName;
      if (PASTE_REMOVE_TAGS.has(tag)) continue;

      // Common formatting aliases are safe to normalize rather than unwrap.
      const canonicalTag = tag === 'B' ? 'STRONG' : tag === 'I' ? 'EM' : tag;
      if (!PASTE_ALLOWED_TAGS.has(canonicalTag)) {
        if (!PASTE_BLOCK_WRAPPERS.has(tag)) {
          appendPasteChildren(child, target, doc);
          continue;
        }

        // Preserve paragraph boundaries from common `<div>line</div>` and
        // office section wrappers. Inline-only wrapper content becomes one
        // paragraph; nested block content is appended as-is so nested DIVs do
        // not collapse `one` and `two` into a single text node.
        const fragment = doc.createDocumentFragment();
        appendPasteChildren(child, fragment, doc);
        const meaningful = Array.from(fragment.childNodes).filter(node =>
          node.nodeType !== Node.TEXT_NODE || String(node.nodeValue || '').trim());
        const hasBlock = meaningful.some(node =>
          node.nodeType === Node.ELEMENT_NODE && PASTE_BLOCK_TAGS.has(node.nodeName));
        if (!hasBlock && meaningful.length) {
          const paragraph = doc.createElement('p');
          paragraph.appendChild(fragment);
          target.appendChild(paragraph);
        } else {
          target.appendChild(fragment);
        }
        continue;
      }

      // A pasted image without a usable source would otherwise create a
      // broken atomic node that the editor cannot meaningfully repair.
      if (canonicalTag === 'IMG' && !isSafePasteUrl(child.getAttribute('src'), { image: true })) continue;

      const clean = doc.createElement(canonicalTag.toLowerCase());
      copyPasteAttributes(child, clean);
      appendPasteChildren(child, clean, doc);
      target.appendChild(clean);
    }
  }

  function sanitizePastedHtml(html) {
    const source = String(html || '').trim();
    if (!source || typeof global.DOMParser !== 'function') return '';
    const parsed = new global.DOMParser().parseFromString(source, 'text/html');
    const clean = parsed.body.ownerDocument.createElement('div');
    appendPasteChildren(parsed.body, clean, clean.ownerDocument);
    // Turn browser/office DIV paragraphs into the same canonical paragraphs
    // used by normal contenteditable input. This also unwraps harmless
    // attribute-free grouping DIVs left by clipboard producers.
    normalizeForSerialization(clean);
    return clean.innerHTML;
  }

  function plainTextToHtml(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    return lines.map(line => {
      const p = global.document.createElement('p');
      if (line) p.textContent = line;
      else p.appendChild(global.document.createElement('br'));
      return p.outerHTML;
    }).join('');
  }


  function renameElement(node, tagName) {
    if (!node?.parentNode) return null;
    const replacement = node.ownerDocument.createElement(tagName);
    for (const attr of Array.from(node.attributes || [])) replacement.setAttribute(attr.name, attr.value);
    while (node.firstChild) replacement.appendChild(node.firstChild);
    node.replaceWith(replacement);
    return replacement;
  }

  function normalizeInlineAliases(root) {
    root.querySelectorAll?.('b:not([class]):not([style]), i:not([class]):not([style])').forEach(node => {
      if (node.attributes.length) return;
      renameElement(node, node.nodeName === 'B' ? 'strong' : 'em');
    });
  }

  function normalizeList(list) {
    if (!list || !/^(UL|OL)$/.test(list.nodeName)) return;
    let previousLi = null;
    for (const node of Array.from(list.childNodes || [])) {
      if (isWhitespaceText(node)) continue;
      if (node.nodeType === Node.ELEMENT_NODE && node.nodeName === 'LI') {
        previousLi = node;
        continue;
      }
      // Browser editing and some clipboard producers place a nested list as a
      // sibling of its parent LI. Canonical HTML nests it inside that LI.
      if (node.nodeType === Node.ELEMENT_NODE && /^(UL|OL)$/.test(node.nodeName) && previousLi) {
        previousLi.appendChild(node);
        continue;
      }
      // Any other direct list child is invalid HTML. Keep the content, but put
      // it inside a list item so Turndown and subsequent browser edits agree on
      // one structure.
      const li = list.ownerDocument.createElement('li');
      list.insertBefore(li, node);
      li.appendChild(node);
      previousLi = li;
    }
  }

  function inlineClone(source, target, doc) {
    for (const child of Array.from(source.childNodes || [])) {
      if (child.nodeType === Node.TEXT_NODE) {
        target.appendChild(doc.createTextNode(child.nodeValue || ''));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = child.nodeName;
      const canonicalTag = tag === 'B' ? 'STRONG' : tag === 'I' ? 'EM' : tag;
      if (['STRONG', 'EM', 'CODE', 'A'].includes(canonicalTag)) {
        const clean = doc.createElement(canonicalTag.toLowerCase());
        copyPasteAttributes(child, clean);
        inlineClone(child, clean, doc);
        target.appendChild(clean);
      } else if (canonicalTag === 'IMG') {
        if (!isSafePasteUrl(child.getAttribute('src'), { image: true })) continue;
        const clean = doc.createElement('img');
        copyPasteAttributes(child, clean);
        target.appendChild(clean);
      } else if (canonicalTag === 'BR') {
        target.appendChild(doc.createElement('br'));
      } else {
        inlineClone(child, target, doc);
        if (PASTE_BLOCK_TAGS.has(tag) || PASTE_BLOCK_WRAPPERS.has(tag)) {
          const last = target.lastChild;
          if (!last || last.nodeName !== 'BR') target.appendChild(doc.createElement('br'));
        }
      }
    }
  }

  function toInlinePasteHtml(html) {
    const source = String(html || '');
    if (!source || typeof global.DOMParser !== 'function') return '';
    const parsed = new global.DOMParser().parseFromString(source, 'text/html');
    const clean = parsed.body.ownerDocument.createElement('div');
    inlineClone(parsed.body, clean, clean.ownerDocument);
    while (clean.lastChild?.nodeName === 'BR') clean.lastChild.remove();
    return clean.innerHTML;
  }

  function setDefaultParagraphSeparator() {
    try {
      if (global.document?.execCommand) {
        global.document.execCommand('defaultParagraphSeparator', false, 'p');
      }
    } catch (_) {
      // Best effort. Normalization before serialization is the hard guarantee.
    }
  }

  function isWhitespaceText(node) {
    return node?.nodeType === Node.TEXT_NODE && !String(node.nodeValue || '').trim();
  }

  function directContentKind(div) {
    let hasBlock = false;
    let hasInline = false;
    for (const node of Array.from(div.childNodes || [])) {
      if (isWhitespaceText(node)) continue;
      if (node.nodeType === Node.TEXT_NODE) {
        hasInline = true;
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (BLOCK_TAGS.has(node.nodeName) || node.classList?.contains('sr-layout')) hasBlock = true;
      else hasInline = true;
    }
    if (hasBlock && !hasInline) return 'blocks';
    if (!hasBlock) return 'inline';
    return 'mixed';
  }

  function replaceWithParagraph(div) {
    const p = div.ownerDocument.createElement('p');
    while (div.firstChild) p.appendChild(div.firstChild);
    if (!p.childNodes.length) p.appendChild(div.ownerDocument.createElement('br'));
    div.replaceWith(p);
  }

  function unwrap(div) {
    const parent = div.parentNode;
    if (!parent) return;
    const fragment = div.ownerDocument.createDocumentFragment();
    while (div.firstChild) fragment.appendChild(div.firstChild);
    parent.replaceChild(fragment, div);
  }

  function normalizeHost(host) {
    if (!host) return;
    // Multiple passes handle nested browser wrappers such as
    // <div><div>line</div><div>line</div></div> without touching attributed
    // custom containers.
    for (let pass = 0; pass < 12; pass += 1) {
      let changed = false;
      for (const child of Array.from(host.children || [])) {
        if (child.nodeName !== 'DIV' || child.attributes.length !== 0) continue;
        const kind = directContentKind(child);
        if (kind === 'inline') {
          replaceWithParagraph(child);
          changed = true;
        } else if (kind === 'blocks') {
          unwrap(child);
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  function normalizeForSerialization(root, options = {}) {
    if (!root) return root;
    const includeRoot = options.includeRoot !== false;
    normalizeInlineAliases(root);
    root.querySelectorAll?.('ul, ol').forEach(normalizeList);
    // LI is itself a browser editing boundary in practice: Enter/paste can
    // leave attribute-free DIV wrappers inside an otherwise valid list.
    root.querySelectorAll?.('li').forEach(normalizeHost);
    // The live slide editor itself is a rich-text host too; Chromium can create
    // plain DIV paragraphs there. Detached generic HTML holders can opt out so
    // intentionally authored top-level raw <div> markup stays lossless.
    if (includeRoot) normalizeHost(root);
    root.querySelectorAll?.(HOST_SELECTOR).forEach(normalizeHost);
    return root;
  }

  app.editor.contentNormalization = Object.freeze({
    setDefaultParagraphSeparator,
    normalizeForSerialization,
    sanitizePastedHtml,
    plainTextToHtml,
    toInlinePasteHtml,
  });
})(window);
