/**
 * Revealation — snapshot history service
 * ======================================
 *
 * Purpose
 * -------
 * Provide bounded undo/redo stack mechanics for core application mutations.
 * The service stores opaque snapshots supplied by the application.
 *
 * Responsibilities
 * ----------------
 * - record pre-mutation snapshots;
 * - maintain undo and redo stacks;
 * - enforce entry-count and approximate-byte limits;
 * - restore snapshots through an injected callback;
 * - report whether undo/redo actions are currently available.
 *
 * Does NOT
 * --------
 * - know the deck/project schema;
 * - read or write DOM content;
 * - decide which user actions deserve a history entry;
 * - save the project after restoration.
 *
 * Dependencies / contract
 * -----------------------
 * `createHistory()` receives `snapshot()` and `restore(snapshot)` callbacks.
 * Snapshots may expose a numeric `bytes` field for memory-budget trimming.
 * `beforeSnapshot()` is called before record/undo/redo so core can flush live
 * editor state into its model first.
 *
 * Public API
 * ----------
 * `Revealation.core.createHistory(options)` -> controller with
 * `record()`, `undo()`, `redo()`, `clear()`, `canUndo()`, `canRedo()`.
 */
(function registerHistoryService(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  function createHistory(options = {}) {
    const {
      snapshot,
      restore,
      beforeSnapshot = () => {},
      onChange = () => {},
      maxEntries = 50,
      maxBytes = 20 * 1024 * 1024,
    } = options;

    if (typeof snapshot !== 'function' || typeof restore !== 'function') {
      throw new Error('createHistory requires snapshot() and restore() callbacks.');
    }

    const undoStack = [];
    const redoStack = [];

    const sizeOf = (item) => Number(item?.bytes) || 0;

    function trimUndo() {
      let totalBytes = undoStack.reduce((sum, item) => sum + sizeOf(item), 0);
      while (undoStack.length > 1
          && (undoStack.length > maxEntries || totalBytes > maxBytes)) {
        totalBytes -= sizeOf(undoStack.shift());
      }
    }

    function notify() {
      onChange({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 });
    }

    function record() {
      beforeSnapshot();
      undoStack.push(snapshot());
      trimUndo();
      redoStack.length = 0;
      notify();
    }

    function undo() {
      if (!undoStack.length) return false;
      beforeSnapshot();
      redoStack.push(snapshot());
      restore(undoStack.pop());
      notify();
      return true;
    }

    function redo() {
      if (!redoStack.length) return false;
      beforeSnapshot();
      undoStack.push(snapshot());
      trimUndo();
      restore(redoStack.pop());
      notify();
      return true;
    }

    function clear() {
      undoStack.length = 0;
      redoStack.length = 0;
      notify();
    }

    function canUndo() { return undoStack.length > 0; }
    function canRedo() { return redoStack.length > 0; }

    return Object.freeze({ record, undo, redo, clear, canUndo, canRedo });
  }

  app.core.createHistory = createHistory;
})(window);
