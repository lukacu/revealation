/**
 * Revealation — native presentation package
 * ==========================================
 *
 * Purpose
 * -------
 * Provide the storage-independent `.revealation` ZIP exchange format.
 *
 * Responsibilities
 * ----------------
 * - serialize a canonical deck and local binary assets;
 * - validate archive structure, paths, versions and asset references;
 * - restore packaged assets without mutating application state.
 *
 * Does NOT
 * --------
 * - save projects to IndexedDB or a local directory;
 * - render decks or execute imported content;
 * - decide project merge or activation policy.
 *
 * Public API
 * ----------
 * `Revealation.storage.deckPackage`
 */
(function registerDeckPackage(global) {
  'use strict';
  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  const FORMAT = 'revealation';
  const FORMAT_VERSION = 1;
  const MIME = 'application/vnd.revealation.deck+zip';
  const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
  const MAX_ENTRY_BYTES = 768 * 1024 * 1024;
  const REQUIRED = new Set(['mimetype', 'manifest.json', 'deck.json']);

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function safePath(value) {
    const path = String(value || '').replace(/\\/g, '/');
    return !!path && !path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path)
      && !path.split('/').some(part => !part || part === '.' || part === '..')
      && !/[\0\u202e]/.test(path);
  }
  function assetPath(asset, index) {
    const name = String(asset?.path || asset?.name || `asset-${index + 1}.bin`)
      .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || `asset-${index + 1}.bin`;
    return `assets/${name}`;
  }
  function asBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return value;
  }
  function dataUriBytes(uri) {
    const match = String(uri || '').match(/^data:([^;,]+)?(?:;[^,]*)?,(.*)$/s);
    if (!match) return null;
    const mime = match[1] || 'application/octet-stream';
    const raw = match[2];
    if (/;base64/i.test(String(uri).slice(0, String(uri).indexOf(',')))) {
      const binary = global.atob(raw.replace(/[^A-Za-z0-9+/=]/g, ''));
      return { mime, bytes: Uint8Array.from(binary, char => char.charCodeAt(0)) };
    }
    return { mime, bytes: new TextEncoder().encode(decodeURIComponent(raw)) };
  }
  function replaceValue(value, replacements) {
    if (typeof value !== 'string') return value;
    let result = value;
    for (const [source, target] of replacements) if (result.includes(source)) result = result.split(source).join(target);
    return result;
  }
  function replaceDeckAssets(deck, replacements) {
    const copy = clone(deck);
    (copy.slides || []).forEach(slide => {
      slide.content = replaceValue(slide.content, replacements);
      if (slide.background) slide.background.value = replaceValue(slide.background.value, replacements);
    });
    return copy;
  }
  function archiveEntries(zip) {
    return Object.values(zip?.files || {}).filter(entry => !entry.dir);
  }
  function assertEntryNames(entries) {
    const seen = new Set();
    for (const entry of entries) {
      const name = String(entry.unsafeOriginalName || entry.name || '');
      if (!safePath(name)) throw new Error(`Unsafe archive entry path: ${name}`);
      if (seen.has(name)) throw new Error(`Duplicate archive entry: ${name}`);
      seen.add(name);
      const size = Number(entry._data?.uncompressedSize || 0);
      if (size > MAX_ENTRY_BYTES) throw new Error(`Archive entry is too large: ${name}`);
    }
    return seen;
  }
  async function parseJson(zip, name, label) {
    const entry = zip.file(name);
    if (!entry) throw new Error(`Package is missing ${name}.`);
    try { return JSON.parse(await entry.async('string')); }
    catch (error) { throw new Error(`${label} is not valid JSON: ${error.message || error}`); }
  }
  function validateManifest(manifest) {
    if (!manifest || manifest.format !== FORMAT) throw new Error('Not a Revealation presentation package.');
    if (manifest.formatVersion !== FORMAT_VERSION) {
      throw new Error(`Unsupported Revealation format version: ${manifest.formatVersion}. Please use a newer Revealation version.`);
    }
    if (manifest.generatorVersion != null && typeof manifest.generatorVersion !== 'string') throw new Error('Invalid package generator version.');
    return manifest;
  }
  function isoTimestamp(value, fallback) {
    if (!value) return fallback;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
  }
  async function validateDeckPackage(input) {
    if (!global.JSZip) throw new Error('JSZip is not available.');
    if (Number(input?.size) > MAX_ARCHIVE_BYTES) throw new Error('Revealation package is too large.');
    const zip = input?.file ? input : await global.JSZip.loadAsync(input);
    const entries = archiveEntries(zip);
    const names = assertEntryNames(entries);
    for (const required of REQUIRED) if (!names.has(required)) throw new Error(`Package is missing ${required}.`);
    const mimetype = await zip.file('mimetype').async('string');
    if (mimetype !== MIME) throw new Error('Package has an incorrect mimetype.');
    const manifest = validateManifest(await parseJson(zip, 'manifest.json', 'Package manifest'));
    const deck = await parseJson(zip, 'deck.json', 'Deck');
    if (!deck || typeof deck !== 'object' || !Array.isArray(deck.slides) || !deck.slides.length) throw new Error('Deck is not a valid presentation.');
    for (const reference of JSON.stringify(deck).match(/assets\/[A-Za-z0-9._/-]+/g) || []) {
      if (!zip.file(reference)) throw new Error(`Package is missing referenced asset: ${reference}`);
    }
    return { zip, manifest, deck, entries };
  }
  async function exportDeckPackage(deck, assets = deck?.assets || []) {
    if (!global.JSZip) throw new Error('JSZip is not available.');
    if (!deck || typeof deck !== 'object' || !Array.isArray(deck.slides) || !deck.slides.length) throw new Error('Cannot export an invalid deck.');
    const zip = new global.JSZip();
    zip.file('mimetype', MIME, { compression: 'STORE' });
    const replacements = [];
    const supplied = new Set(assets.map(asset => asset?.dataUrl).filter(Boolean));
    const embedded = [];
    const sourceText = JSON.stringify(deck);
    for (const match of sourceText.match(/data:[^"'\s)]+/g) || []) {
      if (!supplied.has(match) && !embedded.some(asset => asset.dataUrl === match)) embedded.push({ name: `embedded-${embedded.length + 1}`, dataUrl: match });
    }
    assets = [...assets, ...embedded];
    const descriptors = [];
    const used = new Set();
    for (let i = 0; i < assets.length; i += 1) {
      const source = assets[i] || {};
      const path = assetPath(source, i);
      if (used.has(path)) throw new Error(`Duplicate asset path: ${path}`);
      used.add(path);
      let bytes = asBytes(source.bytes || source.data);
      let mime = source.type || 'application/octet-stream';
      if (!bytes && source.dataUrl) {
        const parsed = dataUriBytes(source.dataUrl);
        if (parsed) { bytes = parsed.bytes; mime = source.type || parsed.mime; replacements.push([source.dataUrl, path]); }
      }
      if (!bytes && source.blob) bytes = source.blob;
      if (!bytes) throw new Error(`Asset ${source.name || path} has no data.`);
      // Arrays keep the package module interoperable with test harnesses and
      // adapters that provide Uint8Arrays from another JavaScript realm.
      zip.file(path, bytes instanceof Uint8Array ? Array.from(bytes) : bytes);
      descriptors.push({ id: source.id || path, name: source.name || path.slice(7), path, type: mime, size: Number(source.size) || undefined, createdAt: source.createdAt });
      if (source.path && source.path !== path) replacements.push([source.path, path]);
    }
    const packagedDeck = replaceDeckAssets(deck, replacements);
    packagedDeck.assets = descriptors;
    const now = new Date().toISOString();
    const manifest = { format: FORMAT, formatVersion: FORMAT_VERSION, generator: app.info?.name || 'Revealation', generatorVersion: app.version || '0.0.0', created: isoTimestamp(deck.createdAt, now), modified: now };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    zip.file('deck.json', JSON.stringify(packagedDeck, null, 2));
    return zip.generateAsync({ type: 'blob' });
  }
  async function importDeckPackage(file) {
    const validated = await validateDeckPackage(file);
    const { zip, deck } = validated;
    const assets = [];
    for (const descriptor of Array.isArray(deck.assets) ? deck.assets : []) {
      if (!descriptor || typeof descriptor.path !== 'string' || !safePath(descriptor.path) || !descriptor.path.startsWith('assets/')) throw new Error('Deck contains an invalid asset reference.');
      const entry = zip.file(descriptor.path);
      if (!entry) throw new Error(`Package is missing referenced asset: ${descriptor.path}`);
      const bytes = await entry.async('uint8array');
      assets.push({ ...descriptor, bytes });
    }
    const replacements = [];
    for (const asset of assets) {
      const mime = asset.type || 'application/octet-stream';
      let dataUrl;
      if (typeof global.FileReader === 'function') dataUrl = await new Promise((resolve, reject) => { const reader = new global.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(reader.error); reader.readAsDataURL(new global.Blob([asset.bytes], { type: mime })); });
      else { let binary = ''; asset.bytes.forEach(byte => { binary += String.fromCharCode(byte); }); dataUrl = `data:${mime};base64,${global.btoa(binary)}`; }
      asset.dataUrl = dataUrl;
      replacements.push([asset.path, dataUrl]);
    }
    const importedDeck = replaceDeckAssets(deck, replacements);
    importedDeck.assets = assets.map(({ bytes, ...asset }) => asset);
    return { deck: importedDeck, assets, manifest: validated.manifest };
  }
  app.storage.deckPackage = Object.freeze({ FORMAT, FORMAT_VERSION, MIME, exportDeckPackage, importDeckPackage, validateDeckPackage });
})(window);
