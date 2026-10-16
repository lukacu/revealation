/**
 * Revealation — application namespace
 * ===================================
 *
 * Purpose
 * -------
 * Establish the single global namespace used by this no-build browser
 * application. Source files register small documented APIs on
 * `window.Revealation` and are loaded in explicit dependency order.
 *
 * Responsibilities
 * ----------------
 * - expose the application identity and version;
 * - provide domain registration buckets (`core`, `ui`, `storage`, ...).
 *
 * Does NOT
 * --------
 * - own presentation state;
 * - provide a generic plugin/event system;
 * - render UI or persist data.
 *
 * Rationale
 * ---------
 * Revealation deliberately avoids a bundler. A small namespace is sufficient
 * for the few cross-file contracts we actually need; no generic module/plugin
 * abstraction is introduced unless a concrete responsibility requires one.
 *
 * Load order
 * ----------
 * This file must be loaded before every other Revealation source file.
 *
 * Public API
 * ----------
 * `window.Revealation` with the documented domain buckets, `version` and
 * `info` metadata used by the application chrome.
 */
(function bootstrapRevealation(global) {
  'use strict';

  const app = global.Revealation || {};
  app.version = '0.1.0-alpha.1';

  // App resources live under a reserved `__app__/` namespace so ordinary
  // relative URLs remain available to the active presentation workspace.
  // Derive the namespace from this script URL rather than from `/` so the
  // application works unchanged from a subdirectory (for example GitHub Pages).
  const bootstrapScript = global.document?.currentScript?.src || '';
  let pageBaseUrl;
  try {
    // about:blank and lightweight test DOMs are not valid bases for relative
    // URLs, so keep a harmless HTTP fallback for those environments.
    pageBaseUrl = new URL('./', global.location?.href || 'http://localhost/');
  } catch (_) {
    pageBaseUrl = new URL('http://localhost/');
  }
  let appBaseUrl;
  try {
    appBaseUrl = bootstrapScript
      ? new URL('../../', new URL(bootstrapScript, pageBaseUrl))
      : new URL('__app__/', pageBaseUrl);
  } catch (_) {
    appBaseUrl = new URL('__app__/', pageBaseUrl);
  }
  const deploymentBaseUrl = new URL('../', appBaseUrl);
  app.urls = Object.freeze({
    appBase: appBaseUrl.href,
    deploymentBase: deploymentBaseUrl.href,
    app(path = '') {
      return new URL(String(path || '').replace(/^\/+/, ''), appBaseUrl).href;
    },
    deployment(path = '') {
      return new URL(String(path || '').replace(/^\/+/, ''), deploymentBaseUrl).href;
    },
  });

  app.info = Object.freeze({
    name: 'Revealation',
    tagline: 'A small, opinionated workshop for making slides without losing your mind.',
    description: 'Write in Markdown, polish visually, and keep the whole presentation under your control.',
    projectUrl: 'https://github.com/lukacu/revealation',
    projectLabel: 'Revealation project page',
    revealUrl: 'https://revealjs.com/',
    revealLabel: 'reveal.js',
    upstreamUrl: 'https://github.com/samplereality/small-reveal/',
    upstreamLabel: 'Small Reveal by Mark Sample',
    license: 'MIT licensed',
    logoIcon: 'bi-easel2',
  });
  app.core = app.core || {};
  app.ui = app.ui || {};
  app.editor = app.editor || {};
  app.rendering = app.rendering || {};
  app.serialization = app.serialization || {};
  app.storage = app.storage || {};
  app.content = app.content || {};
  app.layout = app.layout || {};
  app.theme = app.theme || {};
  app.background = app.background || {};
  app.exporters = app.exporters || {};
  app.config = app.config || {};

  global.Revealation = app;
})(window);
