/** Regression coverage for bounded PWA startup and late service-worker control. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const listeners = new Map();
const registrationListeners = new Map();
const registration = {
  waiting: null,
  installing: null,
  addEventListener(type, callback) {
    const list = registrationListeners.get(type) || [];
    list.push(callback);
    registrationListeners.set(type, list);
  },
  update: () => new Promise(() => {}),
};
const serviceWorker = {
  controller: null,
  ready: new Promise(() => {}),
  register: async () => registration,
  addEventListener(type, callback) {
    const list = listeners.get(type) || [];
    list.push(callback);
    listeners.set(type, list);
  },
  removeEventListener() {},
};

const realSetTimeout = setTimeout;
const testConsole = { log: console.log, error: console.error, warn() {} };
const window = {
  Revealation: { build: 'pwa-smoke-build', urls: { deployment: value => value } },
  isSecureContext: true,
  navigator: { serviceWorker },
  location: { reload() {} },
  AbortController,
  fetch: () => new Promise(() => {}),
  setInterval: () => 0,
  addEventListener() {},
};
window.window = window;
const context = {
  window,
  navigator: window.navigator,
  console: testConsole,
  fetch: (...args) => window.fetch(...args),
  AbortController,
  Promise,
  Date,
  // Keep the test fast while preserving the asynchronous ordering of timers.
  setTimeout: (callback) => realSetTimeout(callback, 0),
  clearTimeout,
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/pwa/runtime.js'), 'utf8'), context, {
  filename: 'src/pwa/runtime.js',
});

const assert = (condition, message) => { if (!condition) throw new Error(message); };

(async () => {
  const started = Date.now();
  await window.Revealation.pwa.register();
  assert(Date.now() - started < 1000, 'PWA registration remained blocked by an unresolved startup promise');
  assert(window.Revealation.pwa.controlled === false, 'uncontrolled startup was reported as controlled');

  let controlChanges = 0;
  serviceWorker.controller = { postMessage() {} };
  await window.Revealation.pwa.register({ onControllerChange: () => { controlChanges += 1; } });
  assert(window.Revealation.pwa.controlled === true, 'late service-worker control was not observed');
  assert(controlChanges === 1, 'service-worker control callback was not delivered');

  window.fetch = async () => ({ ok: true, json: async () => ({ version: '0.1.0', build: 'pwa-smoke-build' }) });
  const verified = await window.Revealation.pwa.verifyDeployment();
  assert(verified.matches === true, 'matching packaged and published builds were not verified');

  window.fetch = async () => ({ ok: true, json: async () => ({ version: '0.1.0', build: 'newer-build' }) });
  const mismatch = await window.Revealation.pwa.verifyDeployment();
  assert(mismatch.matches === false, 'different packaged and published builds were reported as matching');

  console.log('pwa runtime: OK');
})().catch(error => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
