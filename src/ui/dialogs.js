/**
 * Revealation — in-app dialogs
 * ============================
 *
 * Purpose
 * -------
 * Provide the editor's shared, styled replacement for browser alert,
 * confirmation, and prompt dialogs.
 *
 * Responsibilities
 * ----------------
 * - render one accessible modal dialog at a time;
 * - resolve alert, confirmation, and text-entry requests as Promises;
 * - keep application features independent of browser chrome.
 *
 * Does NOT
 * --------
 * - own feature-specific copy or business logic;
 * - persist dialog state.
 *
 * Public API
 * ----------
 * `Revealation.ui.dialogs.alert(message, options)`
 * `Revealation.ui.dialogs.confirm(message, options)`
 * `Revealation.ui.dialogs.prompt(message, value, options)`
 */
(function (global) {
  'use strict';

  const app = global.Revealation = global.Revealation || {};
  app.ui = app.ui || {};

  let active = null;

  function close(result) {
    if (!active) return;
    const current = active;
    active = null;
    current.dialog.close();
    current.dialog.remove();
    current.resolve(result);
  }

  function show({ title = 'Revealation', message = '', kind = 'info', input = false, value = '', confirmLabel = 'OK', cancelLabel = 'Cancel' }) {
    if (active) close(false);
    const dialog = document.createElement('dialog');
    dialog.className = `app-dialog app-dialog-${kind}`;
    dialog.setAttribute('aria-labelledby', 'app-dialog-title');
    dialog.innerHTML = `
      <form method="dialog" class="app-dialog-card">
        <div class="app-dialog-icon" aria-hidden="true"><i class="bi ${kind === 'danger' ? 'bi-exclamation-triangle' : kind === 'warning' ? 'bi-exclamation-circle' : kind === 'question' ? 'bi-question-circle' : 'bi-info-circle'}"></i></div>
        <div class="app-dialog-content">
          <h2 id="app-dialog-title"></h2>
          <p class="app-dialog-message"></p>
          ${input ? '<label class="app-dialog-input-label"><span>URL</span><input class="app-dialog-input" type="text" spellcheck="false"></label>' : ''}
          <div class="app-dialog-actions">
            ${cancelLabel ? '<button type="button" class="app-dialog-cancel"></button>' : ''}
            <button type="submit" class="primary app-dialog-confirm"></button>
          </div>
        </div>
      </form>`;
    dialog.querySelector('#app-dialog-title').textContent = title;
    dialog.querySelector('.app-dialog-message').textContent = String(message);
    if (input) {
      const field = dialog.querySelector('.app-dialog-input');
      field.value = value;
      field.setAttribute('aria-label', title);
    }
    const cancel = dialog.querySelector('.app-dialog-cancel');
    if (cancel) {
      cancel.textContent = cancelLabel;
      cancel.addEventListener('click', () => close(input ? null : false));
    }
    dialog.querySelector('.app-dialog-confirm').textContent = confirmLabel;
    const promise = new Promise(resolve => { active = { dialog, resolve }; });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(input ? null : false); }, { once: true });
    dialog.addEventListener('close', () => {
      if (active && active.dialog === dialog) close(input ? null : false);
    }, { once: true });
    dialog.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      close(input ? dialog.querySelector('.app-dialog-input').value : true);
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    if (input) requestAnimationFrame(() => dialog.querySelector('.app-dialog-input').focus());
    return promise;
  }

  function alertDialog(message, options = {}) {
    return show({ ...options, message, cancelLabel: '' });
  }
  function confirmDialog(message, options = {}) {
    return show({ ...options, message, kind: options.kind || 'question' });
  }
  function promptDialog(message, value = '', options = {}) {
    return show({ ...options, message, value, input: true, confirmLabel: options.confirmLabel || 'Use URL', title: options.title || 'Enter a value' });
  }

  app.ui.dialogs = Object.freeze({ alert: alertDialog, confirm: confirmDialog, prompt: promptDialog });
})(window);
