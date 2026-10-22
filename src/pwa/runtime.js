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
  let controlled = false;
  let controlCallback = null;
  let controllerListenerInstalled = false;

  const CONTROL_TIMEOUT_MS = 5000;
  const UPDATE_TIMEOUT_MS = 8000;

  function settleWithin(promise, timeoutMs, label) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
  }

  function supported() {
    return !!(global.isSecureContext && 'serviceWorker' in navigator);
  }

  async function fetchVersionInfo() {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), UPDATE_TIMEOUT_MS);
    try {
      const response = await fetch(app.urls.deployment('version.json'), {
        cache: 'no-store',
        ...(controller ? { signal: controller.signal } : {}),
      });
      if (!response.ok) return null;
      versionInfo = await response.json();
      return versionInfo;
    } catch (_) {
      return null;
    } finally {
      clearTimeout(timer);
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

  function reportControlChange() {
    controlled = !!navigator.serviceWorker.controller;
    if (typeof controlCallback === 'function') controlCallback({ controlled, registration });
    if (reloadForUpdate && controlled) global.location.reload();
  }

  async function register({ onUpdateAvailable, onControllerChange } = {}) {
    if (!supported()) return null;
    updateCallback = onUpdateAvailable || null;
    controlCallback = onControllerChange || null;
    registration = await navigator.serviceWorker.register(app.urls.deployment('sw.js'), {
      scope: app.urls.deployment(''),
      updateViaCache: 'none',
    });

    registration.addEventListener('updatefound', () => watchInstallingWorker(registration.installing));
    if (!controllerListenerInstalled) {
      navigator.serviceWorker.addEventListener('controllerchange', reportControlChange);
      controllerListenerInstalled = true;
    }

    // Do not await navigator.serviceWorker.ready here: on a failed first
    // installation that promise can remain pending indefinitely. The
    // controllerchange event is the only signal the editor needs, with a
    // bounded fallback for browsers that cannot take control immediately.
    controlled = await waitUntilControlled(CONTROL_TIMEOUT_MS);
    reportControlChange();

    if (registration.waiting && navigator.serviceWorker.controller) reportUpdate(registration.waiting);
    // Update metadata is useful but must not block the editor or workspace
    // picker. The check is independently time-bounded and deliberately runs in
    // the background after the first usable application state is available.
    void checkForUpdates();

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
    await Promise.allSettled([
      settleWithin(registration.update(), UPDATE_TIMEOUT_MS, 'Service worker update'),
      settleWithin(fetchVersionInfo(), UPDATE_TIMEOUT_MS, 'Version check'),
    ]);
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
    get controlled() { return controlled; },
    get versionInfo() { return versionInfo; },
    get registration() { return registration; },
  });
})(window);
