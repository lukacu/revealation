/**
 * Revealation — browser directory workspace storage adapter
 * =========================================================
 *
 * Purpose
 * -------
 * Use the File System Access API as a real Revealation workspace when the app
 * is running as a hosted/PWA application rather than behind `server.py`.
 *
 * Responsibilities
 * ----------------
 * - let the user select/reconnect a read-write presentation directory;
 * - persist multiple recent directory handles in IndexedDB for later sessions;
 * - keep exactly one active handle for the service-worker workspace bridge;
 * - read/write deck.md and deck.json directly in that directory;
 * - recursively list workspace files and upload assets with relative paths;
 * - expose raw File objects for exporters;
 * - notify the service worker when the active directory changes.
 *
 * Does NOT
 * --------
 * - interpret Markdown or mutate presentation state;
 * - cache presentation files inside browser storage;
 * - request filesystem permission without a user gesture;
 * - provide URLs for workspace files itself. In PWA mode the service worker
 *   maps ordinary scope-relative URLs to this same directory.
 *
 * Dependencies / contract
 * -----------------------
 * Requires `Revealation.storage.createIndexedDbStore()` from indexeddb.js and
 * a browser implementing `showDirectoryPicker()`. The persisted handle store
 * names are also consumed by `pwa/sw.template.js`; keep them synchronized.
 *
 * Public API
 * ----------
 * `Revealation.storage.directory` (`pick()` and `activate()` are split so a
 * folder chooser can start inside a user gesture before the old workspace has
 * finished its final save).
 */
(function registerDirectoryStorage(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  const DB_NAME = 'revealation-directory-workspaces';
  const DB_VERSION = 1;
  const STORE_HANDLES = 'handles';
  const ACTIVE_KEY = 'active';
  const RECENT_PREFIX = 'recent:';
  const RECENT_TYPE = 'recent-workspace';
  const DECK_FILENAME = 'deck.json';
  const DECK_MD_FILENAME = 'deck.md';
  const SKIP_DIRS = new Set(['.git', '.hg', '.svn', '__pycache__', 'node_modules', '.venv', 'venv']);

  let handleStore = null;
  let activeHandle = null;
  let recentCache = [];

  function supported() {
    return !!(global.isSecureContext && typeof global.showDirectoryPicker === 'function'
      && app.storage?.createIndexedDbStore);
  }

  function ensureHandleStore() {
    if (handleStore) return handleStore;
    if (!app.storage?.createIndexedDbStore) throw new Error('IndexedDB adapter unavailable.');
    handleStore = app.storage.createIndexedDbStore({
      dbName: DB_NAME,
      version: DB_VERSION,
      stores: [{ name: STORE_HANDLES }],
    });
    return handleStore;
  }

  async function openHandleStore() {
    const store = ensureHandleStore();
    if (!store.isOpen()) await store.open();
    return store;
  }

  function newRecentId() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return `workspace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function recentKey(id) { return `${RECENT_PREFIX}${id}`; }

  async function storedHandle() {
    if (!supported()) return null;
    try {
      return await (await openHandleStore()).get(STORE_HANDLES, ACTIVE_KEY) || null;
    } catch (error) {
      console.warn('Could not restore directory workspace handle', error);
      return null;
    }
  }

  async function sameEntry(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    try {
      if (typeof a.isSameEntry === 'function') return await a.isSameEntry(b);
      if (typeof b.isSameEntry === 'function') return await b.isSameEntry(a);
    } catch (_) {}
    return false;
  }

  function isRecentRecord(value) {
    return !!(value && value.type === RECENT_TYPE && value.id && value.handle?.kind === 'directory');
  }

  async function loadRecentRecords() {
    const values = await (await openHandleStore()).getAll(STORE_HANDLES);
    recentCache = values.filter(isRecentRecord).sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
    return recentCache;
  }

  async function findRecentForHandle(handle, records = recentCache) {
    for (const record of records) {
      if (await sameEntry(record.handle, handle)) return record;
    }
    return null;
  }

  async function rememberHandle(handle, preferredId = null) {
    const store = await openHandleStore();
    await store.put(STORE_HANDLES, handle, ACTIVE_KEY);
    let records = recentCache.length ? recentCache : await loadRecentRecords();
    let record = preferredId ? records.find(item => item.id === preferredId) : null;
    if (!record) record = await findRecentForHandle(handle, records);
    const now = Date.now();
    const next = {
      type: RECENT_TYPE,
      id: record?.id || preferredId || newRecentId(),
      name: handle.name || record?.name || 'Presentation',
      handle,
      lastOpened: now,
    };
    await store.put(STORE_HANDLES, next, recentKey(next.id));
    recentCache = [next, ...records.filter(item => item.id !== next.id)].sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
    return next;
  }

  async function permissionState(handle, mode = 'readwrite') {
    if (!handle) return 'denied';
    try {
      if (typeof handle.queryPermission === 'function') {
        return await handle.queryPermission({ mode });
      }
    } catch (_) {}
    return 'prompt';
  }

  async function requestPermission(handle, mode = 'readwrite') {
    if (!handle) return 'denied';
    const current = await permissionState(handle, mode);
    if (current === 'granted') return current;
    try {
      if (typeof handle.requestPermission === 'function') {
        return await handle.requestPermission({ mode });
      }
    } catch (_) {}
    return current;
  }

  function infoFor(handle, permission = 'granted', record = null) {
    if (!handle) return null;
    return {
      enabled: true,
      kind: 'directory',
      id: record?.id || null,
      name: handle.name || record?.name || 'Presentation',
      root: handle.name || '',
      deckFile: DECK_MD_FILENAME,
      metadataFile: DECK_FILENAME,
      permission,
      lastOpened: record?.lastOpened || 0,
    };
  }

  async function listRecent() {
    if (!supported()) return [];
    try {
      let records = await loadRecentRecords();
      const legacyActive = await storedHandle();
      if (legacyActive && !(await findRecentForHandle(legacyActive, records))) {
        // Upgrade the pre-history single-handle layout in place. The active
        // key remains untouched because the service worker reads it directly.
        const migrated = await rememberHandle(legacyActive);
        records = [migrated, ...recentCache.filter(item => item.id !== migrated.id)];
      }
      const active = legacyActive;
      const result = [];
      for (const record of records) {
        const permission = await permissionState(record.handle);
        result.push({
          ...infoFor(record.handle, permission, record),
          active: active ? await sameEntry(active, record.handle) : false,
        });
      }
      return result;
    } catch (error) {
      console.warn('Could not load recent directory workspaces', error);
      return [];
    }
  }

  async function inspectStored() {
    const handle = await storedHandle();
    if (!handle) return null;
    activeHandle = handle;
    const records = recentCache.length ? recentCache : await loadRecentRecords();
    const record = await findRecentForHandle(handle, records);
    return infoFor(handle, await permissionState(handle), record);
  }

  async function detect() {
    const handle = await storedHandle();
    if (!handle) return null;
    const permission = await permissionState(handle);
    if (permission !== 'granted') return null;
    activeHandle = handle;
    const records = recentCache.length ? recentCache : await loadRecentRecords();
    const record = await findRecentForHandle(handle, records);
    return infoFor(handle, permission, record);
  }

  function openRecent(id) {
    // listRecent() is called while rendering the splash, so the real handle is
    // already in memory. requestPermission() is deliberately invoked before
    // the first await to preserve the click's transient user activation.
    const record = recentCache.find(item => item.id === id);
    if (!record) return Promise.reject(new Error('This recent folder is no longer available. Refresh the list.'));
    let permissionPromise;
    try {
      permissionPromise = typeof record.handle.requestPermission === 'function'
        ? record.handle.requestPermission({ mode: 'readwrite' })
        : permissionState(record.handle);
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.resolve(permissionPromise).then(async permission => {
      if (permission !== 'granted') return null;
      return activate(record.handle, permission, { recentId: record.id });
    });
  }

  async function reconnect() {
    const handle = activeHandle || await storedHandle();
    if (!handle) return null;
    let permissionPromise = null;
    try {
      if (typeof handle.requestPermission === 'function') permissionPromise = handle.requestPermission({ mode: 'readwrite' });
    } catch (_) {}
    const permission = permissionPromise ? await permissionPromise : await permissionState(handle);
    if (permission !== 'granted') return null;
    activeHandle = handle;
    const record = await rememberHandle(handle);
    await notifyServiceWorker();
    return infoFor(handle, permission, record);
  }

  async function pick() {
    if (!supported()) throw new Error('Local directory access is not supported by this browser.');
    const handle = await global.showDirectoryPicker({
      id: 'revealation-workspace',
      mode: 'readwrite',
    });
    const permission = await requestPermission(handle);
    if (permission !== 'granted') throw new Error('Read/write permission was not granted for this directory.');
    return { handle, permission, info: infoFor(handle, permission) };
  }

  async function activate(handle, permission = 'granted', { recentId = null } = {}) {
    if (!handle) throw new Error('Missing local presentation directory handle.');
    activeHandle = handle;
    const record = await rememberHandle(handle, recentId);
    await notifyServiceWorker();
    return infoFor(handle, permission, record);
  }

  async function choose() {
    const choice = await pick();
    return activate(choice.handle, choice.permission);
  }

  async function forget() {
    activeHandle = null;
    try { await (await openHandleStore()).remove(STORE_HANDLES, ACTIVE_KEY); } catch (_) {}
    await notifyServiceWorker();
  }

  async function removeRecent(id) {
    if (!id) return;
    const record = recentCache.find(item => item.id === id) || null;
    const active = activeHandle || await storedHandle();
    const removesActive = !!(record && active && await sameEntry(record.handle, active));
    const store = await openHandleStore();
    await store.remove(STORE_HANDLES, recentKey(id));
    recentCache = recentCache.filter(item => item.id !== id);
    if (removesActive) {
      activeHandle = null;
      await store.remove(STORE_HANDLES, ACTIVE_KEY);
      await notifyServiceWorker();
    }
  }

  function requireHandle() {
    if (!activeHandle) throw new Error('No local presentation directory is connected.');
    return activeHandle;
  }

  function pathParts(path) {
    const value = String(path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!value) return [];
    const parts = value.split('/').filter(Boolean);
    if (parts.some(part => part === '.' || part === '..' || part.includes('\0'))) {
      throw new Error('Invalid workspace path.');
    }
    return parts;
  }

  async function directoryFor(parts, { create = false, root = null } = {}) {
    let dir = root || requireHandle();
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  }

  async function fileHandleFor(path, { create = false, root = null } = {}) {
    const parts = pathParts(path);
    if (!parts.length) throw new Error('Missing file path.');
    const name = parts.pop();
    const dir = await directoryFor(parts, { create, root });
    return dir.getFileHandle(name, { create });
  }

  async function readFile(path, root = null) {
    return (await fileHandleFor(path, { root })).getFile();
  }

  async function readText(path, root = null) {
    return (await readFile(path, root)).text();
  }

  async function writeFile(path, data, root = null) {
    const fileHandle = await fileHandleFor(path, { create: true, root });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(data);
    } finally {
      await writable.close();
    }
  }

  function revisionToken(value) {
    return `v1:${JSON.stringify(value)}`;
  }

  async function deckRevision() {
    const entries = {};
    for (const name of [DECK_FILENAME, DECK_MD_FILENAME]) {
      try {
        const file = await readFile(name);
        entries[name] = { exists: true, size: file.size, modifiedAt: Number(file.lastModified || 0) * 1e6 };
      } catch (error) {
        if (error?.name === 'NotFoundError') entries[name] = { exists: false };
        else throw error;
      }
    }
    return revisionToken(entries);
  }

  async function loadDeck() {
    let project = null;
    let markdown = null;
    let markdownExists = false;
    let jsonMtimeNs = 0;
    let markdownMtimeNs = 0;
    let jsonSize = 0;
    let markdownSize = 0;
    const errors = [];

    try {
      const file = await readFile(DECK_FILENAME);
      jsonMtimeNs = Number(file.lastModified || 0) * 1e6;
      jsonSize = file.size;
      project = JSON.parse(await file.text());
    } catch (error) {
      if (error?.name !== 'NotFoundError') errors.push(`Cannot read ${DECK_FILENAME}: ${error.message || error}`);
    }

    try {
      const file = await readFile(DECK_MD_FILENAME);
      markdownExists = true;
      markdownMtimeNs = Number(file.lastModified || 0) * 1e6;
      markdownSize = file.size;
      markdown = await file.text();
    } catch (error) {
      if (error?.name !== 'NotFoundError') errors.push(`Cannot read ${DECK_MD_FILENAME}: ${error.message || error}`);
    }

    return {
      exists: project !== null || markdownExists,
      project,
      markdown,
      markdownExists,
      markdownPreferred: markdownExists,
      metadataNewer: !!(jsonMtimeNs && markdownMtimeNs && jsonMtimeNs > markdownMtimeNs),
      jsonMtimeNs,
      markdownMtimeNs,
      revision: { deckToken: revisionToken({
        [DECK_FILENAME]: project === null ? { exists: false } : { exists: true, size: jsonSize, modifiedAt: jsonMtimeNs },
        [DECK_MD_FILENAME]: markdownExists ? { exists: true, size: markdownSize, modifiedAt: markdownMtimeNs } : { exists: false },
      }) },
      errors,
    };
  }

  function metadataProject(project) {
    const p = project && typeof project === 'object' ? project : {};
    return {
      ...p,
      assets: [],
      slides: Array.isArray(p.slides) ? p.slides.map(slide => ({ id: slide?.id || '' })) : [],
    };
  }

  async function getWorkspaceState() {
    const files = await listFiles();
    return {
      ok: true,
      revision: {
        deckToken: await deckRevision(),
        assetsToken: revisionToken(files.map(file => ({
          path: file.path,
          size: file.size,
          modifiedAt: file.modifiedAt || 0,
        }))),
      },
      files,
    };
  }

  async function saveDeck(project, markdown, { expectedRevision = null } = {}) {
    // Snapshot the destination before the first await. This matters when the
    // user opens the Change folder picker while a final save is in flight:
    // that save must finish in the old workspace even if the picker resolves.
    const root = requireHandle();
    const expectedToken = expectedRevision?.deckToken || expectedRevision || null;
    if (expectedToken) {
      const currentToken = await deckRevision();
      if (currentToken !== expectedToken) {
        const error = new Error('The presentation changed on disk.');
        error.code = 'WORKSPACE_CONFLICT';
        error.revision = await getWorkspaceState();
        throw error;
      }
    }
    await writeFile(DECK_FILENAME, JSON.stringify(metadataProject(project), null, 2), root);
    if (typeof markdown === 'string') await writeFile(DECK_MD_FILENAME, markdown, root);
    return {
      ok: true,
      deckFile: DECK_MD_FILENAME,
      metadataFile: DECK_FILENAME,
      revision: (await getWorkspaceState()).revision,
    };
  }

  function inferMime(name, fallback = '') {
    if (fallback) return fallback;
    const ext = String(name || '').toLowerCase().split('.').pop();
    return ({
      svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
      mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
      mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
      html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', json: 'application/json', txt: 'text/plain',
    })[ext] || 'application/octet-stream';
  }

  function kindFor(mime) {
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return 'file';
  }

  function quotePath(path) {
    return String(path || '').split('/').map(part => encodeURIComponent(part)).join('/');
  }

  async function listFiles() {
    const result = [];
    async function scan(dir, prefix = '') {
      for await (const [name, entry] of dir.entries()) {
        if (!name || name.startsWith('.')) continue;
        const rel = prefix ? `${prefix}/${name}` : name;
        if (entry.kind === 'directory') {
          if (SKIP_DIRS.has(name)) continue;
          await scan(entry, rel);
          continue;
        }
        if (prefix === '' && (name === DECK_FILENAME || name === DECK_MD_FILENAME)) continue;
        try {
          const file = await entry.getFile();
          const mime = inferMime(name, file.type);
          result.push({
            id: rel,
            name,
            path: rel,
            type: mime,
            kind: kindFor(mime),
            size: file.size,
            modifiedAt: file.lastModified || 0,
            dataUrl: quotePath(rel),
          });
        } catch (_) {}
      }
    }
    await scan(requireHandle());
    result.sort((a, b) => String(a.path).localeCompare(String(b.path)));
    return result;
  }

  async function uniqueUploadPath(subdir, originalName) {
    const cleanName = String(originalName || 'asset.bin').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim() || 'asset.bin';
    const dot = cleanName.lastIndexOf('.');
    const stem = dot > 0 ? cleanName.slice(0, dot) : cleanName;
    const suffix = dot > 0 ? cleanName.slice(dot) : '';
    for (let n = 1; n < 10000; n += 1) {
      const name = n === 1 ? cleanName : `${stem}-${n}${suffix}`;
      const path = `${String(subdir || 'assets').replace(/^\/+|\/+$/g, '')}/${name}`;
      try {
        await fileHandleFor(path);
      } catch (error) {
        if (error?.name === 'NotFoundError') return path;
        throw error;
      }
    }
    throw new Error('Could not choose a unique asset filename.');
  }

  async function uploadFile(file, subdir = 'assets') {
    if (!file) throw new Error('No file supplied.');
    const path = await uniqueUploadPath(subdir, file.name || 'asset.bin');
    await writeFile(path, file);
    const stored = await readFile(path);
    const mime = inferMime(stored.name, stored.type || file.type);
    return {
      id: path,
      name: path.split('/').pop(),
      path,
      type: mime,
      kind: kindFor(mime),
      size: stored.size,
      modifiedAt: stored.lastModified || Date.now(),
      dataUrl: quotePath(path),
    };
  }

  async function notifyServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.getRegistration(app.urls.deployment(''));
      const workers = [navigator.serviceWorker.controller, registration?.active, registration?.waiting, registration?.installing]
        .filter(Boolean);
      workers.forEach(worker => worker.postMessage({ type: 'WORKSPACE_HANDLE_CHANGED' }));
    } catch (_) {}
  }

  app.storage.directory = Object.freeze({
    supported,
    listRecent,
    inspectStored,
    detect,
    openRecent,
    reconnect,
    pick,
    activate,
    choose,
    forget,
    removeRecent,
    loadDeck,
    getWorkspaceState,
    saveDeck,
    listFiles,
    uploadFile,
    readFile,
    db: Object.freeze({ name: DB_NAME, version: DB_VERSION, store: STORE_HANDLES, key: ACTIVE_KEY }),
  });
})(window);
