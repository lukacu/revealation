/**
 * Revealation — PDF exporter
 * ==========================
 *
 * Purpose
 * -------
 * Open a reveal.js print view prepared for the browser's "Save as PDF"
 * command. Revealation intentionally delegates the final PDF file creation to
 * Chromium/Brave/Chrome instead of adding Puppeteer/Node dependencies.
 *
 * Responsibilities
 * ----------------
 * - copy the presentation preview payload into sessionStorage;
 * - apply PDF-specific reveal.js defaults;
 * - open `preview.html?print-pdf=1` in a new tab.
 *
 * Does NOT
 * --------
 * - build the presentation payload;
 * - trigger native print dialogs programmatically;
 * - generate PDF bytes itself.
 *
 * Contract
 * --------
 * `open(payload)` expects the same payload used by in-editor Present mode.
 * `preview.js` reads `PAYLOAD_KEY` when print mode is active.
 *
 * Public API
 * ----------
 * `Revealation.exporters.pdf.open(payload)` plus read-only `payloadKey`.
 */
(function registerPdfExporter(global) {
  'use strict';

  const app = global.Revealation;
  if (!app) throw new Error('Revealation namespace must be loaded first.');

  // RV-COMPAT(preview-protocol): REMOVE/RENAME BEFORE PUBLIC RELEASE.
  // Kept legacy-compatible so an already-open preview tab is not invalidated
  // merely by upgrading Revealation.
  const PAYLOAD_KEY = 'reveal_editor_pdf_payload';

  const DEFAULT_SCREEN_MARGIN = 0.04;

  /**
   * Reveal interprets `margin` differently in screen and print modes.
   *
   * Screen:
   *   the slide occupies `(1 - margin)` of the presentation viewport.
   *
   * Print:
   *   reveal.js creates a page `slideSize * (1 + margin)`.
   *
   * Copying the same number therefore changes the visible amount of outer
   * breathing room. Convert the screen-space value so the logical slide uses
   * the same fraction of the PDF page that it uses in Present mode:
   *
   *   1 / (1 + printMargin) = 1 - screenMargin
   *   printMargin = screenMargin / (1 - screenMargin)
   *
   * Theme `--rv-slide-padding` remains untouched; this conversion concerns
   * only the outer presentation/page margin.
   */
  function screenMarginToPrintMargin(value) {
    const parsed = Number(value);
    const screenMargin = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 0.95) : DEFAULT_SCREEN_MARGIN;
    return screenMargin / (1 - screenMargin);
  }

  function open(payload) {
    if (!payload) throw new Error('Missing PDF payload.');
    const sourceConfig = payload.config || {};
    const copy = {
      ...payload,
      printMode: true,
      config: {
        ...sourceConfig,
        // Preserve the same *visual* outer margin as Present. Reveal's print
        // controller uses a different formula from its screen layout, so the
        // screen value must be converted rather than copied or zeroed.
        margin: screenMarginToPrintMargin(sourceConfig.margin),
        pdfMaxPagesPerSlide: 1,
        pdfSeparateFragments: false,
      },
    };

    try {
      global.sessionStorage.setItem(PAYLOAD_KEY, JSON.stringify(copy));
    } catch (error) {
      global.Revealation?.ui?.dialogs?.alert(`Could not prepare the PDF export: ${error?.message || error}`, { title: 'PDF export failed', kind: 'danger' });
      return false;
    }

    // Resolve directly from the running app origin so the preview URL remains
    // correct when the app is hosted under a repository or subdirectory path.
    const deploymentRoot = new URL('./', global.location.href);
    const previewUrl = new URL('__app__/preview.html?print-pdf=1', deploymentRoot).href;
    const win = app.platform?.openWindow
      ? app.platform.openWindow(previewUrl, '_blank')
      : global.open(previewUrl, '_blank');
    if (!win) {
      global.Revealation?.ui?.dialogs?.alert('The print preview was blocked. Allow pop-ups for this site, then try PDF again.', { title: 'PDF preview blocked', kind: 'warning' });
      return false;
    }
    return true;
  }

  app.exporters.pdf = Object.freeze({ open, payloadKey: PAYLOAD_KEY, screenMarginToPrintMargin });
})(window);
