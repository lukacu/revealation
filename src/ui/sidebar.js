/**
 * Revealation — slide sidebar
 * ===========================
 *
 * Purpose
 * -------
 * Core navigation UI for slides and subslides. The sidebar is not an optional
 * plugin: it is one of the primary ways users understand and navigate a deck.
 *
 * Responsibilities
 * ----------------
 * - render slide/subslide rows;
 * - expose Thumbnail and Outline views;
 * - keep the active slide visibly selected;
 * - provide keyboard, context-menu and drag/drop navigation;
 * - lazy-render visual slide thumbnails;
 * - avoid executing active media/interactive content inside thumbnails.
 *
 * Does NOT
 * --------
 * - mutate deck state directly;
 * - implement delete/move/select semantics;
 * - parse Markdown;
 * - save projects.
 *
 * Dependencies
 * ------------
 * The application creates the sidebar with callbacks for deck mutations.
 * This keeps UI mechanics here while state/history rules remain in core.
 *
 * Public API
 * ----------
 * `Revealation.ui.createSidebar(options)` -> controller
 *
 * Controller methods:
 * - `render({ slides, currentId, width, height })`
 * - `updateSlide({ slide, width, height })`
 * - `renderMarkdown({ items, slides, width, height, onJump })`
 * - `updateMarkdownActive(index)`
 * - `setView('thumbnails' | 'outline')`
 * - `getView()`
 *
 * Slide rows support multi-selection with Cmd/Ctrl-click and Shift-click.
 */
(function registerSidebar(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  const VIEW_STORAGE_KEY = 'revealation.sidebarView';

  function safeStoredView() {
    try {
      return localStorage.getItem(VIEW_STORAGE_KEY) === 'outline' ? 'outline' : 'thumbnails';
    } catch (_) {
      return 'thumbnails';
    }
  }

  function createPlaceholder(label, icon) {
    const wrap = document.createElement('div');
    wrap.className = 'thumbnail-placeholder';
    const i = document.createElement('i');
    i.className = `bi ${icon}`;
    i.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = label;
    wrap.append(i, text);
    return wrap;
  }

  /**
   * Remove behavior from thumbnail content.
   *
   * Interactive frames and media players are deliberately replaced by static
   * placeholders. Otherwise a deck with many interactive slides could start
   * dozens of applications merely by opening the sidebar.
   */
  function sanitizeThumbnail(root) {
    root.querySelectorAll('script').forEach((el) => el.remove());
    // RV-COMPAT(interactive-demo): REMOVE `.sr-demo` BEFORE PUBLIC RELEASE.
    root.querySelectorAll('iframe, .sr-interactive, .sr-demo').forEach((el) => {
      el.replaceWith(createPlaceholder('Interactive', 'bi-window-stack'));
    });
    root.querySelectorAll('video').forEach((el) => {
      el.replaceWith(createPlaceholder('Video', 'bi-film'));
    });
    root.querySelectorAll('audio').forEach((el) => {
      el.replaceWith(createPlaceholder('Audio', 'bi-volume-up'));
    });
    root.querySelectorAll('*').forEach((el) => {
      Array.from(el.attributes || []).forEach((attr) => {
        if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      });
    });
    root.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
    root.querySelectorAll('a').forEach((el) => {
      el.removeAttribute('href');
      el.removeAttribute('target');
    });
  }

  function applyPresentationTheme(surface) {
    const source = document.getElementById('slide-frame') || document.getElementById('slide-editor');
    if (!source || !surface) return;
    const cs = getComputedStyle(source);
    const vars = [
      '--rv-bg', '--rv-text', '--rv-muted', '--rv-accent',
      '--rv-font-heading', '--rv-font-body', '--rv-font-mono',
      '--rv-size-title', '--rv-size-heading', '--rv-size-body', '--rv-size-caption',
      '--rv-slide-padding', '--rv-block-spacing', '--rv-content-width', '--rv-radius',
      '--r-background-color', '--r-main-color', '--r-main-font', '--r-main-font-size',
      '--r-main-line-height', '--r-heading-color', '--r-heading-font', '--r-heading-font-weight',
      '--r-heading-line-height', '--r-link-color', '--r-selection-background-color',
    ];
    vars.forEach(name => {
      const value = cs.getPropertyValue(name).trim();
      if (value) surface.style.setProperty(name, value);
    });
    // Some themes resolve their variables on .reveal rather than exposing the
    // custom properties to arbitrary descendants. Copy the computed fallback
    // too so a Markdown-mode thumbnail never becomes white-on-white.
    if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') surface.style.backgroundColor = cs.backgroundColor;
    if (cs.color) surface.style.color = cs.color;
    if (cs.fontFamily) surface.style.fontFamily = cs.fontFamily;
  }

  function applyBackground(surface, slide, defaultId = '') {
    const bg = slide?.background;
    const extensionId = String((bg && typeof bg === 'object' && bg.id) || defaultId || '').trim();
    if (extensionId) {
      const definition = app.background?.get?.(extensionId);
      if (!definition) return;
      app.background?.ensureStyle?.(extensionId);
      surface.classList.add('rv-background-host');
      surface.setAttribute('data-rv-background', extensionId);
      return;
    }
    if (!bg?.type || !bg.value) return;
    if (bg.type === 'color') {
      surface.style.background = bg.value;
    } else if (bg.type === 'image') {
      surface.style.backgroundImage = `url("${String(bg.value).replace(/"/g, '\\"')}")`;
      surface.style.backgroundSize = bg.size || 'cover';
      surface.style.backgroundPosition = 'center';
      surface.style.backgroundRepeat = 'no-repeat';
    }
  }

  function createSidebar(options) {
    const {
      sidebarElement,
      listElement,
      headElement,
      addButton,
      slideModel = app.core.slideModel,
      labelForSlide,
      renderLabel,
      onSelect,
      onSelectionChange,
      onContextMenu,
      onMove,
      onNavigate,
      onAfterRender = () => {},
    } = options || {};

    if (!sidebarElement || !listElement || !headElement) {
      throw new Error('createSidebar requires sidebarElement, listElement and headElement.');
    }
    if (!slideModel) throw new Error('Revealation slide model is not available.');

    // Keep the thumbnail implementation and stored preference available for
    // the future UI, but temporarily expose only the slide list while the
    // thumbnail view is being polished.
    let view = 'outline';
    let lastRender = { slides: [], currentId: null, width: 960, height: 700 };
    let lastMarkdown = null;
    let renderKind = 'slides';
    let observer = null;
    let selectedIds = new Set();
    let selectionAnchorId = null;
    listElement.setAttribute('role', 'listbox');
    listElement.setAttribute('aria-multiselectable', 'true');
    listElement.title = 'Click to select; Cmd/Ctrl-click or Shift-click to select multiple slides';

    function setSelection(ids, anchorId = null) {
      selectedIds = new Set(ids.filter(Boolean));
      if (anchorId) selectionAnchorId = anchorId;
      listElement.querySelectorAll('li[data-id]').forEach((li) => {
        const selected = selectedIds.has(li.dataset.id);
        li.classList.toggle('selected', selected);
        li.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
      onSelectionChange?.(Array.from(selectedIds));
    }

    function selectFromPointer(slideId, event) {
      const ids = lastRender.slides.map((slide) => slide.id);
      const index = ids.indexOf(slideId);
      if (index < 0) return;
      if (event.shiftKey && selectionAnchorId && ids.includes(selectionAnchorId)) {
        const anchor = ids.indexOf(selectionAnchorId);
        const start = Math.min(anchor, index);
        const end = Math.max(anchor, index);
        setSelection(ids.slice(start, end + 1), slideId);
      } else if (event.metaKey || event.ctrlKey) {
        const next = new Set(selectedIds);
        if (next.has(slideId)) next.delete(slideId); else next.add(slideId);
        setSelection(Array.from(next), slideId);
      } else {
        setSelection([slideId], slideId);
      }
    }

    function ensureViewControls() {
      let group = headElement.querySelector('.sidebar-view-toggle');
      if (group) return group;

      group = document.createElement('div');
      group.className = 'sidebar-view-toggle';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', 'Slide list view');

      const specs = [
        ['thumbnails', 'bi-grid-3x2-gap', 'Thumbnail view'],
        ['outline', 'bi-list-ul', 'Outline view'],
      ];
      specs.forEach(([mode, icon, title]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.sidebarView = mode;
        button.title = title;
        button.setAttribute('aria-label', title);
        button.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i>`;
        group.appendChild(button);
      });

      group.addEventListener('click', (event) => {
        const button = event.target.closest('[data-sidebar-view]');
        if (button) setView(button.dataset.sidebarView);
      });
      headElement.insertBefore(group, addButton || null);
      return group;
    }

    function syncViewControls() {
      headElement.querySelectorAll('[data-sidebar-view]').forEach((button) => {
        const active = button.dataset.sidebarView === view;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      sidebarElement.classList.toggle('sidebar-thumbnails', view === 'thumbnails');
      sidebarElement.classList.toggle('sidebar-outline', view === 'outline');
    }

    function setView(mode) {
      view = mode === 'outline' ? 'outline' : 'thumbnails';
      try { localStorage.setItem(VIEW_STORAGE_KEY, view); } catch (_) {}
      syncViewControls();
      if (renderKind === 'markdown' && lastMarkdown) renderMarkdown(lastMarkdown);
      else render(lastRender);
    }

    function getView() { return view; }

    function scrollActiveIntoView() {
      const active = Array.from(listElement.querySelectorAll('li')).find((li) => li.classList.contains('active') || li.classList.contains('md-current'));
      if (!active) return;
      const listRect = listElement.getBoundingClientRect();
      const rowRect = active.getBoundingClientRect();
      if (rowRect.top < listRect.top) listElement.scrollTop -= listRect.top - rowRect.top;
      else if (rowRect.bottom > listRect.bottom) listElement.scrollTop += rowRect.bottom - listRect.bottom;
    }

    function thumbnailObserver() {
      if (observer || !('IntersectionObserver' in window)) return observer;
      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          renderThumbnail(entry.target);
          observer.unobserve(entry.target);
        });
      }, { root: listElement, rootMargin: '220px 0px' });
      return observer;
    }

    function renderThumbnail(shell) {
      if (!shell || shell.dataset.rendered === '1') return;
      shell.dataset.rendered = '1';
      const slide = shell._revealationSlide;
      const width = shell._revealationWidth || 960;
      const height = shell._revealationHeight || 700;

      const viewport = document.createElement('div');
      viewport.className = 'thumbnail-viewport';
      const surface = document.createElement('div');
      surface.className = `thumbnail-surface reveal slide-editor rv-slide rv-layout-${slide?.layout || 'single'}`;
      surface.style.width = `${width}px`;
      surface.style.height = `${height}px`;
      surface.innerHTML = slide?.content || '';
      applyPresentationTheme(surface);
      sanitizeThumbnail(surface);
      applyBackground(surface, slide, lastRender.defaultBackgroundId);
      viewport.appendChild(surface);
      shell.appendChild(viewport);

      requestAnimationFrame(() => {
        const available = Math.max(80, viewport.clientWidth || shell.clientWidth || 160);
        const scale = available / width;
        viewport.style.height = `${Math.max(54, height * scale)}px`;
        surface.style.transform = `scale(${scale})`;
      });
    }

    function addThumbnail(li, slide, width, height, index = 0) {
      if (view !== 'thumbnails') return;
      const shell = document.createElement('div');
      shell.className = 'thumbnail-shell';
      shell.dataset.rendered = '0';
      shell._revealationSlide = slide;
      shell._revealationWidth = width;
      shell._revealationHeight = height;
      const rowMenu = li.querySelector(':scope > .row-menu');
      li.insertBefore(shell, rowMenu || null);
      // Render the first visible batch synchronously. IntersectionObserver can
      // be delayed while the main pane switches into Markdown mode; leaving
      // the shell empty during that delay looked like lost slide previews.
      if (index < 12 || slide.id === lastRender.currentId) renderThumbnail(shell);
      else {
        const io = thumbnailObserver();
        if (io) io.observe(shell); else renderThumbnail(shell);
      }
    }

    function clearDropCues() {
      listElement.querySelectorAll('li').forEach((el) => {
        el.classList.remove('drag-over', 'drag-over-after', 'drag-over-nest');
      });
    }

    function render(input) {
      renderKind = 'slides';
      lastRender = {
        slides: Array.isArray(input?.slides) ? input.slides : [],
        currentId: input?.currentId || null,
        width: Number(input?.width) || 960,
        height: Number(input?.height) || 700,
        defaultBackgroundId: String(input?.defaultBackgroundId || ''),
      };
      const validIds = new Set(lastRender.slides.map((slide) => slide.id));
      selectedIds = new Set((input?.selectedIds || []).filter((id) => validIds.has(id)));
      if (!selectedIds.size && lastRender.currentId && validIds.has(lastRender.currentId)) {
        selectedIds.add(lastRender.currentId);
      }
      if (!selectionAnchorId || !validIds.has(selectionAnchorId)) selectionAnchorId = lastRender.currentId;
      syncViewControls();
      if (observer) observer.disconnect();
      listElement.replaceChildren();

      lastRender.slides.forEach((slide, index) => {
        const li = document.createElement('li');
        li.dataset.id = slide.id;
        li.setAttribute('role', 'option');
        li.draggable = true;
        li.classList.toggle('active', slide.id === lastRender.currentId);
        li.classList.toggle('selected', selectedIds.has(slide.id));
        li.setAttribute('aria-selected', selectedIds.has(slide.id) ? 'true' : 'false');
        if (slide.id === lastRender.currentId) li.setAttribute('aria-current', 'true');
        li.classList.toggle('subslide', slideModel.isSubslide(slide, index));
        // RV-COMPAT(subslide-vertical): REMOVE BEFORE PUBLIC RELEASE.
        // Legacy CSS hook retained until styles are fully migrated.
        li.classList.toggle('vertical', slideModel.isSubslide(slide, index));
        li.classList.toggle('under-construction', slide?.underConstruction === true);
        li.classList.toggle('slide-hidden', slide?.hidden === true);

        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = slideModel.number(lastRender.slides, index);

        const label = document.createElement('span');
        label.className = 'label';
        const descriptor = labelForSlide ? labelForSlide(slide, index) : { text: `Slide ${index + 1}` };
        if (renderLabel) renderLabel(label, descriptor);
        else label.textContent = descriptor?.text || 'Slide';
        li.append(num);
        if (slide?.underConstruction === true) {
          const badge = document.createElement('span');
          badge.className = 'construction-badge';
          badge.textContent = 'WIP';
          badge.title = 'Under construction';
          badge.setAttribute('aria-label', 'Under construction');
          li.appendChild(badge);
        }
        if (slide?.hidden === true) {
          const badge = document.createElement('span');
          badge.className = 'hidden-slide-badge';
          badge.innerHTML = '<i class="bi bi-eye-slash" aria-hidden="true"></i>';
          badge.title = 'Hidden from presentation';
          badge.setAttribute('aria-label', 'Hidden from presentation');
          li.appendChild(badge);
        }
        li.appendChild(label);
        li.title = `${slide?.underConstruction === true ? 'Under construction · ' : ''}${slide?.hidden === true ? 'Hidden · ' : ''}${label.textContent.trim()}`;

        const rowMenu = document.createElement('button');
        rowMenu.type = 'button';
        rowMenu.className = 'row-menu';
        rowMenu.title = 'Slide actions';
        rowMenu.setAttribute('aria-label', 'Slide actions');
        rowMenu.setAttribute('aria-haspopup', 'menu');
        rowMenu.innerHTML = '<i class="bi bi-three-dots-vertical" aria-hidden="true"></i>';
        rowMenu.addEventListener('click', (event) => {
          event.stopPropagation();
          if (!selectedIds.has(slide.id)) setSelection([slide.id], slide.id);
          const rect = rowMenu.getBoundingClientRect();
          onContextMenu?.(slide.id, rect.left, rect.bottom + 4, Array.from(selectedIds));
        });

        li.append(rowMenu);
        addThumbnail(li, slide, lastRender.width, lastRender.height, index);

        li.addEventListener('click', (event) => {
          if (event.target.closest('button')) return;
          selectFromPointer(slide.id, event);
          if (!event.shiftKey && !event.metaKey && !event.ctrlKey) onSelect?.(slide.id);
        });
        li.tabIndex = 0;
        li.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onSelect?.(slide.id);
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            event.stopPropagation();
            onNavigate?.(event.key === 'ArrowDown' ? 1 : -1);
            requestAnimationFrame(() => {
              const active = listElement.querySelector('li.active');
              if (active) active.focus();
            });
          } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault();
            if (!selectedIds.has(slide.id)) setSelection([slide.id], slide.id);
            const rect = li.getBoundingClientRect();
            onContextMenu?.(slide.id, rect.left + rect.width / 2, rect.top + rect.height / 2, Array.from(selectedIds));
          }
        });

        li.addEventListener('dragstart', (event) => {
          if (!selectedIds.has(slide.id)) setSelection([slide.id], slide.id);
          event.dataTransfer.setData('text/x-slide-id', slide.id);
          event.dataTransfer.setData('text/x-slide-ids', JSON.stringify(Array.from(selectedIds)));
          event.dataTransfer.effectAllowed = 'move';
        });
        const dropMode = (event) => {
          const rect = li.getBoundingClientRect();
          const y = (event.clientY - rect.top) / (rect.height || 1);
          if (y < 0.3) return 'before';
          if (y > 0.7) return 'after';
          return 'nest';
        };
        const clearRowCues = () => li.classList.remove('drag-over', 'drag-over-after', 'drag-over-nest');
        li.addEventListener('dragover', (event) => {
          if (!event.dataTransfer.types.includes('text/x-slide-id')) return;
          event.preventDefault();
          const mode = dropMode(event);
          li.classList.toggle('drag-over', mode === 'before');
          li.classList.toggle('drag-over-after', mode === 'after');
          li.classList.toggle('drag-over-nest', mode === 'nest');
        });
        li.addEventListener('dragleave', clearRowCues);
        li.addEventListener('dragend', clearDropCues);
        li.addEventListener('drop', (event) => {
          event.preventDefault();
          clearRowCues();
          const fromId = event.dataTransfer.getData('text/x-slide-id');
          const draggedIds = (() => {
            try { return JSON.parse(event.dataTransfer.getData('text/x-slide-ids') || '[]'); } catch (_) { return []; }
          })();
          if (fromId && fromId !== slide.id) onMove?.(fromId, slide.id, dropMode(event), draggedIds.length ? draggedIds : Array.from(selectedIds));
        });
        li.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          if (!selectedIds.has(slide.id)) setSelection([slide.id], slide.id);
          onContextMenu?.(slide.id, event.clientX, event.clientY, Array.from(selectedIds));
        });

        listElement.appendChild(li);
      });
      onAfterRender();
      requestAnimationFrame(scrollActiveIntoView);
    }

    function updateSlide({ slide, width, height }) {
      if (!slide || view !== 'thumbnails') return;
      const escaped = global.CSS?.escape ? CSS.escape(String(slide.id)) : String(slide.id).replace(/["\\]/g, '\\$&');
      const li = listElement.querySelector(`li[data-id="${escaped}"]`);
      const shell = li?.querySelector(':scope > .thumbnail-shell');
      if (!shell) return;
      shell.replaceChildren();
      shell.dataset.rendered = '0';
      shell._revealationSlide = slide;
      shell._revealationWidth = Number(width) || lastRender.width;
      shell._revealationHeight = Number(height) || lastRender.height;
      renderThumbnail(shell);
    }

    /** Render deck-wide Markdown navigation without exposing mutation controls. */
    function renderMarkdown(input = {}) {
      const { items = [], slides = [], width = 960, height = 700, onJump = () => {} } = input;
      renderKind = 'markdown';
      lastMarkdown = { items, slides, width, height, onJump };
      syncViewControls();
      if (observer) observer.disconnect();
      listElement.replaceChildren();
      const visualSlides = slides.length === items.length ? slides : [];
      const numberingSlides = items.map((entry, index) => ({
        // RV-COMPAT(subslide-vertical): accepts old sidebar/model field.
        vertical: index > 0 && (!!entry.subslide || !!entry.vertical),
      }));
      items.forEach((item, index) => {
        const slide = visualSlides[index] || {
          id: `markdown-${index}`,
          vertical: !!item.subslide || !!item.vertical,
          content: '',
        };
        const li = document.createElement('li');
        li.dataset.mdIndex = String(index);
        const subslide = !!item.subslide || !!item.vertical;
        li.classList.toggle('subslide', subslide && index > 0);
        // RV-COMPAT(subslide-vertical): REMOVE `.vertical` CSS hook BEFORE PUBLIC RELEASE.
        li.classList.toggle('vertical', subslide && index > 0);
        const underConstruction = item?.underConstruction === true || slide?.underConstruction === true;
        li.classList.toggle('under-construction', underConstruction);
        const hidden = item?.hidden === true || slide?.hidden === true;
        li.classList.toggle('slide-hidden', hidden);
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = slideModel.number(numberingSlides, index);
        const label = document.createElement('span');
        label.className = 'label';
        label.textContent = item.label || `Slide ${index + 1}`;
        li.append(num);
        if (underConstruction) {
          const badge = document.createElement('span');
          badge.className = 'construction-badge';
          badge.textContent = 'WIP';
          badge.title = 'Under construction';
          badge.setAttribute('aria-label', 'Under construction');
          li.appendChild(badge);
        }
        if (hidden) {
          const badge = document.createElement('span');
          badge.className = 'hidden-slide-badge';
          badge.innerHTML = '<i class="bi bi-eye-slash" aria-hidden="true"></i>';
          badge.title = 'Hidden from presentation';
          badge.setAttribute('aria-label', 'Hidden from presentation');
          li.appendChild(badge);
        }
        li.appendChild(label);
        li.title = `${underConstruction ? 'Under construction · ' : ''}${hidden ? 'Hidden · ' : ''}${label.textContent}`;
        if (view === 'thumbnails') addThumbnail(li, slide, Number(width) || 960, Number(height) || 700, index);
        li.tabIndex = 0;
        const jump = () => onJump(index);
        li.addEventListener('click', jump);
        li.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') { event.preventDefault(); jump(); }
        });
        listElement.appendChild(li);
      });
    }

    function updateMarkdownActive(index) {
      listElement.querySelectorAll('li[data-md-index]').forEach((li, i) => {
        li.classList.toggle('md-current', i === index);
        if (i === index) li.setAttribute('aria-current', 'true');
        else li.removeAttribute('aria-current');
      });
      requestAnimationFrame(scrollActiveIntoView);
    }

    syncViewControls();
    return Object.freeze({ render, updateSlide, renderMarkdown, updateMarkdownActive, setView, getView });
  }

  app.ui.createSidebar = createSidebar;
})(window);
