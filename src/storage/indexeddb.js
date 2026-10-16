/**
 * Revealation — IndexedDB storage primitive
 * =========================================
 *
 * Purpose
 * -------
 * Isolate browser database mechanics from deck/library policy. The core owns
 * project selection, dirty tracking and migration semantics; this file owns
 * only IndexedDB transactions.
 *
 * Responsibilities
 * ----------------
 * - open/upgrade the Revealation browser database;
 * - provide Promise-based get/getAll/put/delete operations;
 * - provide an atomic multi-store transaction hook for backup restore.
 *
 * Does NOT
 * --------
 * - know what a deck/project means;
 * - update timestamps;
 * - merge Gists;
 * - decide which project is current.
 *
 * Public API
 * ----------
 * `Revealation.storage.createIndexedDbStore(options)`
 */
(function registerIndexedDbStorage(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  function createIndexedDbStore({ dbName, version = 1, stores = [] }) {
    let db = null;

    function open() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, version);
        request.onupgradeneeded = (event) => {
          const database = event.target.result;
          stores.forEach((store) => {
            if (database.objectStoreNames.contains(store.name)) return;
            database.createObjectStore(store.name, store.options || undefined);
          });
        };
        request.onsuccess = () => {
          db = request.result;
          resolve(db);
        };
        request.onerror = () => reject(request.error);
      });
    }

    function requireDb() {
      if (!db) throw new Error('IndexedDB store has not been opened.');
      return db;
    }

    function get(storeName, key) {
      return new Promise((resolve, reject) => {
        const request = requireDb().transaction(storeName, 'readonly').objectStore(storeName).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    function getAll(storeName) {
      return new Promise((resolve, reject) => {
        const request = requireDb().transaction(storeName, 'readonly').objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    }

    function put(storeName, value, key) {
      return new Promise((resolve, reject) => {
        const store = requireDb().transaction(storeName, 'readwrite').objectStore(storeName);
        const request = key !== undefined ? store.put(value, key) : store.put(value);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    function remove(storeName, key) {
      return new Promise((resolve, reject) => {
        const request = requireDb().transaction(storeName, 'readwrite').objectStore(storeName).delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    function transaction(storeNames, mode, operation) {
      const names = Array.isArray(storeNames) ? storeNames : [storeNames];
      return new Promise((resolve, reject) => {
        const tx = requireDb().transaction(names, mode);
        const objectStores = Object.fromEntries(names.map(name => [name, tx.objectStore(name)]));
        let result;
        let settled = false;
        try {
          // The callback must enqueue all IDB requests synchronously. Keeping
          // this deliberately non-async ensures the browser cannot auto-close
          // the transaction between awaited operations.
          result = operation(objectStores, tx);
          if (result && typeof result.then === 'function') {
            throw new Error('IndexedDB transaction callbacks must be synchronous.');
          }
        } catch (error) {
          settled = true;
          try { tx.abort(); } catch (_) {}
          reject(error);
          return;
        }
        tx.oncomplete = () => { if (!settled) resolve(result); };
        tx.onabort = () => { if (!settled) reject(tx.error || new Error('IndexedDB transaction aborted.')); };
        tx.onerror = () => { /* onabort carries the final transaction error */ };
      });
    }

    function close() {
      if (db) db.close();
      db = null;
    }

    function isOpen() { return !!db; }

    return Object.freeze({ open, get, getAll, put, remove, transaction, close, isOpen });
  }

  app.storage.createIndexedDbStore = createIndexedDbStore;
})(window);
