/**
 * Revealation — presentation background lifecycle runtime
 * ======================================================
 *
 * Purpose
 * -------
 * Provide the tiny runtime contract used by optional animated background
 * extensions in preview and exported presentations.
 *
 * Responsibilities
 * ----------------
 * - let extension scripts register lifecycle factories by background id;
 * - mount instances on `.rv-background-host[data-rv-background]` elements;
 * - start only the active reveal.js slide and stop inactive slides;
 * - destroy instances cleanly when explicitly refreshed/removed.
 *
 * Does NOT
 * --------
 * - know about specific effects such as globes or particles;
 * - load manifests, CSS or extension scripts;
 * - run inside the Revealation editor merely to draw static previews.
 *
 * Public API
 * ----------
 * `RevealationBackgroundRuntime.register(id, factory)`
 * `RevealationBackgroundRuntime.setAssets({ id: { name: url } })`
 * `RevealationBackgroundRuntime.mountAll(root, context?)`
 * `RevealationBackgroundRuntime.setActiveSection(section)`
 * `RevealationBackgroundRuntime.bindReveal(reveal, root?)`
 * `RevealationBackgroundRuntime.destroyAll()`
 */
(function registerBackgroundRuntime(global) {
  'use strict';

  const factories = new Map();
  const mounted = new Map();
  const animationStates = new Map();
  let assetCatalog = Object.create(null);

  function register(id, factory) {
    const key = String(id || '').trim();
    if (!/^[a-z][a-z0-9-]*$/.test(key)) throw new Error(`Invalid background runtime id: ${key || '(empty)'}`);
    if (!factory || (typeof factory !== 'function' && typeof factory !== 'object')) {
      throw new Error(`Background runtime "${key}" requires a lifecycle factory.`);
    }
    if (factories.has(key)) throw new Error(`Background runtime "${key}" is already registered.`);
    factories.set(key, factory);
  }

  function safeCall(instance, method) {
    try { instance?.[method]?.(); } catch (error) { console.error(`Background ${method} failed`, error); }
  }

  function createInstance(factory, host, context) {
    if (typeof factory === 'function') return factory(host, context) || {};
    const instance = Object.create(factory);
    instance.mount?.(host, context);
    return instance;
  }

  function setAssets(catalog = {}) {
    assetCatalog = catalog && typeof catalog === 'object' ? catalog : Object.create(null);
  }

  function mountHost(host, context = {}) {
    if (!host || mounted.has(host)) return mounted.get(host) || null;
    const id = host.getAttribute('data-rv-background') || '';
    const factory = factories.get(id);
    if (!factory) return null;
    const owner = host.closest?.('section') || null;
    const presentationRoot = host.closest?.('.reveal') || null;
    const reparented = !!presentationRoot && host.parentElement !== presentationRoot;
    if (reparented) presentationRoot.appendChild(host);
    const assets = assetCatalog[id] || {};
    const state = animationStates.get(id) || { time: 0 };
    animationStates.set(id, state);
    let instance;
    try {
      instance = createInstance(factory, host, {
        ...context, id, host, assets, state,
        asset: name => assets[String(name || '')] || '',
      });
    }
    catch (error) { console.error(`Background "${id}" mount failed`, error); return null; }
    mounted.set(host, { id, host, instance, owner, reparented, running: false });
    host.hidden = true;
    return mounted.get(host);
  }

  function mountAll(root = global.document, context = {}) {
    if (!root?.querySelectorAll) return [];
    return Array.from(root.querySelectorAll('.rv-background-host[data-rv-background]'))
      .map(host => mountHost(host, context)).filter(Boolean);
  }

  function setRunning(record, shouldRun) {
    if (!record) return;
    record.host.hidden = !shouldRun;
    record.host.classList.toggle('rv-background-runtime-active', shouldRun);
    if (record.running === shouldRun) return;
    if (shouldRun) safeCall(record.instance, 'redraw');
    safeCall(record.instance, shouldRun ? 'start' : 'stop');
    record.running = shouldRun;
  }

  function setActiveSection(section) {
    mounted.forEach((record, host) => {
      const ownerIsVisible = !!record.owner?.classList?.contains('present');
      const shouldRun = !!section && (record.owner === section || ownerIsVisible);
      if (shouldRun && record.running) {
        // Re-entry must restart the effect even if its internal animation loop
        // was stopped by visibility/reduced-motion handling while away.
        record.host.hidden = false;
        record.host.classList.add('rv-background-runtime-active');
        safeCall(record.instance, 'redraw');
        safeCall(record.instance, 'stop');
        safeCall(record.instance, 'start');
      } else {
        setRunning(record, shouldRun);
      }
    });
  }

  function destroyHost(host) {
    const record = mounted.get(host);
    if (!record) return;
    setRunning(record, false);
    safeCall(record.instance, 'destroy');
    if (record.reparented) host.remove();
    mounted.delete(host);
  }

  function refresh(root = global.document, context = {}) {
    const liveHosts = new Set(root?.querySelectorAll ? root.querySelectorAll('.rv-background-host[data-rv-background]') : []);
    Array.from(mounted.keys()).forEach(host => {
      const record = mounted.get(host);
      const id = host.getAttribute?.('data-rv-background') || '';
      if (!liveHosts.has(host) || id !== record.id) destroyHost(host);
    });
    mountAll(root, context);
  }

  function destroyAll() {
    Array.from(mounted.keys()).forEach(destroyHost);
  }

  function bindReveal(reveal, root = global.document) {
    refresh(root, { reveal, presentation: true });
    const sync = event => {
      const section = event?.currentSlide || reveal?.getCurrentSlide?.() || null;
      setActiveSection(section);
    };
    reveal?.on?.('ready', sync);
    reveal?.on?.('slidechanged', sync);
    sync();
    return function unbind() {
      reveal?.off?.('ready', sync);
      reveal?.off?.('slidechanged', sync);
      destroyAll();
    };
  }

  global.RevealationBackgroundRuntime = Object.freeze({
    register, setAssets, mountAll, refresh, setActiveSection, destroyHost, destroyAll, bindReveal,
  });
})(window);
