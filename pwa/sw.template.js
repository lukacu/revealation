/* Revealation PWA service worker. BUILD_ID is injected by scripts/build-pages.sh. */
'use strict';

const BUILD_ID = '__BUILD_ID__';
const CACHE_PREFIX = 'revealation-shell-';
const CACHE_NAME = CACHE_PREFIX + BUILD_ID;
const PRECACHE_MANIFEST = 'precache-manifest.json';

// Must match src/storage/directory.js.
const WORKSPACE_DB_NAME = 'revealation-directory-workspaces';
const WORKSPACE_DB_VERSION = 1;
const WORKSPACE_STORE = 'handles';
const WORKSPACE_KEY = 'active';

const RESERVED_ROOT_FILES = new Set([
  '', 'index.html', 'manifest.webmanifest', 'version.json', PRECACHE_MANIFEST, 'sw.js', '.nojekyll',
]);
const RESERVED_ROOT_PREFIXES = ['__app__/'];
let workspaceHandlePromise = null;

function scopeUrl(path = '') {
  return new URL(path, self.registration.scope).href;
}

function relativeToScope(url) {
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return null;
  const raw = url.pathname.slice(scope.pathname.length);
  try { return decodeURIComponent(raw); } catch (_) { return raw; }
}

function isWorkspaceRequest(relativePath) {
  if (relativePath == null || RESERVED_ROOT_FILES.has(relativePath)) return false;
  return !RESERVED_ROOT_PREFIXES.some(prefix => relativePath.startsWith(prefix));
}

function openWorkspaceDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WORKSPACE_DB_NAME, WORKSPACE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WORKSPACE_STORE)) db.createObjectStore(WORKSPACE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadWorkspaceHandle() {
  if (workspaceHandlePromise) return workspaceHandlePromise;
  workspaceHandlePromise = (async () => {
    try {
      const db = await openWorkspaceDb();
      const handle = await new Promise((resolve, reject) => {
        const request = db.transaction(WORKSPACE_STORE, 'readonly').objectStore(WORKSPACE_STORE).get(WORKSPACE_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      db.close();
      if (!handle) return null;
      if (typeof handle.queryPermission === 'function') {
        const permission = await handle.queryPermission({ mode: 'read' });
        if (permission !== 'granted') return null;
      }
      return handle;
    } catch (_) {
      return null;
    }
  })();
  return workspaceHandlePromise;
}

function safePathParts(path) {
  const clean = String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = clean.split('/').filter(Boolean);
  if (parts.some(part => part === '.' || part === '..' || part.includes('\0'))) return null;
  return parts;
}

async function workspaceFile(path) {
  const root = await loadWorkspaceHandle();
  if (!root) return null;
  const parts = safePathParts(path);
  if (!parts?.length) return null;
  let dir = root;
  try {
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    const handle = await dir.getFileHandle(parts[parts.length - 1]);
    return await handle.getFile();
  } catch (error) {
    if (error?.name === 'NotFoundError' || error?.name === 'TypeMismatchError') return null;
    throw error;
  }
}

function inferMime(name, fallback = '') {
  if (fallback) return fallback;
  const ext = String(name || '').toLowerCase().split('.').pop();
  return ({
    html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8',
  })[ext] || 'application/octet-stream';
}

function fileResponse(file, request) {
  const type = inferMime(file.name, file.type);
  const common = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Last-Modified': new Date(file.lastModified || Date.now()).toUTCString(),
  };
  const range = request.headers.get('Range');
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) return new Response(file, { status: 200, headers: { ...common, 'Content-Length': String(file.size) } });

  let start;
  let end;
  if (match[1]) {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : file.size - 1;
  } else if (match[2]) {
    const count = Number(match[2]);
    start = Math.max(0, file.size - count);
    end = file.size - 1;
  } else {
    start = 0;
    end = file.size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= file.size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${file.size}` } });
  }
  end = Math.min(end, file.size - 1);
  const body = file.slice(start, end + 1, type);
  return new Response(body, {
    status: 206,
    headers: {
      ...common,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${file.size}`,
    },
  });
}

async function tryWorkspaceResponse(request, relativePath) {
  const path = relativePath.endsWith('/') ? `${relativePath}index.html` : relativePath;
  const file = await workspaceFile(path);
  return file ? fileResponse(file, request) : null;
}

async function precacheShell() {
  const response = await fetch(scopeUrl(PRECACHE_MANIFEST), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Precache manifest HTTP ${response.status}`);
  const files = await response.json();
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(files.map(path => scopeUrl(path)));
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    await precacheShell();
    // First install can activate immediately. Updates wait until the editor UI
    // asks explicitly, avoiding a surprise reload while a deck is being edited.
    if (!self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const type = event.data?.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  if (type === 'WORKSPACE_HANDLE_CHANGED') workspaceHandlePromise = null;
});

async function shellResponse(request, relativePath) {
  // These files are used to discover updates and should never be satisfied by
  // an old runtime cache.
  if (relativePath === 'version.json' || relativePath === PRECACHE_MANIFEST) {
    return fetch(request, { cache: 'no-store' });
  }

  const cache = await caches.open(CACHE_NAME);
  if (request.mode === 'navigate' && (relativePath === '' || relativePath === 'index.html')) {
    try {
      const response = await fetch(request);
      if (response.ok) cache.put(scopeUrl('index.html'), response.clone());
      return response;
    } catch (_) {
      return (await cache.match(scopeUrl('index.html'))) || (await cache.match(scopeUrl('')));
    }
  }

  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && request.method === 'GET') cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' && request.method !== 'HEAD') return;
  const url = new URL(request.url);
  const relativePath = relativeToScope(url);
  if (relativePath == null) return;

  event.respondWith((async () => {
    if (isWorkspaceRequest(relativePath)) {
      try {
        const workspace = await tryWorkspaceResponse(request, relativePath);
        if (workspace) return request.method === 'HEAD'
          ? new Response(null, { status: workspace.status, headers: workspace.headers })
          : workspace;
      } catch (_) {
        // Permission may have been revoked between page load and this request.
        // Fall through to the deployed app/network response rather than cache
        // user data or exposing a stale copy.
      }
    }
    return shellResponse(request, relativePath);
  })());
});
