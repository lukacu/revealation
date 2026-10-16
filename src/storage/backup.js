/**
 * Revealation — browser-library backup format
 * ===========================================
 *
 * Purpose
 * -------
 * Provide a lossless, versioned backup/restore format for projects stored in
 * browser IndexedDB. A backup ZIP contains one manifest plus one JSON file per
 * project; project JSON is a full clone of the persisted project object, so
 * IDs, timestamps, slide metadata, reusable data-URI assets and future fields
 * survive a round trip.
 *
 * Responsibilities
 * ----------------
 * - clone browser-library state without dropping persisted fields;
 * - write/read a versioned manifest plus per-project JSON files;
 * - reject incomplete/corrupt backups before callers mutate IndexedDB.
 *
 * Does NOT
 * --------
 * - decide whether an import replaces or merges the current library;
 * - mutate IndexedDB directly;
 * - normalize slide/editor semantics.
 *
 * Public API
 * ----------
 * `Revealation.storage.backup`
 */
(function registerBrowserBackup(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  const FORMAT = 'revealation-library-backup';
  const VERSION = 1;
  const MANIFEST = 'revealation-library.json';

  function cloneJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function snapshotProject(project) {
    const copy = cloneJson(project);
    if (!copy || typeof copy !== 'object') throw new Error('Invalid project backup payload.');
    if (!copy.id || typeof copy.id !== 'string') throw new Error('Project backup is missing its stable id.');
    if (!Array.isArray(copy.slides) || copy.slides.length === 0) throw new Error(`Project ${copy.id} has no slides.`);
    return copy;
  }

  function snapshotLibrary(library) {
    if (!library || !Array.isArray(library.projects)) throw new Error('Invalid browser library.');
    const projects = library.projects.map(snapshotProject);
    const ids = new Set();
    for (const project of projects) {
      if (ids.has(project.id)) throw new Error(`Duplicate project id in browser library: ${project.id}`);
      ids.add(project.id);
    }
    const currentProjectId = ids.has(library.currentProjectId)
      ? library.currentProjectId
      : (projects[0]?.id || null);
    return {
      version: Number(library.version) || 1,
      currentProjectId,
      projects,
      deletedIds: cloneJson(Array.isArray(library.deletedIds) ? library.deletedIds : []),
    };
  }

  function safePart(value, fallback) {
    return String(value || fallback || 'project').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96) || fallback || 'project';
  }

  async function writeLibraryZip(zip, library) {
    if (!zip || typeof zip.file !== 'function') throw new Error('A JSZip instance is required.');
    const snapshot = snapshotLibrary(library);
    const refs = [];
    snapshot.projects.forEach((project, index) => {
      const filename = `projects/${String(index + 1).padStart(3, '0')}-${safePart(project.id, 'project')}.json`;
      zip.file(filename, JSON.stringify(project, null, 2));
      refs.push({ id: project.id, name: project.name || project.title || '', file: filename });
    });
    const manifest = {
      format: FORMAT,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      libraryVersion: snapshot.version,
      currentProjectId: snapshot.currentProjectId,
      deletedIds: snapshot.deletedIds,
      projects: refs,
    };
    zip.file(MANIFEST, JSON.stringify(manifest, null, 2));
    return { snapshot, manifest };
  }

  async function readLibraryZip(zip) {
    if (!zip || typeof zip.file !== 'function') throw new Error('A JSZip instance is required.');
    const manifestEntry = zip.file(MANIFEST);
    if (!manifestEntry) return null;

    let manifest;
    try {
      manifest = JSON.parse(await manifestEntry.async('string'));
    } catch (error) {
      throw new Error(`Backup manifest is not valid JSON: ${error.message || error}`);
    }
    if (manifest?.format !== FORMAT) throw new Error('ZIP contains an unsupported Revealation backup manifest.');
    if (manifest.version !== VERSION) throw new Error(`Unsupported Revealation backup version: ${manifest.version}`);
    if (!Array.isArray(manifest.projects) || manifest.projects.length === 0) throw new Error('Revealation backup contains no projects.');

    const projects = [];
    const ids = new Set();
    for (const ref of manifest.projects) {
      if (!ref || typeof ref.file !== 'string' || !ref.file) throw new Error('Backup manifest contains an invalid project entry.');
      const entry = zip.file(ref.file);
      if (!entry) throw new Error(`Backup is incomplete: missing ${ref.file}`);
      let project;
      try {
        project = snapshotProject(JSON.parse(await entry.async('string')));
      } catch (error) {
        throw new Error(`Cannot restore ${ref.file}: ${error.message || error}`);
      }
      if (ref.id && project.id !== ref.id) throw new Error(`Backup project id mismatch in ${ref.file}.`);
      if (ids.has(project.id)) throw new Error(`Backup contains duplicate project id: ${project.id}`);
      ids.add(project.id);
      projects.push(project);
    }

    const currentProjectId = ids.has(manifest.currentProjectId)
      ? manifest.currentProjectId
      : projects[0].id;
    return {
      version: Number(manifest.libraryVersion) || 1,
      currentProjectId,
      projects,
      deletedIds: cloneJson(Array.isArray(manifest.deletedIds) ? manifest.deletedIds : []),
    };
  }

  app.storage.backup = Object.freeze({
    format: FORMAT,
    version: VERSION,
    manifestName: MANIFEST,
    snapshotProject,
    snapshotLibrary,
    writeLibraryZip,
    readLibraryZip,
  });
})(window);
