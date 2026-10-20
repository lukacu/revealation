/**
 * Revealation — filesystem workspace storage adapter
 * ==================================================
 *
 * Purpose
 * -------
 * Encapsulate the HTTP protocol implemented by `server.py`. The editor core
 * works with methods such as `loadDeck()` and `saveDeck()` instead of knowing
 * endpoint URLs or upload request details.
 *
 * Responsibilities
 * ----------------
 * - detect whether the Python workspace backend is active;
 * - load/save deck metadata and Markdown;
 * - enumerate ordinary files in the workspace;
 * - upload binary files into workspace subdirectories;
 * - provide a best-effort beacon save for page shutdown.
 *
 * Does NOT
 * --------
 * - parse Markdown into slides;
 * - normalize project objects;
 * - decide when a save should occur;
 * - render file-browser UI.
 *
 * Server contract
 * ---------------
 * GET  /api/workspace
 * GET  /api/deck
 * POST /api/deck
 * GET  /api/files
 * GET  /api/workspace-state
 * POST /api/upload?name=...&subdir=...
 *
 * Public API
 * ----------
 * `Revealation.storage.workspace`
 */
(function registerWorkspaceStorage(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  async function jsonResponse(response, context) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || `${context} failed (HTTP ${response.status})`);
    }
    return data;
  }

  async function detect() {
    // Static/PWA builds do not have an HTTP workspace endpoint. The build
    // script marks those artifacts so GitHub Pages does not produce an
    // expected-but-noisy 404 while probing for the Python backend.
    if (global.REVEALATION_STATIC_DEPLOYMENT === true
        || global.document?.documentElement?.dataset?.revealationStatic === 'true') return null;
    try {
      const response = await fetch('/api/workspace', { cache: 'no-store' });
      if (!response.ok) return null;
      const info = await response.json();
      return info?.enabled ? info : null;
    } catch (_) {
      return null;
    }
  }

  async function loadDeck() {
    const response = await fetch('/api/deck', { cache: 'no-store' });
    return jsonResponse(response, 'Deck load');
  }

  async function getWorkspaceState() {
    const response = await fetch('/api/workspace-state', { cache: 'no-store' });
    return jsonResponse(response, 'Workspace state');
  }

  async function saveDeck(project, markdown, { expectedRevision = null } = {}) {
    const response = await fetch('/api/deck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: metadataProject(project), markdown, expectedRevision }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 409) {
      const error = new Error(data?.error || 'The presentation changed on disk.');
      error.code = 'WORKSPACE_CONFLICT';
      error.revision = data?.revision || null;
      throw error;
    }
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error || `Deck save failed (HTTP ${response.status})`);
    }
    return data;
  }

  async function listFiles() {
    const response = await fetch('/api/files', { cache: 'no-store' });
    const data = await jsonResponse(response, 'Workspace file scan');
    return Array.isArray(data.files) ? data.files : [];
  }

  async function uploadFile(file, subdir = 'assets') {
    if (!file) throw new Error('No file supplied.');
    const query = new URLSearchParams({ name: file.name || 'asset.bin', subdir });
    const response = await fetch(`/api/upload?${query.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Type': file.type || 'application/octet-stream',
      },
      body: file,
    });
    const data = await jsonResponse(response, 'Upload');
    return data.file;
  }

  function saveBeacon(project, expectedRevision = null) {
    if (!project || !navigator.sendBeacon) return false;
    try {
      const body = new Blob([JSON.stringify({ project: metadataProject(project), expectedRevision })], { type: 'application/json' });
      return navigator.sendBeacon('/api/deck', body);
    } catch (_) {
      return false;
    }
  }

  // Workspace Markdown is the complete slide source. Keep only project-level
  // metadata and stable slide identities in deck.json; generated HTML and
  // layout projections belong to runtime memory, not the persisted manifest.
  function metadataProject(project) {
    const p = project && typeof project === 'object' ? project : {};
    return {
      ...p,
      assets: [],
      slides: Array.isArray(p.slides) ? p.slides.map(slide => ({ id: slide?.id || '' })) : [],
    };
  }

  app.storage.workspace = Object.freeze({ detect, loadDeck, getWorkspaceState, saveDeck, listFiles, uploadFile, saveBeacon });
})(window);
