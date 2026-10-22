/** Dependency-free tests for the hosted directory recent-project registry. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const backing = new Map();
let pickerHandle = null;
const fakeStore = {
  _open: false,
  async open() { this._open = true; },
  isOpen() { return this._open; },
  async get(_store, key) { return backing.get(key); },
  async getAll() { return Array.from(backing.values()); },
  async put(_store, value, key) { backing.set(key, value); return key; },
  async remove(_store, key) { backing.delete(key); },
};

function handle(id, name, permission = 'granted') {
  let state = permission;
  let requests = 0;
  return {
    kind: 'directory', id, name,
    async queryPermission() { return state; },
    async requestPermission() { requests += 1; state = 'granted'; return state; },
    async isSameEntry(other) { return other?.id === id; },
    setPermission(value) { state = value; },
    get requestCount() { return requests; },
  };
}

const window = {
  isSecureContext: true,
  location: { href: 'https://example.test/revealation/' },
  document: { currentScript: { src: 'https://example.test/revealation/__app__/src/core/revealation.js' } },
  crypto: { randomUUID: (() => { let n = 0; return () => `recent-${++n}`; })() },
  showDirectoryPicker: async () => pickerHandle,
};
window.window = window;
const navigator = {};
const context = { window, navigator, console, URL, Math, Date, setTimeout, clearTimeout };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/core/revealation.js'), 'utf8'), context);
window.Revealation.storage.createIndexedDbStore = () => fakeStore;
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/storage/directory.js'), 'utf8'), context);

const directory = window.Revealation.storage.directory;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

(async () => {
  const alpha = handle('a', 'Alpha');
  const beta = handle('b', 'Beta');

  await directory.activate(alpha);
  const detected = await directory.detect();
  assert(detected?.name === 'Alpha', 'active directory was not detected after reload');
  let recent = await directory.listRecent();
  assert(recent.length === 1 && recent[0].name === 'Alpha', 'first directory was not added to recent history');
  const alphaId = recent[0].id;

  await new Promise(resolve => setTimeout(resolve, 2));
  await directory.activate(beta);
  recent = await directory.listRecent();
  assert(recent.length === 2 && recent[0].name === 'Beta', 'recent directories are not ordered by last open time');
  const betaId = recent.find(item => item.name === 'Beta').id;

  await new Promise(resolve => setTimeout(resolve, 2));
  await directory.activate(alpha);
  recent = await directory.listRecent();
  assert(recent.length === 2, 'reopening the same directory created a duplicate history entry');
  assert(recent[0].id === alphaId, 'reopening a directory did not retain its recent-project identity');

  await directory.forget();
  recent = await directory.listRecent();
  assert(recent.length === 2 && recent.every(item => !item.active), 'switching to browser storage erased or left an active recent folder');

  alpha.setPermission('prompt');
  recent = await directory.listRecent();
  assert(recent.find(item => item.id === alphaId).permission === 'prompt', 'recent permission state was not refreshed');
  const openPromise = directory.openRecent(alphaId);
  const opened = await openPromise;
  assert(opened?.name === 'Alpha' && alpha.requestCount === 1, 'recent folder did not request permission and reopen');

  await directory.removeRecent(betaId);
  recent = await directory.listRecent();
  assert(recent.length === 1 && recent[0].id === alphaId, 'removeRecent did not remove only the selected history entry');

  pickerHandle = beta;
  await directory.choose();
  recent = await directory.listRecent();
  assert(recent.length === 2 && recent.some(item => item.name === 'Beta'), 'newly picked folder was not added to recent history');

  console.log('directory registry: OK');
})().catch(error => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
