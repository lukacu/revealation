/**
 * Revealation — presentation theme registry
 * =========================================
 *
 * Purpose
 * -------
 * Provide the small manifest-backed abstraction between presentation state
 * and presentation CSS. Revealation stores a curated theme id; callers do not
 * need to know reveal.js theme filenames or CSS internals.
 *
 * Responsibilities
 * ----------------
 * - validate theme manifests and register immutable theme definitions;
 * - load explicitly installed theme manifests without a build step;
 * - resolve theme resource URLs relative to each manifest;
 * - expose a safe default fallback;
 * - RV-COMPAT(theme-reveal-aliases): temporarily resolve old reveal.js theme names.
 *
 * Does NOT
 * --------
 * - edit CSS variables or generate arbitrary presentation styling;
 * - own presentation state or UI;
 * - scan directories (static hosting has no portable directory API);
 * - provide a general plugin framework.
 *
 * Public API
 * ----------
 * `Revealation.theme.registerManifest(url)` queues an installed manifest.
 * `Revealation.theme.load()` loads all queued manifests.
 * `Revealation.theme.register(manifest, manifestUrl?)` validates/registers one.
 * `Revealation.theme.registerAlias(alias, themeId)` adds a compatibility alias.
 * `Revealation.theme.get(id)` returns a registered definition or `null`.
 * `Revealation.theme.resolve(id)` returns a registered id, following aliases.
 * `Revealation.theme.resolveOrDefault(id)` always returns a registered id.
 * `Revealation.theme.list()` returns the ordered catalog.
 */
(function registerThemeRegistry(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  const definitions = new Map();
  const manifestUrls = [];
  // RV-COMPAT(theme-reveal-aliases): REMOVE BEFORE PUBLIC RELEASE if aliases have no non-legacy use.
  const aliases = new Map();
  const ID_RE = /^[a-z][a-z0-9-]*$/;
  let defaultId = 'clean';
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

  function normalizeBackgroundHints(value) {
    if (!value || typeof value !== 'object') return Object.freeze({ default: '', recommended: Object.freeze([]) });
    const recommended = Array.isArray(value.recommended)
      ? value.recommended.map(item => String(item || '').trim()).filter(id => ID_RE.test(id))
      : [];
    return Object.freeze({
      default: ID_RE.test(String(value.default || '').trim()) ? String(value.default).trim() : '',
      recommended: Object.freeze(Array.from(new Set(recommended))),
    });
  }

  function normalizeManifest(input, manifestUrl = '') {
    const source = { ...(input || {}) };
    const id = String(source.id || '').trim();
    if (!ID_RE.test(id)) throw new Error(`Invalid theme id: ${id || '(empty)'}`);
    if (!String(source.name || '').trim()) throw new Error(`Theme "${id}" must define a name.`);
    if (!String(source.version || '').trim()) throw new Error(`Theme "${id}" must define a version.`);
    if (!String(source.css || '').trim()) throw new Error(`Theme "${id}" must define a CSS resource.`);

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
      preview: String(source.preview || '').trim(),
      previewUrl: absoluteUrl(source.preview, resourceBase || resolvedManifestUrl),
      assets: Object.freeze(assets),
      assetUrls: Object.freeze(assets.map(asset => absoluteUrl(asset, resourceBase || resolvedManifestUrl))),
      backgrounds: normalizeBackgroundHints(source.backgrounds),
    });
  }

  function register(manifest, manifestUrl = '') {
    const normalized = normalizeManifest(manifest, manifestUrl);
    if (definitions.has(normalized.id)) throw new Error(`Theme "${normalized.id}" is already registered.`);
    definitions.set(normalized.id, normalized);
    return normalized;
  }

  function registerManifest(url) {
    const resolved = absoluteUrl(url);
    if (!resolved) throw new Error('Theme manifest URL is required.');
    if (!manifestUrls.includes(resolved)) manifestUrls.push(resolved);
    return resolved;
  }

  // RV-COMPAT(theme-reveal-aliases): REMOVE BEFORE PUBLIC RELEASE.
  function registerAlias(alias, themeId) {
    const from = String(alias || '').trim();
    const to = String(themeId || '').trim();
    if (!from || !ID_RE.test(to)) throw new Error('Theme alias requires an alias and valid target id.');
    aliases.set(from, to);
  }

  function setDefault(id) {
    const value = String(id || '').trim();
    if (!ID_RE.test(value)) throw new Error(`Invalid default theme id: ${value || '(empty)'}`);
    defaultId = value;
  }

  async function load() {
    if (loadPromise) return loadPromise;
    loadPromise = Promise.all(manifestUrls.map(async url => {
      const response = await global.fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Could not load theme manifest ${url} (HTTP ${response.status}).`);
      const manifest = await response.json();
      return register(manifest, url);
    })).then(() => list());
    return loadPromise;
  }

  function get(id) {
    return definitions.get(String(id || '')) || null;
  }

  function resolve(id) {
    const raw = String(id || '').trim();
    if (definitions.has(raw)) return raw;
    // RV-COMPAT(theme-reveal-aliases): REMOVE BEFORE PUBLIC RELEASE.
    const mapped = aliases.get(raw);
    return mapped && definitions.has(mapped) ? mapped : '';
  }

  function resolveOrDefault(id) {
    return resolve(id) || (definitions.has(defaultId) ? defaultId : (definitions.keys().next().value || ''));
  }

  function list() {
    return Array.from(definitions.values());
  }

  app.theme = app.theme || {};
  Object.assign(app.theme, {
    registerManifest,
    load,
    register,
    registerAlias,
    setDefault,
    get,
    resolve,
    resolveOrDefault,
    list,
    get defaultId() { return defaultId; },
  });
})(window);
