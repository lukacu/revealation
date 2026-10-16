/**
 * Revealation — deterministic rich-text editing helpers
 * =====================================================
 *
 * Purpose
 * -------
 * Keep the small WYSIWYG vocabulary structurally predictable where browser
 * contenteditable behaviour is either inconsistent or actively unhelpful.
 *
 * Responsibilities
 * ----------------
 * - indent/outdent list items with Tab / Shift+Tab without moving focus;
 * - keep the current DOM Range alive across structural list moves;
 * - identify whether a Range belongs to one concrete editing host;
 * - resolve paragraph-like top-level units touched by a selection;
 * - keep Ctrl/Cmd+A scoped to the current editing host instead of the page.
 *
 * Does NOT
 * --------
 * - own deck state or history;
 * - parse/serialize Markdown;
 * - sanitize external clipboard HTML;
 * - decide which layout slot a paste should target.
 *
 * Public API
 * ----------
 * `Revealation.editor.richText.handleListTab(event, editorRoot, options?)`
 * `Revealation.editor.richText.singleEditingHost(range, editorRoot)`
 * `Revealation.editor.richText.blocksForRange(range, editorRoot)`
 * `Revealation.editor.richText.handleSelectAll(event, editorRoot)`
 */
(function registerRichTextHelpers(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  function elementForBoundary(node, offset, preferPrevious = false) {
    if (!node) return null;
    if (node.nodeType === Node.TEXT_NODE) return node.parentElement;
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    if (node.childNodes?.length) {
      const index = preferPrevious ? Math.max(0, offset - 1) : Math.min(offset, node.childNodes.length - 1);
      const child = node.childNodes[index];
      if (child?.nodeType === Node.TEXT_NODE) return child.parentElement;
      if (child?.nodeType === Node.ELEMENT_NODE) return child;
    }
    return node;
  }

  function concreteHost(node, editorRoot) {
    if (!node || !editorRoot) return null;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element || !(element === editorRoot || editorRoot.contains(element))) return null;
    return element.closest?.('.sr-layout-content[contenteditable="true"]') || editorRoot;
  }

  function singleEditingHost(range, editorRoot) {
    if (!range || !editorRoot) return null;
    const start = concreteHost(elementForBoundary(range.startContainer, range.startOffset), editorRoot);
    const end = concreteHost(elementForBoundary(range.endContainer, range.endOffset, true), editorRoot);
    return start && start === end ? start : null;
  }

  function isAlignmentWrapper(element) {
    return !!(element?.nodeType === Node.ELEMENT_NODE
      && (element.classList.contains('sr-align-left')
        || element.classList.contains('sr-align-center')
        || element.classList.contains('sr-align-right')
        // RV-COMPAT(align-shorthand): REMOVE `.sr-center` BEFORE PUBLIC RELEASE.
        || element.classList.contains('sr-center')));
  }

  // Alignment is paragraph/block-level. When a field contains explicit
  // alignment wrappers, their children are still the semantic units users
  // expect to manipulate independently. Flatten only that one structural
  // layer; lists, paragraphs, figures, headings, etc. remain intact.
  function editingUnits(host) {
    if (!host) return [];
    const units = [];
    Array.from(host.children || []).forEach(child => {
      if (isAlignmentWrapper(child)) units.push(...Array.from(child.children || []));
      else units.push(child);
    });
    return units;
  }

  function unitForBoundary(container, offset, host, preferPrevious = false) {
    if (!container || !host) return null;
    let node = container;
    if (node === host) {
      const children = Array.from(host.childNodes || []);
      if (!children.length) return null;
      let index = preferPrevious ? offset - 1 : offset;
      index = Math.max(0, Math.min(children.length - 1, index));
      node = children[index];
    }
    if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
    if (!(node instanceof Element) || !(node === host || host.contains(node))) return null;
    while (node && node !== host) {
      if (node.parentElement === host) {
        if (isAlignmentWrapper(node)) {
          const children = Array.from(node.children || []);
          return preferPrevious ? children[children.length - 1] || null : children[0] || null;
        }
        return node;
      }
      if (isAlignmentWrapper(node.parentElement) && node.parentElement.parentElement === host) return node;
      node = node.parentElement;
    }
    return null;
  }

  function blocksForRange(range, editorRoot) {
    if (!range || !editorRoot) return [];
    const host = singleEditingHost(range, editorRoot);
    if (!host) return [];
    const start = unitForBoundary(range.startContainer, range.startOffset, host, false);
    if (!start) return [];
    const end = range.collapsed
      ? start
      : (unitForBoundary(range.endContainer, range.endOffset, host, true) || start);
    const units = editingUnits(host);
    const a = units.indexOf(start);
    const b = units.indexOf(end);
    if (a < 0 || b < 0) return [];
    return units.slice(Math.min(a, b), Math.max(a, b) + 1);
  }

  function handleSelectAll(event, editorRoot) {
    if (!event || String(event.key || '').toLowerCase() !== 'a'
        || !(event.ctrlKey || event.metaKey) || event.altKey || !editorRoot) return false;
    const selection = global.getSelection?.();
    if (!selection || !selection.rangeCount) return false;
    const current = selection.getRangeAt(0);
    const host = singleEditingHost(current, editorRoot);
    if (!host) return false;
    event.preventDefault?.();
    event.stopPropagation?.();
    const range = document.createRange();
    range.selectNodeContents(host);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function liFromRange(range, editorRoot) {
    const host = singleEditingHost(range, editorRoot);
    if (!host) return null;
    let node = elementForBoundary(range.startContainer, range.startOffset);
    const li = node?.closest?.('li');
    return li && host.contains(li) ? li : null;
  }

  function previousListItem(li) {
    let previous = li?.previousElementSibling || null;
    while (previous && previous.nodeName !== 'LI') previous = previous.previousElementSibling;
    return previous;
  }

  function nestedList(parentLi, tagName) {
    const children = Array.from(parentLi?.children || []);
    return children.find(child => child.nodeName === tagName) || null;
  }

  function rangeBoundarySnapshot(range, li) {
    if (!range || !li) return null;
    const owns = node => node === li || li.contains(node.nodeType === Node.TEXT_NODE ? node.parentNode : node);
    if (!owns(range.startContainer) || !owns(range.endContainer)) return null;
    return {
      startContainer: range.startContainer,
      startOffset: range.startOffset,
      endContainer: range.endContainer,
      endOffset: range.endOffset,
    };
  }

  function restoreRange(snapshot) {
    if (!snapshot) return;
    try {
      const range = document.createRange();
      range.setStart(snapshot.startContainer, snapshot.startOffset);
      range.setEnd(snapshot.endContainer, snapshot.endOffset);
      const selection = global.getSelection?.();
      if (!selection) return;
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (_) {
      // Content is still safe if a browser invalidates a very unusual range.
    }
  }

  function indentListItem(li) {
    const list = li?.parentElement;
    if (!list || !/^(UL|OL)$/.test(list.nodeName)) return false;
    const previous = previousListItem(li);
    if (!previous) return false;
    let childList = nestedList(previous, list.nodeName);
    if (!childList) {
      childList = li.ownerDocument.createElement(list.nodeName.toLowerCase());
      previous.appendChild(childList);
    }
    childList.appendChild(li);
    return true;
  }

  function outdentListItem(li) {
    const list = li?.parentElement;
    if (!list || !/^(UL|OL)$/.test(list.nodeName)) return false;
    const parentLi = list.parentElement;
    if (!parentLi || parentLi.nodeName !== 'LI') return false;
    const parentList = parentLi.parentElement;
    if (!parentList || !/^(UL|OL)$/.test(parentList.nodeName)) return false;
    parentLi.insertAdjacentElement('afterend', li);
    if (!Array.from(list.children).some(child => child.nodeName === 'LI')) list.remove();
    return true;
  }

  function handleListTab(event, editorRoot, options = {}) {
    if (!event || event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return false;
    const selection = global.getSelection?.();
    if (!selection || !selection.rangeCount) return false;
    const range = selection.getRangeAt(0);
    const li = liFromRange(range, editorRoot);
    if (!li) return false;

    // Once Tab is recognized as a list-editing gesture it must never escape
    // contenteditable and move focus to browser/editor chrome, even when the
    // first item cannot be indented or a top-level item cannot be outdented.
    event.preventDefault();
    event.stopPropagation?.();
    const snapshot = rangeBoundarySnapshot(range, li);
    const canChange = event.shiftKey
      ? !!(li.parentElement?.parentElement?.nodeName === 'LI')
      : !!previousListItem(li);
    if (!canChange) return true;

    options.beforeChange?.();
    const changed = event.shiftKey ? outdentListItem(li) : indentListItem(li);
    if (changed) {
      restoreRange(snapshot);
      options.afterChange?.(li);
    }
    return true;
  }

  app.editor.richText = Object.freeze({ handleListTab, singleEditingHost, blocksForRange, handleSelectAll });
})(window);
