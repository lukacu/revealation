/**
 * Lossless browser-library persistence regression:
 * IndexedDB adapter -> backup ZIP -> fresh IndexedDB adapter.
 *
 * The test uses the real Revealation IndexedDB/backup modules and vendored
 * JSZip. A tiny deterministic IndexedDB backend supplies browser transaction
 * semantics so this safety check runs in CI without optional browser packages.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const JSZip = require('../vendor/jszip/jszip.min.js');

const ROOT = path.resolve(__dirname, '..');
const clone = value => value == null ? value : structuredClone(value);
const databases = new Map();

class NameList {
  constructor(db) { this.db = db; }
  contains(name) { return this.db.stores.has(name); }
}

class FakeTransaction {
  constructor(db, names, mode) {
    this.db = db;
    this.names = names;
    this.mode = mode;
    this.aborted = false;
    this.error = null;
    this.oncomplete = null;
    this.onabort = null;
    this.onerror = null;
    this.working = new Map();
    for (const name of names) {
      const source = db.stores.get(name);
      if (!source) throw new Error(`Unknown store ${name}`);
      this.working.set(name, {
        options: source.options,
        data: new Map(Array.from(source.data, ([key, value]) => [key, clone(value)])),
      });
    }
    setTimeout(() => this.finish(), 0);
  }
  objectStore(name) {
    const target = this.working.get(name);
    if (!target) throw new Error(`Store ${name} is outside this transaction`);
    const request = operation => {
      const req = { result: undefined, error: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        if (this.aborted) return;
        try {
          req.result = operation();
          req.onsuccess?.();
        } catch (error) {
          req.error = error;
          this.error = error;
          req.onerror?.();
          this.onerror?.();
        }
      });
      return req;
    };
    return {
      get: key => request(() => clone(target.data.get(key))),
      getAll: () => request(() => Array.from(target.data.values(), clone)),
      put: (value, explicitKey) => request(() => {
        if (this.mode !== 'readwrite') throw new Error('Readonly transaction');
        const key = explicitKey !== undefined ? explicitKey : value?.[target.options?.keyPath];
        if (key === undefined) throw new Error('Missing key');
        target.data.set(key, clone(value));
        return key;
      }),
      delete: key => request(() => { target.data.delete(key); }),
      clear: () => request(() => { target.data.clear(); }),
    };
  }
  abort() {
    if (this.aborted) return;
    this.aborted = true;
    queueMicrotask(() => this.onabort?.());
  }
  finish() {
    if (this.aborted) return;
    if (this.mode === 'readwrite') {
      for (const [name, store] of this.working) {
        this.db.stores.set(name, { options: store.options, data: store.data });
      }
    }
    this.oncomplete?.();
  }
}

class FakeDatabase {
  constructor(name, version) {
    this.name = name;
    this.version = version;
    this.stores = new Map();
    this.objectStoreNames = new NameList(this);
  }
  createObjectStore(name, options) {
    this.stores.set(name, { options: options || {}, data: new Map() });
    return {};
  }
  transaction(names, mode) { return new FakeTransaction(this, Array.isArray(names) ? names : [names], mode); }
  close() {}
}

const indexedDB = {
  open(name, version) {
    const req = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
    queueMicrotask(() => {
      let db = databases.get(name);
      const needsUpgrade = !db || version > db.version;
      if (!db) {
        db = new FakeDatabase(name, version);
        databases.set(name, db);
      } else if (version > db.version) db.version = version;
      req.result = db;
      if (needsUpgrade) req.onupgradeneeded?.({ target: req });
      req.onsuccess?.();
    });
    return req;
  },
};

const window = {
  location: { href: 'https://example.test/revealation/' },
  document: { currentScript: { src: 'https://example.test/revealation/__app__/src/core/revealation.js' } },
};
window.window = window;
const context = { window, console, URL, indexedDB, structuredClone, setTimeout, queueMicrotask };
vm.createContext(context);
for (const relative of ['src/core/revealation.js', 'src/storage/indexeddb.js', 'src/storage/backup.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, relative), 'utf8'), context, { filename: relative });
}

const { createIndexedDbStore, backup } = window.Revealation.storage;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const makeStore = async name => {
  const store = createIndexedDbStore({
    dbName: name,
    version: 1,
    stores: [{ name: 'meta' }, { name: 'projects', options: { keyPath: 'id' } }],
  });
  await store.open();
  return store;
};
const canonical = library => {
  const snapshot = backup.snapshotLibrary(library);
  snapshot.projects.sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(snapshot);
};

(async () => {
  const projectA = {
    id: 'project-alpha', name: 'Alpha', title: 'Alpha title', author: 'Ada', theme: 'clean',
    createdAt: 1700000000000, modifiedAt: 1700000001234, currentId: 'slide-a2',
    config: { width: 1280, height: 720, hash: true, unknownFutureOption: 'keep-me' },
    assets: [
      { id: 'asset-1', name: 'pixel.png', type: 'image/png', size: 4, createdAt: 1700000000100, dataUrl: 'data:image/png;base64,AAECAw==' },
      { id: 'asset-2', name: 'sound.ogg', type: 'audio/ogg', size: 5, createdAt: 1700000000200, dataUrl: 'data:audio/ogg;base64,BAUGBwg=' },
    ],
    slides: [
      { id: 'slide-a1', content: '<h1>Alpha</h1><img src="data:image/png;base64,AAECAw==">', notes: 'speaker note', layout: 'single', vertical: false, hidden: false },
      { id: 'slide-a2', content: '<p>Second</p>', notes: '', layout: 'header-body', blocks: [{ html: '<h1>H</h1>', align: 'center' }, { html: '<p>B</p>', align: 'left' }], vertical: true, background: { id: 'grid' } },
    ],
    futureField: { nested: ['must', 'survive'], flag: true },
  };
  const projectB = {
    id: 'project-beta', name: 'Živjo β', title: 'Unicode ✓', author: 'Luka', theme: 'dark',
    createdAt: 1700000100000, modifiedAt: 1700000200000, currentId: 'slide-b1',
    config: { width: 1920, height: 1080 }, assets: [],
    slides: [{ id: 'slide-b1', content: '<p>βeta</p>', notes: 'čšž', layout: 'single', vertical: false }],
  };
  const meta = { currentProjectId: 'project-beta', deletedIds: [{ id: 'old-project', deletedAt: 1699999999999 }] };

  const sourceStore = await makeStore('roundtrip-source');
  await sourceStore.transaction(['projects', 'meta'], 'readwrite', stores => {
    stores.projects.put(projectA);
    stores.projects.put(projectB);
    stores.meta.put(meta, 'state');
  });
  const sourceLibrary = {
    version: 1,
    currentProjectId: (await sourceStore.get('meta', 'state')).currentProjectId,
    deletedIds: (await sourceStore.get('meta', 'state')).deletedIds,
    projects: await sourceStore.getAll('projects'),
  };

  const zip = new JSZip();
  const written = await backup.writeLibraryZip(zip, sourceLibrary);
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  const restored = await backup.readLibraryZip(await JSZip.loadAsync(bytes));

  const targetStore = await makeStore('roundtrip-target');
  await targetStore.transaction(['projects', 'meta'], 'readwrite', stores => {
    stores.projects.clear();
    stores.meta.clear();
    restored.projects.forEach(project => stores.projects.put(project));
    stores.meta.put({ currentProjectId: restored.currentProjectId, deletedIds: restored.deletedIds }, 'state');
  });
  const targetMeta = await targetStore.get('meta', 'state');
  const targetLibrary = {
    version: restored.version,
    currentProjectId: targetMeta.currentProjectId,
    deletedIds: targetMeta.deletedIds,
    projects: await targetStore.getAll('projects'),
  };

  assert(canonical(sourceLibrary) === canonical(targetLibrary), 'IndexedDB -> ZIP -> fresh IndexedDB changed persisted data');
  const alpha = targetLibrary.projects.find(project => project.id === 'project-alpha');
  assert(alpha.assets.length === 2 && alpha.assets[0].dataUrl === 'data:image/png;base64,AAECAw==', 'reusable base64 assets were lost');
  assert(alpha.futureField.nested.join('|') === 'must|survive', 'unknown/future project fields were dropped');
  assert(targetLibrary.currentProjectId === 'project-beta', 'currentProjectId was lost');
  assert(targetLibrary.deletedIds[0].id === 'old-project', 'deleted-project tombstones were lost');
  assert(written.manifest.format === 'revealation-library-backup', 'backup manifest marker missing');

  const corruptZip = await JSZip.loadAsync(bytes);
  corruptZip.remove(written.manifest.projects[0].file);
  let corruptRejected = false;
  try { await backup.readLibraryZip(corruptZip); } catch (_) { corruptRejected = true; }
  assert(corruptRejected, 'incomplete backup was accepted as a partial restore');

  const beforeAbort = canonical(targetLibrary);
  let abortRejected = false;
  try {
    await targetStore.transaction(['projects', 'meta'], 'readwrite', stores => {
      stores.projects.clear();
      stores.meta.clear();
      throw new Error('deliberate restore failure');
    });
  } catch (_) { abortRejected = true; }
  const afterAbortMeta = await targetStore.get('meta', 'state');
  const afterAbort = canonical({
    version: 1,
    currentProjectId: afterAbortMeta.currentProjectId,
    deletedIds: afterAbortMeta.deletedIds,
    projects: await targetStore.getAll('projects'),
  });
  assert(abortRejected && beforeAbort === afterAbort, 'failed atomic restore did not roll back cleanly');

  console.log('storage roundtrip: OK');
})().catch(error => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
