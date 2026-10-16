/**
 * Revealation — platform selection
 * ================================
 *
 * Select the browser adapter for the static/PWA build.
 *
 * Purpose
 * -------
 * Select the runtime platform adapter at application startup.
 *
 * Responsibilities
 * ----------------
 * - expose the browser platform through `Revealation.platform`.
 *
 * Does NOT
 * --------
 * - implement platform-specific operations itself.
 *
 * Public API
 * ----------
 * `Revealation.platform` selected adapter instance.
 */
(function selectPlatform(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');
  const Platform = app.platform.BrowserPlatform;
  if (!Platform) throw new Error('Revealation platform adapters must be loaded first.');
  app.platform = new Platform();
})(window);
