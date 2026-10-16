/**
 * Revealation — background extension registry
 * ===========================================
 *
 * Purpose
 * -------
 * Keep slide backgrounds semantic and curated. A slide stores a background
 * extension id while the registry resolves that id to CSS/JS/preview assets.
 *
 * Responsibilities
 * ----------------
 * - validate and register background extension manifests;
 * - load explicitly installed manifests in the no-build application;
 * - resolve CSS, JavaScript, static preview and declared asset URLs;
 * - load CSS and static preview code for editor previews.
 *
 * Does NOT
 * --------
 * - expose arbitrary background CSS settings to users;
 * - execute animation JavaScript inside the editor;
 * - own lifecycle execution (see `src/background/runtime.js`);
 * - provide a general-purpose extension framework.
 *
 * Public API
 * ----------
 * `Revealation.background.registerManifest(url)` queues an installed manifest.
 * `Revealation.background.load()` loads queued manifests.
 * `Revealation.background.register(manifest, manifestUrl?)` validates/registers one.
 * `Revealation.background.get(id)` / `list()` expose the catalog.
 * `Revealation.background.ensureStyle(id)` loads only that extension's CSS.
 * Static preview painters are loaded from each extension's `previewJs` file;
 * animation JavaScript is never loaded by the editor.
 */
(function registerBackgroundRegistry(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  const definitions = new Map();
  const manifestUrls = [];
  const previewPainters = new Map();
  const previewPromises = new Map();
  const ID_RE = /^[a-z][a-z0-9-]*$/;
  let loadPromise = null;

  function absoluteUrl(value, baseUrl) {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
      const base = baseUrl || global.document?.baseURI || global.location?.href || 'http://localhost/';
      return new URL(text, base).href;
    } catch (_) {
      return text;
    }
  }

  function normalizeManifest(input, manifestUrl = '') {
    const source = { ...(input || {}) };
    const id = String(source.id || '').trim();
    if (!ID_RE.test(id)) throw new Error(`Invalid background id: ${id || '(empty)'}`);
    if (!String(source.name || '').trim()) throw new Error(`Background "${id}" must define a name.`);
    if (!String(source.version || '').trim()) throw new Error(`Background "${id}" must define a version.`);
    if (!String(source.css || '').trim()) throw new Error(`Background "${id}" must define a CSS resource.`);

    const resolvedManifestUrl = absoluteUrl(manifestUrl);
    const resourceBase = resolvedManifestUrl ? new URL('.', resolvedManifestUrl).href : '';
    const assets = Array.isArray(source.assets)
      ? source.assets.map(item => String(item || '').trim()).filter(Boolean)
      : [];

    return Object.freeze({
      id,
      name: String(source.name).trim(),
      version: String(source.version).trim(),
      description: String(source.description || '').trim(),
      manifestUrl: resolvedManifestUrl,
      css: String(source.css).trim(),
      cssUrl: absoluteUrl(source.css, resourceBase || resolvedManifestUrl),
      js: String(source.js || '').trim(),
      jsUrl: absoluteUrl(source.js, resourceBase || resolvedManifestUrl),
      previewJs: String(source.previewJs || '').trim(),
      previewJsUrl: absoluteUrl(source.previewJs, resourceBase || resolvedManifestUrl),
      preview: String(source.preview || '').trim(),
      previewUrl: absoluteUrl(source.preview, resourceBase || resolvedManifestUrl),
      assets: Object.freeze(assets),
      assetUrls: Object.freeze(assets.map(asset => absoluteUrl(asset, resourceBase || resolvedManifestUrl))),
    });
  }

  function register(manifest, manifestUrl = '') {
    const normalized = normalizeManifest(manifest, manifestUrl);
    if (definitions.has(normalized.id)) throw new Error(`Background "${normalized.id}" is already registered.`);
    definitions.set(normalized.id, normalized);
    return normalized;
  }

  function registerManifest(url) {
    const resolved = absoluteUrl(url);
    if (!resolved) throw new Error('Background manifest URL is required.');
    if (!manifestUrls.includes(resolved)) manifestUrls.push(resolved);
    return resolved;
  }

  async function load() {
    if (loadPromise) return loadPromise;
    loadPromise = Promise.all(manifestUrls.map(async url => {
      const response = await global.fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Could not load background manifest ${url} (HTTP ${response.status}).`);
      const manifest = await response.json();
      return register(manifest, url);
    })).then(async () => {
      await Promise.all(list().map(definition => ensurePreview(definition.id)));
      return list();
    });
    return loadPromise;
  }

  function get(id) {
    return definitions.get(String(id || '')) || null;
  }

  function list() {
    return Array.from(definitions.values());
  }

  function ensureStyle(id) {
    const definition = get(id);
    if (!definition?.cssUrl || !global.document?.head) return null;
    const selectorId = `rv-background-css-${definition.id}`;
    let link = global.document.getElementById(selectorId);
    if (!link) {
      link = global.document.createElement('link');
      link.id = selectorId;
      link.rel = 'stylesheet';
      link.href = definition.cssUrl;
      link.dataset.revealationBackground = definition.id;
      global.document.head.appendChild(link);
    }
    return link;
  }

  function registerPreview(id, painter) {
    const key = String(id || '').trim();
    if (!ID_RE.test(key)) throw new Error(`Invalid background preview id: ${key || '(empty)'}`);
    if (typeof painter !== 'function') throw new Error(`Background preview "${key}" requires a painter function.`);
    if (previewPainters.has(key)) throw new Error(`Background preview "${key}" is already registered.`);
    previewPainters.set(key, painter);
  }

  function ensurePreview(id) {
    const definition = get(id);
    if (!definition?.previewJsUrl || !global.document?.head) return Promise.resolve(null);
    const key = definition.id;
    if (previewPainters.has(key)) return Promise.resolve(previewPainters.get(key));
    if (previewPromises.has(key)) return previewPromises.get(key);
    const promise = new Promise(resolve => {
      const script = global.document.createElement('script');
      script.src = definition.previewJsUrl;
      script.async = false;
      script.dataset.revealationBackgroundPreview = key;
      script.addEventListener('load', () => resolve(previewPainters.get(key) || null), { once: true });
      script.addEventListener('error', () => {
        console.warn(`Could not load static preview for background "${key}".`);
        resolve(null);
      }, { once: true });
      global.document.head.appendChild(script);
    });
    previewPromises.set(key, promise);
    return promise;
  }

  function clearPreview(layer) {
    if (!layer) return;
    delete layer._rvBackgroundPreviewRedraw;
    layer.classList.remove('rv-static-preview-painted');
  }

  function paintPreview(id, layer) {
    const painter = previewPainters.get(String(id || '').trim());
    if (!painter || !layer) return false;
    const result = painter(layer);
    const redraw = typeof result === 'function' ? result : result?.redraw;
    if (typeof redraw === 'function') layer._rvBackgroundPreviewRedraw = redraw;
    layer.classList.add('rv-static-preview-painted');
    return true;
  }

  function refreshPreview(layer) {
    layer?._rvBackgroundPreviewRedraw?.();
  }

  app.background = app.background || {};
  Object.assign(app.background, {
    registerManifest, load, register, get, list, ensureStyle,
    ensurePreview, paintPreview, clearPreview, refreshPreview,
  });
  global.RevealationBackgroundPreviews = Object.freeze({ register: registerPreview });
})(window);
