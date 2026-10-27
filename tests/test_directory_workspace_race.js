/** Directory workspace operations must serialize a deck's two-file writes. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const failNotFound = name => {
  const error = new Error(`${name} not found`);
  error.name = 'NotFoundError';
  throw error;
};

class MemoryDirectory {
  constructor(name = 'workspace') {
    this.kind = 'directory';
    this.name = name;
    this.id = name;
    this.directories = new Map();
    this.files = new Map();
  }

  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.directories.has(name)) {
      if (!create) failNotFound(name);
      this.directories.set(name, new MemoryDirectory(name));
    }
    return this.directories.get(name);
  }

  async getFileHandle(name, { create = false } = {}) {
    if (!this.files.has(name)) {
      if (!create) failNotFound(name);
      this.files.set(name, { content: '', lastModified: Date.now() });
    }
    return new MemoryFile(this, name);
  }

  async *entries() {
    for (const [name, directory] of this.directories) yield [name, directory];
    for (const name of this.files.keys()) yield [name, new MemoryFile(this, name)];
  }
}

let activeWrites = 0;
let maximumActiveWrites = 0;

class MemoryFile {
  constructor(directory, name) {
    this.kind = 'file';
    this.name = name;
    this.directory = directory;
    this.name = name;
  }

  async getFile() {
    const value = this.directory.files.get(this.name);
    return {
      name: this.name,
      size: value.content.length,
      lastModified: value.lastModified,
      text: async () => value.content,
    };
  }

  async createWritable() {
    activeWrites += 1;
    maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
    const value = this.directory.files.get(this.name);
    let content = '';
    return {
      write: async data => {
        await delay(5);
        content = String(data);
      },
      close: async () => {
        await delay(5);
        value.content = content;
        value.lastModified = Date.now();
        activeWrites -= 1;
      },
    };
  }
}

const handleStore = {
  open: async () => {},
  isOpen: () => true,
  async get(_store, key) { return this.values?.get(key); },
  async put(_store, value, key) { this.values ||= new Map(); this.values.set(key, value); return key; },
  async getAll() { return this.values ? Array.from(this.values.values()) : []; },
};

const window = {
  isSecureContext: true,
  location: { href: 'https://example.test/revealation/' },
  document: { currentScript: { src: 'https://example.test/revealation/__app__/src/core/revealation.js' } },
  setTimeout,
  clearTimeout,
};
window.window = window;
const navigator = {};
const context = { window, navigator, console, URL, Math, Date, setTimeout, clearTimeout };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/core/revealation.js'), 'utf8'), context);
window.Revealation.storage.createIndexedDbStore = () => handleStore;
vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/storage/directory.js'), 'utf8'), context);

const directory = window.Revealation.storage.directory;
const root = new MemoryDirectory();
const assert = (condition, message) => { if (!condition) throw new Error(message); };

(async () => {
  await directory.activate(root);
  const first = directory.saveDeck(
    { id: 'first', name: 'First', slides: [{ id: 'first-slide' }] },
    '# First\n',
  );
  const second = directory.saveDeck(
    { id: 'second', name: 'Second', slides: [{ id: 'second-slide' }] },
    '# Second\n',
  );
  await Promise.all([first, second]);

  assert(maximumActiveWrites === 1, 'concurrent saves overlapped file writes');
  assert(root.files.get('deck.md').content === '# Second\n', 'later queued save did not win');
  assert(JSON.parse(root.files.get('deck.json').content).name === 'Second', 'metadata and Markdown came from different saves');
  console.log('directory workspace race: OK');
})().catch(error => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
