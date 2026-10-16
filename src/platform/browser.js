/**
 * Revealation — browser platform adapter
 * ======================================
 *
 * The browser adapter is intentionally thin: it preserves the normal Web API
 * behavior while giving application code one stable platform contract.
 *
 * Purpose
 * -------
 * Encapsulate browser print, fullscreen, and popup behavior.
 *
 * Responsibilities
 * ----------------
 * - implement the shared platform contract with Web APIs;
 * - preserve browser popup and fullscreen return behavior.
 *
 * Does NOT
 * --------
 * - own application state or presentation rendering.
 *
 * Public API
 * ----------
 * `Revealation.platform.BrowserPlatform`.
 */
(function registerBrowserPlatform(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  class BrowserPlatform {
    get kind() { return 'browser'; }
    print() { global.print(); }

    requestFullscreen(element = global.document?.documentElement) {
      if (!element?.requestFullscreen) return Promise.resolve(false);
      return Promise.resolve(element.requestFullscreen()).then(() => true).catch(() => false);
    }

    exitFullscreen() {
      if (!global.document?.exitFullscreen) return Promise.resolve(false);
      return Promise.resolve(global.document.exitFullscreen()).then(() => true).catch(() => false);
    }

    isFullscreen() { return !!global.document?.fullscreenElement; }

    openWindow(url, target = '_blank', features = '') {
      return global.open(url, target, features);
    }

    openExternal(url) {
      return global.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  app.platform = app.platform || {};
  app.platform.BrowserPlatform = BrowserPlatform;
})(window);
