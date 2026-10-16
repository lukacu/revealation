/**
 * Revealation — deck HTML/ZIP exporter
 * ===================================
 *
 * Purpose
 * -------
 * Turn a prepared Revealation project into either linked reveal.js HTML,
 * self-contained standalone HTML, or a ZIP presentation package.
 *
 * Responsibilities
 * ----------------
 * - select the theme/background resources required by a project;
 * - build HTML that references packaged reveal.js/theme/background resources;
 * - inline CSS, local media and simple interactive documents for standalone HTML;
 * - bundle workspace files plus runtime resources into a portable ZIP package;
 * - include the background lifecycle runtime only when a used background is dynamic.
 *
 * Does NOT
 * --------
 * - own editor/project state, save timing, dialogs or download UI;
 * - parse Markdown or capture unsaved WYSIWYG content;
 * - decide how slides/layouts are rendered into <section> markup;
 * - define theme/background registries or mutate presentation content;
 * - bundle arbitrary ES-module graphs, workers, fetch() dependencies or servers.
 *
 * Dependencies / contract
 * -----------------------
 * `create(adapter)` receives the presentation-specific pieces that remain owned
 * by core/rendering:
 *
 * - `themeDefinition(project)` -> resolved theme manifest definition;
 * - `themePayload(project)` -> { themeCssHref, fontsHref, customCss };
 * - `backgrounds(project)` -> used background manifest definitions only;
 * - `renderSections(slides, project)` -> reveal.js <section> markup;
 * - `contentCss()` -> stable Revealation layout/content CSS;
 * - `revealConfig()` -> default reveal.js configuration object.
 *
 * Keeping those callbacks explicit prevents export from reaching into mutable
 * application state while RV-COMPAT(theme-custom) rendering stays
 * in core until that compatibility window closes.
 *
 * Public API
 * ----------
 * `Revealation.exporters.deck.create(adapter)` returns an immutable exporter:
 * - `containsInteractive(project)`
 * - `packagePaths(project)`
 * - `buildLinkedHtml(project, options?)`
 * - `buildStandaloneHtml(project, options?)`
 * - `buildZip(project, { workspaceMode, workspaceStorage })`
 * - `canBuildZip()`
 */
(function registerDeckExporter(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  // -------- Fixed runtime resources --------
  const BACKGROUND_RUNTIME_PATH = 'src/background/runtime.js';
  const REVEAL_VENDOR_ROOT = 'vendor/reveal';
  const KATEX_VENDOR_ROOT = 'vendor/katex';
  const APP_BASE_URL = app.urls.app('');
  // Absolute application-resource prefix used while fetching assets for the
  // single-file standalone export. Linked/ZIP exports keep relative paths.
  const APP_PREFIX = APP_BASE_URL;

  const KATEX_FONT_BASES = Object.freeze([
    'AMS-Regular', 'Caligraphic-Bold', 'Caligraphic-Regular', 'Fraktur-Bold',
    'Fraktur-Regular', 'Main-Bold', 'Main-BoldItalic', 'Main-Italic',
    'Main-Regular', 'Math-BoldItalic', 'Math-Italic', 'SansSerif-Bold',
    'SansSerif-Italic', 'SansSerif-Regular', 'Script-Regular', 'Size1-Regular',
    'Size2-Regular', 'Size3-Regular', 'Size4-Regular', 'Typewriter-Regular',
  ]);

  const BASE_PACKAGE_FILES = Object.freeze([
    `${REVEAL_VENDOR_ROOT}/dist/reveal.css`,
    `${REVEAL_VENDOR_ROOT}/dist/reveal.js`,
    `${REVEAL_VENDOR_ROOT}/plugin/notes/notes.js`,
    `${REVEAL_VENDOR_ROOT}/plugin/highlight/highlight.js`,
    `${REVEAL_VENDOR_ROOT}/plugin/highlight/monokai.css`,
    `${REVEAL_VENDOR_ROOT}/plugin/math/math.js`,
    `${KATEX_VENDOR_ROOT}/dist/katex.min.css`,
    `${KATEX_VENDOR_ROOT}/dist/katex.min.js`,
    `${KATEX_VENDOR_ROOT}/dist/contrib/auto-render.min.js`,
    ...KATEX_FONT_BASES.flatMap(name => ['.woff2', '.woff', '.ttf']
      .map(ext => `${KATEX_VENDOR_ROOT}/dist/fonts/KaTeX_${name}${ext}`)),
  ]);

  // -------- Small shared helpers --------
  function requireFunction(adapter, name) {
    if (typeof adapter?.[name] !== 'function') {
      throw new Error(`Deck exporter adapter requires ${name}().`);
    }
    return adapter[name];
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
  }

  function escapeAttr(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function safeScript(text) {
    return String(text ?? '').replace(/<\/script/gi, '<\\/script');
  }

  function packageResourcePath(url) {
    if (!url) return '';
    try {
      const base = global.location?.href || 'http://localhost/';
      const parsed = new URL(url, base);
      if (parsed.href.startsWith(APP_BASE_URL)) {
        return decodeURIComponent(parsed.href.slice(APP_BASE_URL.length).split(/[?#]/, 1)[0]);
      }
    } catch (_) {}
    return String(url);
  }

  function isSafePackagePath(path) {
    return !!path
      && !/^[a-z][a-z0-9+.-]*:/i.test(path)
      && !String(path).startsWith('/')
      && !String(path).split('/').includes('..');
  }

  function isLocalDeckUrl(url) {
    const value = String(url || '').trim();
    return !!value
      && !/^(?:[a-z]+:|\/\/|#)/i.test(value)
      && !value.startsWith('data:')
      && !value.startsWith('blob:');
  }

  function containsInteractive(project) {
    return (project?.slides || []).filter(slide => slide?.hidden !== true).some(slide => {
      const html = String(slide?.content || '');
      // RV-COMPAT(interactive-demo): REMOVE `demo` branch BEFORE PUBLIC RELEASE.
      return /class=["'][^"']*\bsr-(?:interactive|demo)\b/i.test(html)
        || /data-interactive(?:-src)?=/i.test(html);
    });
  }

  // -------- Exporter instance --------
  function create(adapter) {
    const themeDefinition = requireFunction(adapter, 'themeDefinition');
    const themePayload = requireFunction(adapter, 'themePayload');
    const backgrounds = requireFunction(adapter, 'backgrounds');
    const renderSections = requireFunction(adapter, 'renderSections');
    const contentCss = requireFunction(adapter, 'contentCss');
    const revealConfig = requireFunction(adapter, 'revealConfig');

    // -------- Manifest/resource selection --------
    function backgroundResourceTags(project) {
      const resources = backgrounds(project) || [];
      const css = resources
        .filter(definition => definition?.cssUrl)
        .map(definition => `<link rel="stylesheet" href="${escapeAttr(packageResourcePath(definition.cssUrl))}" data-rv-background-css="${escapeAttr(definition.id)}">`)
        .join('\n');
      const dynamic = resources.filter(definition => definition?.jsUrl);
      const scripts = dynamic.length
        ? [
          `<script src="${BACKGROUND_RUNTIME_PATH}"></script>`,
          ...dynamic.map(definition => `<script src="${escapeAttr(packageResourcePath(definition.jsUrl))}"></script>`),
        ].join('\n')
        : '';
      const assets = Object.fromEntries(resources.map(definition => [
        definition.id,
        Object.fromEntries((definition.assets || []).map((name, index) => [
          name,
          packageResourcePath(definition.assetUrls?.[index] || ''),
        ])),
      ]));
      return { resources, css, scripts, assets, hasDynamic: dynamic.length > 0 };
    }

    /**
     * Return app-relative files required by the project's selected visual system.
     * Only declared manifest assets are copied; arbitrary runtime dependencies are
     * intentionally outside the extension contract.
     */
    function packagePaths(project) {
      const urls = [];
      const theme = themeDefinition(project);
      if (theme?.cssUrl) urls.push(theme.cssUrl);
      urls.push(...(theme?.assetUrls || []));

      const usedBackgrounds = backgrounds(project) || [];
      usedBackgrounds.forEach(definition => {
        if (definition?.cssUrl) urls.push(definition.cssUrl);
        if (definition?.jsUrl) urls.push(definition.jsUrl);
        urls.push(...(definition?.assetUrls || []));
      });

      const paths = urls.map(packageResourcePath).filter(isSafePackagePath);
      if (usedBackgrounds.some(definition => definition?.jsUrl)) paths.push(BACKGROUND_RUNTIME_PATH);
      return Array.from(new Set(paths));
    }

    // -------- Linked/package HTML --------
    /**
     * Build the HTML entry point used by workspace ZIP packages. Resources stay
     * as relative files so interactive iframes can keep their original workspace
     * structure and browser semantics.
     */
    function buildLinkedHtml(project, { hash = false, startAt = null } = {}) {
      if (!project) throw new Error('Missing project for linked HTML export.');
      const vendor = REVEAL_VENDOR_ROOT;
      const themeBits = themePayload(project) || {};
      const themeHref = packageResourcePath(themeBits.themeCssHref);
      const backgroundTags = backgroundResourceTags(project);
      const customHead =
        (themeBits.fontsHref ? `\n<link rel="stylesheet" href="${escapeAttr(themeBits.fontsHref)}">` : '')
        + (themeBits.customCss ? `\n<style>\n${themeBits.customCss}\n</style>` : '');
      const config = { ...revealConfig(), ...(project.config || {}), hash: !!hash };
      const configJson = JSON.stringify(config);
      const initOptions = `Object.assign(${configJson}, { katex: { local: '${KATEX_VENDOR_ROOT}' }, plugins: [RevealNotes, RevealHighlight, RevealMath.KaTeX] })`;
      const startCall = startAt
        ? `\n  revealReady.then(() => Reveal.slide(${startAt[0]}, ${startAt[1]}));`
        : '';
      const backgroundCall = backgroundTags.hasDynamic
        ? `\n  window.RevealationBackgroundRuntime?.setAssets(${JSON.stringify(backgroundTags.assets)});\n  revealReady.then(() => window.RevealationBackgroundRuntime?.bindReveal(Reveal, document));`
        : '';

      return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(project.title || 'Presentation')}</title>${project.author ? `\n<meta name="author" content="${escapeAttr(project.author)}">` : ''}
<link rel="stylesheet" href="${vendor}/dist/reveal.css">
<link rel="stylesheet" href="${escapeAttr(themeHref)}" id="theme">
<link rel="stylesheet" href="${vendor}/plugin/highlight/monokai.css">${backgroundTags.css ? `\n${backgroundTags.css}` : ''}${customHead}
<style>${contentCss()}</style>
</head>
<body>
<div class="reveal"><div class="slides">
${renderSections(project.slides || [], project)}
</div></div>
<script src="${vendor}/dist/reveal.js"><\/script>
<script src="${vendor}/plugin/notes/notes.js"><\/script>
<script src="${vendor}/plugin/highlight/highlight.js"><\/script>
<script src="${vendor}/plugin/math/math.js"><\/script>
${backgroundTags.scripts}
<script>
  const revealReady = Reveal.initialize(${initOptions});${startCall}${backgroundCall}
  revealReady.then(function () {
    var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    Promise.resolve(fontsReady).then(function () {
      requestAnimationFrame(function () { requestAnimationFrame(function () { Reveal.layout(); }); });
    });
  });
  // Linked images open in a sized popup. Exiting fullscreen first is needed on
  // browsers that ignore popup geometry while a fullscreen element is active.
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a.linked-image');
    if (!a) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var href = a.getAttribute('href');
    if (!href) return;
    function openWindow() {
      var w = Math.min(window.innerWidth - 80, 1200);
      var h = Math.min(window.innerHeight - 80, 800);
      var left = (window.screenX || 0) + Math.max(0, (window.innerWidth - w) / 2);
      var top = (window.screenY || 0) + Math.max(0, (window.innerHeight - h) / 2);
      var features = 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top;
      if (window.Revealation && window.Revealation.platform && window.Revealation.platform.openWindow) {
        window.Revealation.platform.openWindow(href, 'reveal-linked-preview', features);
      } else {
        window.open(href, 'reveal-linked-preview', features);
      }
    }
    var platform = window.Revealation && window.Revealation.platform;
    if (platform && platform.isFullscreen && platform.isFullscreen()) {
      Promise.resolve(platform.exitFullscreen()).then(openWindow, openWindow);
    } else if (document.fullscreenElement && document.exitFullscreen) {
      Promise.resolve(document.exitFullscreen()).then(openWindow, openWindow);
    } else {
      openWindow();
    }
  }, true);
<\/script>
</body>
</html>`;
    }

    // -------- Standalone resource inlining --------
    function replaceAsync(text, regex, replacer) {
      const matches = [];
      text.replace(regex, (...args) => { matches.push(args); return args[0]; });
      return Promise.all(matches.map(args => replacer(...args))).then(replacements => {
        let index = 0;
        return text.replace(regex, () => replacements[index++]);
      });
    }

    async function responseDataUrl(url) {
      const response = await global.fetch(url, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`Could not fetch ${url} (HTTP ${response.status})`);
      const blob = await response.blob();
      return await new Promise((resolve, reject) => {
        const reader = new global.FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
        reader.readAsDataURL(blob);
      });
    }

    /** Inline @import rules and url(...) assets recursively for one stylesheet. */
    async function standaloneCss(url, seen = new Set()) {
      const absolute = new URL(url, global.location?.href || 'http://localhost/').href;
      if (seen.has(absolute)) return '';
      seen.add(absolute);
      const response = await global.fetch(absolute, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`Could not fetch stylesheet ${absolute}`);
      let css = await response.text();
      css = await replaceAsync(css, /@import\s+(?:url\()?\s*['"]?([^'"\)\s]+)['"]?\s*\)?\s*;/gi,
        async (whole, href) => {
          try { return await standaloneCss(new URL(href, absolute).href, seen); }
          catch { return whole; }
        });
      css = await replaceAsync(css, /url\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi,
        async (whole, quote, href) => {
          const value = String(href || '').trim();
          if (!value || value.startsWith('data:') || value.startsWith('#')) return whole;
          try { return `url("${await responseDataUrl(new URL(value, absolute).href)}")`; }
          catch { return whole; }
        });
      return css;
    }

    async function inlineDeckAsset(url, cache) {
      if (!isLocalDeckUrl(url)) return url;
      const key = url;
      const origin = global.location?.origin || 'http://localhost';
      if (!cache.has(key)) {
        cache.set(key, responseDataUrl(new URL(url, origin + '/').href).catch(() => url));
      }
      return await cache.get(key);
    }

    async function textDataUrl(text, type = 'text/html;charset=utf-8') {
      const blob = new global.Blob([text], { type });
      return await new Promise((resolve, reject) => {
        const reader = new global.FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
        reader.readAsDataURL(blob);
      });
    }

    /**
     * Inline the simple, directly referenced resources of an interactive HTML
     * document. This is intentionally not a JavaScript/module bundler.
     */
    async function inlineInteractiveDocument(src, cache) {
      const origin = global.location?.origin || 'http://localhost';
      const absolute = new URL(src, origin + '/').href;
      const response = await global.fetch(absolute, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Could not fetch interactive content ${src} (HTTP ${response.status})`);
      const text = await response.text();
      const doc = new global.DOMParser().parseFromString(text, 'text/html');

      for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"][href]'))) {
        const href = link.getAttribute('href');
        if (!href) continue;
        try {
          const style = doc.createElement('style');
          style.textContent = await standaloneCss(new URL(href, absolute).href);
          link.replaceWith(style);
        } catch (_) {}
      }

      // Ordinary script src files can be copied inline. Relative ES-module
      // imports, dynamic imports and runtime fetch() remain unsupported here.
      for (const script of Array.from(doc.querySelectorAll('script[src]'))) {
        const href = script.getAttribute('src');
        if (!href) continue;
        try {
          const scriptResponse = await global.fetch(new URL(href, absolute).href, { cache: 'no-store' });
          if (!scriptResponse.ok) continue;
          const inline = doc.createElement('script');
          for (const attribute of Array.from(script.attributes)) {
            if (attribute.name !== 'src') inline.setAttribute(attribute.name, attribute.value);
          }
          inline.textContent = safeScript(await scriptResponse.text());
          script.replaceWith(inline);
        } catch (_) {}
      }

      for (const element of Array.from(doc.querySelectorAll('img[src],video[src],audio[src],source[src]'))) {
        const href = element.getAttribute('src');
        if (!href || /^(?:data:|blob:|https?:|\/\/)/i.test(href)) continue;
        try {
          const key = new URL(href, absolute).href;
          if (!cache.has(key)) cache.set(key, responseDataUrl(key).catch(() => href));
          element.setAttribute('src', await cache.get(key));
        } catch (_) {}
      }
      for (const element of Array.from(doc.querySelectorAll('video[poster]'))) {
        const href = element.getAttribute('poster');
        if (!href || /^(?:data:|blob:|https?:|\/\/)/i.test(href)) continue;
        try { element.setAttribute('poster', await responseDataUrl(new URL(href, absolute).href)); }
        catch (_) {}
      }

      return '<!doctype html>\n' + doc.documentElement.outerHTML;
    }

    async function projectWithInlinedAssets(project) {
      const clone = JSON.parse(JSON.stringify(project));
      clone.slides = (clone.slides || []).filter(slide => slide?.hidden !== true);
      const cache = new Map();

      for (const slide of clone.slides || []) {
        // A detached element is sufficient here: exported slide content is being
        // rewritten, not mounted into the live editor or presentation DOM.
        const holder = global.document.createElement('div');
        holder.innerHTML = slide.content || '';

        // RV-COMPAT(interactive-demo): REMOVE `.sr-demo` selector BEFORE PUBLIC RELEASE.
        for (const interactive of Array.from(holder.querySelectorAll('.sr-interactive[data-src], .sr-demo[data-src]'))) {
          const src = interactive.getAttribute('data-src') || '';
          const iframe = interactive.querySelector(':scope > iframe');
          if (!src || !iframe || !isLocalDeckUrl(src)) continue;
          try {
            iframe.setAttribute('src', await textDataUrl(await inlineInteractiveDocument(src, cache)));
            iframe.removeAttribute('data-src');
          } catch (error) {
            console.warn('Could not inline interactive content', src, error);
            interactive.setAttribute('data-export-warning', 'Interactive content could not be fully inlined');
          }
        }

        for (const element of holder.querySelectorAll('img[src],video[src],audio[src],source[src]')) {
          const src = element.getAttribute('src');
          if (src) element.setAttribute('src', await inlineDeckAsset(src, cache));
        }
        for (const element of holder.querySelectorAll('video[poster]')) {
          const poster = element.getAttribute('poster');
          if (poster) element.setAttribute('poster', await inlineDeckAsset(poster, cache));
        }
        for (const anchor of holder.querySelectorAll('a.linked-image[href]')) {
          const href = anchor.getAttribute('href');
          if (href && isLocalDeckUrl(href)) anchor.setAttribute('href', await inlineDeckAsset(href, cache));
        }

        // Pre-render code/math so standalone HTML does not need the Highlight
        // or Math plugins at runtime. Their CSS is still embedded below.
        holder.querySelectorAll('pre > code').forEach(code => {
          const plain = code.textContent || '';
          const languageClass = Array.from(code.classList).find(name => name.startsWith('language-')) || '';
          const language = languageClass.replace(/^language-/, '');
          if (!global.hljs) return;
          try {
            const result = language && global.hljs.getLanguage(language)
              ? global.hljs.highlight(plain, { language, ignoreIllegals: true })
              : global.hljs.highlightAuto(plain);
            code.innerHTML = result.value;
            code.classList.add('hljs');
          } catch (_) {
            code.textContent = plain;
          }
        });
        holder.querySelectorAll('.sr-math').forEach(element => {
          const tex = element.dataset.tex || '';
          const display = element.dataset.display === '1';
          if (!global.katex) return;
          try {
            global.katex.render(tex, element, { displayMode: display, throwOnError: false, strict: 'ignore' });
          } catch (_) {
            element.textContent = display ? `\\[${tex}\\]` : `\\(${tex}\\)`;
          }
        });

        slide.content = holder.innerHTML;
        // RV-COMPAT(background-reveal): raw image/video backgrounds are old-format assets.
        if (slide.background && /^(image|video)$/.test(slide.background.type || '') && slide.background.value) {
          slide.background.value = await inlineDeckAsset(slide.background.value, cache);
        }
      }
      return clone;
    }

    async function standaloneBackgroundBundle(project) {
      const definitions = backgrounds(project) || [];
      const css = (await Promise.all(definitions.map(async definition => {
        try { return await standaloneCss(definition.cssUrl); }
        catch (error) {
          console.warn(`Could not inline background CSS for ${definition.id}`, error);
          return '';
        }
      }))).filter(Boolean).join('\n');

      const dynamic = definitions.filter(definition => definition?.jsUrl);
      let runtimeJs = '';
      if (dynamic.length) {
        const response = await global.fetch(`${APP_PREFIX}${BACKGROUND_RUNTIME_PATH}`, { cache: 'force-cache' });
        if (!response.ok) throw new Error('Background runtime fetch failed');
        runtimeJs = safeScript(await response.text());
      }

      const extensionJs = [];
      for (const definition of dynamic) {
        const response = await global.fetch(definition.jsUrl, { cache: 'force-cache' });
        if (!response.ok) throw new Error(`Background JS fetch failed for ${definition.id}`);
        extensionJs.push(safeScript(await response.text()));
      }

      const assets = {};
      for (const definition of definitions) {
        const table = {};
        for (let index = 0; index < (definition.assets || []).length; index += 1) {
          const name = definition.assets[index];
          const url = definition.assetUrls?.[index];
          if (!url) continue;
          try { table[name] = await responseDataUrl(url); }
          catch (_) { table[name] = url; }
        }
        assets[definition.id] = table;
      }
      return { css, runtimeJs, extensionJs, assets, hasDynamic: dynamic.length > 0 };
    }

    /** Build a single HTML file that has no runtime dependency on Revealation. */
    async function buildStandaloneHtml(project, { configOverrides = null } = {}) {
      if (!project) throw new Error('Missing project for standalone HTML export.');
      const vendor = `${APP_PREFIX}${REVEAL_VENDOR_ROOT}`;
      const themeBits = themePayload(project) || {};
      const [revealCss, themeCss, highlightCss, katexCss, revealJs, notesJs, backgroundBundle] = await Promise.all([
        standaloneCss(`${vendor}/dist/reveal.css`),
        standaloneCss(themeBits.themeCssHref),
        standaloneCss(`${vendor}/plugin/highlight/monokai.css`),
        standaloneCss(`${APP_PREFIX}${KATEX_VENDOR_ROOT}/dist/katex.min.css`),
        global.fetch(`${vendor}/dist/reveal.js`, { cache: 'force-cache' })
          .then(response => { if (!response.ok) throw new Error('Reveal JS fetch failed'); return response.text(); }),
        global.fetch(`${vendor}/plugin/notes/notes.js`, { cache: 'force-cache' })
          .then(response => { if (!response.ok) throw new Error('Reveal notes fetch failed'); return response.text(); }),
        standaloneBackgroundBundle(project),
      ]);

      const inlined = await projectWithInlinedAssets(project);
      let customFontsCss = '';
      if (themeBits.fontsHref) {
        try { customFontsCss = await standaloneCss(themeBits.fontsHref); }
        // RV-COMPAT(theme-custom): REMOVE custom-font branch BEFORE PUBLIC RELEASE.
        catch (_) { customFontsCss = '/* Legacy custom web font could not be embedded; system fallback will be used. */'; }
      }

      const config = { ...revealConfig(), ...(inlined.config || {}), ...(configOverrides || {}), hash: true };
      const configJson = safeScript(JSON.stringify(config));
      const assetJson = safeScript(JSON.stringify(backgroundBundle.assets));
      const runtimeScript = backgroundBundle.hasDynamic
        ? `<script>${backgroundBundle.runtimeJs}<\/script>\n${backgroundBundle.extensionJs.map(code => `<script>${code}<\/script>`).join('\n')}`
        : '';
      const backgroundInit = backgroundBundle.hasDynamic
        ? `\nwindow.RevealationBackgroundRuntime.setAssets(${assetJson});\nrevealReady.then(function () { window.RevealationBackgroundRuntime.bindReveal(Reveal, document); });`
        : '';

      return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(inlined.title || 'Presentation')}</title>${inlined.author ? `\n<meta name="author" content="${escapeAttr(inlined.author)}">` : ''}
<style>${revealCss}\n${themeCss}\n${highlightCss}\n${katexCss}\n${customFontsCss}\n${themeBits.customCss || ''}\n${backgroundBundle.css}\n${contentCss()}</style>
</head>
<body>
<div class="reveal"><div class="slides">${renderSections(inlined.slides || [], inlined)}</div></div>
<script>${safeScript(revealJs)}<\/script>
<script>${safeScript(notesJs)}<\/script>
${runtimeScript}
<script>
const revealReady = Reveal.initialize(Object.assign(${configJson}, { plugins: [RevealNotes] }));${backgroundInit}
revealReady.then(function () {
  var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.resolve(fontsReady).then(function () {
    requestAnimationFrame(function () { requestAnimationFrame(function () { Reveal.layout(); }); });
  });
});
document.addEventListener('click', function (e) {
  var a = e.target.closest('a.linked-image'); if (!a) return;
  e.preventDefault(); var href = a.getAttribute('href'); if (!href) return;
  var w = Math.min(window.innerWidth - 80, 1200), h = Math.min(window.innerHeight - 80, 800);
  var left = (window.screenX || 0) + Math.max(0, (window.innerWidth - w) / 2);
  var top = (window.screenY || 0) + Math.max(0, (window.innerHeight - h) / 2);
  window.open(href, 'reveal-linked-preview', 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top);
}, true);
<\/script>
</body></html>`;
    }

    // -------- ZIP assembly --------
    async function fetchAppFile(path) {
      const response = await global.fetch(app.urls.app(path), { cache: 'force-cache' });
      if (!response.ok) throw new Error(`Could not fetch application file ${path} (HTTP ${response.status})`);
      return response.blob();
    }

    /**
     * Build a ZIP blob. Workspace packages retain the original file tree;
     * browser/IndexedDB projects fall back to a self-contained index.html.
     */
    async function buildZip(project, { workspaceMode = false, workspaceStorage = null } = {}) {
      if (!project) throw new Error('Missing project for ZIP export.');
      if (typeof global.JSZip === 'undefined') throw new Error('JSZip is not available.');
      if (workspaceMode && !workspaceStorage?.listFiles) {
        throw new Error('Workspace storage is required for workspace ZIP export.');
      }

      const zip = new global.JSZip();
      if (workspaceMode) {
        const filesToCopy = Array.from(new Set([
          ...BASE_PACKAGE_FILES,
          ...packagePaths(project),
        ]));
        await Promise.all(filesToCopy.map(async path => {
          zip.file(path, await fetchAppFile(path));
        }));

        // Keep workspace-relative URLs intact so iframe applications continue
        // to use modules, fetch(), workers and local data files after extraction.
        const workspaceFiles = await workspaceStorage.listFiles();
        zip.file('presentation.html', buildLinkedHtml(project));
        await Promise.all(workspaceFiles.map(async file => {
          const path = String(file?.path || '');
          if (!isSafePackagePath(path)) return;
          if (typeof workspaceStorage.readFile === 'function') {
            zip.file(path, await workspaceStorage.readFile(path));
            return;
          }
          const response = await global.fetch(app.urls.deployment(path), { cache: 'no-store' });
          if (!response.ok) throw new Error(`Could not fetch workspace file ${path} (HTTP ${response.status})`);
          zip.file(path, await response.blob());
        }));
        zip.file('README.txt', [
          'Revealation presentation package',
          '',
          'Serve this extracted folder over HTTP and open presentation.html.',
          'For example: python3 -m http.server 8000',
          'Interactive content is kept in its original relative paths.',
        ].join('\n'));
      } else {
        zip.file('index.html', await buildStandaloneHtml(project));
        zip.file('README.txt', 'Open index.html in a browser.\n');
      }

      return await zip.generateAsync({ type: 'blob' });
    }

    return Object.freeze({
      containsInteractive,
      packagePaths,
      buildLinkedHtml,
      buildStandaloneHtml,
      buildZip,
      canBuildZip: () => typeof global.JSZip !== 'undefined',
    });
  }

  app.exporters.deck = Object.freeze({ create });
})(window);
