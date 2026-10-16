/**
 * Revealation — installed background registrations
 * ===============================================
 *
 * Purpose
 * -------
 * Declare the background extension manifests installed in this distribution.
 *
 * Responsibilities
 * ----------------
 * - register installed manifest URLs with the background registry.
 *
 * Does NOT
 * --------
 * - implement background effects;
 * - expose effect parameters;
 * - render the background picker.
 *
 * Public API
 * ----------
 * Side-effect registration through `Revealation.background` during startup.
 */
(function registerInstalledBackgrounds(global) {
  'use strict';
  const app = global.Revealation;
  const registry = app?.background;
  if (!registry) throw new Error('Revealation background registry must be loaded first.');
  registry.registerManifest(app.urls.app('extensions/backgrounds/grid/extension.json'));
  registry.registerManifest(app.urls.app('extensions/backgrounds/bubbles/extension.json'));
  registry.registerManifest(app.urls.app('extensions/backgrounds/mesh/extension.json'));
})(window);
