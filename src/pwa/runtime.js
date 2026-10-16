/**
 * Revealation — PWA runtime coordinator
 * =====================================
 *
 * Purpose
 * -------
 * Register the deployment service worker and expose an explicit update flow to
 * the application UI without coupling editor state to service-worker events.
 *
 * Responsibilities
 * ----------------
 * - register `sw.js` at the current deployment/subdirectory scope;
 * - detect waiting/new service workers and report update availability;
 * - trigger a waiting worker only after the user chooses to update;
 * - periodically ask the browser to check for a newer worker;
 * - fetch generated `version.json` without using the HTTP cache.
 *
 * Does NOT
 * --------
 * - decide whether the Python workspace or browser directory storage is used;
 * - reload on first service-worker installation;
 * - save presentation state before an update (core does that first).
 *
 * Public API
 * ----------
 * `Revealation.pwa.{supported,register,checkForUpdates,activateUpdate,versionInfo}`
 */
(function registerPwaRuntime(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  let registration = null;
  let versionInfo = null;
  let updateCallback = null;
  let reloadForUpdate = false;
  let lastCheck = 0;
  let intervalId = null;

  function supported() {
    return !!(global.isSecureContext && 'serviceWorker' in navigator);
  }

  async function fetchVersionInfo() {
    try {
      const response = await fetch(app.urls.deployment('version.json'), { cache: 'no-store' });
      if (!response.ok) return null;
      versionInfo = await response.json();
      return versionInfo;
    } catch (_) {
      return null;
    }
  }

  function reportUpdate(worker) {
    if (!worker) return;
    if (typeof updateCallback === 'function') updateCallback({ worker, registration, versionInfo });
  }

  function watchInstallingWorker(worker) {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) reportUpdate(worker);
    });
  }

  async function waitUntilControlled(timeoutMs = 3000) {
    if (navigator.serviceWorker.controller) return true;
    return new Promise(resolve => {
      let done = false;
      const finish = value => {
        if (done) return;
        done = true;
        navigator.serviceWorker.removeEventListener('controllerchange', onChange);
        clearTimeout(timer);
        resolve(value);
      };
      const onChange = () => finish(true);
      const timer = setTimeout(() => finish(!!navigator.serviceWorker.controller), timeoutMs);
      navigator.serviceWorker.addEventListener('controllerchange', onChange);
    });
  }

  async function register({ onUpdateAvailable } = {}) {
    if (!supported()) return null;
    updateCallback = onUpdateAvailable || null;
    registration = await navigator.serviceWorker.register(app.urls.deployment('sw.js'), {
      scope: app.urls.deployment(''),
      updateViaCache: 'none',
    });

    registration.addEventListener('updatefound', () => watchInstallingWorker(registration.installing));
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadForUpdate) global.location.reload();
    });

    await navigator.serviceWorker.ready;
    await waitUntilControlled();
    await fetchVersionInfo();

    if (registration.waiting && navigator.serviceWorker.controller) reportUpdate(registration.waiting);
    await checkForUpdates();

    if (!intervalId) {
      intervalId = global.setInterval(() => { checkForUpdates(); }, 60 * 60 * 1000);
      global.addEventListener('focus', () => {
        if (Date.now() - lastCheck > 5 * 60 * 1000) checkForUpdates();
      });
    }
    return registration;
  }

  async function checkForUpdates() {
    if (!registration) return null;
    lastCheck = Date.now();
    await Promise.allSettled([registration.update(), fetchVersionInfo()]);
    if (registration.waiting && navigator.serviceWorker.controller) reportUpdate(registration.waiting);
    return versionInfo;
  }

  function activateUpdate() {
    if (!registration?.waiting) return false;
    reloadForUpdate = true;
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    return true;
  }

  app.pwa = Object.freeze({
    supported,
    register,
    checkForUpdates,
    activateUpdate,
    get versionInfo() { return versionInfo; },
    get registration() { return registration; },
  });
})(window);
