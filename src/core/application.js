/**
 * Revealation — application orchestrator
 * =====================================
 *
 * Purpose
 * -------
 * Compose the core deck state, editor commands, Markdown mode, Present/export
 * pipeline and synchronization workflows. This file is intentionally the
 * orchestration layer: reusable UI, storage and content-type mechanics live
 * in their respective `src/` domains.
 *
 * Responsibilities
 * ----------------
 * - own the in-memory project/library state;
 * - enforce history/undo and save timing;
 * - coordinate WYSIWYG and Markdown editing modes;
 * - wire UI callbacks to core mutations;
 * - build reveal.js Present-mode payloads and coordinate export UI;
 * - coordinate optional GitHub Gist synchronization.
 *
 * Does NOT
 * --------
 * - issue workspace HTTP requests directly (`src/storage/workspace.js`);
 * - perform IndexedDB transactions directly (`src/storage/indexeddb.js`);
 * - implement sidebar DOM mechanics (`src/ui/sidebar.js`);
 * - define Interactive content semantics (`src/content/interactive.js`);
 * - implement HTML/ZIP packaging (`src/export/deck.js`);
 * - implement the PDF print-window transport (`src/export/pdf.js`).
 *
 * Entry point / contract
 * ----------------------
 * Loaded last by `index.html`. It consumes the documented `window.Revealation`
 * subsystem APIs and owns startup/wiring; it does not export a general plugin API.
 *
 * Historical note
 * ---------------
 * This file still contains substantial code inherited from Small Reveal.
 * Revealation treats that as implementation history, not as an architectural
 * boundary. New independent responsibilities should move to the domain folders
 * documented in `docs/ARCHITECTURE.md`.
 */
(async () => {
  'use strict';

  const APP_VERSION = window.Revealation?.version || '0.0.0';
  const APP_INFO = window.Revealation?.info || { name: 'Revealation' };
  const slideModel = window.Revealation?.core?.slideModel;
  const createHistory = window.Revealation?.core?.createHistory;
  const serverWorkspaceStorage = window.Revealation?.storage?.workspace;
  const directoryWorkspaceStorage = window.Revealation?.storage?.directory;
  const browserBackup = window.Revealation?.storage?.backup;
  const deckPackage = window.Revealation?.storage?.deckPackage;
  const pwaRuntime = window.Revealation?.pwa;
  let workspaceStorage = null;
  const interactiveContent = window.Revealation?.content?.interactive;
  const htmlContent = window.Revealation?.content?.html;
  const markdownDirectives = window.Revealation?.serialization?.directives;
  const notesSerialization = window.Revealation?.serialization?.notes;
  const layoutRegistry = window.Revealation?.layout;
  const themeRegistry = window.Revealation?.theme;
  const backgroundRegistry = window.Revealation?.background;
  const deckExporterFactory = window.Revealation?.exporters?.deck;
  const layoutBlocks = window.Revealation?.layout?.blocks;
  const markdownDeck = window.Revealation?.serialization?.deck;
  const domSelection = window.Revealation?.editor?.domSelection;
  const contentNormalization = window.Revealation?.editor?.contentNormalization;
  const richText = window.Revealation?.editor?.richText;
  const REVEAL_VERSION = '5.1.0';
  // RV-COMPAT(align-shorthand): DECK_CONTENT_CSS still styles old `.sr-center`.
  // RV-COMPAT(columns-directive): DECK_CONTENT_CSS still styles old `.sr-columns` / `.sr-col`.
  // RV-COMPAT(interactive-demo): DECK_CONTENT_CSS still styles old `.sr-demo`.
  const DECK_CONTENT_CSS = `
/* Keep authored block geometry identical to the WYSIWYG editor. Our custom
   themes intentionally own visual style, but browser default heading/paragraph
   margins and line-height must never leak into Present/export because Reveal
   measures those boxes when vertically centering a slide. */
.reveal{line-height:var(--r-main-line-height,1.3)}
.reveal .slides section{text-align:left}
.reveal h1,.reveal h2,.reveal h3,.reveal h4,.reveal h5,.reveal h6{margin:0 0 .4em;line-height:var(--r-heading-line-height,1.1)}
.reveal h3{font-size:var(--r-heading3-size,1.5em)}
.reveal h4{font-size:var(--r-heading4-size,1em)}
.reveal p{margin:0 0 var(--rv-block-spacing,var(--r-block-margin,.6em))}
.reveal .sr-center,.reveal .sr-align-center{text-align:center}
.reveal .sr-align-right{text-align:right}
.reveal .sr-align-left{text-align:left}
.reveal .sr-columns{display:grid;gap:var(--rv-block-spacing,1.25em);align-items:start;width:100%;margin:.35em 0 .7em}
.reveal .sr-cols-50-50{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.reveal .sr-cols-60-40{grid-template-columns:minmax(0,3fr) minmax(0,2fr)}
.reveal .sr-cols-40-60{grid-template-columns:minmax(0,2fr) minmax(0,3fr)}
.reveal .sr-col{min-width:0}
.reveal pre.sr-code{display:block;width:100%;max-width:100%;min-width:0;margin:var(--rv-block-spacing,var(--r-block-margin,.6em)) 0;box-sizing:border-box;text-align:left;font-size:var(--rv-size-code,.68em);line-height:1.32;overflow:hidden;white-space:pre-wrap}
.reveal pre.sr-code>code,.reveal pre.sr-code>code.hljs{display:block;width:100%;max-width:100%;min-width:0;box-sizing:border-box;padding:.65em .8em;font-size:inherit!important;line-height:inherit!important;white-space:pre-wrap!important;overflow-wrap:anywhere!important;word-break:break-word;overflow:hidden!important;tab-size:2}
/* reveal.js print CSS resets every section to padding:0!important. Restore the
   authored theme content box so PDF uses the same logical slide geometry as
   editor/Present instead of expanding content to the physical page edge. */
html.reveal-print .reveal .slides section.rv-slide{padding:var(--rv-slide-padding,0px)!important}
html.reveal-print .reveal pre.sr-code{width:100%!important;max-width:100%!important;min-width:0!important}
.reveal .sr-math[data-display="1"]{display:block;margin:.55em 0;text-align:center}
.reveal .sr-columns img,.reveal .sr-columns video{max-width:100%;max-height:62vh;object-fit:contain}
.reveal .sr-layout{display:grid;width:100%;min-width:0;margin:0}
.reveal .sr-layout-slot,.reveal .sr-layout-content{min-width:0}
.reveal .sr-layout img,.reveal .sr-layout video{max-width:100%;max-height:62vh;object-fit:contain}
.reveal audio{width:min(100%,520px)}
.reveal .sr-interactive,.reveal .sr-demo{position:relative;display:block;max-width:100%;margin:.35em auto .7em;box-sizing:border-box}
.reveal .sr-interactive iframe,.reveal .sr-demo iframe{display:block;width:100%;height:100%;border:0;background:#fff}
.reveal .sr-interactive iframe,.reveal .sr-demo iframe{overflow:hidden}
.reveal .sr-interactive[data-scrollbars="1"] iframe,.reveal .sr-demo[data-scrollbars="1"] iframe{overflow:auto}
.reveal .sr-interactive[data-border="1"] iframe,.reveal .sr-demo[data-border="1"] iframe{border:1px solid rgba(127,127,127,.55);border-radius:6px}
.reveal .sr-interactive[data-interactive="0"] iframe,.reveal .sr-demo[data-interactive="0"] iframe{pointer-events:none}
.reveal figure.sr-media-caption{max-width:100%;margin:.35em auto .7em}
.reveal figure.sr-media-caption figcaption{color:var(--rv-muted,var(--r-muted-color,inherit));font-size:var(--rv-size-caption,.72em);line-height:1.25;text-align:center}
.reveal .sr-media-crop{display:block;position:relative;overflow:hidden;max-width:100%;box-sizing:border-box;line-height:0}
.reveal .sr-media-crop>img{position:absolute;display:block;max-width:none;max-height:none;width:var(--sr-crop-image-width,100%);height:var(--sr-crop-image-height,100%);left:var(--sr-crop-image-left,0%);top:var(--sr-crop-image-top,0%)}
.reveal .sr-media-crop:not([data-crop-ratio])>img{position:relative;width:100%;height:auto;max-width:100%}
.reveal .rv-slide{position:relative;isolation:isolate}
.reveal > .rv-background-host{position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none}
.reveal .rv-background-host{pointer-events:none}
.reveal > .slides{z-index:1}
.reveal .rv-slide > .rv-background-host ~ *{position:relative;z-index:1}
`;
  const deckContentCss = () => DECK_CONTENT_CSS + (layoutRegistry?.cssText?.() ? `\n${layoutRegistry.cssText()}` : '');

  // RV-COMPAT(storage-old-keys): REMOVE BEFORE PUBLIC RELEASE.
  // Revealation is based on Small Reveal, which was previously called "Reveal Editor". Every
  // storage key below still carries the old name ON PURPOSE — they address
  // data already sitting in people's browsers, and renaming them would look
  // exactly like total data loss. They are never shown to anyone.
  const LIBRARY_KEY = 'reveal-editor:library:v1';
  const LEGACY_STORAGE_KEY = 'reveal-editor:project:v1';
  const THEME_KEY = 'reveal-editor:ui-theme';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const dialogs = window.Revealation?.ui?.dialogs;

  const uid = () => 'id-' + Math.random().toString(36).slice(2, 10);

  // Parse slide HTML for inspection/rewriting WITHOUT putting it in the live
  // document. DOMParser documents are inert: scripts never run, images are
  // not fetched, and inline event handlers (e.g. <img onerror=…>) never fire.
  // Always use this — never `div.innerHTML = …` — when the HTML may come from
  // an imported file or the sync gist. Returns the parsed <body>.
  function parseHtml(html) {
    return new DOMParser().parseFromString(html || '', 'text/html').body;
  }

  const els = {
    deckTitle: $('#deck-title'),
    themeSelect: $('#theme-select'),
    deckSettingsBtn: $('#btn-deck-settings'),
    deckSettingsModal: $('#deck-settings-modal'),
    deckSettingsClose: $('#deck-settings-close'),
    deckSettingsName: $('#deck-settings-name'),
    deckSettingsAuthor: $('#deck-settings-author'),
    deckSettingsCreated: $('#deck-settings-created'),
    deckSettingsModified: $('#deck-settings-modified'),
    themeChoices: $('#theme-choices'),
    styleMotionForm: $('#style-motion-form'),
    styleLayoutForm: $('#style-layout-form'),
    slideList: $('#slide-list'),
    deckSlideCount: $('#deck-slide-count'),
    deckActiveSlideCount: $('#deck-active-slide-count'),
    deckHiddenSlideCount: $('#deck-hidden-slide-count'),
    addSlide: $('#btn-add-slide'),
    editor: $('#slide-editor'),
    source: $('#slide-source'),
    toggleSource: $('#toggle-source'),
    toolbar: $('#toolbar'),
    undoBtn: $('#btn-undo'),
    redoBtn: $('#btn-redo'),
    frame: $('#slide-frame'),
    bgLayer: $('#slide-bg-layer'),
    bgBadge: $('#slide-bg-badge'),
    dropOverlay: $('#drop-overlay'),
    mediaToolbar: $('#media-toolbar'),
    mediaKind: $('#media-kind'),
    mediaWidth: $('#media-width'),
    mediaWidthValue: $('#media-width-value'),
    mediaResetSize: $('#media-reset-size'),
    mediaResetCrop: $('#media-reset-crop'),
    mediaCaptionControl: $('#media-caption-control'),
    mediaCaption: $('#media-caption'),
    mediaSelection: $('#media-selection'),
    videoSettings: $('#video-settings'),
    videoAutoplay: $('#video-autoplay'),
    videoControls: $('#video-controls'),
    videoLoop: $('#video-loop'),
    videoMuted: $('#video-muted'),
    interactiveSettings: $('#interactive-settings'),
    interactiveHeight: $('#interactive-height'),
    interactiveEnabled: $('#interactive-enabled'),
    interactivePreload: $('#interactive-preload'),
    interactiveBorder: $('#interactive-border'),
    interactiveScrollbars: $('#interactive-scrollbars'),
    interactiveEdit: $('#interactive-edit'),
    slideMenu: $('#slide-context-menu'),
    toolbarMenu: $('#toolbar-menu'),
    markdownBtn: $('#btn-markdown'),
    markdownRecover: $('#btn-markdown-recover'),
    markdownPane: $('#markdown-pane'),
    markdownText: $('#markdown-text'),
    markdownHighlight: $('#markdown-highlight'),
    exportHtmlBtn: $('#btn-export-html'),
    exportHtmlControls: $('#export-html-controls'),
    exportHtmlProgress: $('#export-html-progress'),
    markdownApply: $('#markdown-apply'),
    markdownClose: $('#markdown-close'),
    markdownStatus: $('#markdown-status'),
    exportZipBtn: $('#btn-export-zip'),
    codeModal: $('#code-modal'),
    codeClose: $('#code-close'),
    codeCancel: $('#code-cancel'),
    codeInsert: $('#code-insert'),
    codeLanguage: $('#code-language'),
    codeText: $('#code-text'),
    mathModal: $('#math-modal'),
    mathClose: $('#math-close'),
    mathCancel: $('#math-cancel'),
    mathInsert: $('#math-insert'),
    mathDisplay: $('#math-display'),
    mathText: $('#math-text'),
    mathPreview: $('#math-preview'),
    layoutModal: $('#layout-modal'),
    layoutTitle: $('#layout-modal .modal-head strong'),
    layoutClose: $('#layout-close'),
    layoutChoices: $('#layout-choices'),
    backgroundButton: $('#btn-slide-background'),
    backgroundModal: $('#background-modal'),
    backgroundClose: $('#background-close'),
    notesToggle: $('#btn-notes-toggle'),
    interactiveModal: $('#interactive-modal'),
    interactiveClose: $('#interactive-close'),
    interactiveCancel: $('#interactive-cancel'),
    interactiveInsert: $('#interactive-insert'),
    interactiveSrc: $('#interactive-src'),
    interactiveFilesList: $('#interactive-files-list'),
    interactiveWidth: $('#interactive-width'),
    interactiveModalHeight: $('#interactive-modal-height'),
    interactiveModalEnabled: $('#interactive-modal-enabled'),
    interactiveModalPreload: $('#interactive-modal-preload'),
    interactiveModalBorder: $('#interactive-modal-border'),
    interactiveModalScrollbars: $('#interactive-modal-scrollbars'),
    assetsModal: $('#assets-modal'),
    assetsClose: $('#assets-close'),
    assetsRefresh: $('#assets-refresh'),
    assetsGrid: $('#assets-grid'),
    assetsSearch: $('#assets-search'),
    assetsTitle: $('#assets-title'),
    assetsHint: $('#assets-hint'),
    assetUploadLabel: $('#asset-upload-label'),
    assetsEmpty: $('#assets-empty'),
    assetFileInput: $('#asset-file-input'),
    blockStyle: $('#block-style'),
    markdownToolbarBtn: $('#btn-markdown-toolbar'),
    bgChoices: $('#background-choices'),
    bgLegacyNotice: $('#background-legacy-notice'),
    subslide: $('#slide-subslide'),
    wip: $('#slide-wip'),
    hiddenSlide: $('#slide-hidden'),
    status: $('#status'),
    workspaceChangeBanner: $('#workspace-change-banner'),
    workspaceChangeMessage: $('#workspace-change-message'),
    workspaceChangeReload: $('#workspace-change-reload'),
    workspaceChangeKeep: $('#workspace-change-keep'),
    workspaceChangeExport: $('#workspace-change-export'),
    appLoadingScreen: $('#app-loading-screen'),
    saveIndicator: $('#save-indicator'),
    saveLabel: $('#save-label'),
    pwaUpdateBanner: $('#pwa-update-banner'),
    pwaUpdateNow: $('#pwa-update-now'),
    pwaUpdateLater: $('#pwa-update-later'),
    workspacePickerTitle: $('#workspace-picker-title'),
    workspacePickerModal: $('#workspace-picker-modal'),
    workspacePickerMessage: $('#workspace-picker-message'),
    workspacePickerDetail: $('#workspace-picker-detail'),
    workspacePickerRecentSection: $('#workspace-picker-recent-section'),
    workspacePickerRecentTitle: $('#workspace-picker-recent-title'),
    workspacePickerRecent: $('#workspace-picker-recent'),
    workspacePickerChoose: $('#workspace-picker-choose'),
    workspacePickerBrowser: $('#workspace-picker-browser'),
    workspacePickerCancel: $('#workspace-picker-cancel'),
    exportButton: $('#btn-export'),
    exportModal: $('#export-modal'),
    exportClose: $('#export-close'),
    exportHtmlWarning: $('#export-html-warning'),
    helpButton: $('#btn-help'),
    helpModal: $('#help-modal'),
    helpClose: $('#help-close'),
    fileInput: $('#file-input'),
    projectsButton: $('#btn-projects'),
    workspaceOpenButton: $('#btn-workspace-open'),
    workspaceFolderButton: $('#btn-workspace-folder'),
    projectsModal: $('#projects-modal'),
    projectsClose: $('#projects-close'),
    projectsList: $('#projects-list'),
    projectsNew: $('#projects-new'),
    projectsExportAll: $('#projects-export-all'),
    projectsImportInput: $('#projects-import-input'),
    // Legacy Gist synchronization remains isolated for compatibility, but is
    // intentionally not attached to the release UI.
    projectsRemoteSection: null,
    projectsRemoteList: null,
    projectsRemoteStatus: null,
    projectsRemoteRefresh: null,
    presentModal: $('#present-modal'),
    presentFrame: $('#present-frame'),
    appBrand: $('#app-brand'),
    appName: $('#app-name'),
    aboutModal: $('#about-modal'),
    aboutClose: $('#about-close'),
    aboutTitle: $('#about-title'),
    aboutBody: $('#about-body'),
    settingsButton: $('#btn-settings'),
    settingsModal: $('#settings-modal'),
    settingsClose: $('#settings-close'),
    settingsThemeLight: $('#settings-theme-light'),
    settingsThemeDark: $('#settings-theme-dark'),
    presentationSettingsForm: $('#presentation-settings-form'),
    syncPill: null,
    syncModal: null,
    syncClose: null,
    syncSetup: null,
    syncConnected: null,
    syncPat: null,
    syncGistId: null,
    syncConnect: null,
    syncNow: null,
    syncReset: null,
    syncDisconnect: null,
    syncStatusText: null,
    syncLast: null,
    syncError: null,
    syncGistLink: null,
    syncGistIdDisplay: null,
    syncCopyId: null,
    notesPanel: $('#notes-panel'),
    notesPanelText: $('#notes-panel-text'),
    notesPanelClose: $('#notes-panel-close'),
    notesPanelSlide: $('#notes-panel-slide'),
    sidebar: $('.sidebar'),
    mobileMenuBtn: $('#btn-mobile-menu'),
    mobileScrim: $('#mobile-scrim'),
    slidesClose: $('#btn-slides-close'),
    mPrev: $('#m-prev'),
    mNext: $('#m-next'),
    mPicker: $('#m-picker'),
    mPosition: $('#m-position'),
    mAdd: $('#m-add'),
  };

  const FRAGMENT_TYPES = [
    'fade-out', 'fade-up', 'fade-down', 'fade-left', 'fade-right',
    'fade-in-then-out', 'fade-in-then-semi-out',
    'grow', 'shrink', 'strike',
    'highlight-red', 'highlight-green', 'highlight-blue', 'highlight-current-red'
  ];

  // Human labels for the fragment animation menu. '' is reveal's default.
  const FRAGMENT_LABELS = [['', 'fade-in (default)']]
    .concat(FRAGMENT_TYPES.map(t => [t, t]));

  // Animation applied to the next fragment created. Previously this lived in
  // the toolbar's <select>; the select is gone, so the preference lives here
  // and surfaces through the Fragment button's caret menu.
  let fragmentDefaultType = '';

  // RV-COMPAT(background-reveal): REMOVE raw Reveal background sizing BEFORE PUBLIC RELEASE.
  // Background types for which reveal.js honors data-background-size.
  const BG_FIT_TYPES = ['image', 'video'];


  // RV-COMPAT(theme-custom): REMOVE BEFORE PUBLIC RELEASE.
  // -------- Legacy custom-theme compatibility --------
  // Older decks could persist arbitrary Google Font choices. Keep this table
  // only so those decks retain their historic fallback stacks; there is no
  // font picker in the current Revealation UI.
  const GOOGLE_FONTS = [
    { group: 'Sans serif', name: 'Inter', fb: 'sans-serif' },
    { group: 'Sans serif', name: 'Roboto', fb: 'sans-serif' },
    { group: 'Sans serif', name: 'Open Sans', fb: 'sans-serif' },
    { group: 'Sans serif', name: 'Lato', fb: 'sans-serif' },
    { group: 'Sans serif', name: 'Montserrat', fb: 'sans-serif' },
    { group: 'Sans serif', name: 'Poppins', fb: 'sans-serif' },
    { group: 'Sans serif', name: 'Raleway', fb: 'sans-serif' },
    { group: 'Sans serif', name: 'Nunito', fb: 'sans-serif' },
    { group: 'Sans serif', name: 'Work Sans', fb: 'sans-serif' },
    { group: 'Sans serif', name: 'Rubik', fb: 'sans-serif' },
    { group: 'Sans serif', name: 'Karla', fb: 'sans-serif' },
    { group: 'Sans serif', name: 'Manrope', fb: 'sans-serif' },
    { group: 'Sans serif', name: 'Barlow', fb: 'sans-serif' },
    { group: 'Sans serif', name: 'Jost', fb: 'sans-serif' },
    { group: 'Sans serif', name: 'DM Sans', fb: 'sans-serif' },
    { group: 'Sans serif', name: 'Outfit', fb: 'sans-serif' },
    { group: 'Sans serif', name: 'Figtree', fb: 'sans-serif' },
    { group: 'Sans serif', name: 'Fira Sans', fb: 'sans-serif' },
    { group: 'Sans serif', name: 'Source Sans 3', fb: 'sans-serif' },
    { group: 'Sans serif', name: 'Mulish', fb: 'sans-serif' },
    { group: 'Serif', name: 'Playfair Display', fb: 'serif' },
    { group: 'Serif', name: 'Merriweather', fb: 'serif' },
    { group: 'Serif', name: 'Lora', fb: 'serif' },
    { group: 'Serif', name: 'EB Garamond', fb: 'serif' },
    { group: 'Serif', name: 'Libre Baskerville', fb: 'serif' },
    { group: 'Serif', name: 'Cormorant Garamond', fb: 'serif' },
    { group: 'Serif', name: 'Crimson Text', fb: 'serif' },
    { group: 'Serif', name: 'Source Serif 4', fb: 'serif' },
    { group: 'Serif', name: 'Spectral', fb: 'serif' },
    { group: 'Serif', name: 'Bitter', fb: 'serif' },
    { group: 'Serif', name: 'Domine', fb: 'serif' },
    { group: 'Serif', name: 'Vollkorn', fb: 'serif' },
    { group: 'Serif', name: 'PT Serif', fb: 'serif' },
    { group: 'Serif', name: 'Literata', fb: 'serif' },
    { group: 'Serif', name: 'IM Fell English', fb: 'serif' },
    { group: 'Serif', name: 'IM Fell English SC', fb: 'serif' },
    { group: 'Serif', name: 'IM Fell DW Pica', fb: 'serif' },
    { group: 'Display', name: 'Oswald', fb: 'sans-serif' },
    { group: 'Display', name: 'Anton', fb: 'sans-serif' },
    { group: 'Display', name: 'Bebas Neue', fb: 'sans-serif' },
    { group: 'Display', name: 'Archivo Black', fb: 'sans-serif' },
    { group: 'Display', name: 'Alfa Slab One', fb: 'serif' },
    { group: 'Display', name: 'Abril Fatface', fb: 'serif' },
    { group: 'Display', name: 'Righteous', fb: 'sans-serif' },
    { group: 'Display', name: 'Lobster', fb: 'cursive' },
    { group: 'Display', name: 'Special Elite', fb: 'monospace' },
    { group: 'Display', name: 'Amatic SC', fb: 'cursive' },
    { group: 'Handwriting', name: 'Caveat', fb: 'cursive' },
    { group: 'Handwriting', name: 'Pacifico', fb: 'cursive' },
    { group: 'Handwriting', name: 'Permanent Marker', fb: 'cursive' },
    { group: 'Handwriting', name: 'Shadows Into Light', fb: 'cursive' },
    { group: 'Handwriting', name: 'Dancing Script', fb: 'cursive' },
    { group: 'Handwriting', name: 'Kalam', fb: 'cursive' },
    { group: 'Monospace', name: 'Fira Code', fb: 'monospace' },
    { group: 'Monospace', name: 'JetBrains Mono', fb: 'monospace' },
    { group: 'Monospace', name: 'IBM Plex Mono', fb: 'monospace' },
    { group: 'Monospace', name: 'Space Mono', fb: 'monospace' },
    { group: 'Monospace', name: 'Inconsolata', fb: 'monospace' },
  ];

  // The retired custom-theme format overlaid these fields on a reveal.js base
  // theme. It remains a read/render compatibility format, not a supported
  // visual customization API for new presentations.
  const CUSTOM_THEME_DEFAULTS = {
    base: 'black',
    headingFont: '',
    bodyFont: '',
    backgroundColor: '',
    textColor: '',
    headingColor: '',
    linkColor: '',
    fontSize: '',
    headingTransform: '',
    headingLetterSpacing: '',
    headingShadow: false,
  };

  function normalizeCustomTheme(t) {
    const out = { ...CUSTOM_THEME_DEFAULTS };
    if (t && typeof t === 'object') {
      Object.keys(out).forEach(k => { if (t[k] !== undefined) out[k] = t[k]; });
    }
    return out;
  }

  // Strip characters that could break out of a CSS declaration or a <style>
  // block; the values land in generated stylesheets in exports.
  function cssValue(v) {
    return String(v).replace(/[;{}<>]/g, '').trim();
  }

  function fontStack(family) {
    const name = cssValue(family).replace(/["']/g, '');
    const known = GOOGLE_FONTS.find(f => f.name === name);
    return `"${name}", ${known ? known.fb : 'sans-serif'}`;
  }

  // Google Fonts URL for the families the theme uses. The classic v1 CSS API
  // serves whichever of the requested variants exist; css2 rejects the whole
  // request if any single weight is missing, which typed-in families would
  // trip over constantly.
  function googleFontsHref(t) {
    const fams = [...new Set([t.headingFont, t.bodyFont]
      .map(f => String(f || '').trim()).filter(Boolean))];
    if (!fams.length) return '';
    const q = fams
      .map(f => encodeURIComponent(f).replace(/%20/g, '+') + ':400,700,400italic,700italic')
      .join('|');
    return `https://fonts.googleapis.com/css?family=${q}&display=swap`;
  }

  function customThemeCss(t) {
    const vars = [];
    if (t.bodyFont) {
      const stack = fontStack(t.bodyFont);
      vars.push(`--rv-font-body: ${stack};`, `--r-main-font: ${stack};`);
    }
    if (t.headingFont) {
      const stack = fontStack(t.headingFont);
      vars.push(`--rv-font-heading: ${stack};`, `--r-heading-font: ${stack};`);
    }
    if (t.backgroundColor) {
      const value = cssValue(t.backgroundColor);
      vars.push(`--rv-bg: ${value};`, `--r-background-color: ${value};`);
    }
    if (t.textColor) {
      const value = cssValue(t.textColor);
      vars.push(`--rv-text: ${value};`, `--r-main-color: ${value};`);
    }
    if (t.headingColor) vars.push(`--r-heading-color: ${cssValue(t.headingColor)};`);
    if (t.linkColor) {
      const value = cssValue(t.linkColor);
      vars.push(`--rv-accent: ${value};`, `--r-link-color: ${value};`);
    }
    const size = parseFloat(t.fontSize);
    if (size > 0) vars.push(`--rv-size-body: ${size}px;`, `--r-main-font-size: ${size}px;`);
    if (t.headingTransform) vars.push(`--r-heading-text-transform: ${cssValue(t.headingTransform)};`);
    const ls = parseFloat(t.headingLetterSpacing);
    if (!Number.isNaN(ls) && ls !== 0) vars.push(`--r-heading-letter-spacing: ${ls}px;`);
    if (t.headingShadow) vars.push('--r-heading-text-shadow: 2px 2px 8px rgba(0, 0, 0, .45);');
    const rules = [];
    if (vars.length) rules.push(`:root {\n  ${vars.join('\n  ')}\n}`);
    if (t.backgroundColor) {
      rules.push(`.reveal-viewport {\n  background: ${cssValue(t.backgroundColor)};\n}`);
    }
    return rules.join('\n');
  }

  // Legacy custom-theme data is kept renderable for decks created by older
  // Revealation builds, but the normal UI no longer exposes arbitrary visual
  // controls. Choosing any curated theme clears this compatibility overlay.
  function presentationThemeCss(custom = null) {
    return custom ? customThemeCss(custom) : '';
  }

  function themeDefinition(project = state) {
    const requested = project?.theme || themeRegistry?.defaultId || 'clean';
    return themeRegistry?.get?.(themeRegistry.resolveOrDefault(requested)) || null;
  }

  function themePayloadBits(p) {
    const definition = themeDefinition(p);
    const themeId = definition?.id || themeRegistry?.resolveOrDefault?.(p?.theme) || 'clean';
    const legacy = p?.legacyCustomTheme ? normalizeCustomTheme(p.legacyCustomTheme) : null;
    return {
      theme: themeId,
      themeName: definition?.name || themeId,
      themeCssHref: definition?.cssUrl || window.Revealation.urls.app(`themes/${encodeURIComponent(themeId)}/theme.css`),
      themePreviewHref: definition?.previewUrl || '',
      fontsHref: legacy ? googleFontsHref(legacy) : '',
      customCss: presentationThemeCss(legacy),
    };
  }

  // -------- State --------
  function newSlide(content = '<h2>New slide</h2>') {
    return {
      id: uid(),
      content,
      notes: '',
      // RV-COMPAT(slide-transition): REMOVE BEFORE PUBLIC RELEASE.
      transition: '',
      background: { id: '' },
      // RV-COMPAT(subslide-vertical): REMOVE BEFORE PUBLIC RELEASE.
      vertical: false,
      // Slide-level presentation structure. `single` is implicit in Markdown;
      // multi-block ids are written next to the slide separator.
      layout: 'single',
      // Multi-block layouts persist their slot content separately from the
      // rendered `.sr-layout` DOM cache. `null` means the implicit single body.
      blocks: null,
      autoAnimate: { enabled: false, id: '', duration: '', easing: '', unmatched: '' },
      underConstruction: false,
      hidden: false,
    };
  }

  function contentLayoutId(content) {
    if (typeof content !== 'string' || !content.trim()) return 'single';
    const holder = document.createElement('div');
    holder.innerHTML = content;
    const children = Array.from(holder.children);
    const layout = children.length === 1 && children[0].classList?.contains('sr-layout') ? children[0] : null;
    if (layout) {
      const id = layout.getAttribute('data-layout') || '';
      if (layoutRegistry?.get(id)) return id;
    }
    // RV-COMPAT(columns-directive): REMOVE BEFORE PUBLIC RELEASE.
    // Pre-layout-engine columns from older projects map to the corresponding
    // slide-level layout during migration.
    if (children.length === 1 && children[0].classList?.contains('sr-columns')) {
      const cls = children[0].classList;
      if (cls.contains('sr-cols-60-40')) return 'two-columns-60-40';
      if (cls.contains('sr-cols-40-60')) return 'two-columns-40-60';
      if (cls.contains('sr-cols-50-50')) return 'two-columns';
    }
    return 'single';
  }

  function normalizeStoredLayoutBlocks(blocks) {
    if (!Array.isArray(blocks)) return null;
    return blocks.map(block => ({
      html: String(block?.html || ''),
      align: SR_ALIGNMENTS.has(String(block?.align || 'left')) ? String(block?.align || 'left') : 'left',
    }));
  }

  function layoutBlocksFromContent(content, expectedLayout = '') {
    if (typeof content !== 'string' || !content.trim()) return null;
    const holder = document.createElement('div');
    holder.innerHTML = content;
    const meaningful = Array.from(holder.childNodes).filter(node => {
      if (node.nodeType === Node.TEXT_NODE) return !!String(node.nodeValue || '').trim();
      return node.nodeType === Node.ELEMENT_NODE;
    });
    if (meaningful.length !== 1 || meaningful[0].nodeType !== Node.ELEMENT_NODE) return null;
    const extracted = layoutBlocks?.htmlBlocksFromCanonicalElement?.(meaningful[0]);
    if (!extracted) return null;
    if (expectedLayout && extracted.id !== expectedLayout) return null;
    return extracted;
  }

  function hasValidSlideBlocks(slide, layoutId = slide?.layout) {
    const def = layoutRegistry?.get(layoutId);
    return !!(def && layoutId !== 'single' && Array.isArray(slide?.blocks)
      && slide.blocks.length === def.slots.length);
  }

  function renderSlideBlocks(slide) {
    if (!slide || slide.layout === 'single' || !hasValidSlideBlocks(slide)) return null;
    const wrap = layoutBlocks?.createElementFromHtml?.(slide.layout, slide.blocks);
    return wrap ? wrap.outerHTML : null;
  }

  function normalizeSlideLayout(slide) {
    if (!slide) return 'single';

    // RV-COMPAT(layout-html-cache): inference from stored layout DOM is migration-only.
    // Layout identity belongs to slide metadata. Only infer it from content
    // when migrating an older project that did not yet persist `slide.layout`.
    let requested = String(slide.layout || 'single');
    if (!layoutRegistry?.get(requested)) requested = 'single';
    const fromContent = contentLayoutId(slide.content || '');
    if (requested === 'single' && fromContent !== 'single') requested = fromContent;
    slide.layout = requested;

    if (requested === 'single') {
      slide.blocks = null;
      return requested;
    }

    // RV-COMPAT(layout-html-cache): old JSON without `blocks` is migrated from stored DOM.
    // Persistent positional blocks are the source of truth. Canonical layout
    // DOM is only a render/edit projection. Older JSON projects may not yet
    // contain blocks, so migrate them once from canonical stored HTML.
    const normalized = normalizeStoredLayoutBlocks(slide.blocks);
    const def = layoutRegistry.get(requested);
    if (normalized && normalized.length === def.slots.length) {
      slide.blocks = normalized;
    } else {
      const extracted = layoutBlocksFromContent(slide.content || '', requested);
      slide.blocks = extracted ? extracted.blocks : null;
    }

    // Keep the compatibility/rendering cache canonical whenever the block
    // model is available. Present/sidebar/export can continue consuming
    // `slide.content` without owning the layout structure.
    const rendered = renderSlideBlocks(slide);
    if (rendered != null) slide.content = rendered;
    return requested;
  }

  // applySlideEffects sizes .r-fit-text and .r-stretch with inline styles so
  // the editor preview matches the slide. Those numbers are measured against
  // the editor pane, not the deck, and reveal.js computes its own at runtime —
  // an inline value would override it. Strip them before anything stores or
  // exports the content.
  function stripEditorSizing(root) {
    root.querySelectorAll('.r-fit-text').forEach(el => {
      el.style.fontSize = '';
      if (!el.getAttribute('style')) el.removeAttribute('style');
    });
    root.querySelectorAll('.r-stretch').forEach(el => {
      el.style.height = '';
      if (!el.getAttribute('style')) el.removeAttribute('style');
    });
    // Interactive blocks store height in logical Reveal slide pixels. The
    // WYSIWYG editor physically scales that height to match the stage, but the
    // editor-only number must never leak into persisted HTML or export.
    root.querySelectorAll('.sr-interactive[data-height], .sr-demo[data-height]').forEach(el => {
      const logicalHeight = Number(el.dataset.height);
      if (Number.isFinite(logicalHeight) && logicalHeight > 0) {
        el.style.height = `${logicalHeight}px`;
      }
    });
    return root;
  }

  function backgroundExtensionId(background) {
    if (typeof background === 'string') return background.trim();
    if (background && typeof background === 'object') return String(background.id || '').trim();
    return '';
  }

  // RV-COMPAT(background-reveal): REMOVE BEFORE PUBLIC RELEASE.
  function legacyBackground(background) {
    if (!background || typeof background !== 'object' || backgroundExtensionId(background)) return null;
    const type = String(background.type || '').trim();
    const value = String(background.value || '');
    if (!type || !value) return null;
    return {
      type,
      value,
      size: BG_FIT_TYPES.includes(type) ? String(background.size || '') : '',
    };
  }

  function normalizeBackground(background) {
    const id = backgroundExtensionId(background);
    if (id) return { id };
    const legacy = legacyBackground(background);
    return legacy || { id: '' };
  }

  function defaultBackgroundId(project = state) {
    const id = themeDefinition(project)?.backgrounds?.default || '';
    return backgroundRegistry?.get?.(id) ? id : '';
  }

  function effectiveBackgroundId(slide, project = state) {
    return backgroundExtensionId(slide?.background) || defaultBackgroundId(project);
  }

  function backgroundResources(project = state) {
    const ids = new Set();
    const themeDefault = defaultBackgroundId(project);
    if (themeDefault) ids.add(themeDefault);
    (project?.slides || []).filter(slide => !slide?.hidden).forEach(slide => {
      const id = backgroundExtensionId(slide?.background);
      if (id) ids.add(id);
    });
    return Array.from(ids).map(id => backgroundRegistry?.get?.(id)).filter(Boolean);
  }

  function backgroundPayloadResources(project = state) {
    return backgroundResources(project).map(definition => ({
      id: definition.id,
      cssHref: definition.cssUrl,
      jsHref: definition.jsUrl || '',
      assets: Object.fromEntries((definition.assets || []).map((name, index) => [
        name,
        definition.assetUrls?.[index] || '',
      ])),
    }));
  }

  function migrateSlide(s) {
    if (!s || typeof s !== 'object') return s;
    // RV-COMPAT(background-reveal): REMOVE BEFORE PUBLIC RELEASE.
    if (s.background === undefined) {
      const oldColor = s.backgroundColor;
      s.background = oldColor
        ? { type: 'color', value: String(oldColor), size: '' }
        : { id: '' };
      delete s.backgroundColor;
    } else {
      s.background = normalizeBackground(s.background);
    }
    // RV-COMPAT(subslide-vertical): REMOVE BEFORE PUBLIC RELEASE.
    if (typeof s.vertical !== 'boolean') s.vertical = false;
    if (typeof s.underConstruction !== 'boolean') s.underConstruction = false;
    if (typeof s.hidden !== 'boolean') s.hidden = false;
    if (!s.autoAnimate || typeof s.autoAnimate !== 'object') s.autoAnimate = { enabled: false, id: '', duration: '', easing: '', unmatched: '' };
    else s.autoAnimate = {
      enabled: !!s.autoAnimate.enabled,
      id: String(s.autoAnimate.id || ''),
      duration: String(s.autoAnimate.duration || ''),
      easing: String(s.autoAnimate.easing || ''),
      unmatched: String(s.autoAnimate.unmatched || ''),
    };
    // RV-COMPAT(video-html-autoplay): REMOVE BEFORE PUBLIC RELEASE.
    // Earlier Revealation builds inserted HTML autoplay directly. That makes videos
    // start while editing and can make hidden slides play early. Reveal.js'
    // data-autoplay is slide-aware, so migrate the legacy form in place.
    if (typeof s.content === 'string' && /<video\b[^>]*\bautoplay(?:\s|=|>)/i.test(s.content)) {
      const holder = document.createElement('div');
      holder.innerHTML = s.content;
      let changed = false;
      holder.querySelectorAll('video[autoplay]').forEach(v => {
        v.removeAttribute('autoplay');
        v.setAttribute('data-autoplay', '');
        changed = true;
      });
      if (changed) s.content = holder.innerHTML;
    }
    // RV-COMPAT(editor-sizing-artifacts): REMOVE BEFORE PUBLIC RELEASE.
    // Older decks were saved with the editor's measured sizing baked in.
    if (typeof s.content === 'string' && /r-fit-text|r-stretch/.test(s.content)) {
      const holder = document.createElement('div');
      holder.innerHTML = s.content;
      const cleaned = stripEditorSizing(holder).innerHTML;
      if (cleaned !== s.content) s.content = cleaned;
    }
    normalizeSlideLayout(s);
    return s;
  }

  function blankProject(name) {
    const first = newSlide('<h1>My presentation</h1><p>Subtitle or intro</p>');
    const now = Date.now();
    return {
      id: uid(),
      name: name || 'Untitled presentation',
      createdAt: now,
      modifiedAt: now,
      title: name || 'Untitled presentation',
      author: '',
      theme: themeRegistry?.defaultId || 'clean',
      assets: [],
      slides: [first],
      currentId: first.id,
      config: defaultRevealConfig(),
    };
  }

  function normalizeProject(p, fallbackName) {
    if (!p || typeof p !== 'object') return null;
    if (!Array.isArray(p.slides) || p.slides.length === 0) return null;
    p.slides.forEach(migrateSlide);
    if (!p.currentId || !p.slides.some(s => s.id === p.currentId)) {
      p.currentId = p.slides[0].id;
    }
    if (!p.id) p.id = uid();
    if (!p.title) p.title = fallbackName || 'Untitled presentation';
    if (!p.name) p.name = p.title;
    p.author = typeof p.author === 'string' ? p.author : '';
    // RV-COMPAT(theme-custom): REMOVE BEFORE PUBLIC RELEASE.
    // Legacy decks stored raw reveal.js theme names and could select a
    // free-form `custom` theme. Map those names to curated Revealation themes
    // while retaining the custom values only as a render-only compatibility
    // overlay until the user chooses a current theme.
    if (p.theme === 'custom') {
      const legacy = normalizeCustomTheme(p.customTheme);
      p.legacyCustomTheme = normalizeCustomTheme(p.legacyCustomTheme || legacy);
      p.theme = themeRegistry?.resolveOrDefault?.(legacy.base) || themeRegistry?.defaultId || 'clean';
    } else {
      p.theme = themeRegistry?.resolveOrDefault?.(p.theme) || themeRegistry?.defaultId || 'clean';
      if (p.legacyCustomTheme) p.legacyCustomTheme = normalizeCustomTheme(p.legacyCustomTheme);
    }
    // Preserve the old field for round-tripping older project JSON. It no
    // longer drives the normal theme UI.
    if (p.customTheme) p.customTheme = normalizeCustomTheme(p.customTheme);
    if (!Array.isArray(p.assets)) p.assets = [];
    p.assets = p.assets.filter(a => a && typeof a === 'object' && typeof a.dataUrl === 'string').map(a => ({
      id: a.id || uid(),
      name: String(a.name || 'asset'),
      type: String(a.type || ''),
      dataUrl: a.dataUrl,
      size: Number(a.size) || 0,
      createdAt: Number(a.createdAt) || Date.now(),
    }));
    // RV-COMPAT(reveal-config-fields): REMOVE BEFORE PUBLIC RELEASE.
    // The spread also preserves unknown/retired Reveal config keys from
    // internal decks. Supported keys are all defined by REVEAL_OPTIONS.
    if (!p.config || typeof p.config !== 'object') p.config = defaultRevealConfig();
    else p.config = { ...defaultRevealConfig(), ...p.config };
    const now = Date.now();
    if (!p.createdAt) p.createdAt = now;
    if (!p.modifiedAt) p.modifiedAt = now;
    return p;
  }

  function applySlideMetadata(slide, metadata = {}) {
    if (!slide) return;
    const value = key => metadata[key] == null ? '' : String(metadata[key]);
    // RV-COMPAT(slide-transition): REMOVE BEFORE PUBLIC RELEASE.
    slide.transition = value('transition');
    if (Object.prototype.hasOwnProperty.call(metadata, 'background')) {
      slide.background = { id: value('background').trim() };
    } else {
      // RV-COMPAT(background-reveal): REMOVE BEFORE PUBLIC RELEASE.
      // Legacy Reveal background metadata remains readable, but is no longer
      // generated by the normal editor UI.
      const backgroundKeys = [
        ['background-color', 'color'], ['background-image', 'image'],
        ['background-video', 'video'], ['background-iframe', 'iframe'],
      ];
      for (const [key, type] of backgroundKeys) {
        if (Object.prototype.hasOwnProperty.call(metadata, key)) {
          slide.background = { type, value: value(key), size: value('background-size') };
          break;
        }
      }
      if (Object.prototype.hasOwnProperty.call(metadata, 'background-size') && slide.background?.type) {
        slide.background.size = value('background-size');
      }
    }
    slide.autoAnimate = {
      enabled: /^(true|yes|1|on)$/i.test(value('auto-animate')),
      id: value('auto-animate-id'),
      duration: value('auto-animate-duration'),
      easing: value('auto-animate-easing'),
      unmatched: value('auto-animate-unmatched'),
    };
    slide.underConstruction = /^(true|yes|1|on)$/i.test(value('under-construction'));
    slide.hidden = /^(true|yes|1|on)$/i.test(value('hidden'));
  }

  function slideMetadata(slide) {
    const metadata = {};
    // RV-COMPAT(slide-transition): REMOVE BEFORE PUBLIC RELEASE.
    if (slide?.transition) metadata.transition = slide.transition;
    const bg = slide?.background || {};
    const backgroundId = backgroundExtensionId(bg);
    if (backgroundId) metadata.background = backgroundId;
    else {
      // RV-COMPAT(background-reveal): REMOVE BEFORE PUBLIC RELEASE.
      const legacy = legacyBackground(bg);
      if (legacy) metadata[`background-${legacy.type}`] = legacy.value;
      if (legacy?.size) metadata['background-size'] = legacy.size;
    }
    const animation = slide?.autoAnimate || {};
    if (animation.enabled) metadata['auto-animate'] = 'true';
    if (animation.id) metadata['auto-animate-id'] = animation.id;
    if (animation.duration) metadata['auto-animate-duration'] = animation.duration;
    if (animation.easing) metadata['auto-animate-easing'] = animation.easing;
    if (animation.unmatched) metadata['auto-animate-unmatched'] = animation.unmatched;
    if (slide?.underConstruction) metadata['under-construction'] = 'true';
    if (slide?.hidden) metadata.hidden = 'true';
    return metadata;
  }

  // -------- Local workspace backend --------
  // When served by server.py, the editor works directly against one directory
  // on disk. deck.md is the complete human-readable presentation source,
  // deck.json carries project metadata and stable slide identities, and ordinary relative paths in slide HTML
  // refer to ordinary files in that directory.
  let workspaceMode = false;
  let workspaceInfo = null;
  let workspaceFiles = [];
  let workspaceLoadWarning = '';
  let workspaceRevision = null;
  let workspaceExternalRevision = null;
  let workspaceMonitorTimer = null;
  let workspaceMonitorBusy = false;
  let workspaceConflict = false;


  function activateWorkspace(adapter, info) {
    if (!adapter || !info) return false;
    workspaceStorage = adapter;
    workspaceMode = true;
    workspaceInfo = info;
    return true;
  }

  async function detectWorkspace() {
    if (serverWorkspaceStorage) {
      try {
        const info = await serverWorkspaceStorage.detect();
        if (info) return activateWorkspace(serverWorkspaceStorage, { ...info, kind: info.kind || 'server' });
      } catch (error) {
        console.warn('Server workspace detection failed', error);
      }
    }
    // Hosted/PWA directory workspaces persist their handle in IndexedDB. On
    // reload (for example after choosing another presentation folder), restore
    // that active handle before prepareHostedMode() decides whether to show the
    // workspace picker again.
    if (directoryWorkspaceStorage) {
      try {
        const info = await directoryWorkspaceStorage.detect?.();
        if (info) return activateWorkspace(directoryWorkspaceStorage, info);
      } catch (error) {
        console.warn('Directory workspace detection failed', error);
      }
    }
    return false;
  }

  function showPwaUpdateAvailable() {
    if (els.pwaUpdateBanner) els.pwaUpdateBanner.hidden = false;
  }

  async function chooseDirectoryWorkspace({ allowCancel = false } = {}) {
    if (!els.workspacePickerModal || !directoryWorkspaceStorage) return false;
    const supported = directoryWorkspaceStorage.supported?.() === true;
    let recent = [];
    if (supported) {
      try {
        recent = await directoryWorkspaceStorage.listRecent?.() || [];
      } catch (error) {
        console.warn('Workspace history could not be read', error);
      }
    }

    els.workspacePickerModal.hidden = false;
    els.workspacePickerChoose.hidden = !supported;
    els.workspacePickerCancel.hidden = !allowCancel;
    if (els.appLoadingScreen) els.appLoadingScreen.hidden = true;
    if (els.workspacePickerTitle) {
      els.workspacePickerTitle.textContent = allowCancel ? 'Open a presentation' : 'Welcome to Revealation';
    }

    return new Promise(resolve => {
      let finished = false;
      const finish = value => {
        if (finished) return;
        finished = true;
        els.workspacePickerModal.hidden = true;
        els.workspacePickerChoose.onclick = null;
        els.workspacePickerBrowser.onclick = null;
        els.workspacePickerCancel.onclick = null;
        els.workspacePickerRecent?.replaceChildren();
        resolve(value);
      };

      const renderRecent = () => {
        if (!els.workspacePickerRecent || !els.workspacePickerRecentSection) return;
        els.workspacePickerRecent.replaceChildren();
        els.workspacePickerRecentSection.hidden = !supported || recent.length === 0;
        for (const [index, item] of recent.entries()) {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'workspace-recent-row';
          row.setAttribute('role', 'listitem');
          row.setAttribute('aria-label', `${index === 0 ? 'Continue with' : 'Open'} ${item.name || 'Presentation'}`);

          const main = document.createElement('div');
          main.className = 'workspace-recent-main';
          if (index === 0) {
            const eyebrow = document.createElement('div');
            eyebrow.className = 'workspace-recent-eyebrow';
            eyebrow.textContent = 'Continue where you left off';
            main.appendChild(eyebrow);
          }
          const name = document.createElement('div');
          name.className = 'workspace-recent-name';
          name.textContent = item.name || 'Presentation';
          const meta = document.createElement('div');
          meta.className = 'workspace-recent-meta';
          const permission = item.permission === 'granted' ? 'ready' : 'permission required';
          const when = item.lastOpened ? ` · opened ${new Date(item.lastOpened).toLocaleString()}` : '';
          meta.textContent = `${index === 0 ? 'Last opened' : 'Recent'} · ${permission}${when}`;
          main.append(name, meta);

          row.onclick = async () => {
            // openRecent invokes requestPermission before its first await so
            // Chromium still sees this row click as a user gesture.
            const openPromise = directoryWorkspaceStorage.openRecent(item.id);
            try {
              const info = await openPromise;
              if (info) finish(activateWorkspace(directoryWorkspaceStorage, info));
              else els.workspacePickerDetail.textContent = `Permission to open “${item.name}” was not granted.`;
            } catch (error) {
              els.workspacePickerDetail.textContent = `Could not open “${item.name}”: ${error.message || error}`;
            }
          };
          row.append(main);
          els.workspacePickerRecent.appendChild(row);
        }
      };

      if (els.workspacePickerMessage) {
        els.workspacePickerMessage.textContent = recent.length
          ? 'Continue with your last presentation, choose another recent one, or open a new folder.'
          : 'Open a new presentation folder to get started. Your recent folders will appear here next time.';
      }
      if (els.workspacePickerRecentTitle) {
        els.workspacePickerRecentTitle.textContent = recent.length > 1 ? 'Recent presentations' : 'Last presentation';
      }
      els.workspacePickerDetail.textContent = supported
        ? (recent.length
          ? 'Select a presentation to continue. You can also choose a new folder below.'
          : 'Choose a folder below, or continue with browser storage.')
        : 'This browser does not expose local directory access. Revealation can continue with browser storage.';
      renderRecent();

      els.workspacePickerChoose.onclick = async () => {
        try {
          const info = await directoryWorkspaceStorage.choose();
          if (info) finish(activateWorkspace(directoryWorkspaceStorage, info));
        } catch (error) {
          if (error?.name !== 'AbortError') els.workspacePickerDetail.textContent = `Could not open the folder: ${error.message || error}`;
        }
      };
      els.workspacePickerBrowser.onclick = async () => {
        // Disconnect only the active directory. Recent handles remain in the
        // splash history so switching to browser storage is reversible.
        await directoryWorkspaceStorage.forget?.();
        finish(false);
      };
      els.workspacePickerCancel.onclick = () => finish(null);
    });
  }

  async function prepareHostedMode() {
    if (workspaceMode) return false;
    if (pwaRuntime?.supported?.()) {
      try {
        await pwaRuntime.register({ onUpdateAvailable: showPwaUpdateAvailable });
      } catch (error) {
        console.warn('PWA service worker registration/update failed', error);
        // An installed PWA may be launching offline. If an existing worker still
        // controls this page, its cached shell and directory bridge remain usable
        // even though register()/update could not reach sw.js right now.
        if (!navigator.serviceWorker?.controller) {
          setStatus('PWA offline support could not be started; using browser storage', false);
        } else {
          setStatus('Offline · using installed Revealation version', true);
        }
      }
    } else {
      setStatus('Browser storage mode · host the app on HTTPS or localhost for folder access', true);
    }
    // Always show the welcome/picker when no Python workspace is active. On a
    // supported PWA this offers local folders; otherwise it still gives the
    // user a clear browser-storage fallback instead of silently opening a deck.
    return chooseDirectoryWorkspace();
  }

  async function refreshWorkspaceFiles() {
    if (!workspaceMode || !workspaceStorage) return [];
    try {
      workspaceFiles = await workspaceStorage.listFiles();
      return workspaceFiles;
    } catch (e) {
      console.warn('workspace file scan failed', e);
      setStatus('Could not refresh workspace files', false);
      return workspaceFiles;
    }
  }

  function revisionToken(revision, key) {
    if (!revision) return '';
    return String(revision[key] || '');
  }

  function localWorkspaceEditsPending() {
    return !!(saveTimer != null
      || (state && dirtyProjects.has(state.id))
      || (markdownMode && els.markdownText && els.markdownText.value !== markdownBaseline));
  }

  function workspaceAssetUrl(value) {
    const source = String(value || '');
    if (!workspaceMode || !source || /^(?:data:|blob:|https?:|\/|#)/i.test(source)) return source;
    const clean = source.split('#', 1)[0].split('?', 1)[0];
    let lookup = clean;
    try { lookup = decodeURIComponent(clean); } catch (_) {}
    const file = workspaceFiles.find(item => item.path === clean || item.path === lookup);
    if (!file) return source;
    const revision = `${file.modifiedAt || 0}-${file.size || 0}`;
    const hash = source.includes('#') ? `#${source.split('#').slice(1).join('#')}` : '';
    return `${clean}?rv=${encodeURIComponent(revision)}${hash}`;
  }

  function refreshWorkspaceAssetUrls(root = els.editor) {
    if (!workspaceMode || !root) return;
    root.querySelectorAll?.('[src], [poster], [href]').forEach(node => {
      for (const attribute of ['src', 'poster', 'href']) {
        if (!node.hasAttribute(attribute)) continue;
        const value = node.getAttribute(attribute) || '';
        if (attribute === 'href' && !node.matches('a')) continue;
        const next = workspaceAssetUrl(value);
        if (next !== value) node.setAttribute(attribute, next);
      }
    });
  }

  function stripWorkspaceAssetRevisions(root) {
    if (!workspaceMode || !root) return;
    root.querySelectorAll?.('[src], [poster], [href]').forEach(node => {
      for (const attribute of ['src', 'poster', 'href']) {
        if (!node.hasAttribute(attribute)) continue;
        const value = node.getAttribute(attribute) || '';
        const hashIndex = value.indexOf('#');
        const hash = hashIndex >= 0 ? value.slice(hashIndex) : '';
        const withoutHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
        const queryIndex = withoutHash.indexOf('?');
        if (queryIndex < 0) continue;
        const base = withoutHash.slice(0, queryIndex);
        const params = new URLSearchParams(withoutHash.slice(queryIndex + 1));
        if (!params.has('rv')) continue;
        params.delete('rv');
        node.setAttribute(attribute, `${base}${params.toString() ? `?${params}` : ''}${hash}`);
      }
    });
  }

  function showWorkspaceConflict(revision, message = 'This presentation changed on disk while you were editing it.') {
    workspaceConflict = true;
    workspaceExternalRevision = revision || workspaceExternalRevision;
    if (els.workspaceChangeBanner) els.workspaceChangeBanner.hidden = false;
    if (els.workspaceChangeMessage) els.workspaceChangeMessage.textContent = message;
    setSaveState('error', 'Changed on disk');
    setStatus('Save paused because the presentation changed on disk', false);
  }

  function hideWorkspaceConflict() {
    workspaceConflict = false;
    workspaceExternalRevision = null;
    if (els.workspaceChangeBanner) els.workspaceChangeBanner.hidden = true;
  }

  async function reloadWorkspaceFromDisk() {
    if (!workspaceMode || !workspaceStorage) return;
    hideWorkspaceConflict();
    if (saveTimer != null) { clearTimeout(saveTimer); saveTimer = null; }
    library = await loadLibrary();
    state = library.projects.find(p => p.id === library.currentProjectId) || library.projects[0];
    dirtyProjects.clear();
    metaDirty = false;
    clearHistory();
    renderAll();
    setSaveState('saved', 'Reloaded from disk');
    setStatus('Reloaded changes from disk', true);
  }

  async function checkWorkspaceChanges({ force = false } = {}) {
    if (!workspaceMode || !workspaceStorage?.getWorkspaceState || workspaceMonitorBusy) return;
    if (!force && document.visibilityState === 'hidden') return;
    workspaceMonitorBusy = true;
    try {
      const current = await workspaceStorage.getWorkspaceState();
      const nextRevision = current?.revision || null;
      const oldDeck = revisionToken(workspaceRevision, 'deckToken');
      const newDeck = revisionToken(nextRevision, 'deckToken');
      const oldAssets = revisionToken(workspaceRevision, 'assetsToken');
      const newAssets = revisionToken(nextRevision, 'assetsToken');
      if (oldDeck && newDeck && oldDeck !== newDeck) {
        workspaceExternalRevision = nextRevision;
        if (localWorkspaceEditsPending()) showWorkspaceConflict(nextRevision);
        else await reloadWorkspaceFromDisk();
        return;
      }
      if (newAssets && oldAssets && newAssets !== oldAssets) {
        workspaceFiles = Array.isArray(current.files) ? current.files : workspaceFiles;
        workspaceRevision = nextRevision;
        if (!sourceMode) {
          refreshWorkspaceAssetUrls(els.editor);
          scheduleIntrinsicSlideReflow();
        }
        if (els.assetsModal && !els.assetsModal.hidden) renderAssetsModal();
      }
    } catch (error) {
      console.warn('Workspace change check failed', error);
    } finally {
      workspaceMonitorBusy = false;
    }
  }

  function startWorkspaceMonitor() {
    if (!workspaceMode || !workspaceStorage?.getWorkspaceState) return;
    clearInterval(workspaceMonitorTimer);
    workspaceMonitorTimer = setInterval(() => checkWorkspaceChanges(), 5000);
    window.addEventListener('focus', () => checkWorkspaceChanges({ force: true }));
    window.addEventListener('pageshow', () => checkWorkspaceChanges({ force: true }));
  }

  async function uploadWorkspaceFile(file, subdir = 'assets') {
    if (!workspaceMode || !workspaceStorage || !file) return null;
    const item = await workspaceStorage.uploadFile(file, subdir);
    const i = workspaceFiles.findIndex(x => x.path === item.path);
    if (i >= 0) workspaceFiles[i] = item; else workspaceFiles.push(item);
    workspaceFiles.sort((a, b) => String(a.path).localeCompare(String(b.path)));
    return item;
  }

  function configureWorkspaceUi() {
    if (!workspaceMode) return;
    document.body.classList.add('workspace-mode');
    const localFolderMode = workspaceInfo?.kind === 'directory';
    document.body.classList.toggle('directory-workspace-mode', localFolderMode);
    if (els.workspaceOpenButton) els.workspaceOpenButton.hidden = !localFolderMode;
    if (els.workspaceFolderButton) els.workspaceFolderButton.hidden = !localFolderMode;
    if (workspaceInfo?.name) document.title = `${workspaceInfo.name} — Revealation`;
  }

  // -------- Library (multi-project storage, IndexedDB-backed) --------
  let library = null;          // { version, currentProjectId, projects: [...] }
  let state = null;            // current project entry (reference into library.projects)
  let selectedSlideIds = [];
  let sourceMode = false;
  let saveTimer = null;
  let statusTimer = null;
  let suppressContentCapture = 0;

  // Pre-rename name, kept so existing decks stay reachable. See LIBRARY_KEY.
  const DB_NAME = 'reveal-editor';
  const DB_VERSION = 1;
  const STORE_META = 'meta';
  const STORE_PROJECTS = 'projects';
  const META_KEY = 'state';

  const browserStore = window.Revealation?.storage?.createIndexedDbStore?.({
    dbName: DB_NAME,
    version: DB_VERSION,
    stores: [
      { name: STORE_META },
      { name: STORE_PROJECTS, options: { keyPath: 'id' } },
    ],
  });
  const dirtyProjects = new Set();   // ids of projects that need flushing
  const pushDirty = new Set();       // ids edited locally since the last successful gist push
  let metaDirty = false;
  let browserLibraryFresh = false;

  const idbGet = (storeName, key) => browserStore.get(storeName, key);
  const idbGetAll = (storeName) => browserStore.getAll(storeName);
  const idbPut = (storeName, value, key) => browserStore.put(storeName, value, key);
  const idbDelete = (storeName, key) => browserStore.remove(storeName, key);

  async function persistWholeBrowserLibrary(nextLibrary) {
    if (!browserStore?.isOpen()) throw new Error('IndexedDB storage is not available.');
    if (!browserStore.transaction) throw new Error('Atomic IndexedDB transactions are not available.');
    await browserStore.transaction([STORE_PROJECTS, STORE_META], 'readwrite', stores => {
      stores[STORE_PROJECTS].clear();
      for (const project of nextLibrary.projects) stores[STORE_PROJECTS].put(project);
      stores[STORE_META].put({
        currentProjectId: nextLibrary.currentProjectId,
        deletedIds: nextLibrary.deletedIds || [],
      }, META_KEY);
    });
  }

  // Open the DB and assemble the in-memory library, migrating from
  // localStorage on first run if needed.
  async function loadLibrary() {
    if (workspaceMode) {
      try {
        const data = await workspaceStorage.loadDeck();
        let p = null;
        try {
          p = normalizeProject(data?.project, workspaceInfo?.name || 'Presentation');
        } catch (e) {
          // A stale or partially written deck.json must not prevent the
          // authoritative deck.md from opening. Keep the diagnostic for the
          // status line, then let the Markdown path below rebuild the project.
          workspaceLoadWarning = `deck.json could not be loaded; using deck.md: ${e.message || String(e)}`;
          console.warn(workspaceLoadWarning, e);
        }
        if (!p) p = blankProject(workspaceInfo?.name || 'Presentation');
        if (Array.isArray(data?.errors) && data.errors.length) {
          const detail = data.errors.join(' ');
          workspaceLoadWarning = workspaceLoadWarning
            ? `${workspaceLoadWarning} ${detail}`
            : detail;
          console.warn('Workspace file read warnings:', data.errors);
        }
        workspaceRevision = data?.revision || null;
        // Workspace contract: deck.md is the authoritative source of the
        // presentation whenever it exists and parses successfully. deck.json
        // carries project metadata and stable IDs; its mtime must never
        // silently override a valid human-edited Markdown deck.
        if (data.markdownExists && typeof data.markdown === 'string') {
          try {
            const mdSlides = parseMarkdownDeck(data.markdown);
            if (mdSlides.length) {
              // Reuse cached IDs position-by-position where possible so a
              // reload after hand-editing deck.md does not churn slide IDs.
              const cached = Array.isArray(p.slides) ? p.slides : [];
              mdSlides.forEach((s, i) => { if (cached[i]?.id) s.id = cached[i].id; });
              p.slides = mdSlides;
              if (!p.slides.some(s => s.id === p.currentId)) p.currentId = p.slides[0].id;
            }
          } catch (e) {
            workspaceLoadWarning = `deck.md could not be parsed; using available JSON metadata only: ${e.message || String(e)}`;
            console.error(workspaceLoadWarning, e);
          }
        }
        // Files are not embedded in the project JSON. They are scanned from
        // disk whenever the asset browser opens.
        p.assets = [];
        await refreshWorkspaceFiles();
        if (workspaceStorage.getWorkspaceState) {
          try {
            const workspaceState = await workspaceStorage.getWorkspaceState();
            workspaceRevision = workspaceState?.revision || workspaceRevision;
            if (Array.isArray(workspaceState?.files)) workspaceFiles = workspaceState.files;
          } catch (error) {
            console.warn('Workspace revision could not be initialized', error);
          }
        }
        return { version: 1, currentProjectId: p.id, projects: [p], deletedIds: [] };
      } catch (e) {
        console.error('workspace deck load failed', e);
        const p = blankProject(workspaceInfo?.name || 'Presentation');
        return { version: 1, currentProjectId: p.id, projects: [p], deletedIds: [] };
      }
    }
    try {
      if (!browserStore) throw new Error('IndexedDB adapter unavailable');
      await browserStore.open();
    } catch (e) {
      console.warn('IndexedDB unavailable, falling back to in-memory only:', e);
      return freshLibrary();
    }

    // Already-migrated case: pull projects + meta from IDB.
    const existing = await idbGetAll(STORE_PROJECTS);
    if (existing.length > 0) {
      const meta = await idbGet(STORE_META, META_KEY);
      const projects = existing.map(p => normalizeProject(p)).filter(Boolean);
      let currentProjectId = meta?.currentProjectId;
      if (!projects.some(p => p.id === currentProjectId)) currentProjectId = projects[0].id;
      // Sort: keep stable but newest first as a default presentation order.
      projects.sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0));
      const deletedIds = Array.isArray(meta?.deletedIds) ? meta.deletedIds : [];
      return { version: 1, currentProjectId, projects, deletedIds };
    }

    // RV-COMPAT(storage-old-keys): REMOVE BEFORE PUBLIC RELEASE.
    // First-run migration from the multi-project localStorage key.
    try {
      const raw = localStorage.getItem(LIBRARY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.projects) && parsed.projects.length > 0) {
          const projects = parsed.projects.map(p => normalizeProject(p)).filter(Boolean);
          for (const p of projects) await idbPut(STORE_PROJECTS, p);
          let currentProjectId = parsed.currentProjectId;
          if (!projects.some(p => p.id === currentProjectId)) currentProjectId = projects[0].id;
          await idbPut(STORE_META, { currentProjectId }, META_KEY);
          try { localStorage.removeItem(LIBRARY_KEY); } catch {}
          return { version: 1, currentProjectId, projects };
        }
      }
    } catch (e) { console.warn('library migration failed:', e); }

    // Second-run migration: legacy single-slot key.
    try {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        const p = normalizeProject(JSON.parse(legacy));
        if (p) {
          await idbPut(STORE_PROJECTS, p);
          await idbPut(STORE_META, { currentProjectId: p.id }, META_KEY);
          try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch {}
          return { version: 1, currentProjectId: p.id, projects: [p] };
        }
      }
    } catch (e) { console.warn('legacy migration failed:', e); }

    // Truly fresh — create one blank project and persist it.
    const lib = freshLibrary();
    try {
      await idbPut(STORE_PROJECTS, lib.projects[0]);
      await idbPut(STORE_META, { currentProjectId: lib.currentProjectId, deletedIds: [] }, META_KEY);
      browserLibraryFresh = true;
    } catch {}
    return lib;
  }

  function freshLibrary() {
    const p = blankProject();
    return { version: 1, currentProjectId: p.id, projects: [p], deletedIds: [] };
  }

  function ensureDeletedIds() {
    if (!Array.isArray(library.deletedIds)) library.deletedIds = [];
  }

  function recordTombstone(id) {
    ensureDeletedIds();
    const existing = library.deletedIds.find(t => t.id === id);
    const now = Date.now();
    if (existing) existing.deletedAt = now;
    else library.deletedIds.push({ id, deletedAt: now });
  }

  // Re-importing a project that was deleted earlier must lift its tombstone,
  // or the next sync pull would treat the import as already-deleted and
  // remove it again.
  function clearTombstone(id) {
    ensureDeletedIds();
    library.deletedIds = library.deletedIds.filter(t => t.id !== id);
  }

  // Mark a project (or the current one) for the next flush. This is
  // persistence-only: it does NOT stamp modifiedAt or queue a gist upload,
  // so sync-pulled projects can be written to IDB without looking "edited".
  function markDirty(projectId) {
    dirtyProjects.add(projectId || (state && state.id));
    metaDirty = true;
    if (!workspaceMode) browserLibraryFresh = false;
  }

  // Mark a project as edited by the user: stamp modifiedAt (the value the
  // cross-machine last-write-wins merge compares) and queue it for the next
  // gist push, in addition to the local flush.
  function markEdited(projectId) {
    const id = projectId || (state && state.id);
    if (!id) return;
    const p = library.projects.find(x => x.id === id);
    if (p) {
      p.modifiedAt = Date.now();
      if (p === state && els.deckSettingsModified && !els.deckSettingsModal.hidden) {
        els.deckSettingsModified.textContent = formatDeckDate(p.modifiedAt);
      }
    }
    pushDirty.add(id);
    markDirty(id);
  }

  // Flush whatever's dirty to IndexedDB. Called by scheduleSave / saveProject.
  async function flushDirty({ capture = true, expectedRevision = null } = {}) {
    if (workspaceMode) {
      if (!state) return true;
      if (workspaceConflict && !expectedRevision) return false;
      try {
        // Markdown is authoritative while its editor is open. The WYSIWYG
        // editor remains hidden and may still contain a different slide than
        // the one selected by the Markdown caret.
        if (!markdownMode && capture) captureCurrentContent();
        let markdown = null;
        if (typeof TurndownService !== 'undefined' && typeof marked !== 'undefined') {
          markdown = projectToMarkdown(state);
        }
        const expected = expectedRevision || workspaceRevision?.deckToken || null;
        const result = await workspaceStorage.saveDeck(state, markdown, { expectedRevision: expected });
        workspaceRevision = result?.revision || workspaceRevision;
        hideWorkspaceConflict();
        dirtyProjects.clear();
        metaDirty = false;
        setSaveState('saved', markdown == null ? 'Saved metadata to deck.json' : 'Saved to deck.md');
        return true;
      } catch (e) {
        if (e?.code === 'WORKSPACE_CONFLICT') {
          workspaceExternalRevision = e.revision?.revision || e.revision || workspaceExternalRevision;
          showWorkspaceConflict(workspaceExternalRevision);
          return false;
        }
        setSaveState('error', 'Save failed: ' + (e.message || String(e)));
        setStatus('Save failed: ' + (e.message || String(e)), false);
        return false;
      }
    }
    if (!browserStore?.isOpen()) {
      setSaveState('error', 'Storage unavailable');
      return false;
    }
    try {
      // Snapshot the dirty set so concurrent edits during await don't lose us
      // entries that were marked after this run started.
      const ids = Array.from(dirtyProjects);
      dirtyProjects.clear();
      const wasMetaDirty = metaDirty;
      metaDirty = false;

      for (const id of ids) {
        const p = library.projects.find(x => x.id === id);
        if (!p) continue;
        await idbPut(STORE_PROJECTS, p);
      }
      if (wasMetaDirty) {
        await idbPut(STORE_META, {
          currentProjectId: library.currentProjectId,
          deletedIds: library.deletedIds || [],
        }, META_KEY);
      }
      setSaveState('saved', 'Saved');
      return true;
    } catch (e) {
      const message = 'Save failed: ' + (e.name === 'QuotaExceededError'
        ? 'browser storage is full'
        : (e.message || String(e)));
      setSaveState('error', message);
      setStatus(message, false);
      return false;
    }
  }

  // RV-COMPAT(save-api-shim): REMOVE BEFORE PUBLIC RELEASE.
  // Compatibility shim. Most code paths call saveProject()/saveLibrary() —
  // route them through the dirty-tracking flush.
  function saveProject() {
    if (state) markDirty(state.id);
    setSaveState('saving', 'Saving…');
    flushDirty();
  }
  function saveLibrary() { saveProject(); }

  async function deleteProjectRecord(id) {
    if (!browserStore?.isOpen()) return;
    try { await idbDelete(STORE_PROJECTS, id); } catch (e) { console.warn('delete failed', e); }
  }

  function scheduleSave({ capture = true } = {}) {
    setSaveState('saving', 'Saving…');
    if (state) markEdited(state.id);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; flushDirty({ capture }); }, 400);
    if (!workspaceMode) schedulePush();
  }

  function setSaveState(stateName, detail = '') {
    if (!els.saveIndicator) return;
    const states = {
      saved: { icon: 'bi-check-circle-fill', label: detail || 'Saved' },
      saving: { icon: 'bi-arrow-repeat', label: detail || 'Saving…' },
      error: { icon: 'bi-exclamation-triangle-fill', label: detail || 'Save failed' },
    };
    const next = states[stateName] || states.saved;
    els.saveIndicator.dataset.state = stateName in states ? stateName : 'saved';
    els.saveIndicator.title = next.label;
    els.saveIndicator.setAttribute('aria-label', next.label);
    if (els.saveLabel) els.saveLabel.textContent = next.label;
    const icon = els.saveIndicator.querySelector('i');
    if (icon) icon.className = `bi ${next.icon}`;
  }

  function setStatus(text, ok) {
    if (!els.status) return;
    clearTimeout(statusTimer);
    const message = String(text || '').trim();
    if (!message) {
      els.status.hidden = true;
      return;
    }
    els.status.textContent = message;
    els.status.hidden = false;
    const isError = !ok && /fail|error|invalid|cannot|could not|unavailable|fix|missing/i.test(message);
    els.status.classList.toggle('error', isError);
    els.status.classList.toggle('ok', !!ok && !isError);
    statusTimer = setTimeout(() => {
      els.status.hidden = true;
      els.status.classList.remove('error', 'ok');
    }, isError ? 6000 : 2800);
  }

  // -------- Rendering --------
  function currentSlide() {
    return state.slides.find(s => s.id === state.currentId) || state.slides[0];
  }

  let sidebarController = null;

  function ensureSidebarController() {
    if (sidebarController) return sidebarController;
    if (!window.Revealation?.ui?.createSidebar) {
      throw new Error('Revealation sidebar UI is not loaded.');
    }
    sidebarController = window.Revealation.ui.createSidebar({
      sidebarElement: document.querySelector('.sidebar'),
      listElement: els.slideList,
      headElement: document.querySelector('.sidebar-head'),
      addButton: els.addSlide,
      slideModel,
      labelForSlide: slideLabel,
      renderLabel: renderLabelInto,
      onSelect: selectSlide,
      onSelectionChange: (ids) => { selectedSlideIds = ids; },
      onContextMenu: showSlideContextMenu,
      onMove: moveSlide,
      onNavigate: stepSlide,
      onAfterRender: updateMobileBar,
    });
    return sidebarController;
  }

  function renderSidebar() {
    const total = state?.slides?.length || 0;
    const hidden = state?.slides?.filter(slide => slide.hidden).length || 0;
    if (els.deckSlideCount) els.deckSlideCount.textContent = String(total);
    if (els.deckActiveSlideCount) els.deckActiveSlideCount.textContent = String(total - hidden);
    if (els.deckHiddenSlideCount) els.deckHiddenSlideCount.textContent = String(hidden);
    if (markdownMode) { renderMarkdownSidebar(); return; }
    const validIds = new Set(state.slides.map(slide => slide.id));
    selectedSlideIds = selectedSlideIds.filter(id => validIds.has(id));
    if (!selectedSlideIds.length && state.currentId) selectedSlideIds = [state.currentId];
    const size = logicalSlideSize();
    ensureSidebarController().render({
      slides: state.slides,
      currentId: state.currentId,
      selectedIds: selectedSlideIds,
      width: size.width,
      height: size.height,
      defaultBackgroundId: defaultBackgroundId(state),
    });
  }

  // -------- Slide context menu --------
  function showSlideContextMenu(slideId, x, y, contextSelection = []) {
    const idx = state.slides.findIndex(s => s.id === slideId);
    if (idx < 0) return;
    const slide = state.slides[idx];
    const selectedIds = contextSelection.length ? contextSelection : [slideId];
    selectedSlideIds = selectedIds.slice();
    const multi = selectedIds.length > 1;
    const menu = els.slideMenu;
    menu.innerHTML = '';

    const allUnderConstruction = selectedIds.every(id => state.slides.find(s => s.id === id)?.underConstruction);
    const allHidden = selectedIds.every(id => state.slides.find(s => s.id === id)?.hidden);
    const items = multi ? [
      { label: 'Make selected slides', action: () => setSlidesSubslide(selectedIds, false) },
      { label: 'Make selected subslides', action: () => setSlidesSubslide(selectedIds, true), disabled: selectedIds.every(id => state.slides.findIndex(s => s.id === id) === 0) },
      { sep: true },
      { label: `Move ${selectedIds.length} slides up`, action: () => moveSelectedSlides(-1), disabled: !canMoveSelectedSlides(-1) },
      { label: `Move ${selectedIds.length} slides down`, action: () => moveSelectedSlides(1), disabled: !canMoveSelectedSlides(1) },
      { sep: true },
      { label: allUnderConstruction ? 'Mark selected complete' : 'Mark selected under construction', action: () => setSlidesUnderConstruction(selectedIds, !allUnderConstruction) },
      { label: allHidden ? 'Show selected slides' : 'Hide selected slides', action: () => setSlidesHidden(selectedIds, !allHidden) },
      { sep: true },
      { label: `Delete ${selectedIds.length} slides`, action: () => deleteSlides(selectedIds), danger: true },
    ] : [
      { label: 'Insert slide above', action: () => insertSlideAt(idx, slide.vertical) },
      { label: 'Insert slide below', action: () => insertSlideAt(idx + 1, slide.vertical) },
      { label: 'Duplicate', action: () => duplicateSlide(slideId) },
      { label: slide.underConstruction ? 'Mark as complete' : 'Mark under construction', action: () => toggleSlideUnderConstruction(slideId) },
      { label: slide.hidden ? 'Show in presentation' : 'Hide from presentation', action: () => toggleSlideHidden(slideId) },
      { sep: true },
      { label: slide.vertical ? 'Make slide' : 'Make subslide', action: () => toggleSlideSubslide(slideId), disabled: idx === 0 },
      { label: 'Move up', action: () => swapSlides(idx, idx - 1), disabled: idx === 0 },
      { label: 'Move down', action: () => swapSlides(idx, idx + 1), disabled: idx === state.slides.length - 1 },
      { sep: true },
      { label: 'Delete', action: () => deleteSlides([slideId]), danger: true },
    ];

    items.forEach(item => {
      if (item.sep) {
        const sep = document.createElement('span');
        sep.className = 'sep';
        menu.appendChild(sep);
      } else {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = item.label;
        if (item.danger) btn.className = 'danger';
        if (item.disabled) btn.disabled = true;
        btn.addEventListener('click', () => {
          hideSlideContextMenu();
          item.action();
        });
        menu.appendChild(btn);
      }
    });

    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth) left = Math.max(4, window.innerWidth - rect.width - 4);
    if (top + rect.height > window.innerHeight) top = Math.max(4, window.innerHeight - rect.height - 4);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    const first = menu.querySelector('button:not(:disabled)');
    if (first) first.focus();
  }

  function hideSlideContextMenu() {
    if (els.slideMenu.hidden) return;
    const hadFocus = els.slideMenu.contains(document.activeElement);
    els.slideMenu.hidden = true;
    if (hadFocus) {
      const li = els.slideList.querySelector('li.active');
      if (li) li.focus();
    }
  }

  function insertSlideAt(idx, vertical = false) {
    recordHistory();
    const s = newSlide('');
    // Inherit hierarchy from the clicked slide — inserting around a subslide
    // keeps the new item in the same reveal.js stack rather than breaking out
    // to a new top-level slide. Slot 0 can never be a subslide.
    if (vertical && idx > 0) s.vertical = true;
    state.slides.splice(idx, 0, s);
    state.currentId = s.id;
    renderAll();
    scheduleSave();
    closeSlidesDrawer();
    els.editor.focus();
  }

  function duplicateSlide(id) {
    const idx = state.slides.findIndex(x => x.id === id);
    if (idx < 0) return;
    recordHistory();
    const copy = JSON.parse(JSON.stringify(state.slides[idx]));
    copy.id = uid();
    state.slides.splice(idx + 1, 0, copy);
    state.currentId = copy.id;
    renderAll();
    scheduleSave();
  }

  function swapSlides(a, b) {
    if (a < 0 || b < 0 || a >= state.slides.length || b >= state.slides.length) return;
    recordHistory();
    [state.slides[a], state.slides[b]] = [state.slides[b], state.slides[a]];
    renderSidebar();
    scheduleSave();
  }

  function toggleSlideSubslide(id) {
    const s = state.slides.find(x => x.id === id);
    if (!s) return;
    recordHistory();
    s.vertical = !s.vertical;
    if (id === state.currentId) els.subslide.checked = s.vertical;
    renderSidebar();
    scheduleSave();
  }

  function setSlidesSubslide(ids, value) {
    const selected = new Set(ids);
    const targets = state.slides.filter(slide => selected.has(slide.id));
    if (!targets.length) return;
    suppressContentCapture += 1;
    try {
      recordHistory();
      targets.forEach(slide => {
        const index = state.slides.indexOf(slide);
        slide.vertical = !!value && index > 0;
      });
      if (state.slides[0]) state.slides[0].vertical = false;
      const current = currentSlide();
      if (current) els.subslide.checked = !!current.vertical;
    } finally {
      suppressContentCapture -= 1;
    }
    renderSidebar();
    scheduleSave({ capture: false });
  }

  function toggleSlideUnderConstruction(id) {
    const slide = state.slides.find(x => x.id === id);
    if (!slide) return;
    suppressContentCapture += 1;
    try {
      recordHistory();
      slide.underConstruction = !slide.underConstruction;
    } finally {
      suppressContentCapture -= 1;
    }
    renderSidebar();
    scheduleSave({ capture: false });
  }

  function setSlidesHidden(ids, value) {
    const selected = new Set(ids);
    const targets = state.slides.filter(slide => selected.has(slide.id));
    if (!targets.length) return;
    suppressContentCapture += 1;
    try {
      recordHistory();
      targets.forEach(slide => { slide.hidden = !!value; });
      if (targets.some(slide => slide.id === state.currentId) && els.hiddenSlide) els.hiddenSlide.checked = !!value;
    } finally {
      suppressContentCapture -= 1;
    }
    renderSidebar();
    scheduleSave({ capture: false });
  }

  function toggleSlideHidden(id) {
    const slide = state.slides.find(x => x.id === id);
    if (!slide) return;
    setSlidesHidden([id], !slide.hidden);
  }

  function slideNumber(idx) {
    return slideModel.number(state.slides, idx);
  }

  // Returns { icon, text } so renderers can put an icon <i> next to the
  // text instead of mixing emoji into the textContent.
  function slideLabel(slide, index = -1) {
    const fallbackIndex = index >= 0 ? index : state?.slides?.findIndex?.(item => item.id === slide?.id);
    const fallback = { icon: null, text: `Slide ${Math.max(0, fallbackIndex) + 1}` };
    if (!slide) return fallback;

    const def = layoutRegistry?.get?.(slide.layout || 'single');
    const titleIndex = def?.slots?.findIndex?.(slot => slot.titleSource === true) ?? -1;
    if (titleIndex < 0) return fallback;

    let html = '';
    if (def.id === 'single') {
      html = String(slide.content || '');
    } else if (Array.isArray(slide.blocks) && slide.blocks[titleIndex]) {
      html = String(slide.blocks[titleIndex].html || '');
    } else {
      const extracted = layoutBlocksFromContent(slide.content || '', def.id);
      html = String(extracted?.blocks?.[titleIndex]?.html || '');
    }

    const holder = parseHtml(html);
    const text = String(holder.textContent || '').trim().replace(/\s+/g, ' ');
    if (!text) return fallback;
    return { icon: null, text: text.length > 48 ? text.slice(0, 48) + '…' : text };
  }

  const BG_ICONS = {
    image: 'bi-image',
    video: 'bi-camera-video',
    iframe: 'bi-globe',
    color: 'bi-brush',
  };

  function backgroundLabel(bg) {
    const extensionId = backgroundExtensionId(bg);
    if (extensionId) {
      const definition = backgroundRegistry?.get?.(extensionId);
      return { icon: 'bi-layers', text: definition?.name || extensionId };
    }
    const type = bg?.type;
    const value = String(bg?.value || '');
    let hint;
    if (type === 'color') {
      hint = value.trim();
    } else if (/^data:/.test(value)) {
      const mime = (value.match(/^data:([^;,]+)/) || ['', ''])[1];
      hint = mime ? `inline ${mime}` : 'inline data';
    } else {
      hint = value;
      try {
        const u = new URL(value, window.location.href);
        hint = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname);
      } catch {
        const parts = value.split(/[/\\]/).filter(Boolean);
        if (parts.length) hint = parts[parts.length - 1];
      }
    }
    if (hint.length > 40) hint = hint.slice(0, 37) + '…';
    return { icon: BG_ICONS[type] || null, text: hint };
  }

  // Renders a {icon, text} label into a DOM element, replacing its contents.
  function renderLabelInto(el, label) {
    el.replaceChildren();
    if (label.icon) {
      const i = document.createElement('i');
      i.className = 'bi ' + label.icon + ' label-icon';
      el.appendChild(i);
    }
    el.appendChild(document.createTextNode(label.text));
  }

  function syncEditorSemanticClasses(slide) {
    Array.from(els.frame.classList).forEach(name => {
      if (name === 'rv-slide' || name.startsWith('rv-layout-')) els.frame.classList.remove(name);
    });
    els.frame.classList.add('rv-slide', `rv-layout-${slide?.layout || 'single'}`);
  }

  function orderedBackgroundDefinitions(project = state) {
    const all = backgroundRegistry?.list?.() || [];
    const recommended = themeDefinition(project)?.backgrounds?.recommended || [];
    const order = new Map(recommended.map((id, index) => [id, index]));
    return [...all].sort((a, b) => {
      const ai = order.has(a.id) ? order.get(a.id) : Number.MAX_SAFE_INTEGER;
      const bi = order.has(b.id) ? order.get(b.id) : Number.MAX_SAFE_INTEGER;
      return ai - bi || a.name.localeCompare(b.name);
    });
  }

  function renderBackgroundChoices() {
    const slide = currentSlide();
    if (!slide || !els.bgChoices) return;
    const explicitId = backgroundExtensionId(slide.background);
    const legacy = legacyBackground(slide.background);
    const themeDefault = defaultBackgroundId(state);
    const selectedId = explicitId || '';
    els.bgChoices.replaceChildren();

    const makeChoice = (id, name, previewUrl = '') => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'background-choice';
      button.dataset.backgroundId = id;
      button.setAttribute('aria-pressed', String(selectedId === id));
      if (selectedId === id) button.classList.add('selected');
      const preview = document.createElement('span');
      preview.className = 'background-choice-preview';
      if (previewUrl) preview.style.backgroundImage = `url("${previewUrl.replace(/"/g, '%22')}")`;
      else preview.classList.add('background-choice-none');
      const label = document.createElement('span');
      label.className = 'background-choice-label';
      label.textContent = name;
      button.append(preview, label);
      return button;
    };

    els.bgChoices.appendChild(makeChoice('', themeDefault ? 'Theme default' : 'None'));
    orderedBackgroundDefinitions().forEach(definition => {
      els.bgChoices.appendChild(makeChoice(definition.id, definition.name, definition.previewUrl));
    });

    // RV-COMPAT(background-reveal): REMOVE BEFORE PUBLIC RELEASE.
    if (els.bgLegacyNotice) {
      if (legacy) {
        els.bgLegacyNotice.textContent = `Legacy ${legacy.type} background preserved. Choose a curated background to replace it.`;
        els.bgLegacyNotice.hidden = false;
      } else if (explicitId && !backgroundRegistry?.get?.(explicitId)) {
        els.bgLegacyNotice.textContent = `Background extension “${explicitId}” is not installed; metadata is preserved.`;
        els.bgLegacyNotice.hidden = false;
      } else {
        els.bgLegacyNotice.hidden = true;
        els.bgLegacyNotice.textContent = '';
      }
    }
  }

  function renderEditor() {
    clearMediaSelection();
    // A DOM Range belongs to the concrete nodes of one rendered slide. Never
    // carry it across a slide render; toolbar actions would otherwise restore
    // a stale range from the previous slide and mutate the wrong structure.
    lastEditorRange = null;
    const slide = currentSlide();
    normalizeSlideLayout(slide);
    syncEditorSemanticClasses(slide);
    if (sourceMode) {
      els.source.value = slide.content;
    } else {
      els.editor.innerHTML = slide.content;
      refreshWorkspaceAssetUrls(els.editor);
      decorateFragments();
      decorateRichContent();
      refreshCropGeometry(els.editor);
    }
    renderBackgroundChoices();
    els.subslide.checked = !!slide.vertical;
    els.wip.checked = slide.underConstruction === true;
    if (els.hiddenSlide) els.hiddenSlide.checked = slide.hidden === true;
    syncNotesPanel();
    applySlideEffects();
    applyEditorBackground();
    syncToolbarState();
    updateMobileBar();
  }

  // RV-COMPAT(background-reveal): raw-background branch below is temporary.
  // Animation JavaScript is intentionally never loaded in the editor; each
  // background extension supplies its own deterministic static preview.
  function applyEditorBackground() {
    const slide = currentSlide();
    const layer = els.bgLayer;
    const badge = els.bgBadge;
    backgroundRegistry?.clearPreview?.(layer);
    layer.className = 'slide-bg-layer rv-background-host';
    layer.style.background = '';
    layer.style.backgroundImage = '';
    layer.style.backgroundSize = '';
    layer.removeAttribute('data-bg-size');
    layer.removeAttribute('data-rv-background');
    layer.replaceChildren();
    badge.hidden = true;
    badge.textContent = '';
    if (!slide) return;

    const explicitId = backgroundExtensionId(slide.background);
    const id = effectiveBackgroundId(slide);
    if (id) {
      const definition = backgroundRegistry?.get?.(id);
      if (definition) {
        backgroundRegistry.ensureStyle(id);
        layer.setAttribute('data-rv-background', id);
        backgroundRegistry.paintPreview?.(id, layer);
        return;
      }
      if (explicitId) {
        badge.textContent = `Missing background: ${explicitId}`;
        badge.hidden = false;
      }
      return;
    }

    const legacy = legacyBackground(slide.background);
    if (!legacy) return;
    const { type, value, size } = legacy;
    if (size) layer.setAttribute('data-bg-size', size);
    if (type === 'color') {
      layer.style.background = value;
    } else if (type === 'image') {
      const safeValue = workspaceAssetUrl(value);
      const safe = safeValue.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      layer.style.backgroundImage = `url("${safe}")`;
      if (size) layer.style.backgroundSize = size;
    } else {
      // Do not run old video/iframe backgrounds while editing; this matches
      // the new extension rule that editor backgrounds are static previews.
      badge.textContent = `Legacy ${type} background (presentation only)`;
      badge.hidden = false;
      return;
    }

    const display = value.length > 80 ? value.slice(0, 77) + '…' : value;
    badge.textContent = `Legacy ${type}: ${display}`;
    badge.hidden = false;
  }

  // -------- Undo / redo --------
  // Core decides what a project snapshot contains and which mutations create
  // entries. `core/history.js` owns only bounded stack mechanics.
  let textEditField = null;  // snapshot once per text-input focus session

  function snapshotProject() {
    const snap = {
      title: state.title,
      name: state.name,
      author: state.author || '',
      theme: state.theme,
      // RV-COMPAT(theme-custom): REMOVE BEFORE PUBLIC RELEASE.
      legacyCustomTheme: state.legacyCustomTheme ? { ...state.legacyCustomTheme } : null,
      customTheme: state.customTheme ? { ...state.customTheme } : null,
      currentId: state.currentId,
      slides: JSON.parse(JSON.stringify(state.slides)),
      config: { ...(state.config || {}) },
    };
    snap.bytes = snap.slides.reduce(
      (n, slide) => n + (slide.content ? slide.content.length : 0) + (slide.notes ? slide.notes.length : 0), 0);
    return snap;
  }

  function restoreProject(snap) {
    state.title = snap.title;
    if (snap.name !== undefined) state.name = snap.name;
    state.author = snap.author || '';
    state.theme = themeRegistry?.resolveOrDefault?.(snap.theme) || themeRegistry?.defaultId || 'clean';
    // RV-COMPAT(theme-custom): REMOVE BEFORE PUBLIC RELEASE.
    state.legacyCustomTheme = snap.legacyCustomTheme ? normalizeCustomTheme(snap.legacyCustomTheme) : null;
    state.customTheme = snap.customTheme ? normalizeCustomTheme(snap.customTheme) : state.customTheme;
    state.slides = snap.slides;
    state.currentId = snap.currentId;
    if (snap.config) state.config = { ...snap.config };
    if (!state.slides.some((slide) => slide.id === state.currentId)) {
      state.currentId = state.slides[0] && state.slides[0].id;
    }
    renderAll();
    if (!els.settingsModal.hidden) { syncUiThemeSettings(); renderPresentationSettings(); }
    if (!els.projectsModal.hidden) renderProjectsList();
    if (!els.deckSettingsModal.hidden) { renderDeckSettings(); }
    scheduleSave();
  }

  const historyController = createHistory({
    snapshot: snapshotProject,
    restore: restoreProject,
    beforeSnapshot: captureCurrentContent,
    onChange: ({ canUndo, canRedo }) => {
      els.undoBtn.disabled = !canUndo;
      els.redoBtn.disabled = !canRedo;
    },
  });

  function recordHistory() { historyController.record(); }

  function snapshotForTextField(name) {
    if (textEditField === name) return;
    recordHistory();
    textEditField = name;
  }

  function endTextEditSession() { textEditField = null; }

  function undo() {
    if (historyController.undo()) textEditField = null;
  }

  function redo() {
    if (historyController.redo()) textEditField = null;
  }

  function refreshUndoButtons() {
    els.undoBtn.disabled = !historyController.canUndo();
    els.redoBtn.disabled = !historyController.canRedo();
  }

  function clearHistory() {
    historyController.clear();
    textEditField = null;
  }



  function decorateFragments() {
    els.editor.querySelectorAll('.fragment').forEach((el, idx) => {
      const type = FRAGMENT_TYPES.find(t => el.classList.contains(t));
      const explicit = el.getAttribute('data-fragment-index');
      const label = explicit != null ? explicit : String(idx + 1);
      el.setAttribute('data-fragment-label', type ? `${label} ${type}` : label);
    });
  }

  function populateThemeOptions() {
    if (!els.themeSelect) return;
    els.themeSelect.replaceChildren();
    (themeRegistry?.list?.() || []).forEach(definition => {
      const option = document.createElement('option');
      option.value = definition.id;
      option.textContent = definition.name;
      els.themeSelect.appendChild(option);
    });
  }

  function syncThemeUi() {
    const definition = themeDefinition(state);
    const id = definition?.id || themeRegistry?.defaultId || 'clean';
    if (els.themeSelect) els.themeSelect.value = id;
  }

  function renderThemePicker() {
    if (!els.themeChoices) return;
    els.themeChoices.replaceChildren();
    const active = themeDefinition(state)?.id || state.theme;
    (themeRegistry?.list?.() || []).forEach(definition => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'theme-choice';
      button.dataset.themeId = definition.id;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(definition.id === active));
      if (definition.id === active) button.classList.add('selected');
      const preview = document.createElement('span');
      preview.className = 'theme-choice-preview';
      if (definition.previewUrl) preview.style.backgroundImage = `url("${definition.previewUrl.replace(/"/g, '%22')}")`;
      const copy = document.createElement('span');
      copy.className = 'theme-choice-copy';
      const name = document.createElement('strong');
      name.className = 'theme-choice-name';
      name.textContent = definition.name;
      const description = document.createElement('span');
      description.className = 'theme-choice-description';
      description.textContent = definition.description || `Revealation theme ${definition.version}`;
      copy.append(name, description);
      button.append(preview, copy);
      els.themeChoices.appendChild(button);
    });
  }

  function selectPresentationTheme(id, { record = true } = {}) {
    const resolved = themeRegistry?.resolveOrDefault?.(id) || themeRegistry?.defaultId || 'clean';
    // RV-COMPAT(theme-custom): choosing a curated theme discards the old overlay.
    if (resolved === state.theme && !state.legacyCustomTheme) return;
    if (record) recordHistory();
    state.theme = resolved;
    state.legacyCustomTheme = null;
    applyDeckTheme(resolved);
    syncThemeUi();
    renderThemePicker();
    renderBackgroundChoices();
    applyEditorBackground();
    renderSidebar();
    scheduleSave();
  }

  function renderAll() {
    els.deckTitle.textContent = state.title || state.name || 'Untitled presentation';
    syncThemeUi();
    applyDeckTheme(state.theme);
    renderSidebar();
    renderEditor();
  }

  // -------- Live theme + sizing in the editor preview --------

  function applyDeckTheme(theme) {
    let link = document.getElementById('deck-theme-css');
    if (!link) {
      link = document.createElement('link');
      link.id = 'deck-theme-css';
      link.rel = 'stylesheet';
      link.addEventListener('load', applySlideEffects);
      document.head.appendChild(link);
    }
    const bits = themePayloadBits({ ...state, theme });
    if (link.getAttribute('href') !== bits.themeCssHref) link.setAttribute('href', bits.themeCssHref);
    // RV-COMPAT(theme-custom): REMOVE BEFORE PUBLIC RELEASE.
    applyCustomThemeExtras(state?.legacyCustomTheme ? normalizeCustomTheme(state.legacyCustomTheme) : null);
  }

  // Retained only so legacy custom decks keep rendering. There is no editor
  // UI for these overrides in the curated theme system.
  function applyCustomThemeExtras(custom) {
    const href = custom ? googleFontsHref(custom) : '';
    const css = presentationThemeCss(custom);
    let fonts = document.getElementById('custom-fonts-css');
    if (href) {
      if (!fonts) {
        fonts = document.createElement('link');
        fonts.id = 'custom-fonts-css';
        fonts.rel = 'stylesheet';
        fonts.addEventListener('load', applySlideEffects);
        document.head.appendChild(fonts);
      }
      if (fonts.getAttribute('href') !== href) fonts.setAttribute('href', href);
    } else if (fonts) {
      fonts.remove();
    }
    let style = document.getElementById('custom-theme-css');
    if (css) {
      if (!style) {
        style = document.createElement('style');
        style.id = 'custom-theme-css';
      }
      if (style.textContent !== css) style.textContent = css;
      document.head.appendChild(style);
    } else if (style) {
      style.remove();
    }
  }

  // -------- WYSIWYG slide geometry --------

  // Reveal.js lays content out at a fixed logical width/height (960x700 by
  // default) and uniformly scales that canvas into the viewport. The editor
  // must do the same. Scaling only the font changes line wrapping and was the
  // main reason the old editor disagreed with Present/export.
  function logicalSlideSize() {
    const cfg = { ...defaultRevealConfig(), ...(state.config || {}) };
    const width = Math.max(200, Number(cfg.width) || 960);
    const height = Math.max(200, Number(cfg.height) || 700);
    return { width, height };
  }

  function updateStageScale() {
    const stage = els.frame && els.frame.parentElement;
    if (!els.frame || !stage) return;
    const { width, height } = logicalSlideSize();
    const cs = getComputedStyle(stage);
    const availW = Math.max(1, stage.clientWidth
      - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0));
    const availH = Math.max(1, stage.clientHeight
      - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0));
    const scale = Math.min(1, availW / width, availH / height);
    const cleanScale = Math.max(0.05, Math.round(scale * 10000) / 10000);
    els.frame.style.width = `${Math.round(width * cleanScale * 100) / 100}px`;
    els.frame.style.height = `${Math.round(height * cleanScale * 100) / 100}px`;
    els.frame.style.setProperty('--stage-scale', String(cleanScale));
    els.frame.style.setProperty('--sr-logical-slide-width', String(width));
    els.frame.style.setProperty('--sr-logical-slide-height', String(height));

    // Resolve length-valued theme tokens in JS. `calc(64px * .7)` and
    // `calc(22px * .7)` are not portable CSS, so the old editor silently lost
    // padding/body-size scaling in Chromium and could never match Reveal.
    const tokenStyle = getComputedStyle(els.editor);
    const logicalPadding = parseFloat(tokenStyle.getPropertyValue('--rv-slide-padding')) || 0;
    const logicalBodySize = parseFloat(tokenStyle.getPropertyValue('--rv-size-body'))
      || parseFloat(tokenStyle.getPropertyValue('--r-main-font-size')) || 22;
    els.frame.style.setProperty('--stage-slide-padding', `${Math.round(logicalPadding * cleanScale * 100) / 100}px`);
    els.frame.style.setProperty('--stage-body-size', `${Math.round(logicalBodySize * cleanScale * 100) / 100}px`);

    // Unlike text and slide padding, iframe height is an authored pixel value.
    // Reveal lays it out in logical slide pixels and then scales the complete
    // canvas. The editor uses a physically smaller canvas, so mirror that
    // transform explicitly or the iframe gets a different aspect ratio here.
    els.editor?.querySelectorAll('.sr-interactive, .sr-demo').forEach(el => {
      let logicalHeight = Number(el.dataset.height);
      if (!Number.isFinite(logicalHeight) || logicalHeight <= 0) {
        logicalHeight = parseFloat(el.style.height);
        if (Number.isFinite(logicalHeight) && logicalHeight > 0) {
          el.dataset.height = String(Math.round(logicalHeight * 100) / 100);
        }
      }
      if (Number.isFinite(logicalHeight) && logicalHeight > 0) {
        el.style.height = `${Math.round(logicalHeight * cleanScale * 100) / 100}px`;
      }
    });
  }

  function resetEditorVerticalPadding() {
    if (!els.editor) return;
    // Let the theme-provided scaled padding from `.slide-editor` become the
    // baseline again. Setting these to 0 used to erase vertical theme padding
    // in the editor, which made editor/Present/PDF geometry diverge.
    els.editor.style.removeProperty('padding-top');
    els.editor.style.removeProperty('padding-bottom');
  }

  function syncEditorCenteringAndOverflow() {
    if (!els.editor || sourceMode) {
      els.frame.removeAttribute('data-content-overflow');
      return;
    }
    resetEditorVerticalPadding();
    const centered = state.config?.center !== false;
    const baseStyle = getComputedStyle(els.editor);
    const basePadTop = parseFloat(baseStyle.paddingTop) || 0;
    const basePadBottom = parseFloat(baseStyle.paddingBottom) || 0;
    // Reveal centers the *section scroll box* inside the logical slide. That
    // scroll box includes theme padding. Measure the authored children, add
    // the same baseline padding, then apply only the extra centering offset.
    // This preserves theme margins when center=false and exactly mirrors
    // Reveal's `top = (slideHeight - section.scrollHeight) / 2` behavior when
    // center=true.
    const children = Array.from(els.editor.children).filter(el => {
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.position !== 'absolute';
    });
    let naturalTop = Infinity;
    let naturalBottom = 0;
    children.forEach(el => {
      const cs = getComputedStyle(el);
      const top = el.offsetTop - (parseFloat(cs.marginTop) || 0);
      const bottom = el.offsetTop + el.offsetHeight + (parseFloat(cs.marginBottom) || 0);
      naturalTop = Math.min(naturalTop, top);
      naturalBottom = Math.max(naturalBottom, bottom);
    });
    const available = els.editor.clientHeight;
    const natural = Math.max(0, naturalBottom - (Number.isFinite(naturalTop) ? naturalTop : basePadTop));
    const sectionHeight = natural + basePadTop + basePadBottom;
    if (centered && natural > 0 && sectionHeight < available) {
      const extraTop = Math.max(0, (available - sectionHeight) / 2);
      els.editor.style.paddingTop = `${basePadTop + extraTop}px`;
      els.editor.style.paddingBottom = `${basePadBottom}px`;
    }
    const overflowY = els.editor.scrollHeight > els.editor.clientHeight + 2;
    const overflowX = els.editor.scrollWidth > els.editor.clientWidth + 2;
    els.frame.toggleAttribute('data-content-overflow', overflowY || overflowX);
  }

  // Reveal's r-fit-text scales an element's font-size to fill the slide width;
  // r-stretch fills the slide's remaining vertical space. The editor uses the
  // same conventions so the preview matches what the deck will render.
  function applySlideEffects() {
    updateStageScale();
    if (sourceMode) {
      els.frame.removeAttribute('data-content-overflow');
      return;
    }
    resetEditorVerticalPadding();
    els.editor.querySelectorAll('.r-fit-text').forEach(fitTextElement);
    els.editor.querySelectorAll('.r-stretch').forEach(stretchElement);
    syncEditorCenteringAndOverflow();
  }

  // Intrinsic media dimensions often arrive after the slide DOM has already
  // been centered. Re-measure on the next two animation frames so layout and
  // image decoding have both settled before computing vertical padding.
  let intrinsicReflowGeneration = 0;
  function scheduleIntrinsicSlideReflow() {
    const generation = ++intrinsicReflowGeneration;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (generation !== intrinsicReflowGeneration) return;
      applySlideEffects();
      positionMediaSelection();
    }));
  }

  function handleEditorIntrinsicLoad(event) {
    const target = event?.target;
    if (!target || !els.editor.contains(target)) return;
    if (target.matches?.('.sr-media-crop > img')) refreshCropGeometry(els.editor);
    scheduleIntrinsicSlideReflow();
  }

  function fitTextElement(el) {
    const container = els.editor;
    if (!container || !container.clientWidth) return;
    const padX = parseFloat(getComputedStyle(container).paddingLeft) +
                 parseFloat(getComputedStyle(container).paddingRight);
    const available = container.clientWidth - padX;
    if (available <= 0) return;
    // Binary search on font-size so el.scrollWidth fits available width.
    let lo = 8, hi = 600;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      el.style.fontSize = mid + 'px';
      if (el.scrollWidth <= available) lo = mid;
      else hi = mid - 1;
    }
    el.style.fontSize = lo + 'px';
  }

  function stretchElement(el) {
    const container = els.editor;
    if (!container) return;
    const cs = getComputedStyle(container);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const available = container.clientHeight - padY;
    if (available <= 0) return;
    // Briefly collapse so siblings measure naturally, then take what's left.
    el.style.height = '0px';
    let usedByOthers = 0;
    Array.from(container.children).forEach(child => {
      if (child === el) return;
      const r = child.getBoundingClientRect();
      usedByOthers += r.height;
    });
    const target = Math.max(40, available - usedByOthers - 8);
    el.style.height = target + 'px';
  }

  // -------- Slide operations --------
  function selectSlide(id) {
    captureCurrentContent();
    state.currentId = id;
    selectedSlideIds = id ? [id] : [];
    renderAll();
    closeSlidesDrawer();
  }

  function addSlide({ atEnd = false, layout = 'single' } = {}) {
    recordHistory();
    const s = newSlide('');
    const definition = layoutRegistry?.get?.(layout);
    if (definition && definition.id !== 'single' && layoutBlocks?.slotInitialHtml) {
      s.layout = definition.id;
      s.blocks = definition.slots.map(slot => ({
        html: layoutBlocks.slotInitialHtml(slot),
        align: 'left',
      }));
      s.content = renderSlideBlocks(s) || '';
    }
    if (atEnd) {
      state.slides.push(s);
    } else {
      const idx = state.slides.findIndex(x => x.id === state.currentId);
      state.slides.splice(idx + 1, 0, s);
    }
    state.currentId = s.id;
    renderAll();
    scheduleSave();
    els.editor.focus();
  }

  function deleteSlides(ids) {
    const requested = new Set(ids);
    const targets = state.slides.filter(slide => requested.has(slide.id));
    if (!targets.length) return;
    recordHistory();
    if (state.slides.length === 1 || targets.length >= state.slides.length) {
      // Reset the only slide instead of deleting
      state.slides[0] = newSlide('');
      state.currentId = state.slides[0].id;
    } else {
      const firstRemoved = state.slides.findIndex(slide => requested.has(slide.id));
      state.slides = state.slides.filter(slide => !requested.has(slide.id));
      if (requested.has(state.currentId)) {
        state.currentId = state.slides[Math.max(0, firstRemoved - 1)].id;
      }
    }
    selectedSlideIds = state.currentId ? [state.currentId] : [];
    renderAll();
    scheduleSave();
  }

  function deleteSlide(id) { deleteSlides([id]); }

  function canMoveSelectedSlides(direction) {
    const selected = new Set(selectedSlideIds);
    const indices = state.slides.map((slide, index) => selected.has(slide.id) ? index : -1).filter(index => index >= 0);
    if (!indices.length) return false;
    if (direction < 0) return indices[0] > 0 && !selected.has(state.slides[indices[0] - 1].id);
    return indices[indices.length - 1] < state.slides.length - 1 && !selected.has(state.slides[indices[indices.length - 1] + 1].id);
  }

  function moveSelectedSlides(direction) {
    if (!canMoveSelectedSlides(direction)) return;
    const selected = new Set(selectedSlideIds);
    recordHistory();
    if (direction < 0) {
      for (let i = 1; i < state.slides.length; i += 1) {
        if (selected.has(state.slides[i].id) && !selected.has(state.slides[i - 1].id)) {
          [state.slides[i - 1], state.slides[i]] = [state.slides[i], state.slides[i - 1]];
        }
      }
    } else {
      for (let i = state.slides.length - 2; i >= 0; i -= 1) {
        if (selected.has(state.slides[i].id) && !selected.has(state.slides[i + 1].id)) {
          [state.slides[i], state.slides[i + 1]] = [state.slides[i + 1], state.slides[i]];
        }
      }
    }
    if (state.slides[0]) state.slides[0].vertical = false;
    renderSidebar();
    scheduleSave();
  }

  function setSlidesUnderConstruction(ids, value) {
    const selected = new Set(ids);
    const targets = state.slides.filter(slide => selected.has(slide.id));
    if (!targets.length) return;
    suppressContentCapture += 1;
    try {
      recordHistory();
      targets.forEach(slide => { slide.underConstruction = !!value; });
    } finally {
      suppressContentCapture -= 1;
    }
    renderSidebar();
    scheduleSave({ capture: false });
  }

  // How many slides move together when you drag the one at `idx`. A top-level
  // A slide carries its subslides with it; a subslide moves on its own.
  // RV-COMPAT(subslide-vertical): REMOVE persisted `vertical` field before public release.
  // Slot 0 is always top-level, so a legacy vertical flag there is ignored.
  function slideBlockLength(idx) {
    const s = state.slides[idx];
    if (!s) return 0;
    if (idx > 0 && s.vertical) return 1;
    let n = 1;
    while (idx + n < state.slides.length && state.slides[idx + n].vertical) n++;
    return n;
  }

  // mode: 'before' | 'after' | 'nest'
  //   before/after place the block as a sibling at the target's own level.
  //   nest makes the block a subslide directly under the target
  //   (or, when the target is itself a sub-slide, joins its group there).
  function moveSlide(fromId, targetId, mode = 'before', selectedIds = []) {
    if (selectedIds.length > 1 && selectedIds.includes(fromId)) {
      moveSelectedToTarget(selectedIds, targetId, mode);
      return;
    }
    const fromIdx = state.slides.findIndex(s => s.id === fromId);
    const targetIdx = state.slides.findIndex(s => s.id === targetId);
    if (fromIdx < 0 || targetIdx < 0) return;

    const len = slideBlockLength(fromIdx);
    // Dropping a block inside itself would delete it — a parent can't become
    // a child of its own descendant.
    if (targetIdx >= fromIdx && targetIdx < fromIdx + len) return;

    const target = state.slides[targetIdx];
    let insertAt;
    let vertical;
    if (mode === 'nest') {
      insertAt = targetIdx + 1;
      vertical = true;
    } else if (mode === 'after') {
      // Land past the target's whole group so we never split one open.
      insertAt = targetIdx + slideBlockLength(targetIdx);
      vertical = !!target.vertical && targetIdx > 0;
    } else {
      insertAt = targetIdx;
      vertical = !!target.vertical && targetIdx > 0;
    }

    recordHistory();
    const block = state.slides.splice(fromIdx, len);
    if (fromIdx < insertAt) insertAt -= len;
    block[0].vertical = vertical;
    state.slides.splice(insertAt, 0, ...block);
    // Slot 0 can never be a sub-slide.
    if (state.slides[0]) state.slides[0].vertical = false;

    const cur = currentSlide();
    if (cur) els.subslide.checked = !!cur.vertical;
    renderSidebar();
    scheduleSave();
  }

  function moveSelectedToTarget(ids, targetId, mode = 'before') {
    const selected = new Set(ids);
    const moving = state.slides.filter(slide => selected.has(slide.id));
    if (!moving.length || selected.has(targetId)) return;
    const targetIndex = state.slides.findIndex(slide => slide.id === targetId);
    if (targetIndex < 0) return;
    recordHistory();
    let insertAt = targetIndex;
    if (mode === 'after') insertAt += 1;
    const beforeTarget = state.slides.slice(0, insertAt).filter(slide => !selected.has(slide.id)).length;
    const target = state.slides[targetIndex];
    state.slides = state.slides.filter(slide => !selected.has(slide.id));
    insertAt = beforeTarget;
    moving[0].vertical = mode === 'nest' ? true : !!target.vertical && targetIndex > 0;
    if (mode === 'nest') insertAt = state.slides.findIndex(slide => slide.id === targetId) + 1;
    state.slides.splice(Math.max(0, insertAt), 0, ...moving);
    if (state.slides[0]) state.slides[0].vertical = false;
    renderSidebar();
    scheduleSave();
  }

  function layoutHostAlign(host) {
    if (!host) return 'left';
    const cls = Array.from(host.classList || []).find(name => /^sr-align-(left|center|right)$/.test(name));
    return cls ? cls.slice('sr-align-'.length) : 'left';
  }

  function cleanLayoutHostContent(host) {
    const clone = host.cloneNode(true);
    stripWorkspaceAssetRevisions(clone);
    undecorateRichContent(clone);
    // The cloned host itself is not structural data; only its inner HTML is
    // persisted. Normalize browser-generated paragraph wrappers locally so a
    // harmless contenteditable artifact can never invalidate the whole layout.
    contentNormalization?.normalizeForSerialization(clone);
    stripEditorSizing(clone);
    return clone.innerHTML;
  }

  function layoutHostInfo(slide, host) {
    if (!slide || !host?.classList?.contains('sr-layout-content')) return null;
    const slot = host.parentElement;
    const layout = slot?.parentElement;
    const def = layoutRegistry?.get(slide.layout);
    if (!slot?.classList?.contains('sr-layout-slot') || !layout?.classList?.contains('sr-layout') || !def) return null;
    if (layout.dataset.layout !== slide.layout || !els.editor.contains(layout)) return null;
    const index = def.slots.findIndex(item => item.id === slot.dataset.slot);
    if (index < 0) return null;
    return { layout, slot, def, index };
  }

  function commitLayoutHost(slide, host) {
    const info = layoutHostInfo(slide, host);
    if (!info) return false;
    if (!Array.isArray(slide.blocks) || slide.blocks.length !== info.def.slots.length) {
      slide.blocks = info.def.slots.map((_, index) => ({
        html: String(slide.blocks?.[index]?.html || ''),
        align: String(slide.blocks?.[index]?.align || 'left'),
      }));
    }
    slide.blocks[info.index] = {
      html: cleanLayoutHostContent(host),
      align: layoutHostAlign(host),
    };
    const rendered = renderSlideBlocks(slide);
    if (rendered != null) slide.content = rendered;
    return true;
  }

  function captureLayoutHosts(slide) {
    const def = layoutRegistry?.get(slide?.layout);
    if (!def || slide.layout === 'single') return false;
    const layouts = Array.from(els.editor.children).filter(el => el.classList?.contains('sr-layout'));
    const layout = layouts.find(el => el.dataset.layout === slide.layout);
    if (!layout) return false;

    // Capture by semantic slot identity, not by exact wrapper shape. Chromium
    // may insert harmless BR/text nodes around nested editing hosts. Requiring
    // `slot.children.length === 1` made ordinary typing fail even though all
    // protected hosts were still present and unambiguous.
    const next = [];
    for (const slotDef of def.slots) {
      const slot = Array.from(layout.children).find(el =>
        el.classList?.contains('sr-layout-slot') && el.dataset.slot === slotDef.id);
      if (!slot) return false;
      const host = Array.from(slot.children).find(el => el.classList?.contains('sr-layout-content'));
      if (!host) return false;
      next.push({ html: cleanLayoutHostContent(host), align: layoutHostAlign(host) });
    }
    slide.blocks = next;
    const rendered = renderSlideBlocks(slide);
    if (rendered != null) slide.content = rendered;
    return true;
  }

  function captureCurrentContent(inputTarget = null, { allowMarkdown = false } = {}) {
    // Markdown navigation can point at a different slide while the hidden
    // WYSIWYG editor still contains the slide rendered before Markdown mode.
    // Never copy that stale DOM into the Markdown-selected slide.
    if (suppressContentCapture || (markdownMode && !allowMarkdown)) return true;
    const slide = currentSlide();
    if (!slide) return true;

    // Do not infer layout identity from DOM here. Since 3.4 it is slide-level
    // metadata; doing so reintroduced the old content/metadata coupling.
    if (slide.layout === 'single') {
      slide.content = sourceMode ? els.source.value : cleanEditorContent(els.editor);
      slide.blocks = null;
      return true;
    }

    if (!sourceMode) {
      // Normal WYSIWYG input has a concrete slot target. Commit only that
      // positional block; the rest of the protected layout is irrelevant to
      // this edit and must not be revalidated on every keystroke.
      let node = inputTarget;
      if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
      const targetedHost = node?.closest?.('.sr-layout-content');
      if (targetedHost && commitLayoutHost(slide, targetedHost)) return true;

      // Programmatic toolbar/media commands do not always carry an InputEvent.
      // Prefer the current selection/active host before sweeping all slots.
      const sel = window.getSelection?.();
      let anchor = sel?.rangeCount ? sel.getRangeAt(0).startContainer : null;
      if (anchor?.nodeType === Node.TEXT_NODE) anchor = anchor.parentElement;
      const activeHost = anchor?.closest?.('.sr-layout-content')
        || document.activeElement?.closest?.('.sr-layout-content');
      if (activeHost && commitLayoutHost(slide, activeHost)) return true;

      if (captureLayoutHosts(slide)) return true;

      const message = `Could not commit WYSIWYG content for layout "${slide.layout}": required layout slots are missing.`;
      console.error(message);
      setStatus('Edit not saved: required layout slot is missing', false);
      return false;
    }

    // RV-COMPAT(html-source-mode): REMOVE BEFORE PUBLIC RELEASE.
    // Hidden legacy HTML-source mode still edits the canonical HTML string, so
    // it requires one migration parse before the persistent block model can be
    // refreshed. This path is no longer exposed in the UI.
    const content = els.source.value;
    const extracted = layoutBlocksFromContent(content, slide.layout);
    if (!extracted) {
      setStatus('Edit not saved: invalid layout HTML', false);
      return false;
    }
    slide.blocks = extracted.blocks;
    const rendered = renderSlideBlocks(slide);
    slide.content = rendered != null ? rendered : content;
    return true;
  }

  function cleanEditorClone(root) {
    const clone = root.cloneNode(true);
    stripWorkspaceAssetRevisions(clone);
    clone.querySelectorAll('[data-fragment-label]').forEach(el => {
      el.removeAttribute('data-fragment-label');
    });
    undecorateRichContent(clone);
    layoutBlocks?.undecorateEditor(clone);
    // Chromium may create attribute-free <div> wrappers for paragraphs inside
    // nested contenteditable hosts. They are editing artifacts, not authored
    // raw HTML. Canonicalize them before storage/Markdown conversion.
    contentNormalization?.normalizeForSerialization(clone);
    stripEditorSizing(clone);
    return clone;
  }

  function cleanEditorContent(root) {
    return cleanEditorClone(root).innerHTML;
  }

  // -------- Toolbar / editing --------
  function execCmd(cmd, arg = null) {
    restoreEditorSelection();
    if (!currentEditorRange()) els.editor.focus({ preventScroll: true });
    contentNormalization?.setDefaultParagraphSeparator();
    document.execCommand(cmd, false, arg);
    onEditorInput();
  }

  function wrapSelection(tag, className) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    recordHistory();
    const range = sel.getRangeAt(0);
    const node = document.createElement(tag);
    if (className) node.className = className;
    try {
      node.appendChild(range.extractContents());
      range.insertNode(node);
      sel.removeAllRanges();
      const r = document.createRange();
      r.selectNodeContents(node);
      sel.addRange(r);
    } catch (e) {
      console.warn(e);
    }
    onEditorInput();
  }

  function setEditorSelectionRange(range) {
    if (!range) return false;
    try {
      const start = range.startContainer;
      const end = range.endContainer;
      if (!(start === els.editor || els.editor.contains(start)) || !(end === els.editor || els.editor.contains(end))) return false;
      const selection = window.getSelection();
      if (!selection) return false;
      const snapshot = range.cloneRange();
      const host = richText?.singleEditingHost?.(snapshot, els.editor)
        || domSelection?.editingHostFromRange?.(snapshot, els.editor)
        || els.editor;
      host.focus({ preventScroll: true });
      selection.removeAllRanges();
      selection.addRange(snapshot);
      lastEditorRange = snapshot.cloneRange();
      return true;
    } catch (_) {
      return false;
    }
  }

  function editorRangeSnapshot() {
    const range = currentEditorRange();
    if (!range) return null;
    try {
      if (!(range.startContainer === els.editor || els.editor.contains(range.startContainer))) return null;
      return range.cloneRange();
    } catch (_) {
      return null;
    }
  }

  function insertHTMLAtCursor(html, rangeOverride = null) {
    // File pickers and toolbar buttons temporarily move focus away from a
    // nested layout slot. Restore the exact cached/snapshotted range before
    // insertion so asynchronous image processing cannot move content into the
    // field the user happened to click later.
    if (rangeOverride) setEditorSelectionRange(rangeOverride);
    else restoreEditorSelection();
    if (!currentEditorRange()) els.editor.focus({ preventScroll: true });
    contentNormalization?.setDefaultParagraphSeparator();
    if (!document.execCommand('insertHTML', false, html)) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const wrap = document.createElement('div');
        wrap.innerHTML = html;
        const frag = document.createDocumentFragment();
        let last = null;
        while (wrap.firstChild) { last = wrap.firstChild; frag.appendChild(wrap.firstChild); }
        range.insertNode(frag);
        if (last) {
          const next = document.createRange();
          next.setStartAfter(last);
          next.collapse(true);
          sel.removeAllRanges();
          sel.addRange(next);
          lastEditorRange = next.cloneRange();
        }
      } else {
        els.editor.insertAdjacentHTML('beforeend', html);
      }
    }
    const range = currentEditorRange();
    const host = range
      ? (richText?.singleEditingHost?.(range, els.editor) || domSelection?.editingHostFromRange?.(range, els.editor))
      : els.editor;
    // Paste/insertHTML is where Chromium is most likely to manufacture DIV
    // paragraphs or invalid list children. Canonicalize that one editing host
    // immediately instead of waiting until serialization reports a problem.
    contentNormalization?.normalizeForSerialization(host || els.editor);
    onEditorInput({ target: host || els.editor });
  }

  async function handleToolbarAction(action) {
    switch (action) {
      case 'blockquote':
        recordHistory();
        execCmd('formatBlock', 'blockquote');
        break;
      case 'code-inline':
        wrapSelection('code');
        break;
      case 'code-block':
        openCodeModal();
        break;
      case 'math':
        openMathModal();
        break;
      case 'layout':
        openLayoutModal();
        break;
      case 'align-left':
        if (markdownMode) setMarkdownAlignment('left');
        else setAlignment('left');
        break;
      case 'align-center':
        if (markdownMode) setMarkdownAlignment('center');
        else setAlignment('center');
        break;
      case 'align-right':
        if (markdownMode) setMarkdownAlignment('right');
        else setAlignment('right');
        break;
      case 'link': {
        const url = await dialogs.prompt('Link URL:', 'https://', { title: 'Add a link' });
        if (url) {
          recordHistory();
          execCmd('createLink', url);
        }
        break;
      }
      case 'image':
        openAssetsModal('image');
        break;
      case 'video':
        openAssetsModal('video');
        break;
      case 'audio':
        openAssetsModal('audio');
        break;
      case 'interactive':
      // RV-COMPAT(interactive-demo): REMOVE BEFORE PUBLIC RELEASE.
      case 'demo': // legacy toolbar action
        openInteractiveModal();
        break;
      case 'linked-image': {
        const url = await dialogs.prompt(
          'Open this URL in a new window when the image is clicked:',
          'https://',
          { title: 'Link image' },
        );
        if (!url || url === 'https://') break;
        els.fileInput.dataset.linkHref = url;
        els.fileInput.click();
        break;
      }
      case 'hr':
        recordHistory();
        insertHTMLAtCursor('<hr><p></p>');
        break;
      case 'fragment':
        toggleFragment();
        break;
      case 'fit-text':
        toggleBlockClass('r-fit-text');
        break;
      case 'stretch':
        if (isInteractiveElement(selectedMediaEl)) {
          setStatus('Interactive embeds use Width/Height controls instead of r-stretch.', true);
        } else {
          toggleBlockClass('r-stretch');
        }
        break;
    }
  }

  let editingCodeEl = null;
  let editingMathEl = null;

  function insertMarkupAtCursor(html) {
    if (sourceMode) {
      const ta = els.source;
      const pos = ta.selectionStart;
      const before = ta.value.slice(0, pos);
      const after = ta.value.slice(ta.selectionEnd);
      ta.value = before + html + after;
      ta.selectionStart = ta.selectionEnd = pos + html.length;
      onEditorInput();
      return;
    }
    // execCommand('insertHTML') is convenient for ordinary rich text, but
    // Chromium may rewrite custom spans and discard data-* attributes. Our
    // technical blocks (math/code/layouts/assets) need those attributes to
    // round-trip, so insert a DOM fragment directly instead.
    restoreEditorSelection();
    let range = currentEditorRange();
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(els.editor);
      range.collapse(false);
    }
    range.deleteContents();
    const template = document.createElement('template');
    template.innerHTML = html;
    const frag = template.content;
    const last = frag.lastChild;
    range.insertNode(frag);
    if (last) {
      const next = document.createRange();
      next.setStartAfter(last);
      next.collapse(true);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(next);
        lastEditorRange = next.cloneRange();
      }
    }
    onEditorInput();
  }

  function normalizeCodeLanguage(lang) {
    const v = String(lang || '').trim().toLowerCase();
    return /^[a-z0-9_+-]+$/.test(v) ? v : 'plaintext';
  }

  function codeBlockHtml(code, language) {
    const lang = normalizeCodeLanguage(language);
    return `<pre class="sr-code"><code class="language-${escapeHtml(lang)}" data-trim>${escapeHtml(code || '')}</code></pre><p></p>`;
  }

  const MATH_SOURCE_SENTINEL = '\u200B';

  function mathSourceText(tex, display) {
    const source = String(tex || '');
    return display ? `\\[${source}\\]` : `\\(${source}\\)`;
  }

  function mathSpanHtml(tex, display) {
    const t = String(tex || '').trim();
    const d = display ? '1' : '0';
    // The TeX source has exactly one canonical home: data-tex. Never keep a
    // second source copy in the element body. Markdown/HTML parsers are free
    // to interpret backslashes in text nodes, which corrupts constructs such
    // as cases/arrays (\\ row breaks, \bmod, \left, ...). The children
    // are runtime-only KaTeX output and are discarded again before capture.
    // A zero-width sentinel keeps Turndown from pruning the otherwise-empty
    // atomic span before our dedicated math rule can serialize data-tex.
    return `<span class="sr-math" data-display="${d}" data-tex="${escapeHtml(t)}">&#8203;</span>`;
  }

  function decorateRichContent(root = els.editor) {
    if (!root) return;
    root.querySelectorAll('pre > code').forEach(code => {
      const pre = code.parentElement;
      if (!pre) return;
      pre.classList.add('sr-code');
      pre.setAttribute('contenteditable', 'false');
      const plain = code.textContent || '';
      code.textContent = plain;
      code.removeAttribute('data-highlighted');
      if (window.hljs) {
        try { window.hljs.highlightElement(code); } catch (e) { console.warn('highlight failed', e); }
      }
    });
    layoutBlocks?.decorateEditor(root);
    root.querySelectorAll('.sr-html-block').forEach(el => el.setAttribute('contenteditable', 'false'));
    root.querySelectorAll('.sr-math').forEach(el => {
      el.setAttribute('contenteditable', 'false');
      const tex = el.dataset.tex || '';
      const display = el.dataset.display === '1';
      // Rendering is a projection of data-tex. Always clear stale KaTeX/raw
      // fallback children first so repeated slide mounts are idempotent.
      el.replaceChildren();
      if (window.katex) {
        try {
          window.katex.render(tex, el, { displayMode: display, throwOnError: false, strict: 'ignore' });
          return;
        } catch (e) {
          console.warn('math render failed', e);
        }
      }
      // Fallback is live-editor UI only. undecorateRichContent() removes it
      // before the slide is captured or converted back to Markdown.
      el.textContent = mathSourceText(tex, display);
    });
  }

  function undecorateRichContent(root) {
    root.querySelectorAll('pre.sr-code > code, pre > code.hljs').forEach(code => {
      const plain = code.textContent || '';
      code.textContent = plain;
      code.classList.remove('hljs');
      code.removeAttribute('data-highlighted');
      const pre = code.parentElement;
      if (pre) pre.removeAttribute('contenteditable');
    });
    root.querySelectorAll('.sr-html-block').forEach(el => el.removeAttribute('contenteditable'));
    root.querySelectorAll('.sr-math').forEach(el => {
      // data-tex is canonical. KaTeX markup and raw fallback text are runtime
      // decoration only and must never become persisted slide HTML.
      el.textContent = MATH_SOURCE_SENTINEL;
      el.removeAttribute('contenteditable');
    });
  }

  function selectedEditorText() {
    const r = currentEditorRange();
    return r && !r.collapsed ? r.toString() : '';
  }

  function openCodeModal(existing = null) {
    if (sourceMode && !existing) {
      const ta = els.source;
      els.codeText.value = ta.value.slice(ta.selectionStart, ta.selectionEnd) || '';
    } else {
      els.codeText.value = existing
        ? (existing.querySelector('code')?.textContent || '')
        : selectedEditorText();
    }
    editingCodeEl = existing;
    let lang = 'python';
    if (existing) {
      const cls = existing.querySelector('code')?.className || '';
      const m = cls.match(/(?:^|\s)language-([^\s]+)/);
      if (m) lang = m[1];
    }
    if (Array.from(els.codeLanguage.options).some(o => o.value === lang)) els.codeLanguage.value = lang;
    else els.codeLanguage.value = 'plaintext';
    els.codeInsert.textContent = existing ? 'Update code' : 'Insert code';
    els.codeModal.hidden = false;
    focusModal(els.codeModal);
    setTimeout(() => els.codeText.focus(), 0);
  }

  function closeCodeModal() {
    els.codeModal.hidden = true;
    editingCodeEl = null;
    restoreModalFocus();
  }

  function commitCodeModal() {
    const code = els.codeText.value;
    const lang = normalizeCodeLanguage(els.codeLanguage.value);
    if (editingCodeEl && els.editor.contains(editingCodeEl)) {
      recordHistory();
      const codeEl = editingCodeEl.querySelector('code');
      editingCodeEl.classList.add('sr-code');
      if (codeEl) {
        codeEl.className = `language-${lang}`;
        codeEl.setAttribute('data-trim', '');
        codeEl.textContent = code;
      }
      decorateRichContent(editingCodeEl.parentElement || els.editor);
      onEditorInput();
      closeCodeModal();
      return;
    }
    recordHistory();
    insertMarkupAtCursor(codeBlockHtml(code, lang));
    closeCodeModal();
  }

  function renderMathDialogPreview() {
    const tex = els.mathText.value.trim();
    els.mathPreview.classList.remove('bad');
    els.mathPreview.replaceChildren();
    if (!tex) return;
    if (!window.katex) {
      els.mathPreview.textContent = tex;
      return;
    }
    try {
      window.katex.render(tex, els.mathPreview, {
        displayMode: els.mathDisplay.value === '1', throwOnError: true, strict: 'ignore'
      });
    } catch (e) {
      els.mathPreview.classList.add('bad');
      els.mathPreview.textContent = e && e.message ? e.message : String(e);
    }
  }

  function openMathModal(existing = null) {
    editingMathEl = existing;
    els.mathText.value = existing ? (existing.dataset.tex || '') : '';
    els.mathDisplay.value = existing && existing.dataset.display === '1' ? '1' : '0';
    els.mathInsert.textContent = existing ? 'Update equation' : 'Insert equation';
    renderMathDialogPreview();
    els.mathModal.hidden = false;
    focusModal(els.mathModal);
    setTimeout(() => els.mathText.focus(), 0);
  }

  function closeMathModal() {
    els.mathModal.hidden = true;
    editingMathEl = null;
    restoreModalFocus();
  }

  function commitMathModal() {
    const tex = els.mathText.value.trim();
    if (!tex) return;
    const display = els.mathDisplay.value === '1';
    if (editingMathEl && els.editor.contains(editingMathEl)) {
      recordHistory();
      editingMathEl.dataset.tex = tex;
      editingMathEl.dataset.display = display ? '1' : '0';
      editingMathEl.replaceChildren();
      decorateRichContent(editingMathEl.parentElement || els.editor);
      onEditorInput();
      closeMathModal();
      return;
    }
    recordHistory();
    insertMarkupAtCursor(mathSpanHtml(tex, display));
    closeMathModal();
  }

  let pendingNewSlide = null;

  function renderLayoutChoices() {
    if (!els.layoutChoices || !layoutRegistry) return;
    els.layoutChoices.replaceChildren();
    layoutRegistry.list().forEach(def => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'layout-choice';
      button.dataset.layout = def.id;
      button.title = def.description || def.label;
      const preview = document.createElement('span');
      preview.className = 'layout-choice-preview';
      if (def.grid?.areas) preview.style.gridTemplateAreas = def.grid.areas;
      if (def.grid?.columns) preview.style.gridTemplateColumns = def.grid.columns;
      if (def.grid?.rows) preview.style.gridTemplateRows = def.grid.rows;
      def.slots.forEach(slot => {
        const cell = document.createElement('i');
        cell.style.gridArea = slot.id;
        preview.appendChild(cell);
      });
      const label = document.createElement('strong');
      label.textContent = def.label;
      button.append(preview, label);
      const activeLayout = pendingNewSlide ? null : (markdownMode
        ? (markdownNavRanges[markdownActiveSlideIndex()]?.layout || 'single')
        : (currentSlide()?.layout || 'single'));
      if (def.id === activeLayout) {
        button.classList.add('active');
        button.setAttribute('aria-current', 'true');
        const current = document.createElement('span');
        current.className = 'layout-choice-current';
        current.innerHTML = '<i class="bi bi-check2" aria-hidden="true"></i> Current';
        button.appendChild(current);
      }
      if (def.description) {
        const description = document.createElement('small');
        description.textContent = def.description;
        button.appendChild(description);
      }
      els.layoutChoices.appendChild(button);
    });
  }

  function openLayoutModal() {
    renderLayoutChoices();
    if (els.layoutTitle) {
      els.layoutTitle.textContent = pendingNewSlide ? 'Choose layout for new slide' : 'Insert layout';
    }
    els.layoutModal.hidden = false;
    focusModal(els.layoutModal);
  }

  function openNewSlideLayoutModal({ atEnd = false } = {}) {
    pendingNewSlide = { atEnd };
    openLayoutModal();
  }

  function closeLayoutModal() {
    pendingNewSlide = null;
    els.layoutModal.hidden = true;
    restoreModalFocus();
  }

  function openBackgroundModal() {
    renderBackgroundChoices();
    els.backgroundModal.hidden = false;
    focusModal(els.backgroundModal);
  }

  function closeBackgroundModal() {
    els.backgroundModal.hidden = true;
    restoreModalFocus();
  }

  const isInteractiveElement = (el) => interactiveContent.isElement(el);
  const clampInteractiveHeight = (value) => interactiveContent.clampHeight(value);
  const interactiveBlockHtml = (spec) => interactiveContent.toHtml(spec);
  const interactiveSpecFromElement = (el) => interactiveContent.fromElement(el);

  let editingInteractiveEl = null;
  let editingInteractiveMarkdownRange = null;

  function refreshInteractiveFileChoices() {
    if (!els.interactiveFilesList) return;
    els.interactiveFilesList.replaceChildren();
    workspaceFiles
      .filter(f => /\.html?$/i.test(String(f.path || f.name || '')))
      .sort((a, b) => String(a.path).localeCompare(String(b.path)))
      .forEach(f => {
        const o = document.createElement('option');
        o.value = f.path || f.dataUrl || f.name;
        els.interactiveFilesList.appendChild(o);
      });
  }

  function openInteractiveModal(existing = null, suggestedSrc = '') {
    editingInteractiveEl = isInteractiveElement(existing) ? existing : null;
    editingInteractiveMarkdownRange = null;
    let s = editingInteractiveEl ? interactiveSpecFromElement(editingInteractiveEl) : null;
    if (!s && markdownMode && els.markdownText) {
      const text = els.markdownText.value;
      const pos = els.markdownText.selectionStart || 0;
      const hit = scanMarkdownDirectives(text)
        .filter(d => d.kind === 'interactive' && pos >= d.start && pos <= d.end)
        .sort((a, b) => b.start - a.start)[0];
      if (hit) {
        const f = srDirectiveFields(text.slice(hit.contentStart, hit.endStart).split(/\r?\n/));
        if (f && f.src) {
          const width = f.width ? srParseWidth(f.width) : '100';
          const height = f.height ? Number(f.height) : 480;
          const interactive = srParseBool(f.interactive, true);
          const preload = srParseBool(f.preload, false);
          const border = srParseBool(f.border, false);
          const scrollbars = srParseBool(f.scrollbars, false);
          if (width !== null && Number.isFinite(height) && interactive !== null && preload !== null && border !== null && scrollbars !== null) {
            s = { src: f.src, width: Number(width || 100), height, interactive, preload, border, scrollbars };
            editingInteractiveMarkdownRange = { start: hit.start, end: hit.end };
          }
        }
      }
    }
    refreshInteractiveFileChoices();
    els.interactiveSrc.value = s?.src || suggestedSrc || '';
    els.interactiveWidth.value = String(Math.round(s?.width || 100));
    els.interactiveModalHeight.value = String(Math.round(s?.height || 480));
    els.interactiveModalEnabled.checked = s ? s.interactive : true;
    els.interactiveModalPreload.checked = s ? s.preload : false;
    els.interactiveModalBorder.checked = s ? s.border : false;
    els.interactiveModalScrollbars.checked = s ? s.scrollbars : false;
    els.interactiveInsert.textContent = (editingInteractiveEl || editingInteractiveMarkdownRange) ? 'Update interactive' : 'Insert interactive';
    els.interactiveModal.hidden = false;
    focusModal(els.interactiveModal);
    if (workspaceMode) refreshWorkspaceFiles().then(refreshInteractiveFileChoices);
    setTimeout(() => els.interactiveSrc.focus(), 0);
  }

  function closeInteractiveModal() {
    els.interactiveModal.hidden = true;
    editingInteractiveEl = null;
    editingInteractiveMarkdownRange = null;
    restoreModalFocus();
  }

  const interactiveMarkdownBlock = (spec) => interactiveContent.toMarkdown(spec);

  function commitInteractiveModal() {
    const src = String(els.interactiveSrc.value || '').trim();
    if (!src) { setStatus('Choose an HTML entry point for the interactive content.', false); return; }
    const spec = {
      src,
      width: Math.max(10, Math.min(100, Number(els.interactiveWidth.value) || 100)),
      height: clampInteractiveHeight(els.interactiveModalHeight.value),
      interactive: els.interactiveModalEnabled.checked,
      preload: els.interactiveModalPreload.checked,
      border: els.interactiveModalBorder.checked,
      scrollbars: els.interactiveModalScrollbars.checked,
    };
    if (markdownMode) {
      const ta = els.markdownText;
      const block = interactiveMarkdownBlock(spec);
      const start = editingInteractiveMarkdownRange?.start ?? (ta.selectionStart || 0);
      const end = editingInteractiveMarkdownRange?.end ?? (ta.selectionEnd == null ? start : ta.selectionEnd);
      const replacing = !!editingInteractiveMarkdownRange;
      const next = ta.value.slice(0, start) + block + ta.value.slice(end);
      markdownApplyBufferEdit(next, start, start + block.length, replacing ? 'Updated interactive content.' : 'Inserted interactive content.');
      closeInteractiveModal();
      return;
    }
    recordHistory();
    const html = interactiveBlockHtml(spec);
    if (editingInteractiveEl && editingInteractiveEl.isConnected && els.editor.contains(editingInteractiveEl)) {
      const t = document.createElement('template');
      t.innerHTML = html;
      const next = t.content.firstElementChild;
      editingInteractiveEl.replaceWith(next);
      decorateRichContent(next.parentElement || els.editor);
      onEditorInput();
      selectMedia(next);
    } else {
      insertMarkupAtCursor(html + '<p></p>');
    }
    closeInteractiveModal();
  }

  function selectedMediaWrapper() {
    if (!selectedMediaEl || !selectedMediaEl.isConnected || !els.editor.contains(selectedMediaEl)) return null;
    // Keep a captioned figure or clickable image anchor together with its
    // media. Plain media is wrapped directly.
    return selectedMediaEl.closest('figure.sr-media-caption')
      || selectedMediaEl.closest('.sr-media-crop')
      || selectedMediaEl.closest('a.linked-image')
      || selectedMediaEl;
  }

  function alignmentClassValue(element) {
    if (!element?.classList) return 'left';
    if (element.classList.contains('sr-align-right')) return 'right';
    if (element.classList.contains('sr-align-center')
        // RV-COMPAT(align-shorthand): REMOVE `.sr-center` BEFORE PUBLIC RELEASE.
        || element.classList.contains('sr-center')) return 'center';
    return 'left';
  }

  function isAlignmentWrapper(element) {
    return !!(element?.classList
      && (element.classList.contains('sr-align-left')
        || element.classList.contains('sr-align-center')
        || element.classList.contains('sr-align-right')
        // RV-COMPAT(align-shorthand): REMOVE `.sr-center` BEFORE PUBLIC RELEASE.
        || element.classList.contains('sr-center')));
  }

  function setAlignmentClass(element, align, { omitLeft = false } = {}) {
    if (!element || !SR_ALIGNMENTS.has(align)) return;
    element.classList.remove('sr-center', 'sr-align-left', 'sr-align-center', 'sr-align-right');
    if (!(omitLeft && align === 'left')) element.classList.add(`sr-align-${align}`);
  }

  // Multi-block layout alignment is part of the persistent slide model, not
  // merely a CSS class on the current WYSIWYG projection. Update the model at
  // the same time as the live slot so changing slides cannot discard it.
  function persistLayoutHostAlignment(host, align) {
    if (!host?.classList?.contains('sr-layout-content')) return;
    const layout = host.closest('.sr-layout');
    const slot = host.parentElement;
    const slide = currentSlide();
    if (!layout || !slot || !slide || slide.layout !== layout.dataset.layout) return;
    if (!Array.isArray(slide.blocks)) return;
    const slots = Array.from(layout.children).filter(el => el.classList.contains('sr-layout-slot'));
    const index = slots.indexOf(slot);
    if (index < 0 || !slide.blocks[index]) return;
    slide.blocks[index].align = align;
  }

  function editingHostForRange(range) {
    return richText?.singleEditingHost?.(range, els.editor) || null;
  }

  // Return the paragraph-like unit containing `node`. Explicit alignment
  // wrappers are structural containers, so the unit is their direct child.
  function alignableUnitForNode(node, host) {
    if (!node || !host) return null;
    let element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!(element instanceof Element) || !(element === host || host.contains(element))) return null;
    while (element && element !== host) {
      if (element.parentElement === host) return element;
      if (isAlignmentWrapper(element.parentElement) && element.parentElement.parentElement === host) return element;
      element = element.parentElement;
    }
    return null;
  }

  // Pull one unit out of an existing alignment wrapper without changing the
  // alignment of its siblings. The wrapper is split around the selected unit.
  function isolateAlignmentUnit(unit, host) {
    const wrapper = unit?.parentElement;
    if (!unit || !host || !isAlignmentWrapper(wrapper) || wrapper.parentElement !== host) return unit;
    const nodes = Array.from(wrapper.childNodes);
    const index = nodes.indexOf(unit);
    if (index < 0) return unit;
    const fragment = document.createDocumentFragment();
    const before = nodes.slice(0, index);
    const after = nodes.slice(index + 1);
    if (before.length) {
      const shell = wrapper.cloneNode(false);
      before.forEach(node => shell.appendChild(node));
      fragment.appendChild(shell);
    }
    fragment.appendChild(unit);
    if (after.length) {
      const shell = wrapper.cloneNode(false);
      after.forEach(node => shell.appendChild(node));
      fragment.appendChild(shell);
    }
    wrapper.replaceWith(fragment);
    return unit;
  }

  function unwrapDirectAlignmentWrappers(host) {
    if (!host) return;
    Array.from(host.children || []).filter(isAlignmentWrapper).forEach(wrapper => {
      const fragment = document.createDocumentFragment();
      while (wrapper.firstChild) fragment.appendChild(wrapper.firstChild);
      wrapper.replaceWith(fragment);
    });
  }

  // Apply alignment to one selected semantic unit. This is intentionally
  // independent of the field alignment so a paragraph/image can override a
  // centered layout field without affecting its siblings.
  function setUnitAlignment(unit, align, host) {
    if (!unit || !host || !SR_ALIGNMENTS.has(align)) return false;
    isolateAlignmentUnit(unit, host);
    const inherited = alignmentClassValue(host);
    if (align === inherited) return true;
    const wrapper = document.createElement('div');
    wrapper.className = `sr-align-${align}`;
    unit.before(wrapper);
    wrapper.appendChild(unit);
    return true;
  }

  function setWholeHostAlignment(host, align) {
    if (!host || !SR_ALIGNMENTS.has(align)) return false;
    // Whole-field alignment deliberately supersedes any direct partial
    // alignment wrappers left from earlier selections.
    unwrapDirectAlignmentWrappers(host);
    if (host.classList?.contains('sr-layout-content')) {
      setAlignmentClass(host, align, { omitLeft: true });
      persistLayoutHostAlignment(host, align);
      return true;
    }
    if (host !== els.editor) return false;
    if (align === 'left') return true;
    const wrapper = document.createElement('div');
    wrapper.className = `sr-align-${align}`;
    while (host.firstChild) wrapper.appendChild(host.firstChild);
    host.appendChild(wrapper);
    return true;
  }

  function setAlignment(align) {
    if (!SR_ALIGNMENTS.has(align)) return;

    // The media selection is explicit and wins over an old/collapsed native
    // text Range. Align only the selected media (or its caption/crop wrapper).
    const mediaNode = selectedMediaWrapper();
    if (mediaNode) {
      const host = mediaNode.closest('.sr-layout-content') || els.editor;
      const unit = alignableUnitForNode(mediaNode, host);
      if (unit) {
        recordHistory();
        setUnitAlignment(unit, align, host);
        selectMedia(selectedMediaEl);
        onEditorInput({ target: host });
        return;
      }
    }

    restoreEditorSelection();
    const range = currentEditorRange();
    if (!range) {
      setStatus('Place the cursor in a text block before changing alignment.', false);
      return;
    }

    const host = editingHostForRange(range);
    if (!host) {
      setStatus('Alignment cannot span multiple layout fields.', false);
      return;
    }

    // A real text selection aligns the complete paragraph-like units touched
    // by the selection. Selecting one word therefore aligns its paragraph,
    // while a selection across several paragraphs aligns only those paragraphs.
    if (!range.collapsed) {
      const units = richText?.blocksForRange?.(range, els.editor) || [];
      if (units.length) {
        recordHistory();
        units.forEach(unit => setUnitAlignment(unit, align, host));
        onEditorInput({ target: host });
        return;
      }
    }

    // With only a caret, alignment is a field/block operation. In a semantic
    // layout this is the current slot; in the single layout it is the complete
    // slide body.
    recordHistory();
    if (setWholeHostAlignment(host, align)) {
      onEditorInput({ target: host });
      return;
    }

    setStatus('Place the cursor in a text block before changing alignment.', false);
  }

  function focusLayoutMaster(definition) {
    if (!definition) return;
    const master = definition.slots.find(slot => slot.master) || definition.slots[0];
    const host = definition.id === 'single'
      ? els.editor
      : els.editor.querySelector(`.sr-layout-slot[data-slot="${master.id}"] > .sr-layout-content`);
    if (!host) return;
    host.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(host);
    range.collapse(false);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
      lastEditorRange = range.cloneRange();
    }
  }

  function insertLayout(layoutId) {
    const def = layoutRegistry?.get(layoutId);
    if (!def) { setStatus(`Unknown layout: ${layoutId}`, false); closeLayoutModal(); return; }
    if (pendingNewSlide) {
      const { atEnd } = pendingNewSlide;
      closeLayoutModal();
      addSlide({ atEnd, layout: def.id });
      return;
    }
    if (markdownMode) {
      setMarkdownLayout(def.id);
      closeLayoutModal();
      return;
    }

    const slide = currentSlide();
    if (!slide) { closeLayoutModal(); return; }
    if (!captureCurrentContent()) {
      setStatus('Cannot change layout until the current edit is valid.', false);
      closeLayoutModal();
      return;
    }
    if (slide.layout === def.id) { closeLayoutModal(); return; }

    const moved = layoutBlocks?.transferContent?.(slide.layout || 'single', def.id, {
      singleHtml: slide.layout === 'single' ? slide.content : '',
      blocks: slide.blocks,
    });
    if (!moved) {
      setStatus('Could not transfer slide content to the selected layout.', false);
      closeLayoutModal();
      return;
    }

    recordHistory();
    slide.layout = moved.layout;
    slide.blocks = moved.blocks;
    slide.content = moved.layout === 'single'
      ? moved.content
      : (renderSlideBlocks(slide) || '');
    renderEditor();
    closeLayoutModal();
    focusLayoutMaster(def);
    onEditorInput();
  }

  const BLOCK_TAGS = new Set([
    'li', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'pre', 'img', 'iframe', 'video', 'div',
  ]);

  function blockFromRange(range) {
    return domSelection.blockFromRange(range, els.editor, BLOCK_TAGS);
  }

  // Prefer the cached "last good" range over the live selection here.
  // Clicking a toolbar button may have shifted focus and reset the live
  // selection to the editor's default caret position, but lastEditorRange
  // still reflects where the user actually was last.
  function getSelectedBlock() {
    return blockFromRange(lastEditorRange)
        || blockFromRange(currentEditorRange())
        || wrapBareEditorContent();
  }

  // Chrome's contenteditable lets you type bare text/inline nodes directly
  // into the editor div without ever creating a block. r-fit-text and
  // r-stretch need a block to attach to, so if we find ourselves in that
  // state, wrap whatever's there in a <div>.
  function wrapBareEditorContent() {
    if (els.editor.childNodes.length === 0) return null;  // empty editor
    if (els.editor.children.length > 0) return null;       // already has blocks
    const wrapper = document.createElement('div');
    while (els.editor.firstChild) wrapper.appendChild(els.editor.firstChild);
    els.editor.appendChild(wrapper);
    return wrapper;
  }

  // The live selection range when it's inside the editor, else the last range
  // we remembered while it was. This survives focus shifts to the toolbar.
  let lastEditorRange = null;
  function currentEditorRange() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const r = sel.getRangeAt(0);
      if (els.editor.contains(r.startContainer) || r.startContainer === els.editor) {
        return r;
      }
    }
    return lastEditorRange;
  }
  let restoringSelection = false;
  function rememberEditorRange() {
    if (restoringSelection) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    if (els.editor.contains(r.startContainer) || r.startContainer === els.editor) {
      lastEditorRange = r.cloneRange();
    }
  }

  // Re-focus the editor and put the live selection back where it was. Any
  // toolbar action that reads the selection should call this first — the
  // mousedown handler tries to keep focus in place, but some browsers still
  // shift focus to the button briefly and drop the live range.
  function restoreEditorSelection() {
    if (!lastEditorRange) return;
    restoringSelection = true;
    try {
      const snapshot = lastEditorRange.cloneRange();
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(snapshot);
      }
      const host = domSelection?.editingHostFromRange?.(snapshot, els.editor) || els.editor;
      if (document.activeElement !== host) {
        host.focus({ preventScroll: true });
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(snapshot);
        }
      }
      contentNormalization?.setDefaultParagraphSeparator();
    } finally {
      setTimeout(() => { restoringSelection = false; }, 0);
    }
  }

  function toggleBlockClass(cls) {
    const block = getSelectedBlock();
    if (!block) {
      setStatus(`Place the cursor in a block first to apply ${cls}`, false);
      return;
    }
    recordHistory();
    block.classList.toggle(cls);
    // Clear inline sizes that applySlideEffects may have set when the class
    // is being removed, otherwise the block keeps its fit/stretch geometry.
    if (!block.classList.contains(cls)) {
      if (cls === 'r-fit-text') block.style.fontSize = '';
      if (cls === 'r-stretch') block.style.height = '';
    }
    onEditorInput();
    // Bring focus + caret back to the editor so the user can keep editing.
    restoreEditorSelection();
  }

  function fragmentFromRange(range) {
    return domSelection.fragmentFromRange(range, els.editor);
  }

  function getActiveFragment() {
    // For the live-bound dropdown we use the live selection (so it reacts
    // immediately as the user moves the caret). Other call sites can prefer
    // lastEditorRange.
    return fragmentFromRange(currentEditorRange());
  }

  function getFragmentTypeOf(el) {
    return el ? (FRAGMENT_TYPES.find(t => el.classList.contains(t)) || '') : '';
  }

  function setFragmentTypeOn(el, type) {
    if (!el) return;
    FRAGMENT_TYPES.forEach(t => el.classList.remove(t));
    if (type) el.classList.add(type);
  }

  // Keeps the dropdown's selected option in sync with the fragment under the
  // cursor. If no fragment is active, the dropdown reverts to the user's last
  // manually chosen default (stored on the element).
  // -------- Deck markdown mode --------
  // Edits the whole deck as one markdown file, the way reveal's own markdown
  // decks are authored. Deliberately NOT live two-way: re-parsing on every
  // keystroke would churn slide identity and fight the cursor, so the buffer
  // is yours until you press Apply.
  let markdownMode = false;
  let markdownBaseline = '';      // what we generated on open, for dirty checks
  let markdownRecoveryMode = false; // lossy plain-text fallback after conversion failure
  let markdownAssets = new Map(); // asset:N  ->  original data: URI
  let markdownNavCache = [];      // last successfully parsed labels
  let markdownNavRanges = [];     // current source offsets, even while dirty
  let markdownPreviewSlides = []; // parsed slides used by the thumbnail sidebar
  let markdownNavTimer = null;

  // Pasted images live in the deck as data URIs. Inlining a few hundred
  // kilobytes of base64 would make the buffer unusable, so each distinct URI
  // is swapped for a short token that still reads as a URL inside ![](...).
  const DATA_URI_RE = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;

  function stashDataUris(text) {
    const byUri = new Map();
    const map = new Map();
    let n = 0;
    const out = text.replace(DATA_URI_RE, (uri) => {
      let token = byUri.get(uri);
      if (!token) {
        token = `asset:${++n}`;
        byUri.set(uri, token);
        map.set(token, uri);
      }
      return token;
    });
    return { text: out, map };
  }

  function restoreDataUris(text, map) {
    let out = text;
    map.forEach((uri, token) => { out = out.split(token).join(uri); });
    return out;
  }

  function markdownApplyBufferEdit(text, start, end = start, message = '') {
    const ta = els.markdownText;
    ta.value = text;
    ta.focus();
    try { ta.setSelectionRange(start, end); } catch {}
    updateMarkdownHighlight();
    refreshMarkdownNavigation();
    updateMarkdownNavActive();
    if (message) setMarkdownStatus(message, true);
  }

  // Return the recognized ::: directive ranges in the *raw* markdown buffer.
  // This is intentionally an editor helper rather than the renderer parser:
  // offsets must stay byte-for-byte aligned with textarea.selectionStart.
  function scanMarkdownDirectives(text) {
    return markdownDirectives.scanRanges(text);
  }

  function markdownContainingDirective(text, start, end, kinds) {
    const wanted = new Set(kinds);
    return scanMarkdownDirectives(text)
      .filter(d => wanted.has(d.kind) && start >= d.start && end <= d.end)
      .sort((a, b) => b.start - a.start)[0] || null;
  }

  function replaceMarkdownDirectiveHeader(text, dir, header) {
    return text.slice(0, dir.headerStart) + header + text.slice(dir.headerEnd);
  }

  // When there is no text selection, toolbar actions should still be useful
  // on a generated media construct under the caret. Return the source range
  // of a canonical standalone image line or video/audio directive.
  function markdownMediaRangeAtCaret(text, pos) {
    const src = String(text || '');
    const dirs = scanMarkdownDirectives(src)
      .filter(d => (d.kind === 'video' || d.kind === 'audio' || d.kind === 'interactive') && pos >= d.start && pos <= d.end)
      .sort((a, b) => b.start - a.start);
    if (dirs.length) return { start: dirs[0].start, end: dirs[0].end, kind: dirs[0].kind };

    const lineStart = src.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
    let lineEnd = src.indexOf('\n', pos);
    if (lineEnd < 0) lineEnd = src.length;
    const line = src.slice(lineStart, lineEnd);
    // Canonical Revealation image syntax, with optional title/width attrs.
    if (/^\s*!\[[^\]]*\]\((?:<[^>]+>|[^\n]+)\)(?:\{\s*width\s*=\s*\d+(?:\.\d+)?%\s*\})?\s*$/.test(line)) {
      return { start: lineStart, end: lineEnd, kind: 'image' };
    }
    return null;
  }

  function setMarkdownAlignment(align) {
    if (!SR_ALIGNMENTS.has(align) || !els.markdownText) return;
    const ta = els.markdownText;
    const text = ta.value;
    const start = ta.selectionStart || 0;
    const end = ta.selectionEnd == null ? start : ta.selectionEnd;
    const host = markdownContainingDirective(text, start, end, ['block', 'column', 'align']);

    // The natural operation inside a known block is mutation, not nesting.
    if (host) {
      const header = host.kind === 'column'
        ? `::: column${align === 'left' ? '' : ` ${align}`}`
        : host.kind === 'block'
          ? `::: block${align === 'left' ? '' : ` align=${align}`}`
          : `::: align ${align}`;
      const nextText = replaceMarkdownDirectiveHeader(text, host, header);
      const delta = header.length - (host.headerEnd - host.headerStart);
      const nextStart = start + (start > host.headerEnd ? delta : 0);
      const nextEnd = end + (end > host.headerEnd ? delta : 0);
      markdownApplyBufferEdit(nextText, nextStart, nextEnd, `Updated ${host.kind} alignment to ${align}.`);
      return;
    }

    if (end === start) {
      const media = markdownMediaRangeAtCaret(text, start);
      if (media) {
        if (align === 'left') {
          setMarkdownStatus('Media is already left-aligned by default here.', true);
          return;
        }
        const selected = text.slice(media.start, media.end).replace(/\n+$/, '');
        const prefix = `::: align ${align}\n\n`;
        const suffix = `\n\n:::`;
        const block = prefix + selected + suffix;
        const nextText = text.slice(0, media.start) + block + text.slice(media.end);
        markdownApplyBufferEdit(nextText, media.start + prefix.length, media.start + prefix.length + selected.length,
          `Wrapped ${media.kind} in an ${align}-aligned block.`);
        return;
      }
    }

    if (end > start) {
      const selected = text.slice(start, end);
      const prefix = `::: align ${align}\n\n`;
      const suffix = `\n\n:::`;
      const block = prefix + selected + suffix;
      const nextText = text.slice(0, start) + block + text.slice(end);
      markdownApplyBufferEdit(nextText, start + prefix.length, start + prefix.length + selected.length,
        `Wrapped selection in an ${align}-aligned block.`);
      return;
    }

    // Left is already the default outside a block. Center/right create an
    // empty block and leave the caret ready for typing inside it.
    if (align === 'left') {
      setMarkdownStatus('Text is already left-aligned by default here.', true);
      return;
    }
    const prefix = `::: align ${align}\n\n`;
    const suffix = `\n:::`;
    const block = prefix + suffix;
    const nextText = text.slice(0, start) + block + text.slice(start);
    markdownApplyBufferEdit(nextText, start + prefix.length, start + prefix.length,
      `Inserted an ${align}-aligned block.`);
  }

  function transferMarkdownLayoutContent(fromLayoutId, toLayoutId, body, currentBlocks) {
    const from = layoutRegistry?.get(fromLayoutId);
    const to = layoutRegistry?.get(toLayoutId);
    const plan = layoutRegistry?.transferPlan?.(fromLayoutId, toLayoutId);
    if (!from || !to || !plan) return null;
    const sourceBlocks = from.id === 'single'
      ? [{ raw: String(body || '').trim(), align: 'left' }]
      : currentBlocks;
    if (!Array.isArray(sourceBlocks) || sourceBlocks.length !== from.slots.length) return null;

    const targetBlocks = plan.targets.map(({ sourceIndexes }) => {
      const contributors = sourceIndexes.map(index => sourceBlocks[index]).filter(Boolean);
      const meaningful = contributors.filter(block => String(block.raw || '').trim());
      const raw = meaningful.map(block => String(block.raw || '').trim()).join('\n\n');
      let align = 'left';
      if (meaningful.length) {
        const first = String(meaningful[0].align || 'left');
        if (meaningful.every(block => String(block.align || 'left') === first)) align = first;
      }
      return { raw, align };
    });
    return { from, to, blocks: targetBlocks };
  }

  function setMarkdownLayout(layoutId) {
    if (!els.markdownText) return;
    const def = layoutRegistry?.get(layoutId);
    if (!def) { setMarkdownStatus(`Unknown layout: ${layoutId}`, false); return; }

    const ta = els.markdownText;
    const text = ta.value;
    const caret = ta.selectionStart || 0;
    const separatorErrors = markdownDeck.validateSeparators(text);
    if (separatorErrors.length) {
      const first = separatorErrors[0];
      setMarkdownStatus(`Markdown error L${first.line}: ${first.message}`, false);
      return;
    }
    const ranges = markdownDeck.scanSlideRanges(text);
    const slideIndex = Math.max(0, ranges.findIndex(range => caret >= (range.separatorStart ?? range.start) && caret <= range.end));
    const slideRange = ranges[slideIndex] || ranges[ranges.length - 1];
    if (!slideRange) return;

    const chunk = text.slice(slideRange.start, slideRange.end);
    let body = chunk;
    let prefix = '';
    let suffix = '';

    const attrMatch = body.match(/^\s*<!--\s*\.slide:[\s\S]*?-->\s*/);
    if (attrMatch) {
      prefix = attrMatch[0].trimEnd() + '\n\n';
      body = body.slice(attrMatch[0].length);
    }
    const separatedNotes = notesSerialization.split(body, { lineOffset: (slideRange.startLine || 1) - 1 });
    const noteError = separatedNotes.diagnostics.find(item => item.severity === 'error');
    if (noteError) {
      setMarkdownStatus(`Markdown error L${noteError.line}: ${noteError.message}`, false);
      return;
    }
    body = separatedNotes.body.trim();
    const notesBlock = notesSerialization.format(separatedNotes.notes);
    if (notesBlock) suffix = `\n\n${notesBlock}`;

    let currentLayout = slideRange.layout || 'single';
    let currentBlocks = null;
    // RV-COMPAT(layout-wrapper): Markdown-mode layout editing accepts the old wrapper.
    const legacy = layoutBlocks?.parseLegacyLayout(body);
    if (legacy?.detected) {
      const errors = legacy.diagnostics.filter(item => item.severity === 'error');
      if (errors.length || !legacy.spec) {
        const first = errors[0];
        setMarkdownStatus(first ? `Markdown error: ${first.message}` : 'Invalid legacy layout.', false);
        return;
      }
      currentLayout = legacy.spec.id;
      currentBlocks = legacy.spec.blocks.map(block => ({ raw: block.raw.trim(), align: block.align || 'left' }));
    } else if (currentLayout !== 'single') {
      try {
        const parsed = layoutBlocks.parseSlide(body, currentLayout);
        currentBlocks = parsed.blocks.map(block => ({ raw: block.raw.trim(), align: block.align || 'left' }));
      } catch (error) {
        setMarkdownStatus(error.message || String(error), false);
        return;
      }
    }

    const transferred = transferMarkdownLayoutContent(currentLayout, def.id, body, currentBlocks);
    if (!transferred) {
      setMarkdownStatus('Could not transfer content to the selected layout.', false);
      return;
    }
    let nextBody = '';
    if (def.id === 'single') {
      nextBody = transferred.blocks[0]?.raw || '';
    } else {
      nextBody = transferred.blocks.map(block => {
        const head = `::: block${block.align !== 'left' ? ` align=${block.align}` : ''}`;
        return `${head}\n${block.raw}\n:::`;
      }).join('\n\n');
    }

    const nextChunk = `${prefix}${nextBody}${suffix}`.trimEnd();
    const fullStart = slideRange.separatorStart ?? slideRange.start;
    const fullEnd = slideRange.end;
    const needsSeparator = slideIndex > 0 || def.id !== 'single' || Object.keys(slideRange.metadata || {}).length > 0;
    const separator = needsSeparator
      ? markdownDeck.formatSeparator({ subslide: slideIndex > 0 && slideRange.subslide, layout: def.id, metadata: slideRange.metadata }) + '\n\n'
      : '';
    const replacement = separator + nextChunk + (fullEnd < text.length ? '\n\n' : '');
    const nextText = text.slice(0, fullStart) + replacement + text.slice(fullEnd);
    const nextCaret = fullStart + separator.length + Math.min(nextChunk.length, Math.max(0, caret - slideRange.start));
    markdownApplyBufferEdit(nextText, nextCaret, nextCaret,
      def.id === 'single' ? 'Changed to the default single-block layout.' : `Changed slide layout to ${def.label}.`);
  }

  function deckToMarkdownText({ capture = true } = {}) {
    if (capture) captureCurrentContent(null, { allowMarkdown: true });
    const md = projectToMarkdown(snapshotProject());
    const { text, map } = stashDataUris(md);
    markdownAssets = map;
    return text;
  }

  function recoveryTextFromHtml(html) {
    const root = parseHtml(html || '');
    root.querySelectorAll('script,style,noscript').forEach(node => node.remove());
    let text = String(root.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) {
      const image = root.querySelector('img[alt]');
      const media = root.querySelector('iframe[src],video[src],audio[src]');
      if (image?.getAttribute('alt')) text = `Image: ${image.getAttribute('alt')}`;
      else if (media?.getAttribute('src')) text = `Embedded media: ${media.getAttribute('src')}`;
    }
    if (!text) return '<!-- Unsupported HTML was stripped during Markdown recovery. -->';
    // Keep recovered text as one safe paragraph. Escaping angle brackets is
    // important because recovery is specifically used when authored HTML is
    // the thing preventing Markdown mode from opening.
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/^(---|--|:::|#{1,6}\s)/i, '\\$1');
  }

  // Produce a deliberately lossy but editable Markdown document when strict
  // conversion cannot open the deck. Valid slides retain their normal output;
  // only slides that fail conversion are reduced to safe plain text and
  // switched to the implicit single layout.
  function projectToMarkdownRecovery(p) {
    const td = makeMarkdownTurndown();
    const blocks = [];
    p.slides.forEach((slide, index) => {
      let layout = 'single';
      let body;
      let recovered = false;
      try {
        layout = slideLayoutFromContent(slide);
        body = slideToMarkdown(slide, td);
      } catch (_) {
        recovered = true;
        body = '<!-- Recovery: unsupported HTML was stripped from this slide. -->\n\n'
          + recoveryTextFromHtml(slide?.content || '');
        layout = 'single';
      }
      if (index > 0 || layout !== 'single' || Object.keys(slideMetadata(slide)).length) {
        blocks.push(markdownDeck.formatSeparator({
          subslide: index > 0 && !!slide.vertical,
          layout,
          metadata: slideMetadata(slide),
        }));
      }
      if (recovered && slide.notes) {
        const notes = String(slide.notes).trim()
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        body += `\n\n${notesSerialization.format(notes)}`;
      }
      blocks.push(body);
    });
    return blocks.join('\n\n') + '\n';
  }

  function showMarkdownBuffer(text, recovered = false) {
    const idx = slideModel.indexOf(state.slides, state.currentId);
    els.markdownText.value = text;
    markdownRecoveryMode = recovered;
    markdownBaseline = text;
    markdownNavCache = state.slides.map((slide, i) => { const v = slideLabel(slide, i); return (v && (v.text || v)) || `Slide ${i + 1}`; });
    updateMarkdownHighlight();
    refreshMarkdownNavigation();
    setMarkdownStatus(recovered
      ? 'Recovery mode: unsupported HTML was stripped. Review before applying.'
      : '');
    els.markdownText.focus();
    els.markdownText.setSelectionRange(0, 0);
    if (idx > 0) jumpToMarkdownSlide(idx);
  }

  function markdownLineClass(line, ctx) {
    const trimmed = line.trim();
    const fm = srFenceMarker(line);
    if (ctx.fence) {
      if (fm && fm[0] === ctx.fence[0] && fm.length >= ctx.fence.length) {
        ctx.fence = '';
        return 'md-fence';
      }
      return 'md-code';
    }
    if (fm) { ctx.fence = fm; return 'md-fence'; }
    if (ctx.math) {
      if (/\\\]\s*$/.test(trimmed)) ctx.math = false;
      return 'md-math';
    }
    if (/^\\\[/.test(trimmed)) { if (!/\\\]\s*$/.test(trimmed.slice(2))) ctx.math = true; return 'md-math'; }
    if (/^---(?:\s+layout=[a-z][a-z0-9-]*)?\s*$/i.test(trimmed)) return 'md-slide-separator';
    if (/^--(?:\s+layout=[a-z][a-z0-9-]*)?\s*$/i.test(trimmed)) return 'md-vertical-separator';
    if (/^#{1,6}\s+/.test(trimmed)) return 'md-heading';
    // RV-COMPAT(layout-wrapper): REMOVE legacy syntax highlighting BEFORE PUBLIC RELEASE.
    if (/^:::\s+layout\s+/i.test(trimmed)) return 'md-layout'; // legacy input only
    if (/^:::\s+block(?:\s|$)/i.test(trimmed)) return 'md-block';
    if (/^:::\s+notes\s*$/i.test(trimmed)) return 'md-note';
    if (/^:::\s*/.test(trimmed)) return 'md-directive';
    if (/^!\[[^\]]*\]\([^)]*\)(?:\{[^}]*\})?\s*$/.test(trimmed)) return 'md-media';
    if (/^<!--/.test(trimmed) || /-->$/.test(trimmed)) return 'md-comment';
    if (/^[-*+]\s+|^\d+[.)]\s+/.test(trimmed)) return 'md-list';
    return '';
  }

  function layoutDiagnosticsForDocument(text) {
    const diagnostics = [];
    const separatorErrors = markdownDeck.validateSeparators(text);
    if (separatorErrors.length) return diagnostics;
    const ranges = markdownDeck.scanSlideRanges(text);
    ranges.forEach((range) => {
      const layoutId = range.layout || 'single';
      if (!layoutRegistry?.get(layoutId)) {
        diagnostics.push({
          line: range.separatorLine || range.startLine || 1,
          code: 'unknown-layout',
          message: `Unknown layout "${layoutId}".`,
          severity: 'error',
        });
        return;
      }
      // RV-COMPAT(layout-wrapper): REMOVE legacy diagnostics BEFORE PUBLIC RELEASE.
      const legacy = layoutBlocks?.parseLegacyLayout(range.chunk, { lineOffset: (range.startLine || 1) - 1 });
      if (legacy?.detected) {
        diagnostics.push(...legacy.diagnostics);
        if (legacy.spec && layoutId !== 'single' && legacy.spec.id !== layoutId) {
          diagnostics.push({
            line: range.separatorLine || range.startLine || 1,
            code: 'layout-metadata-mismatch',
            message: `Separator layout "${layoutId}" conflicts with legacy layout "${legacy.spec.id}".`,
            severity: 'error',
          });
        }
        return;
      }
      diagnostics.push(...(layoutBlocks?.validateSlideMarkdown(range.chunk, layoutId, {
        lineOffset: (range.startLine || 1) - 1,
      }) || []));
    });
    return diagnostics;
  }

  function updateMarkdownHighlight() {
    if (!els.markdownText) return;
    const markdownValue = els.markdownText.value;
    const diagnostics = [
      ...markdownDeck.validateSeparators(markdownValue),
      ...layoutDiagnosticsForDocument(markdownValue),
      ...implicitRawHtmlDiagnostics(markdownValue),
    ].sort((a, b) => a.line - b.line || a.code.localeCompare(b.code));
    const errors = diagnostics.filter(d => d.severity === 'error');
    const shell = els.markdownText.closest('.markdown-editor-shell');
    shell?.classList.toggle('has-errors', errors.length > 0);
    els.markdownText.setAttribute('aria-invalid', errors.length ? 'true' : 'false');

    // The old transparent-text + <pre> overlay looked attractive but could not
    // guarantee identical glyph/caret metrics across browsers and zoom levels.
    // The textarea now owns both visible text and caret; the hidden layer is
    // retained only as an implementation hook for a future real editor.
    if (els.markdownHighlight) els.markdownHighlight.textContent = '';

    if (errors.length) {
      const first = errors[0];
      els.markdownStatus.dataset.layoutError = '1';
      els.markdownStatus.title = errors.slice(0, 12).map(d => `Line ${d.line}: ${d.message}`).join('\n');
      setMarkdownStatus(`Markdown error L${first.line}: ${first.message}`, false);
    } else if (els.markdownStatus.dataset.layoutError === '1') {
      delete els.markdownStatus.dataset.layoutError;
      els.markdownStatus.removeAttribute('title');
      setMarkdownStatus(els.markdownText.value === markdownBaseline ? '' : 'Unapplied changes');
    }
  }

  function syncMarkdownHighlightScroll() {
    // Text and caret are rendered by the same textarea; no overlay to sync.
  }

  function refreshMarkdownNavigation({ tryParse = true } = {}) {
    if (!markdownMode) return;
    const text = els.markdownText.value;
    const ranges = markdownDeck.scanSlideRanges(text);
    let labels = ranges.map((r, i) => `Slide ${i + 1}`);
    if (tryParse) {
      try {
        const parsed = parseMarkdownDeck(restoreDataUris(text, markdownAssets));
        if (parsed.length === ranges.length && parsed.length) {
          labels = parsed.map((slide, i) => { const v = slideLabel(slide, i); return (v && (v.text || v)) || labels[i]; });
          markdownNavCache = labels.slice();
          markdownPreviewSlides = parsed;
        }
      } catch {}
    }
    if (markdownNavCache.length === ranges.length) {
      labels = labels.map((label, i) => label || markdownNavCache[i] || `Slide ${i + 1}`);
    }
    markdownNavRanges = ranges.map((r, i) => ({
      ...r,
      underConstruction: /^(true|yes|1|on)$/i.test(String(r.metadata?.['under-construction'] || '')),
      hidden: /^(true|yes|1|on)$/i.test(String(r.metadata?.hidden || '')),
      label: labels[i] || markdownNavCache[i] || `Slide ${i + 1}`,
    }));
    renderMarkdownSidebar();
    updateMarkdownNavActive();
  }


  function renderMarkdownSidebar() {
    if (!markdownMode) return;
    const items = markdownNavRanges.length ? markdownNavRanges : state.slides.map((slide, index) => ({
      start: 0,
      end: 0,
      subslide: !!slide.vertical,
      underConstruction: !!slide.underConstruction,
      hidden: !!slide.hidden,
      label: ((slideLabel(slide, index) || {}).text || `Slide ${index + 1}`),
    }));
    const previewSlides = markdownPreviewSlides.length === items.length ? markdownPreviewSlides : state.slides;
    const size = logicalSlideSize();
    ensureSidebarController().renderMarkdown({
      items,
      slides: previewSlides,
      width: size.width,
      height: size.height,
      onJump: jumpToMarkdownSlide,
    });
    updateMarkdownNavActive();
  }

  function jumpToMarkdownSlide(index) {
    const item = markdownNavRanges[index];
    if (!item) return;
    els.markdownText.focus();
    els.markdownText.setSelectionRange(item.start, item.start);
    const before = els.markdownText.value.slice(0, item.start);
    const line = (before.match(/\n/g) || []).length;
    const lh = parseFloat(getComputedStyle(els.markdownText).lineHeight) || 20.8;
    els.markdownText.scrollTop = Math.max(0, line * lh - els.markdownText.clientHeight * 0.22);
    syncMarkdownHighlightScroll();
    updateMarkdownNavActive();
  }

  function markdownActiveSlideIndex() {
    if (!markdownNavRanges.length) return 0;
    const pos = els.markdownText?.selectionStart || 0;
    let active = 0;
    for (let i = 0; i < markdownNavRanges.length; i += 1) {
      if (pos >= markdownNavRanges[i].start) active = i; else break;
    }
    return active;
  }

  function updateMarkdownNavActive() {
    if (!markdownMode || !markdownNavRanges.length) return;
    const active = markdownActiveSlideIndex();
    ensureSidebarController().updateMarkdownActive(active);
    // Caret position is the current slide, so it survives leaving Markdown mode.
    if (markdownNavRanges.length === state.slides.length) state.currentId = state.slides[active].id;
  }

  function setMarkdownButtonState(active) {
    [els.markdownBtn, els.markdownToolbarBtn].filter(Boolean).forEach(button => {
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
      button.classList.toggle('active', active);
    });
  }

  async function openMarkdownMode() {
    if (markdownMode) return;
    if (typeof TurndownService === 'undefined' || typeof marked === 'undefined') {
      setStatus('Markdown converter failed to load — check your network.', false);
      return;
    }
    if (sourceMode) els.toggleSource.click();   // per-slide HTML view is a different scope
    closeToolbarMenu(false);
    markdownMode = true;
    document.body.classList.add('markdown-mode');
    els.markdownPane.hidden = false;
    setMarkdownButtonState(true);
    let text;
    let recovered = false;
    try {
        text = deckToMarkdownText();
    } catch (error) {
      const message = error?.message || String(error);
      const useRecovery = await dialogs.confirm(
        'Revealation could not convert this deck to Markdown.\n\n'
        + message
        + '\n\nOpen a recovery document with unsupported HTML stripped?',
        { title: 'Markdown conversion needs recovery', confirmLabel: 'Open recovery', cancelLabel: 'Cancel', kind: 'warning' }
      );
      if (useRecovery) {
        try {
          text = projectToMarkdownRecovery(snapshotProject());
          recovered = true;
        } catch (recoveryError) {
          text = null;
          setStatus('Markdown recovery failed: ' + (recoveryError.message || recoveryError), false);
        }
      }
      if (text == null) {
        markdownMode = false;
        document.body.classList.remove('markdown-mode');
        els.markdownPane.hidden = true;
        setMarkdownButtonState(false);
        setStatus('Cannot open Markdown: ' + message, false);
        if (!useRecovery) dialogs.alert('Revealation cannot safely convert this slide to Markdown.\n\n' + message, { title: 'Markdown unavailable', kind: 'danger' });
        return;
      }
    }
    showMarkdownBuffer(text, recovered);
  }

  async function openMarkdownRecoveryMode() {
    if (markdownMode && !(await dialogs.confirm('Replace the current Markdown buffer with a fresh recovery document?', { title: 'Replace Markdown buffer', confirmLabel: 'Replace', kind: 'warning' }))) return;
    if (!markdownMode) {
      if (sourceMode) els.toggleSource.click();
      closeToolbarMenu(false);
      markdownMode = true;
      document.body.classList.add('markdown-mode');
      els.markdownPane.hidden = false;
      setMarkdownButtonState(true);
    }
    try {
      captureCurrentContent(null, { allowMarkdown: true });
      showMarkdownBuffer(projectToMarkdownRecovery(snapshotProject()), true);
    } catch (error) {
      setStatus('Markdown recovery failed: ' + (error.message || error), false);
    }
  }

  async function closeMarkdownMode({ force = false } = {}) {
    if (!markdownMode) return true;
    if (!force && els.markdownText.value !== markdownBaseline
        && !(await dialogs.confirm('Discard your unapplied Markdown changes?', { title: 'Discard Markdown changes', confirmLabel: 'Discard', kind: 'warning' }))) {
      return false;
    }
    // The Markdown textarea can lose focus before its final click/key event
    // reaches updateMarkdownNavActive (for example when the user clicks the
    // Markdown toggle). Capture the caret-selected slide while the Markdown
    // navigation state is still live, otherwise renderEditor() reopens the
    // previously selected WYSIWYG slide.
    refreshMarkdownNavigation({ tryParse: false });
    updateMarkdownNavActive();
    markdownMode = false;
    document.body.classList.remove('markdown-mode');
    els.markdownPane.hidden = true;
    setMarkdownButtonState(false);
    markdownRecoveryMode = false;
    markdownAssets = new Map();
    markdownNavRanges = [];
    markdownPreviewSlides = [];
    if (markdownNavTimer) { clearTimeout(markdownNavTimer); markdownNavTimer = null; }
    renderSidebar();
    renderEditor();
    return true;
  }

  function setMarkdownStatus(msg, ok = true) {
    els.markdownStatus.textContent = msg;
    els.markdownStatus.classList.toggle('bad', !ok);
  }

  function applyMarkdownToDeck() {
    const raw = restoreDataUris(els.markdownText.value, markdownAssets);
    let slides;
    try {
      slides = parseMarkdownDeck(raw);
    } catch (err) {
      setMarkdownStatus('Could not parse: ' + (err && err.message || err), false);
      return false;
    }
    if (!slides.length) {
      setMarkdownStatus('Nothing to apply — the markdown is empty.', false);
      return false;
    }
    recordHistory();
    // Reuse the existing slide ids position by position so the sidebar
    // selection, and anything else keyed on id, survives an edit that only
    // changed wording.
    const oldIds = state.slides.map(s => s.id);
    slides.forEach((s, i) => { if (oldIds[i]) s.id = oldIds[i]; });
    const before = state.slides.length;
    state.slides = slides;
    if (!slides.some(s => s.id === state.currentId)) state.currentId = slides[0].id;
    renderAll();
    scheduleSave();
    const delta = slides.length - before;
    setMarkdownStatus(
      `Applied — ${slides.length} slide${slides.length === 1 ? '' : 's'}`
      + (delta ? ` (${delta > 0 ? '+' : ''}${delta})` : ''));
    // Regenerate so the buffer reflects exactly what the deck now holds.
    const text = deckToMarkdownText({ capture: false });
    const pos = els.markdownText.selectionStart;
    els.markdownText.value = text;
    markdownBaseline = text;
    markdownRecoveryMode = false;
    updateMarkdownHighlight();
    refreshMarkdownNavigation();
    try { els.markdownText.setSelectionRange(pos, pos); } catch {}
    updateMarkdownNavActive();
    return true;
  }

  async function applyAndCloseMarkdownMode({ save = false } = {}) {
    if (!applyMarkdownToDeck()) return false;
    await closeMarkdownMode({ force: true });
    if (save) saveProject();
    return true;
  }

  // -------- Toolbar popover menus --------
  // The rarely-used tools live behind the "More" button and the fragment
  // animation behind a caret, so the always-visible row stays short enough
  // to fit one line on a laptop. Both reuse the slide context menu's styling.
  let toolbarMenuAnchor = null;

  // restoreFocus: whether picking an item puts the caret back in the editor
  // first. True for menus whose items act on the selection; false for the
  // small-screen app menu, where refocusing the editor pops the on-screen
  // keyboard over the panel the item just opened.
  function openToolbarMenu(anchor, items, { restoreFocus = true } = {}) {
    const menu = els.toolbarMenu;
    menu.replaceChildren();
    items.forEach(item => {
      if (item.sep) {
        const sep = document.createElement('span');
        sep.className = 'sep';
        menu.appendChild(sep);
        return;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', item.toggle ? 'menuitemcheckbox' : 'menuitemradio');
      if (item.checked != null) btn.setAttribute('aria-checked', item.checked ? 'true' : 'false');
      const tick = document.createElement('i');
      tick.className = 'bi bi-check2 menu-tick';
      tick.setAttribute('aria-hidden', 'true');
      if (!item.checked) tick.style.visibility = 'hidden';
      btn.appendChild(tick);
      btn.appendChild(document.createTextNode(item.label));
      if (item.hint) {
        const hint = document.createElement('span');
        hint.className = 'menu-hint';
        hint.textContent = item.hint;
        btn.appendChild(hint);
      }
      if (item.disabled) btn.disabled = true;
      btn.addEventListener('click', () => {
        closeToolbarMenu(false);
        // Menu items live outside the editor, so put the caret back where it
        // was before running a command that acts on the selection.
        if (restoreFocus) restoreEditorSelection();
        item.action();
      });
      menu.appendChild(btn);
    });

    menu.hidden = false;
    const a = anchor.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    let left = a.left;
    let top = a.bottom + 4;
    if (left + m.width > window.innerWidth) left = Math.max(4, window.innerWidth - m.width - 4);
    if (top + m.height > window.innerHeight) top = Math.max(4, a.top - m.height - 4);
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    toolbarMenuAnchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    const first = menu.querySelector('button[aria-checked="true"]:not(:disabled)')
      || menu.querySelector('button:not(:disabled)');
    if (first) first.focus();
  }

  function closeToolbarMenu(returnFocus = true) {
    if (els.toolbarMenu.hidden) return;
    const hadFocus = els.toolbarMenu.contains(document.activeElement);
    els.toolbarMenu.hidden = true;
    if (toolbarMenuAnchor) {
      toolbarMenuAnchor.setAttribute('aria-expanded', 'false');
      if (returnFocus && hadFocus) toolbarMenuAnchor.focus();
    }
    toolbarMenuAnchor = null;
  }

  function cmdState(cmd) {
    try { return document.queryCommandState(cmd); } catch { return false; }
  }

  function runCmd(cmd, arg = null) {
    recordHistory();
    execCmd(cmd, arg);
    syncToolbarState();
  }

  function openFragmentMenu() {
    if (toolbarMenuAnchor === els.fragmentMenuBtn) { closeToolbarMenu(); return; }
    const frag = getActiveFragment();
    const current = frag ? getFragmentTypeOf(frag) : fragmentDefaultType;
    openToolbarMenu(els.fragmentMenuBtn, FRAGMENT_LABELS.map(([value, label]) => ({
      label,
      checked: value === current,
      action: () => {
        const target = getActiveFragment();
        if (target) {
          // Retype the fragment the caret is in.
          recordHistory();
          setFragmentTypeOn(target, value);
          onEditorInput();
        } else {
          fragmentDefaultType = value;
        }
        syncFragmentDropdown();
      },
    })));
  }

  // -------- Toolbar state reflection --------
  // A WYSIWYG toolbar should show what is already applied at the caret.
  // Without it every button looks like a one-shot action and there is no way
  // to tell you are sitting inside a heading, a list, or a fragment.
  const TOOLBAR_STATE_CMDS = ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'];
  // Values the paragraph-style <select> can represent. Semantic styles stay
  // content-level concepts: themes decide how they look, while Revealation
  // persists only stable rv-block-* classes. Anything else (a list item, say)
  // leaves the selector on the disabled "Mixed" placeholder.
  const SEMANTIC_BLOCK_STYLES = Object.freeze({
    emphasis: 'rv-block-emphasis',
    muted: 'rv-block-muted',
    callout: 'rv-block-callout',
  });
  const SEMANTIC_BLOCK_CLASSES = Object.freeze([
    ...Object.values(SEMANTIC_BLOCK_STYLES),
    'rv-block-quote',
  ]);
  const SEMANTIC_BLOCK_CLASS_TO_KIND = Object.freeze(Object.fromEntries(
    Object.entries(SEMANTIC_BLOCK_STYLES).map(([kind, className]) => [className, kind]),
  ));
  const BLOCK_STYLES = ['p', 'h1', 'h2', 'h3', ...Object.keys(SEMANTIC_BLOCK_STYLES), 'blockquote'];

  function paragraphStyleBlocks() {
    const range = currentEditorRange();
    if (!range) return [];
    return (richText?.blocksForRange?.(range, els.editor) || []).filter(node =>
      /^(P|H[1-6]|BLOCKQUOTE)$/.test(node?.nodeName || ''));
  }

  function clearSemanticBlockStyle(node) {
    if (!node?.classList) return;
    SEMANTIC_BLOCK_CLASSES.forEach(className => node.classList.remove(className));
  }

  function applyParagraphStyle(style) {
    const requested = String(style || '').toLowerCase();
    if (requested === 'inline-code') {
      handleToolbarAction('code-inline');
      return true;
    }
    if (!BLOCK_STYLES.includes(requested)) return false;
    recordHistory();
    restoreEditorSelection();
    if (!currentEditorRange()) return false;
    contentNormalization?.setDefaultParagraphSeparator();

    const semanticClass = SEMANTIC_BLOCK_STYLES[requested] || '';
    const tag = semanticClass ? 'p' : requested;
    document.execCommand('formatBlock', false, tag);

    const blocks = paragraphStyleBlocks();
    blocks.forEach(clearSemanticBlockStyle);
    if (semanticClass) blocks.forEach(node => node.classList.add(semanticClass));
    else if (requested === 'blockquote') blocks.forEach(node => node.classList.add('rv-block-quote'));

    onEditorInput();
    syncToolbarState();
    return true;
  }

  let tbRefs = null;
  function toolbarRefs() {
    if (tbRefs) return tbRefs;
    const q = (sel) => els.toolbar.querySelector(sel);
    tbRefs = {
      cmds: Object.fromEntries(
        TOOLBAR_STATE_CMDS.map(c => [c, q(`button[data-cmd="${c}"]`)])),
      alignLeft: q('button[data-action="align-left"]'),
      alignCenter: q('button[data-action="align-center"]'),
      alignRight: q('button[data-action="align-right"]'),
      commandButtons: els.toolbar.querySelectorAll('button[data-cmd], button[data-action]'),
    };
    return tbRefs;
  }

  function setPressed(btn, on) {
    if (!btn) return;
    const v = on ? 'true' : 'false';
    if (btn.getAttribute('aria-pressed') !== v) btn.setAttribute('aria-pressed', v);
  }

  // Nearest element to the caret, or null when the selection is outside the
  // slide editor. Shared by the state sync and the "More" menu, which needs
  // the same context to tick its checkboxes.
  function selectionElement() {
    // Images/videos use a visual selection overlay rather than a native text
    // selection. Treat that media element as the active selection target so
    // alignment/layout controls act on what the user actually clicked, not on
    // a stale caret elsewhere in the slide.
    if (selectedMediaEl && selectedMediaEl.isConnected && els.editor.contains(selectedMediaEl)) {
      return selectedMediaEl;
    }
    const sel = window.getSelection();
    const node = sel && sel.rangeCount ? sel.getRangeAt(0).commonAncestorContainer : null;
    if (!node || !(els.editor === node || els.editor.contains(node))) return null;
    return node.nodeType === 1 ? node : node.parentElement;
  }

  function syncToolbarState() {
    const refs = toolbarRefs();
    // In HTML source view the rich-text commands have nothing to act on, so
    // grey them out instead of leaving dead buttons enabled.
    refs.commandButtons.forEach(btn => { btn.disabled = sourceMode; });
    els.blockStyle.disabled = sourceMode;
    setPressed(els.toggleSource, sourceMode);
    if (sourceMode) {
      els.toolbar.querySelectorAll('button[aria-pressed]').forEach(btn => {
        if (btn !== els.toggleSource) setPressed(btn, false);
      });
      return;
    }

    // queryCommandState reads the *live* selection, so when focus has left
    // the editor there is nothing meaningful to report — leave the last
    // known state up rather than blanking the toolbar.
    const el = selectionElement();
    if (!el) return;

    TOOLBAR_STATE_CMDS.forEach(cmd => {
      let on = false;
      try { on = document.queryCommandState(cmd); } catch {}
      setPressed(refs.cmds[cmd], on);
    });

    let block = '';
    try { block = String(document.queryCommandValue('formatBlock') || '').toLowerCase(); } catch {}
    const semanticHost = el.closest('.rv-block-emphasis, .rv-block-muted, .rv-block-callout');
    let styleValue = '';
    const inlineCodeHost = el.closest('code');
    if (inlineCodeHost && !inlineCodeHost.closest('pre') && els.editor.contains(inlineCodeHost)) {
      styleValue = 'inline-code';
    } else if (semanticHost && els.editor.contains(semanticHost)) {
      styleValue = Object.entries(SEMANTIC_BLOCK_STYLES)
        .find(([, className]) => semanticHost.classList.contains(className))?.[0] || '';
    } else {
      if (!BLOCK_STYLES.includes(block) && el.closest('blockquote')) block = 'blockquote';
      styleValue = BLOCK_STYLES.includes(block) ? block : '';
    }
    if (els.blockStyle.value !== styleValue) els.blockStyle.value = styleValue;

    const inside = (selector) => {
      const hit = el.closest(selector);
      return !!(hit && els.editor.contains(hit));
    };
    // RV-COMPAT(columns-directive), RV-COMPAT(align-shorthand): old editable hosts.
    const alignHost = el.closest('.sr-layout-content, .sr-col, .sr-align-left, .sr-align-center, .sr-align-right, .sr-center');
    let alignment = 'left';
    if (alignHost) {
      if (alignHost.classList.contains('sr-center') || alignHost.classList.contains('sr-align-center')) alignment = 'center';
      else if (alignHost.classList.contains('sr-align-right')) alignment = 'right';
      else alignment = 'left';
    }
    setPressed(refs.alignLeft, alignment === 'left');
    setPressed(refs.alignCenter, alignment === 'center');
    setPressed(refs.alignRight, alignment === 'right');
  }

  // The fragment animation no longer has a permanent <select>; the caret
  // button next to Fragment carries the current value in its tooltip and
  // accessible name, and opens the full list on click.
  function syncFragmentDropdown() {
    if (sourceMode) return;
    if (!els.fragmentMenuBtn) return;
    const frag = getActiveFragment();
    const type = frag ? getFragmentTypeOf(frag) : fragmentDefaultType;
    const shown = type || 'fade-in';
    const btn = els.fragmentMenuBtn;
    btn.classList.toggle('bound', !!frag);
    btn.title = frag
      ? `Animation for this fragment: ${shown}. Click to change.`
      : `Animation for the next fragment you add: ${shown}. Click to change.`;
    btn.setAttribute('aria-label', `Fragment animation: ${shown}`);
  }

  function toggleFragment() {
    const type = fragmentDefaultType;
    // For fragment work we DO need the live selection — wrapping spans
    // around a highlighted range uses range.extractContents. Restore the
    // cached selection first so the wrap honours what the user selected
    // before clicking.
    restoreEditorSelection();
    const sel = window.getSelection();
    const activeFrag = fragmentFromRange(lastEditorRange) || getActiveFragment();
    const block = getSelectedBlock();

    // 1. Cursor is already inside a fragment → remove it.
    //    (Inline span: unwrap. Block-level: strip the classes.)
    if (activeFrag) {
      recordHistory();
      if (activeFrag.tagName.toLowerCase() === 'span') {
        const parent = activeFrag.parentNode;
        while (activeFrag.firstChild) parent.insertBefore(activeFrag.firstChild, activeFrag);
        parent.removeChild(activeFrag);
        parent.normalize();
      } else if (activeFrag.classList.contains('sr-fragment')) {
        const parent = activeFrag.parentNode;
        while (activeFrag.firstChild) parent.insertBefore(activeFrag.firstChild, activeFrag);
        parent.removeChild(activeFrag);
        parent.normalize();
      } else {
        activeFrag.classList.remove('fragment');
        FRAGMENT_TYPES.forEach(t => activeFrag.classList.remove(t));
      }
      onEditorInput();
      syncFragmentDropdown();
      return;
    }

    // 2. Non-collapsed selection inside a block → wrap selection in a span.
    const hasInlineSelection = sel && !sel.isCollapsed && block
      && !rangeCoversBlock(sel.getRangeAt(0), block);

    if (hasInlineSelection) {
      recordHistory();
      const span = document.createElement('span');
      span.className = 'fragment';
      if (type) span.classList.add(type);
      try {
        const range = sel.getRangeAt(0);
        span.appendChild(range.extractContents());
        range.insertNode(span);
        const r = document.createRange();
        r.selectNodeContents(span);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      } catch (e) {
        console.warn(e);
      }
      onEditorInput();
      syncFragmentDropdown();
      return;
    }

    // 3. No fragment, no selection → apply to the nearest block.
    if (!block) {
      setStatus('Place the cursor in a block to fragment it', false);
      return;
    }
    recordHistory();
    block.classList.add('fragment');
    if (type) block.classList.add(type);
    onEditorInput();
    syncFragmentDropdown();
  }

  function rangeCoversBlock(range, block) {
    return domSelection.rangeCoversBlock(range, block);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // The sidebar label re-parses the slide's full HTML — noticeably heavy on
  // slides holding multi-MB image data URIs. Debounce it; the state capture
  // and save scheduling stay immediate.
  let labelTimer = null;
  function scheduleLabelUpdate() {
    clearTimeout(labelTimer);
    labelTimer = setTimeout(() => {
      labelTimer = null;
      const li = els.slideList.querySelector(`li[data-id="${state.currentId}"] .label`);
      if (li) renderLabelInto(li, slideLabel(currentSlide()));
    }, 150);
  }

  function onEditorInput(event = null) {
    captureCurrentContent(event?.target || null);
    if (!sourceMode) {
      decorateFragments();
      decorateRichContent();
      applySlideEffects();
    }
    syncToolbarState();
    scheduleLabelUpdate();
    if (sidebarController && state) {
      const size = logicalSlideSize();
      sidebarController.updateSlide({ slide: currentSlide(), width: size.width, height: size.height });
    }
    scheduleSave();
  }

  // -------- Selected media: resize + video playback --------
  let selectedMediaEl = null;
  let mediaWidthEditing = false;

  function mediaFromTarget(target) {
    if (!target || sourceMode) return null;
    // RV-COMPAT(interactive-demo): REMOVE `.sr-demo` BEFORE PUBLIC RELEASE.
    let el = target.closest && target.closest('.sr-interactive, .sr-demo, img, video');
    if (!el && target.closest) {
      const linked = target.closest('a.linked-image');
      if (linked) el = linked.querySelector('img');
    }
    return el && els.editor.contains(el) ? el : null;
  }

  function mediaSizingContainer(el) {
    if (!el) return els.editor;
    let p = el.parentElement;
    if (p && p.matches('a.linked-image')) p = p.parentElement;
    if (p && p.matches('.sr-media-crop')) return p.parentElement || els.editor;
    return p || els.editor;
  }

  function mediaCropWrapper(el) {
    return el?.closest?.('.sr-media-crop') || null;
  }

  function mediaCropOffsets(el) {
    const raw = mediaCropWrapper(el)?.dataset.crop || '';
    const values = raw.split(/\s+/).map(value => Number.parseFloat(value));
    return values.length === 4 && values.every(value => Number.isFinite(value))
      ? values.map(value => Math.max(0, Math.min(95, value)))
      : [0, 0, 0, 0];
  }

  function applyCropGeometry(wrapper, offsets, fullRatio) {
    const [top, right, bottom, left] = offsets;
    const visibleWidth = Math.max(.05, 1 - left / 100 - right / 100);
    const visibleHeight = Math.max(.05, 1 - top / 100 - bottom / 100);
    const ratio = Math.max(.05, Number(fullRatio) || 1) * visibleWidth / visibleHeight;
    wrapper.dataset.cropRatio = String(Math.max(.05, Number(fullRatio) || 1));
    wrapper.style.aspectRatio = `${Math.round(ratio * 1000) / 1000} / 1`;
    wrapper.style.setProperty('--sr-crop-image-width', `${Math.round(100 / visibleWidth * 1000) / 10}%`);
    wrapper.style.setProperty('--sr-crop-image-height', `${Math.round(100 / visibleHeight * 1000) / 10}%`);
    wrapper.style.setProperty('--sr-crop-image-left', `${Math.round(-left / visibleWidth * 1000) / 10}%`);
    wrapper.style.setProperty('--sr-crop-image-top', `${Math.round(-top / visibleHeight * 1000) / 10}%`);
  }

  function refreshCropGeometry(root) {
    root?.querySelectorAll?.('.sr-media-crop > img').forEach(image => {
      const wrapper = image.parentElement;
      const update = () => {
        if (!image.naturalWidth || !image.naturalHeight) return;
        applyCropGeometry(wrapper, mediaCropOffsets(image), image.naturalWidth / image.naturalHeight);
        wrapper.style.removeProperty('clip-path');
        if (!wrapper.dataset.cropBaseWidth) {
          wrapper.dataset.cropBaseWidth = String(parseFloat(wrapper.style.width) || 100);
        }
      };
      if (image.complete) update();
      else image.addEventListener('load', update, { once: true });
    });
  }

  function contentBoxWidth(el) {
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const left = parseFloat(cs.paddingLeft) || 0;
    const right = parseFloat(cs.paddingRight) || 0;
    return Math.max(1, r.width - left - right);
  }

  function selectedMediaWidthPercent() {
    if (!selectedMediaEl) return 100;
    // Once the user has set a relative width, report that authored value
    // rather than a potentially smaller rendered width (a tall portrait may
    // also be constrained by max-height in the editor).
    const authored = String(selectedMediaEl.style.width || '').trim();
    if (authored.endsWith('%')) {
      const pct = parseFloat(authored);
      if (Number.isFinite(pct)) return Math.max(10, Math.min(100, pct));
    }
    const container = mediaSizingContainer(selectedMediaEl);
    const cw = contentBoxWidth(container);
    const mw = (mediaCropWrapper(selectedMediaEl) || selectedMediaEl).getBoundingClientRect().width;
    return Math.max(10, Math.min(100, (mw / cw) * 100));
  }

  function positionMediaSelection() {
    if (!selectedMediaEl || !selectedMediaEl.isConnected || sourceMode) {
      if (els.mediaSelection) els.mediaSelection.hidden = true;
      return;
    }
    const fr = els.frame.getBoundingClientRect();
    const mr = (mediaCropWrapper(selectedMediaEl) || selectedMediaEl).getBoundingClientRect();
    if (!mr.width || !mr.height) {
      els.mediaSelection.hidden = true;
      return;
    }
    els.mediaSelection.style.left = `${mr.left - fr.left}px`;
    els.mediaSelection.style.top = `${mr.top - fr.top}px`;
    els.mediaSelection.style.width = `${mr.width}px`;
    els.mediaSelection.style.height = `${mr.height}px`;
    els.mediaSelection.hidden = false;
  }

  function syncMediaToolbar() {
    const el = selectedMediaEl;
    if (!el || !el.isConnected || sourceMode) {
      if (els.mediaToolbar) els.mediaToolbar.hidden = true;
      if (els.mediaSelection) els.mediaSelection.hidden = true;
      return;
    }
    const pct = Math.round(selectedMediaWidthPercent());
    els.mediaWidth.value = String(pct);
    els.mediaWidthValue.value = `${pct}%`;
    els.mediaWidthValue.textContent = `${pct}%`;
    const isVideo = el.tagName === 'VIDEO';
    const isDemo = isInteractiveElement(el);
    const isCaptionable = el.tagName === 'IMG' || isVideo;
    els.mediaKind.textContent = isDemo ? 'Interactive' : (isVideo ? 'Video' : 'Image');
    els.mediaResetSize.textContent = isDemo ? 'Reset width' : 'Natural size';
    if (els.mediaResetCrop) {
      els.mediaResetCrop.hidden = el.tagName !== 'IMG'
        || !mediaCropWrapper(el)
        || !mediaCropOffsets(el).some(value => value > 0.001);
    }
    if (els.mediaCaptionControl) els.mediaCaptionControl.hidden = !isCaptionable;
    if (els.mediaCaption) els.mediaCaption.value = isCaptionable ? mediaCaptionFromElement(el) : '';
    els.videoSettings.hidden = !isVideo;
    if (els.interactiveSettings) els.interactiveSettings.hidden = !isDemo;
    if (isVideo) {
      // RV-COMPAT(video-html-autoplay): REMOVE BEFORE PUBLIC RELEASE.
      // Treat legacy autoplay as the same setting in the inspector, but any
      // change writes the reveal-aware data-autoplay form.
      els.videoAutoplay.checked = el.hasAttribute('data-autoplay') || el.hasAttribute('autoplay');
      els.videoControls.checked = el.hasAttribute('controls');
      els.videoLoop.checked = el.hasAttribute('loop');
      els.videoMuted.checked = el.hasAttribute('muted') || !!el.defaultMuted;
    }
    if (isDemo) {
      const s = interactiveSpecFromElement(el);
      els.interactiveHeight.value = String(Math.round(s?.height || 480));
      els.interactiveEnabled.checked = s?.interactive !== false;
      els.interactivePreload.checked = !!s?.preload;
      els.interactiveBorder.checked = !!s?.border;
      els.interactiveScrollbars.checked = !!s?.scrollbars;
    }
    els.mediaToolbar.hidden = false;
    positionMediaSelection();
  }

  function selectMedia(el) {
    if (!el || !els.editor.contains(el) || !(/^(IMG|VIDEO)$/.test(el.tagName) || isInteractiveElement(el))) {
      clearMediaSelection();
      return;
    }
    selectedMediaEl = el;
    syncMediaToolbar();
  }

  function clearMediaSelection() {
    selectedMediaEl = null;
    mediaWidthEditing = false;
    if (els.mediaToolbar) els.mediaToolbar.hidden = true;
    if (els.mediaSelection) els.mediaSelection.hidden = true;
  }

  function mediaCaptionFromElement(media) {
    const figure = media?.closest?.('figure.sr-media-caption');
    const caption = figure?.querySelector(':scope > figcaption');
    return caption ? caption.textContent.trim() : '';
  }

  function setSelectedMediaCaption(value) {
    const media = selectedMediaEl;
    if (!media || !media.isConnected || !els.editor.contains(media)) return;
    const captionText = String(value || '').trim();
    const existing = media.closest('figure.sr-media-caption');
    const carrier = media.closest('a.linked-image') || media;
    recordHistory();
    if (captionText) {
      const caption = existing?.querySelector(':scope > figcaption');
      if (existing && caption) {
        caption.textContent = captionText;
      } else if (!existing) {
        const figure = document.createElement('figure');
        figure.className = 'sr-media-caption';
        const figcaption = document.createElement('figcaption');
        figcaption.textContent = captionText;
        carrier.replaceWith(figure);
        figure.append(carrier, figcaption);
      }
    } else if (existing) {
      existing.replaceWith(carrier);
    }
    onEditorInput();
    syncMediaToolbar();
  }

  function removeSelectedMedia() {
    if (!selectedMediaEl || !selectedMediaEl.isConnected) return false;
    recordHistory();
    const node = selectedMediaWrapper();
    node.remove();
    clearMediaSelection();
    onEditorInput();
    return true;
  }

  function persistMediaDomChange() {
    captureCurrentContent();
    scheduleLabelUpdate();
    scheduleSave();
    syncMediaToolbar();
  }

  function setSelectedMediaWidth(percent) {
    if (!selectedMediaEl || !selectedMediaEl.isConnected) return;
    const pct = Math.max(10, Math.min(100, Number(percent) || 100));
    selectedMediaEl.classList.remove('r-stretch');
    selectedMediaEl.removeAttribute('width');
    selectedMediaEl.removeAttribute('height');
    const width = `${Math.round(pct * 10) / 10}%`;
    const crop = mediaCropWrapper(selectedMediaEl);
    (crop || selectedMediaEl).style.width = width;
    if (!crop && !isInteractiveElement(selectedMediaEl)) selectedMediaEl.style.height = 'auto';
    persistMediaDomChange();
  }

  function resetSelectedMediaSize() {
    if (!selectedMediaEl || !selectedMediaEl.isConnected) return;
    recordHistory();
    selectedMediaEl.classList.remove('r-stretch');
    selectedMediaEl.removeAttribute('width');
    selectedMediaEl.removeAttribute('height');
    const crop = mediaCropWrapper(selectedMediaEl);
    if (crop) crop.style.removeProperty('width');
    selectedMediaEl.style.removeProperty('width');
    if (isInteractiveElement(selectedMediaEl)) {
      selectedMediaEl.style.width = '100%';
      if (!selectedMediaEl.style.height) selectedMediaEl.style.height = '480px';
    } else {
      selectedMediaEl.style.removeProperty('height');
      if (!selectedMediaEl.getAttribute('style')) selectedMediaEl.removeAttribute('style');
    }
    onEditorInput();
    syncMediaToolbar();
  }

  function setSelectedMediaCropOffsets(offsets) {
    const image = selectedMediaEl;
    if (!image || image.tagName !== 'IMG' || !image.isConnected) return;
    const next = offsets.map(value => Math.max(0, Math.min(95, Number(value) || 0)));
    const active = next.some(value => value > 0.001);
    const current = mediaCropWrapper(image);
    recordHistory();
    if (!active) {
      if (current) current.replaceWith(image);
    } else {
      const wrapper = current || document.createElement('div');
      if (!current) {
        wrapper.className = 'sr-media-crop';
        wrapper.dataset.cropBaseWidth = String(selectedMediaWidthPercent());
        wrapper.style.width = `${Math.round(selectedMediaWidthPercent() * 10) / 10}%`;
        image.replaceWith(wrapper);
        wrapper.appendChild(image);
      }
      const serialized = next.map(value => `${Math.round(value * 100) / 100}%`).join(' ');
      wrapper.dataset.crop = serialized;
      applyCropGeometry(wrapper, next, image.getBoundingClientRect().width / Math.max(1, image.getBoundingClientRect().height));
      const baseWidth = Number(wrapper.dataset.cropBaseWidth) || selectedMediaWidthPercent();
      wrapper.style.width = `${Math.round(baseWidth * (1 - next[1] / 100 - next[3] / 100) * 10) / 10}%`;
    }
    onEditorInput();
    syncMediaToolbar();
  }

  function resetSelectedMediaCrop() {
    const image = selectedMediaEl;
    const wrapper = mediaCropWrapper(image);
    if (!image || image.tagName !== 'IMG' || !wrapper) return;
    recordHistory();
    wrapper.replaceWith(image);
    onEditorInput();
    syncMediaToolbar();
  }

  function setSelectedVideoOption(kind, enabled) {
    const v = selectedMediaEl;
    if (!v || v.tagName !== 'VIDEO' || !v.isConnected) return;
    recordHistory();
    if (kind === 'autoplay') {
      // HTML autoplay is intentionally removed: in Reveal, data-autoplay means
      // "play when this slide becomes active" and does not start in editor.
      v.removeAttribute('autoplay');
      v.toggleAttribute('data-autoplay', enabled);
    } else if (kind === 'controls') {
      v.toggleAttribute('controls', enabled);
      v.controls = enabled;
    } else if (kind === 'loop') {
      v.toggleAttribute('loop', enabled);
      v.loop = enabled;
    } else if (kind === 'muted') {
      v.toggleAttribute('muted', enabled);
      v.defaultMuted = enabled;
      v.muted = enabled;
    }
    v.setAttribute('playsinline', '');
    onEditorInput();
    syncMediaToolbar();
    if (kind === 'autoplay' && enabled && !v.hasAttribute('muted')) {
      setStatus('Autoplay enabled. Browsers are most reliable when Muted is also enabled.', true);
    }
  }

  function setSelectedInteractiveHeight(value) {
    const d = selectedMediaEl;
    if (!d || !isInteractiveElement(d) || !d.isConnected) return;
    recordHistory();
    const logicalHeight = clampInteractiveHeight(value);
    // data-height is the canonical authored value. The editor renders a
    // physically scaled projection of it; changing only style.height is lost
    // on the next updateStageScale(), which is why the inspector used to snap
    // back to its previous value.
    d.dataset.height = String(logicalHeight);
    const scale = Math.max(0.05, Number.parseFloat(els.frame?.style?.getPropertyValue('--stage-scale')) || 1);
    d.style.height = `${Math.round(logicalHeight * scale * 100) / 100}px`;
    onEditorInput();
    syncMediaToolbar();
  }

  function setSelectedInteractiveOption(kind, enabled) {
    const d = selectedMediaEl;
    if (!d || !isInteractiveElement(d) || !d.isConnected) return;
    recordHistory();
    const iframe = d.querySelector(':scope > iframe');
    if (kind === 'interactive') d.dataset.interactive = enabled ? '1' : '0';
    if (kind === 'preload') {
      d.dataset.preload = enabled ? '1' : '0';
      if (iframe) {
        iframe.toggleAttribute('data-preload', enabled);
        iframe.setAttribute('loading', enabled ? 'eager' : 'lazy');
      }
    }
    if (kind === 'border') d.dataset.border = enabled ? '1' : '0';
    if (kind === 'scrollbars') {
      d.dataset.scrollbars = enabled ? '1' : '0';
      if (iframe) iframe.setAttribute('scrolling', enabled ? 'yes' : 'no');
    }
    onEditorInput();
    syncMediaToolbar();
  }

  function startMediaResize(e) {
    if (!selectedMediaEl || !selectedMediaEl.isConnected) return;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const direction = handle.dataset.mediaResize || 'se';
    const container = mediaSizingContainer(selectedMediaEl);
    const containerWidth = contentBoxWidth(container);
    const startX = e.clientX;
    const startY = e.clientY;
    const selectedBox = mediaCropWrapper(selectedMediaEl) || selectedMediaEl;
    const startRect = selectedBox.getBoundingClientRect();
    const startWidth = startRect.width;
    const startHeight = Math.max(1, startRect.height);
    const horizontal = direction.includes('e') ? 1 : direction.includes('w') ? -1 : 0;
    const vertical = direction.includes('s') ? 1 : direction.includes('n') ? -1 : 0;
    const cropEditing = selectedMediaEl.tagName === 'IMG' && e.shiftKey;
    let crop = mediaCropWrapper(selectedMediaEl);
    if (cropEditing && !crop) {
      crop = document.createElement('div');
      crop.className = 'sr-media-crop';
      crop.dataset.cropBaseWidth = String(selectedMediaWidthPercent());
      crop.style.width = `${Math.round(selectedMediaWidthPercent() * 10) / 10}%`;
      crop.dataset.crop = '0% 0% 0% 0%';
      selectedMediaEl.replaceWith(crop);
      crop.appendChild(selectedMediaEl);
      applyCropGeometry(crop, [0, 0, 0, 0], startWidth / startHeight);
    }
    const startCrop = cropEditing ? mediaCropOffsets(selectedMediaEl) : null;
    recordHistory();
    try { handle.setPointerCapture(e.pointerId); } catch {}

    const move = (ev) => {
      if (cropEditing) {
        const dx = (ev.clientX - startX) / Math.max(1, startWidth) * 100;
        const dy = (ev.clientY - startY) / Math.max(1, startHeight) * 100;
        const next = startCrop.slice();
        if (direction.includes('n')) next[0] += dy;
        if (direction.includes('e')) next[1] -= dx;
        if (direction.includes('s')) next[2] -= dy;
        if (direction.includes('w')) next[3] += dx;
        next[0] = Math.max(0, Math.min(95, next[0]));
        next[1] = Math.max(0, Math.min(95 - next[3], next[1]));
        next[2] = Math.max(0, Math.min(95 - next[0], next[2]));
        next[3] = Math.max(0, Math.min(95 - next[1], next[3]));
        const serialized = next.map(value => `${Math.round(value * 100) / 100}%`).join(' ');
        crop.dataset.crop = serialized;
        const fullRatio = Number(crop.dataset.cropRatio)
          || startWidth / Math.max(1, startHeight);
        applyCropGeometry(crop, next, fullRatio);
        const baseWidth = Number(crop.dataset.cropBaseWidth) || selectedMediaWidthPercent();
        crop.style.width = `${Math.round(baseWidth * (1 - next[1] / 100 - next[3] / 100) * 10) / 10}%`;
        positionMediaSelection();
        return;
      }
      let px;
      const horizontalDelta = horizontal * (ev.clientX - startX);
      const verticalDelta = vertical * (ev.clientY - startY) * (startWidth / startHeight);
      const delta = horizontal ? horizontalDelta : verticalDelta;
      px = Math.max(containerWidth * .10, Math.min(containerWidth, startWidth + delta));
      const pct = (px / containerWidth) * 100;
      selectedMediaEl.classList.remove('r-stretch');
      const width = `${Math.round(pct * 10) / 10}%`;
      (crop || selectedMediaEl).style.width = width;
      if (crop) {
        const offsets = mediaCropOffsets(selectedMediaEl);
        crop.dataset.cropBaseWidth = String(pct / Math.max(.05, 1 - offsets[1] / 100 - offsets[3] / 100));
      }
      if (!crop && !isInteractiveElement(selectedMediaEl)) selectedMediaEl.style.height = 'auto';
      const shown = Math.round(pct);
      els.mediaWidth.value = String(shown);
      els.mediaWidthValue.value = `${shown}%`;
      els.mediaWidthValue.textContent = `${shown}%`;
      positionMediaSelection();
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      if (cropEditing && crop && mediaCropOffsets(selectedMediaEl).every(value => value <= 0.001)) {
        crop.replaceWith(selectedMediaEl);
      }
      onEditorInput();
      syncMediaToolbar();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  // -------- Project asset library --------
  function ensureAssets() {
    if (workspaceMode) return workspaceFiles;
    if (!Array.isArray(state.assets)) state.assets = [];
    return state.assets;
  }

  function assetKind(asset) {
    const t = String(asset?.type || '');
    if (t.startsWith('image/')) return 'image';
    if (t.startsWith('video/')) return 'video';
    if (t.startsWith('audio/')) return 'audio';
    return 'file';
  }

  function rememberAsset({ name, type, dataUrl, size = 0 }) {
    // Workspace files are discovered from disk and are not duplicated inside
    // either deck file as base64 blobs.
    if (workspaceMode) return null;
    if (!dataUrl || !state) return null;
    const assets = ensureAssets();
    const existing = assets.find(a => a.dataUrl === dataUrl);
    if (existing) return existing;
    const asset = {
      id: uid(), name: name || 'asset', type: type || '', dataUrl,
      size: Number(size) || 0, createdAt: Date.now(),
    };
    assets.push(asset);
    scheduleSave();
    return asset;
  }

  function assetMarkup(asset) {
    const src = escapeAttr(asset.dataUrl);
    const kind = assetKind(asset);
    if (kind === 'image') return `<img src="${src}" alt="">`;
    if (kind === 'video') return `<video src="${src}" controls playsinline controlsList="nofullscreen nodownload noremoteplayback noplaybackrate" disablePictureInPicture></video><br>`;
    if (kind === 'audio') return `<audio src="${src}" controls></audio><br>`;
    return `<a href="${src}" target="_blank" rel="noopener noreferrer">${escapeHtml(asset.path || asset.name || 'file')}</a>`;
  }

  function insertAsset(asset) {
    const html = assetMarkup(asset);
    if (!html) return;
    recordHistory();
    insertMarkupAtCursor(html);
    closeAssetsModal();
  }

  let assetFilter = 'all';
  let assetQuery = '';

  function renderAssetsModal() {
    const assets = ensureAssets()
      .filter(asset => assetFilter === 'all' || assetKind(asset) === assetFilter)
      .filter(asset => {
        if (!assetQuery) return true;
        const haystack = `${asset.name || ''} ${asset.path || ''}`.toLowerCase();
        return haystack.includes(assetQuery);
      })
      .slice()
      .sort((a, b) => (b.createdAt || b.modifiedAt || 0) - (a.createdAt || a.modifiedAt || 0));
    els.assetsGrid.replaceChildren();
    els.assetsEmpty.hidden = assets.length > 0;
    els.assetsEmpty.textContent = assets.length
      ? ''
      : assetQuery
        ? `No ${assetFilter === 'all' ? 'media' : assetFilter} files match “${assetQuery}”.`
        : `No ${assetFilter === 'all' ? 'media' : assetFilter} files yet. Upload one to add it to this project.`;
    for (const asset of assets) {
      const card = document.createElement('div');
      card.className = 'asset-card';
      const preview = document.createElement('div');
      preview.className = 'asset-preview';
      preview.setAttribute('role', 'button');
      preview.tabIndex = 0;
      preview.title = `Insert ${asset.name || 'media'}`;
      preview.addEventListener('click', () => insertAsset(asset));
      preview.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          insertAsset(asset);
        }
      });
      const kind = assetKind(asset);
      let media;
      if (kind === 'image') {
        media = document.createElement('img'); media.src = workspaceAssetUrl(asset.dataUrl || asset.path); media.alt = '';
      } else if (kind === 'video') {
        media = document.createElement('video'); media.src = workspaceAssetUrl(asset.dataUrl || asset.path); media.muted = true;
      } else if (kind === 'audio') {
        media = document.createElement('audio'); media.src = workspaceAssetUrl(asset.dataUrl || asset.path); media.controls = true;
      } else {
        media = document.createElement('span'); media.textContent = 'file';
      }
      preview.appendChild(media);
      const info = document.createElement('div');
      info.className = 'asset-info';
      const name = document.createElement('div');
      name.className = 'asset-name';
      name.title = asset.name;
      name.textContent = (asset.path || asset.name) + (asset.size ? ` · ${formatBytes(asset.size)}` : '');
      const del = document.createElement('button');
      del.type = 'button'; del.textContent = 'Delete';
      del.addEventListener('click', async () => {
        if (!(await dialogs.confirm(`Remove "${asset.name}" from the reusable asset list? Existing slides are not changed.`, { title: 'Remove reusable asset', confirmLabel: 'Remove', kind: 'danger' }))) return;
        state.assets = ensureAssets().filter(a => a.id !== asset.id);
        scheduleSave();
        renderAssetsModal();
      });
      if (!workspaceMode) {
        const actions = document.createElement('div');
        actions.className = 'asset-actions';
        actions.append(del);
        info.append(name, actions);
      } else info.append(name);
      card.append(preview, info);
      els.assetsGrid.appendChild(card);
    }
  }

  function openAssetsModal(kind = 'all') {
    assetFilter = ['image', 'video', 'audio'].includes(kind) ? kind : 'all';
    assetQuery = '';
    const label = assetFilter === 'all' ? 'media' : assetFilter;
    if (els.assetsTitle) els.assetsTitle.textContent = `Insert ${label}`;
    if (els.assetsHint) els.assetsHint.textContent = workspaceMode
      ? `Choose an existing ${label} file or upload a new one to assets/.`
      : `Choose an existing ${label} or upload a new one.`;
    if (els.assetUploadLabel) els.assetUploadLabel.textContent = `Upload ${label}`;
    if (els.assetsRefresh) els.assetsRefresh.hidden = !workspaceMode;
    if (els.assetFileInput) {
      els.assetFileInput.accept = assetFilter === 'all' ? 'image/*,video/*,audio/*' : `${assetFilter}/*`;
      els.assetFileInput.multiple = false;
    }
    if (els.assetsSearch) els.assetsSearch.value = '';
    renderAssetsModal();
    els.assetsModal.hidden = false;
    focusModal(els.assetsModal);
    if (workspaceMode) refreshWorkspaceFiles().then(renderAssetsModal);
  }

  function closeAssetsModal() {
    els.assetsModal.hidden = true;
    restoreModalFocus();
  }

  async function addFilesToAssetLibrary(files) {
    if (workspaceMode) {
      for (const file of Array.from(files || []).filter(file => assetFilter === 'all' || file.type.startsWith(`${assetFilter}/`))) {
        try { await uploadWorkspaceFile(file, 'assets'); }
        catch (e) { console.warn('workspace upload failed', file && file.name, e); }
      }
      await refreshWorkspaceFiles();
      renderAssetsModal();
      return;
    }
    for (const file of Array.from(files || []).filter(file => assetFilter === 'all' || file.type.startsWith(`${assetFilter}/`))) {
      try {
        if (file.type.startsWith('image/')) {
          const result = await optimizeImage(file);
          const mime = (result.dataUrl.match(/^data:([^;,]+)/) || ['', file.type || 'image/*'])[1];
          rememberAsset({ name: file.name, type: mime, dataUrl: result.dataUrl, size: result.newSize });
        } else if (file.type.startsWith('video/') || file.type.startsWith('audio/')) {
          const dataUrl = await fileToDataUrl(file);
          rememberAsset({ name: file.name, type: file.type, dataUrl, size: file.size });
        }
      } catch (e) {
        console.warn('asset import failed', file && file.name, e);
      }
    }
    renderAssetsModal();
  }

  // -------- Image drop / paste --------
  // Defaults tuned for 1080p slides on a 16:9 deck. Photos shrink ~10–30×;
  // anything below skipBelow is left alone (icons, screenshots, diagrams).
  const IMAGE_OPTIMIZE = {
    maxDim: 1920,
    quality: 0.85,
    skipBelow: 200 * 1024,
  };

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  // Returns { dataUrl, origSize, newSize, skipped }. On any failure we fall
  // through to the original file so the user always gets their image.
  async function optimizeImage(file) {
    const orig = file.size;
    const pass = async () => ({ dataUrl: await fileToDataUrl(file), origSize: orig, newSize: orig, skipped: true });

    if (orig <= IMAGE_OPTIMIZE.skipBelow) return pass();
    // SVG: vector, don't rasterize. GIF: probably animated, canvas drops frames.
    if (file.type === 'image/svg+xml' || file.type === 'image/gif') return pass();

    let img;
    try { img = await loadImageFromFile(file); } catch { return pass(); }

    let w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return pass();
    const longest = Math.max(w, h);
    if (longest > IMAGE_OPTIMIZE.maxDim) {
      const scale = IMAGE_OPTIMIZE.maxDim / longest;
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    // Preserve transparency for PNGs; everything else re-encodes as JPEG.
    const outType = (file.type === 'image/png') ? 'image/png' : 'image/jpeg';
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (outType === 'image/jpeg') {
      // JPEG has no alpha — paint white behind transparent sources.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await new Promise(r => canvas.toBlob(r, outType, IMAGE_OPTIMIZE.quality));
    if (!blob || blob.size >= orig) return pass();
    return { dataUrl: await blobToDataUrl(blob), origSize: orig, newSize: blob.size, skipped: false };
  }

  async function insertImageFromFile(file, linkHref = null, insertionRange = null) {
    if (!file || !file.type.startsWith('image/')) return;
    if (workspaceMode) {
      try {
        const asset = await uploadWorkspaceFile(file, 'assets');
        if (!asset) return;
        const imgTag = `<img src="${escapeAttr(asset.dataUrl)}" alt="">`;
        const tag = linkHref
          ? `<a href="${escapeAttr(linkHref)}" target="_blank" rel="noopener noreferrer" class="linked-image">${imgTag}</a>`
          : imgTag;
        recordHistory();
        if (sourceMode) {
          const ta = els.source;
          const pos = ta.selectionStart;
          ta.value = ta.value.slice(0, pos) + tag + ta.value.slice(ta.selectionEnd);
          ta.selectionStart = ta.selectionEnd = pos + tag.length;
          onEditorInput();
        } else insertHTMLAtCursor(tag, insertionRange);
        setStatus(`Saved ${asset.path}`, true);
      } catch (e) {
        setStatus('Image upload failed: ' + (e.message || String(e)), false);
      }
      return;
    }
    let result;
    try {
      result = await optimizeImage(file);
    } catch (e) {
      console.warn('image optimize failed; using original', e);
      result = { dataUrl: await fileToDataUrl(file), origSize: file.size, newSize: file.size, skipped: true };
    }
    rememberAsset({ name: file.name || 'image', type: (result.dataUrl.match(/^data:([^;,]+)/) || ['', file.type || 'image/*'])[1], dataUrl: result.dataUrl, size: result.newSize });
    const imgTag = `<img src="${result.dataUrl}" alt="">`;
    const tag = linkHref
      ? `<a href="${escapeAttr(linkHref)}" target="_blank" rel="noopener noreferrer" class="linked-image">${imgTag}</a>`
      : imgTag;
    // Snapshot here (not at the toolbar click) so paste/drop insertions are
    // undoable too, and a cancelled file picker leaves no no-op entry.
    recordHistory();
    if (sourceMode) {
      const ta = els.source;
      const pos = ta.selectionStart;
      const before = ta.value.slice(0, pos);
      const after = ta.value.slice(ta.selectionEnd);
      ta.value = before + tag + after;
      ta.selectionStart = ta.selectionEnd = pos + tag.length;
      onEditorInput();
    } else {
      insertHTMLAtCursor(tag, insertionRange);
    }
    if (!result.skipped) {
      const saved = Math.round((1 - result.newSize / result.origSize) * 100);
      setStatus(`Image: ${formatBytes(result.origSize)} → ${formatBytes(result.newSize)} (${saved}% smaller)`, true);
    }
  }

  async function insertVideoFromFile(file, insertionRange = null) {
    if (!file || !file.type.startsWith('video/')) return;
    if (workspaceMode) {
      try {
        const asset = await uploadWorkspaceFile(file, 'assets');
        if (!asset) return;
        const tag = `<video src="${escapeAttr(asset.dataUrl)}" controls playsinline controlsList="nofullscreen nodownload noremoteplayback noplaybackrate" disablePictureInPicture></video><br>`;
        recordHistory();
        if (sourceMode) {
          const ta = els.source;
          const pos = ta.selectionStart;
          ta.value = ta.value.slice(0, pos) + tag + ta.value.slice(ta.selectionEnd);
          ta.selectionStart = ta.selectionEnd = pos + tag.length;
          onEditorInput();
        } else insertHTMLAtCursor(tag, insertionRange);
        setStatus(`Saved ${asset.path}`, true);
      } catch (e) {
        setStatus('Video upload failed: ' + (e.message || String(e)), false);
      }
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    rememberAsset({ name: file.name || 'video', type: file.type, dataUrl, size: file.size });
    const tag = `<video src="${escapeAttr(dataUrl)}" controls playsinline controlsList="nofullscreen nodownload noremoteplayback noplaybackrate" disablePictureInPicture></video><br>`;
    recordHistory();
    if (sourceMode) {
      const ta = els.source;
      const pos = ta.selectionStart;
      const before = ta.value.slice(0, pos);
      const after = ta.value.slice(ta.selectionEnd);
      ta.value = before + tag + after;
      ta.selectionStart = ta.selectionEnd = pos + tag.length;
      onEditorInput();
    } else {
      insertHTMLAtCursor(tag, insertionRange);
    }
    setStatus(`Video: ${formatBytes(file.size)}`, true);
  }

  let dragDepth = 0;
  function setupDropZone() {
    const target = els.frame;
    const isFileDrag = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

    target.addEventListener('dragenter', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth++;
      els.dropOverlay.hidden = false;
    });
    target.addEventListener('dragover', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    target.addEventListener('dragleave', (e) => {
      if (!isFileDrag(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) els.dropOverlay.hidden = true;
    });
    target.addEventListener('drop', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth = 0;
      els.dropOverlay.hidden = true;
      const files = Array.from(e.dataTransfer.files || []);
      files.forEach(f => {
        if (f.type.startsWith('image/')) insertImageFromFile(f);
        else if (f.type.startsWith('video/')) insertVideoFromFile(f);
      });
    });
  }

  const REVEALATION_CLIPBOARD_MIME = 'application/x-revealation-html';

  function liveEditorSelectionRange({ allowCollapsed = false } = {}) {
    const selection = window.getSelection?.();
    if (!selection || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!allowCollapsed && range.collapsed) return null;
    const host = richText?.singleEditingHost?.(range, els.editor);
    return host ? range : null;
  }

  function cleanClipboardHtml(nodeOrFragment) {
    const holder = document.createElement('div');
    holder.appendChild(nodeOrFragment.cloneNode(true));
    holder.querySelectorAll('[data-fragment-label]').forEach(node => node.removeAttribute('data-fragment-label'));
    undecorateRichContent(holder);
    layoutBlocks?.undecorateEditor(holder);
    holder.querySelectorAll('[contenteditable],[spellcheck]').forEach(node => {
      node.removeAttribute('contenteditable');
      node.removeAttribute('spellcheck');
    });
    contentNormalization?.normalizeForSerialization(holder);
    stripEditorSizing(holder);
    return holder.innerHTML;
  }

  function clipboardPayload() {
    const range = liveEditorSelectionRange();
    if (range) {
      const fragment = range.cloneContents();
      const html = cleanClipboardHtml(fragment);
      return html ? { html, text: range.toString(), range, media: null } : null;
    }

    const activeInEditor = document.activeElement === els.editor || els.editor.contains(document.activeElement);
    if (activeInEditor && selectedMediaEl && selectedMediaEl.isConnected && els.editor.contains(selectedMediaEl)) {
      const wrapper = selectedMediaWrapper();
      if (!wrapper) return null;
      const html = cleanClipboardHtml(wrapper);
      const text = mediaCaptionFromElement(selectedMediaEl)
        || selectedMediaEl.getAttribute?.('alt')
        || selectedMediaEl.getAttribute?.('src')
        || 'media';
      return { html, text, range: null, media: wrapper };
    }
    return null;
  }

  function writeEditorClipboard(event, { cut = false } = {}) {
    const data = event?.clipboardData;
    if (!data) return false;
    const payload = clipboardPayload();
    if (!payload) return false;
    event.preventDefault();
    data.setData(REVEALATION_CLIPBOARD_MIME, payload.html);
    data.setData('text/html', payload.html);
    data.setData('text/plain', payload.text || '');
    if (!cut) return true;

    recordHistory();
    if (payload.media) {
      payload.media.remove();
      clearMediaSelection();
      onEditorInput();
      return true;
    }
    if (payload.range) {
      const host = richText?.singleEditingHost?.(payload.range, els.editor) || els.editor;
      payload.range.deleteContents();
      contentNormalization?.normalizeForSerialization(host);
      onEditorInput({ target: host });
    }
    return true;
  }

  function validatedInternalClipboardHtml(html) {
    const source = String(html || '').trim();
    if (!source) return '';
    // The custom MIME is for lossless Revealation-to-Revealation moves, not a
    // trust boundary. Reject executable clipboard markup before accepting the
    // richer canonical representation.
    if (/<\/?(?:script|style|iframe|object|embed)\b/i.test(source)
        || /\son[a-z]+\s*=/i.test(source)
        || /(?:javascript|vbscript)\s*:/i.test(source)) return '';
    const holder = document.createElement('div');
    holder.innerHTML = source;
    try {
      contentNormalization?.normalizeForSerialization(holder);
      assertMarkdownConvertible(holder);
      return holder.innerHTML;
    } catch (_) {
      return '';
    }
  }

  function pasteShouldStayInline(range) {
    if (!range) return false;
    let node = range.startContainer;
    if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const block = node?.closest?.('h1,h2,h3,h4,h5,h6,li');
    return !!(block && els.editor.contains(block));
  }

  function setupPaste() {
    // Copy/cut is registered at the document level because selecting media via
    // the inspector does not necessarily leave the browser focus on the IMG.
    // The handler activates only for a live editor selection or selected media
    // while an editor host has focus, so normal clipboard behavior elsewhere
    // in the application is untouched.
    document.addEventListener('copy', event => { writeEditorClipboard(event); });
    document.addEventListener('cut', event => { writeEditorClipboard(event, { cut: true }); });

    els.editor.addEventListener('paste', (e) => {
      const data = e.clipboardData;
      if (!data) return;
      const insertionRange = liveEditorSelectionRange({ allowCollapsed: true })?.cloneRange()
        || editorRangeSnapshot();
      const items = data.items;
      if (items) {
        for (const item of items) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            e.preventDefault();
            insertImageFromFile(item.getAsFile(), null, insertionRange);
            return;
          }
          if (item.kind === 'file' && item.type.startsWith('video/')) {
            e.preventDefault();
            insertVideoFromFile(item.getAsFile(), insertionRange);
            return;
          }
        }
      }

      const internal = validatedInternalClipboardHtml(data.getData(REVEALATION_CLIPBOARD_MIME));
      const html = data.getData('text/html');
      const text = data.getData('text/plain');
      if (!internal && !html && !text) return;
      if (!contentNormalization) return;
      e.preventDefault();

      let inserted = internal;
      if (!inserted) {
        inserted = html
          ? contentNormalization.sanitizePastedHtml(html)
          : contentNormalization.plainTextToHtml(text);
        // Pasting paragraphs from a web page into a title/list item should not
        // silently replace that block's semantics. Keep the inline formatting
        // and images, but collapse external block wrappers to line breaks.
        if (pasteShouldStayInline(insertionRange)) {
          inserted = contentNormalization.toInlinePasteHtml(inserted);
        }
      }
      if (!inserted) inserted = contentNormalization.plainTextToHtml(text) || '';
      if (!inserted) return;
      recordHistory();
      insertHTMLAtCursor(inserted, insertionRange);
    });
  }

  // -------- Present mode --------
  function presentationSlides(project = state) {
    const source = Array.isArray(project?.slides) ? project.slides : [];
    const groups = [];
    source.forEach((slide, index) => {
      if (index > 0 && slideModel.isSubslide(slide, index) && groups.length) groups[groups.length - 1].push(slide);
      else groups.push([slide]);
    });
    return groups.flatMap(group => {
      const visible = group.filter(slide => slide?.hidden !== true);
      return visible.map((slide, index) => ({ ...slide, vertical: index > 0 }));
    });
  }

  function slidePosition(id, slides = state.slides) {
    const pos = slideModel.position(slides, id);
    return [pos.h, pos.v];
  }

  function presentationStartSlide(project = state) {
    const visible = presentationSlides(project);
    if (!visible.length) return null;
    if (visible.some(slide => slide.id === project.currentId)) {
      return visible.find(slide => slide.id === project.currentId) || visible[0];
    }
    const currentIndex = (project.slides || []).findIndex(slide => slide.id === project.currentId);
    if (currentIndex >= 0) {
      const after = (project.slides || []).slice(currentIndex + 1).find(slide => !slide.hidden);
      if (after) return after;
      for (let i = currentIndex - 1; i >= 0; i -= 1) {
        if (!project.slides[i].hidden) return project.slides[i];
      }
    }
    return visible[0];
  }

  function escapeAttr(s) {
    return String(s).replace(/"/g, '&quot;');
  }

  function buildSections(slides, project = state) {
    slides = presentationSlides({ slides: slides || [] });
    // RV-COMPAT(subslide-vertical): REMOVE BEFORE PUBLIC RELEASE.
    // Group consecutive legacy `vertical:true` entries as subslides under the preceding slide.
    const groups = [];
    slides.forEach((s, i) => {
      if (s.vertical && i > 0 && groups.length > 0) {
        groups[groups.length - 1].push(s);
      } else {
        groups.push([s]);
      }
    });
    const themeDefault = defaultBackgroundId(project);
    return groups.map(g => g.length === 1
      ? renderSection(g[0], themeDefault)
      : `<section>\n${g.map(slide => renderSection(slide, themeDefault)).join('\n')}\n</section>`
    ).join('\n');
  }

  function renderSection(s, themeDefaultBackground = '') {
    const layoutId = layoutRegistry?.get?.(s.layout) ? s.layout : 'single';
    const attrs = [`class="rv-slide rv-layout-${escapeAttr(layoutId)}"`];
    // RV-COMPAT(slide-transition): REMOVE BEFORE PUBLIC RELEASE.
    if (s.transition) attrs.push(`data-transition="${escapeAttr(s.transition)}"`);
    const extensionId = backgroundExtensionId(s.background) || themeDefaultBackground;
    // RV-COMPAT(background-reveal): REMOVE BEFORE PUBLIC RELEASE.
    const legacy = legacyBackground(s.background);
    if (!extensionId && legacy) {
      const attr = legacy.type === 'color' ? 'data-background'
        : `data-background-${legacy.type}`;
      attrs.push(`${attr}="${escapeAttr(legacy.value)}"`);
      if (legacy.size) attrs.push(`data-background-size="${escapeAttr(legacy.size)}"`);
    }
    const animation = s.autoAnimate || {};
    if (animation.enabled) attrs.push('data-auto-animate');
    if (animation.id) attrs.push(`data-auto-animate-id="${escapeAttr(animation.id)}"`);
    if (animation.duration) attrs.push(`data-auto-animate-duration="${escapeAttr(animation.duration)}"`);
    if (animation.easing) attrs.push(`data-auto-animate-easing="${escapeAttr(animation.easing)}"`);
    if (animation.unmatched) attrs.push(`data-auto-animate-unmatched="${escapeAttr(animation.unmatched)}"`);
    const background = extensionId && backgroundRegistry?.get?.(extensionId)
      ? `<div class="rv-background-host" data-rv-background="${escapeAttr(extensionId)}" aria-hidden="true"></div>`
      : '';
    const notes = s.notes ? `<aside class="notes">${escapeHtml(s.notes)}</aside>` : '';
    return `<section ${attrs.join(' ')}>${background}${s.content}${notes}</section>`;
  }

  const deckExporter = deckExporterFactory?.create?.({
    themeDefinition,
    themePayload: themePayloadBits,
    backgrounds: backgroundResources,
    renderSections: buildSections,
    contentCss: deckContentCss,
    revealConfig: defaultRevealConfig,
  });

  const PRESENTATION_FULLSCREEN_KEY = 'revealation:presentation-fullscreen';
  const PRESENTATION_PAYLOAD_PREFIX = 'revealation:presentation:';

  function presentationFullscreenEnabled() {
    try {
      const stored = localStorage.getItem(PRESENTATION_FULLSCREEN_KEY);
      return stored == null ? true : stored === '1';
    } catch (_) {
      return true;
    }
  }

  function setPresentationFullscreenEnabled(enabled) {
    try { localStorage.setItem(PRESENTATION_FULLSCREEN_KEY, enabled ? '1' : '0'); } catch (_) {}
  }

  function requestPresentationFullscreen() {
    if (!presentationFullscreenEnabled()) return;
    try {
      Promise.resolve(window.Revealation?.platform?.requestFullscreen?.(document.documentElement))
        .catch(error => console.warn('Presentation fullscreen failed', error));
    } catch (error) {
      console.warn('Presentation fullscreen failed', error);
    }
  }

  function startPresentation({ fromCurrent = false } = {}) {
    captureCurrentContent();
    const visibleSlides = presentationSlides(state);
    if (!visibleSlides.length) {
      dialogs.alert('All slides are hidden. Show at least one slide before presenting.', { title: 'Nothing to present', kind: 'warning' });
      return;
    }
    const startSlide = fromCurrent ? presentationStartSlide(state) : null;
    const startAt = startSlide ? slidePosition(startSlide.id, visibleSlides) : null;
    presentationPosition = null;
    speakerViewOpen = false;
    const payload = {
      type: 'render-deck',
      version: REVEAL_VERSION,
      ...themePayloadBits(state),
      title: state.title || 'Presentation',
      sections: buildSections(state.slides, state),
      contentCss: deckContentCss(),
      backgroundResources: backgroundPayloadResources(state),
      start: startAt,
      config: { ...defaultRevealConfig(), ...(state.config || {}) },
    };
    const presentationId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      sessionStorage.setItem(PRESENTATION_PAYLOAD_PREFIX + presentationId, JSON.stringify(payload));
    } catch (_) {}
    els.presentModal.hidden = false;
    requestPresentationFullscreen();
    modalReturnFocus = document.activeElement;   // focus lands in the iframe; remember where to return
    // Force a fresh load so reveal.js re-initializes cleanly each time.
    els.presentFrame.addEventListener('load', () => {
      try {
        els.presentFrame.contentWindow?.postMessage(payload, '*');
        els.presentFrame.contentWindow?.focus();
      } catch {}
    }, { once: true });
    els.presentFrame.src = window.Revealation.urls.app(`preview.html?t=${Date.now()}&present=${encodeURIComponent(presentationId)}`);
  }

  let presentationPosition = null;
  let speakerViewOpen = false;

  function closePresentation() {
    speakerViewOpen = false;
    window.Revealation?.platform?.closeSpeaker?.();
    // Reveal's notes plugin opens the speaker view from inside the preview
    // iframe, so the host platform cannot close that popup directly in a
    // browser. Ask the preview runtime to close the popup before unloading it.
    try { els.presentFrame.contentWindow?.postMessage({ type: 'close-speaker' }, '*'); } catch (_) {}
    els.presentModal.hidden = true;
    els.presentFrame.removeAttribute('src');
    if (window.Revealation?.platform?.isFullscreen?.()) {
      try {
        Promise.resolve(window.Revealation.platform.exitFullscreen?.())
          .catch(error => console.warn('Presentation fullscreen exit failed', error));
      } catch (error) {
        console.warn('Presentation fullscreen exit failed', error);
      }
    }
    restoreModalFocus();
    if (!presentationPosition) return;
    const { h, v } = presentationPosition;
    presentationPosition = null;
    let target = null;
    const visibleSlides = presentationSlides(state);
    visibleSlides.forEach((s) => {
      const pos = slideModel.position(visibleSlides, s.id);
      if (pos.h === h && pos.v === v) target = s;
    });
    if (target && target.id !== state.currentId) selectSlide(target.id);
  }

  // -------- Export coordination --------
  // Artifact construction lives in src/export/. Core only reconciles the live
  // editor state, handles user-facing warnings/status and starts downloads.
  function projectForRuntimeExport(project = state) {
    if (!project) return null;
    if (project !== state) return project;
    if (!markdownMode) {
      captureCurrentContent();
      return project;
    }

    try {
      const raw = restoreDataUris(els.markdownText.value, markdownAssets);
      const slides = parseMarkdownDeck(raw);
      if (!slides.length) throw new Error('Markdown contains no slides');
      return { ...project, slides };
    } catch (error) {
      setMarkdownStatus('Fix the Markdown before exporting: ' + (error.message || error), false);
      return null;
    }
  }

  async function exportStandaloneHtml(project = state, { confirmInteractive = true, revealConfig = null } = {}) {
    if (!deckExporter) {
      dialogs.alert('The presentation export module failed to load.', { title: 'Export unavailable', kind: 'danger' });
      return;
    }
    const projectForExport = projectForRuntimeExport(project);
    if (!projectForExport) return;

    if (confirmInteractive && deckExporter.containsInteractive(projectForExport) && !(await dialogs.confirm(
      'This presentation contains interactive content. A standalone HTML file may not preserve its local scripts, data files, workers, or server connections, so the interactive content may not work correctly after export.\n\nFor fully working interactive content, use the ZIP package and serve the extracted folder over HTTP.',
      { title: 'Standalone HTML has limitations', confirmLabel: 'Export anyway', cancelLabel: 'Cancel', kind: 'warning' }
    ))) return;

    setStatus('Building standalone HTML…', false);
    try {
      const html = await deckExporter.buildStandaloneHtml(projectForExport, { configOverrides: revealConfig });
      download(html, safeFilename(projectForExport.name || projectForExport.title || 'presentation') + '.html', 'text/html');
      setStatus('Standalone HTML exported', true);
    } catch (error) {
      console.error('standalone export failed', error);
      setStatus('Standalone export failed', false);
      dialogs.alert('Could not build the standalone HTML. The export needs access to the local vendor files.\n\n' + (error.message || error), { title: 'HTML export failed', kind: 'danger' });
    }
  }

  async function exportPresentationZip(project = state) {
    if (!deckPackage) {
      dialogs.alert('The presentation export module failed to load.', { title: 'Export unavailable', kind: 'danger' });
      return;
    }
    const projectForExport = projectForRuntimeExport(project);
    if (!projectForExport) return;

    setStatus('Building Revealation presentation…', false);
    try {
      let assets = Array.isArray(projectForExport.assets) ? projectForExport.assets : [];
      if (workspaceMode && workspaceStorage?.listFiles) {
        const files = (await workspaceStorage.listFiles()).filter(file => String(file?.path || '').startsWith('assets/'));
        assets = await Promise.all(files.map(async file => ({
          ...file,
          data: typeof workspaceStorage.readFile === 'function'
            ? await workspaceStorage.readFile(file.path)
            : await fetch(window.Revealation?.urls?.deployment?.(file.path) || file.path, { cache: 'no-store' }).then(response => {
              if (!response.ok) throw new Error(`Could not read workspace asset ${file.path}`);
              return response.blob();
            }),
          path: file.path,
        })));
      }
      const blob = await deckPackage.exportDeckPackage(projectForExport, assets);
      const baseName = safeFilename(projectForExport.name || projectForExport.title || 'presentation');
      download(blob, baseName + '.revealation', deckPackage.MIME);
      setStatus('Presentation exported', true);
    } catch (error) {
      console.error('Revealation export failed', error);
      setStatus('Presentation export failed', false);
      dialogs.alert('Could not export the presentation.\n\n' + (error.message || error), { title: 'Export failed', kind: 'danger' });
    }
  }

  async function exportProjectAsHtml(id) {
    const p = library.projects.find(x => x.id === id);
    if (!p) return;
    if (state.id === id) captureCurrentContent();
    await exportStandaloneHtml(p);
  }

  async function exportProjectAsZip(id) {
    const p = library.projects.find(x => x.id === id);
    if (!p) return;
    if (state.id === id) captureCurrentContent();
    await exportPresentationZip(p);
  }

  function extToMime(ext) {
    switch ((ext || '').toLowerCase()) {
      case 'jpg': case 'jpeg': return 'image/jpeg';
      case 'png': return 'image/png';
      case 'gif': return 'image/gif';
      case 'webp': return 'image/webp';
      case 'svg': return 'image/svg+xml';
      case 'mp4': return 'video/mp4';
      case 'webm': return 'video/webm';
      default: return 'application/octet-stream';
    }
  }

  // -------- PDF export (via reveal.js print-pdf mode) --------
  function exportProjectAsPdf(id) {
    const p = library.projects.find(x => x.id === id);
    if (!p) return;
    if (state.id === id) captureCurrentContent();

    const payload = {
      type: 'render-deck',
      version: REVEAL_VERSION,
      ...themePayloadBits(p),
      title: p.title || p.name || 'Presentation',
      sections: buildSections(p.slides, p),
      contentCss: deckContentCss(),
      backgroundResources: backgroundPayloadResources(p),
      config: { ...defaultRevealConfig(), ...(p.config || {}) },
    };
    if (!window.Revealation?.exporters?.pdf?.open) {
      dialogs.alert('The PDF export module failed to load.', { title: 'PDF export unavailable', kind: 'danger' });
      return;
    }
    window.Revealation.exporters.pdf.open(payload);
  }

  // -------- HTML <-> Markdown, losslessly --------
  // Plain turndown throws away anything markdown cannot express: the class on
  // a fragment, r-fit-text, r-stretch, whole tables, inline styles. That is
  // survivable for a one-way import but not for editing a deck through
  // markdown and writing it back. Two mechanisms close the gap:
  //
  //   1. Semantic blocks use readable `::: emphasis`, `::: muted`, and
  //      `::: callout` directives. Legacy `.element` comments remain readable.
  //   2. Anything with no markdown equivalent at all (tables, layout divs,
  //      inline styles, classed spans) is emitted as literal HTML, which
  //      markdown permits and both converters pass through untouched.
  const MD_MARK_OPEN = '\u2999EL:';
  const MD_MARK_CLOSE = '\u299A';
  const MD_MARK_RE = /\u2999EL:([^\u299A]*)\u299A/g;
  const MD_BLOCK_MARKABLE = new Set([
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LI', 'UL', 'OL',
    'BLOCKQUOTE', 'PRE', 'IMG', 'FIGURE',
  ]);
  const MD_KEEP_TAGS = new Set(['IFRAME', 'VIDEO', 'AUDIO', 'DIV', 'FIGURE', 'FORM', 'SVG', 'CANVAS']);
  const MD_INLINE_CARRIERS = new Set(['SPAN', 'A', 'SUP', 'SUB', 'MARK', 'CODE', 'EM', 'STRONG']);
  const MD_VOIDISH = new Set(['IMG', 'HR', 'BR']);

  // A table can be written as a pipe table only when it is a plain grid:
  // one header row, no spans, no block content or styling in the cells.
  // Anything else keeps its HTML, which is lossless if less pretty.
  function mdIsSimpleTable(t) {
    if (t.querySelector('table')) return false;
    const rows = Array.from(t.rows || []);
    if (rows.length < 1) return false;
    const grid = rows.map(r => Array.from(r.cells));
    const width = grid[0].length;
    if (!width || grid.some(r => r.length !== width)) return false;
    if (!grid[0].every(c => c.nodeName === 'TH')) return false;
    if (grid.slice(1).some(r => r.some(c => c.nodeName === 'TH'))) return false;
    const cells = Array.from(t.querySelectorAll('th, td'));
    if (cells.some(c => c.colSpan > 1 || c.rowSpan > 1)) return false;
    if (cells.some(c => c.getAttribute('style') || c.getAttribute('class'))) return false;
    if (t.getAttribute('style') || t.getAttribute('class')) return false;
    if (t.querySelector('th p, td p, th div, td div, th ul, td ul, th ol, td ol, th pre, td pre, th table, td table')) return false;
    return true;
  }

  // Revealation Markdown deliberately covers only structures that this
  // editor itself generates. Anything richer or unfamiliar falls through to
  // literal HTML, preserving the old lossless behavior.
  function srHasOnlyAttrs(node, allowed) {
    const ok = new Set(allowed.map(x => x.toLowerCase()));
    return Array.from(node.attributes || []).every(a => ok.has(a.name.toLowerCase()));
  }

  function srAuthoredWidth(node) {
    if (!node?.hasAttribute('style')) return '';
    const style = node.style;
    for (let i = 0; i < style.length; i++) {
      const prop = style.item(i);
      if (prop !== 'width' && prop !== 'height') return '';
    }
    if (style.height && style.height !== 'auto') return '';
    const m = String(style.width || '').trim().match(/^(\d+(?:\.\d+)?)%$/);
    if (!m) return '';
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0 || n > 100) return '';
    return String(Math.round(n * 10) / 10);
  }

  const SR_ALIGNMENTS = new Set(['left', 'center', 'right']);

  function srAlignmentFromClasses(node, baseClass = '') {
    if (!node?.classList) return null;
    const classes = Array.from(node.classList);
    const alignClasses = classes.filter(c => /^sr-align-(left|center|right)$/.test(c));
    if (alignClasses.length > 1) return null;
    const allowed = new Set(baseClass ? [baseClass] : []);
    alignClasses.forEach(c => allowed.add(c));
    if (classes.some(c => !allowed.has(c))) return null;
    return alignClasses.length ? alignClasses[0].slice('sr-align-'.length) : 'left';
  }

  // RV-COMPAT(columns-directive): REMOVE BEFORE PUBLIC RELEASE.
  function srColumnsSpec(node) {
    if (!node || node.nodeName !== 'DIV' || !node.classList.contains('sr-columns')) return null;
    const ratios = ['50-50', '60-40', '40-60'];
    const ratio = ratios.find(r => node.classList.contains(`sr-cols-${r}`));
    if (!ratio || node.getAttribute('style')) return null;
    const allowedClasses = new Set(['sr-columns', `sr-cols-${ratio}`]);
    if (Array.from(node.classList).some(c => !allowedClasses.has(c))) return null;
    if (!srHasOnlyAttrs(node, ['class'])) return null;
    const nodes = Array.from(node.children);
    if (nodes.length !== 2) return null;
    const cols = [];
    for (const col of nodes) {
      if (col.nodeName !== 'DIV' || !col.classList.contains('sr-col') || !srHasOnlyAttrs(col, ['class'])) return null;
      const align = srAlignmentFromClasses(col, 'sr-col');
      if (!align) return null;
      cols.push({ node: col, align });
    }
    return { ratio: ratio.replace('-', '/'), cols };
  }

  function srLayoutSpec(node) {
    return layoutBlocks?.fromCanonicalElement(node) || null;
  }

  function srAlignBlockSpec(node) {
    if (!node || node.nodeName !== 'DIV' || !srHasOnlyAttrs(node, ['class']) || node.getAttribute('style')) return null;
    // RV-COMPAT(align-shorthand): REMOVE BEFORE PUBLIC RELEASE.
    // Backwards compatibility with the first explicit-centering implementation.
    if (node.className === 'sr-center') return { align: 'center', html: node.innerHTML };
    const hasAlignClass = Array.from(node.classList).some(c => /^sr-align-(left|center|right)$/.test(c));
    if (!hasAlignClass) return null;
    const align = srAlignmentFromClasses(node);
    if (!align) return null;
    return { align, html: node.innerHTML };
  }

  function srSemanticBlockSpec(node) {
    if (!node || !MD_BLOCK_MARKABLE.has(node.nodeName) || !srHasOnlyAttrs(node, ['class'])) return null;
    const classes = Array.from(node.classList || []);
    const kinds = classes.map(className => SEMANTIC_BLOCK_CLASS_TO_KIND[className]).filter(Boolean);
    if (kinds.length !== 1 || classes.length !== 1) return null;
    return { kind: kinds[0], html: node.innerHTML };
  }

  function srFragmentSpec(node) {
    if (!node || node.nodeName !== 'DIV' || !node.classList.contains('sr-fragment')) return null;
    if (!srHasOnlyAttrs(node, ['class', 'data-effect'])) return null;
    const classes = Array.from(node.classList);
    if (!classes.includes('fragment') || classes.some(c => c !== 'sr-fragment' && c !== 'fragment')) return null;
    return { effect: node.getAttribute('data-effect') || '', html: node.innerHTML };
  }

  function srClassFragmentSpec(node) {
    if (!node?.classList?.contains('fragment') || !MD_BLOCK_MARKABLE.has(node.nodeName)) return null;
    if (!srHasOnlyAttrs(node, ['class'])) return null;
    const effect = FRAGMENT_TYPES.find(type => node.classList.contains(type)) || '';
    return { effect, html: node.outerHTML.replace(/^<[^>]+>|<\/[^>]+>$/g, '') };
  }

  function srAnimateSpec(node) {
    if (!node || node.nodeName !== 'DIV' || !node.classList.contains('sr-animate')) return null;
    if (!srHasOnlyAttrs(node, ['class', 'data-id'])) return null;
    const classes = Array.from(node.classList);
    if (classes.some(c => c !== 'sr-animate')) return null;
    const id = node.getAttribute('data-id') || '';
    return id ? { id, html: node.innerHTML } : null;
  }

  function srImageSpec(node) {
    if (!node || node.nodeName !== 'IMG') return null;
    if (!srHasOnlyAttrs(node, ['src', 'alt', 'title', 'style', 'class'])) return null;
    const src = node.getAttribute('src');
    if (!src) return null;
    const width = node.hasAttribute('style') ? srAuthoredWidth(node) : '';
    if (node.hasAttribute('style') && !width) return null;
    return {
      src,
      alt: node.getAttribute('alt') || '',
      title: node.getAttribute('title') || '',
      width,
    };
  }

  function srSizedImageSpec(node) {
    const image = srImageSpec(node);
    return image && image.width ? image : null;
  }

  function srCropOffsets(value) {
    const parts = String(value || '').trim().split(/\s+/);
    if (parts.length !== 4) return '';
    const values = parts.map(part => Number.parseFloat(part.replace(/%$/, '')));
    if (values.some(value => !Number.isFinite(value) || value < 0 || value > 95)) return '';
    if (values.every(value => value <= 0)) return '';
    return values.map(value => `${Math.round(value * 100) / 100}%`).join(' ');
  }

  function srCropWidth(node) {
    const m = String(node?.style?.width || '').trim().match(/^(\d+(?:\.\d+)?)%$/);
    if (!m) return '';
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 && n <= 100 ? String(Math.round(n * 10) / 10) : '';
  }

  function srCroppedImageSpec(node) {
    if (!node || node.nodeName !== 'DIV' || !node.classList.contains('sr-media-crop')) return null;
    if (!srHasOnlyAttrs(node, ['class', 'data-crop', 'data-crop-ratio', 'data-crop-base-width', 'style']) || node.classList.length !== 1) return null;
    const image = node.children.length === 1 ? srImageSpec(node.firstElementChild) : null;
    const crop = srCropOffsets(node.dataset.crop);
    if (!image || !crop || !srCropWidth(node) || node.style.height || node.style.objectFit) return null;
    const allowedStyles = new Set(['width', 'aspect-ratio', '--sr-crop-top', '--sr-crop-right', '--sr-crop-bottom', '--sr-crop-left', 'clip-path']);
    if (Array.from(node.style).some(prop => !allowedStyles.has(prop))) return null;
    return { ...image, width: srCropWidth(node), crop };
  }

  function srCaptionedMediaSpec(node) {
    if (!node || node.nodeName !== 'FIGURE' || !node.classList.contains('sr-media-caption')) return null;
    if (!srHasOnlyAttrs(node, ['class']) || node.classList.length !== 1) return null;
    const children = Array.from(node.children);
    if (children.length !== 2 || children[1].nodeName !== 'FIGCAPTION') return null;
    const captionNode = children[1];
    if (captionNode.attributes.length || captionNode.children.length || !captionNode.textContent.trim()) return null;
    let carrier = children[0];
    let media = carrier;
    if (carrier.nodeName === 'A') {
      if (!srHasOnlyAttrs(carrier, ['href', 'target', 'rel', 'class'])
        || !carrier.classList.contains('linked-image') || carrier.children.length !== 1) return null;
      media = carrier.firstElementChild;
      if (!media || media.nodeName !== 'IMG') return null;
    }
    const image = media.nodeName === 'IMG' ? srImageSpec(media) : srCroppedImageSpec(media);
    const video = media.nodeName === 'VIDEO' ? srVideoSpec(media) : null;
    if (!image && !video) return null;
    return { carrier, media, image, video, caption: captionNode.textContent.trim() };
  }

  function srVideoSpec(node) {
    if (!node || node.nodeName !== 'VIDEO' || node.children.length) return null;
    if (!srHasOnlyAttrs(node, [
      // RV-COMPAT(video-html-autoplay): raw `autoplay` is accepted only for old content.
      'src', 'style', 'controls', 'data-autoplay', 'autoplay', 'loop', 'muted',
      'playsinline', 'controlslist', 'disablepictureinpicture'
    ])) return null;
    const src = node.getAttribute('src');
    if (!src) return null;
    let width = '';
    if (node.hasAttribute('style')) {
      width = srAuthoredWidth(node);
      if (!width) return null;
    }
    return {
      src,
      width,
      controls: node.hasAttribute('controls'),
      // RV-COMPAT(video-html-autoplay): REMOVE BEFORE PUBLIC RELEASE.
      autoplay: node.hasAttribute('data-autoplay') || node.hasAttribute('autoplay'),
      loop: node.hasAttribute('loop'),
      muted: node.hasAttribute('muted'),
    };
  }

  function srAudioSpec(node) {
    if (!node || node.nodeName !== 'AUDIO' || node.children.length) return null;
    if (!srHasOnlyAttrs(node, ['src', 'controls'])) return null;
    const src = node.getAttribute('src');
    if (!src) return null;
    return { src, controls: node.hasAttribute('controls') };
  }

  function srInteractiveSpec(node) {
    return interactiveContent.fromCanonicalElement(node, srHasOnlyAttrs);
  }

  function srHtmlSpec(node) {
    return htmlContent?.fromCanonicalElement(node);
  }

  function markdownConversionError(node, reason = '') {
    const tag = String(node?.nodeName || 'node').toLowerCase();
    const sample = String(node?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 52);
    const detail = reason ? ` ${reason}` : '';
    const preview = sample ? ` Near: “${sample}${sample.length >= 52 ? '…' : ''}”` : '';
    const error = new Error(`Cannot convert <${tag}> to safe Revealation Markdown.${detail}${preview} Use an explicit ::: html block for intentional raw HTML.`);
    error.code = 'markdown-conversion';
    error.nodeName = tag;
    return error;
  }

  function assertSingleLayoutDom(root) {
    const layouts = Array.from(root.children || []).filter(el => el.classList?.contains('sr-layout'));
    if (layouts.length > 1) {
      const error = new Error('A slide may contain only one layout.');
      error.code = 'multiple-layouts';
      throw error;
    }
    if (layouts.length === 1) {
      const extra = Array.from(root.childNodes || []).some(node => {
        if (node === layouts[0]) return false;
        if (node.nodeType === Node.TEXT_NODE) return !!String(node.nodeValue || '').trim();
        return node.nodeType === Node.ELEMENT_NODE;
      });
      if (extra) {
        const error = new Error('A slide with a multi-block layout cannot contain content outside that layout.');
        error.code = 'layout-mixed-content';
        throw error;
      }
    }
  }

  function assertMarkdownConvertible(root) {
    const allowedAttrs = (node, names) => srHasOnlyAttrs(node, names);
    const visit = (node) => {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
      if (srHtmlSpec(node) != null) return; // Explicit escape hatch owns its subtree.

      const isLayout = !!srLayoutSpec(node);
      // RV-COMPAT(columns-directive): old columns DOM remains serializable during migration.
      const isColumns = !!srColumnsSpec(node);
      const isAlign = !!srAlignBlockSpec(node);
      const isFragment = !!srFragmentSpec(node);
      const isAnimate = !!srAnimateSpec(node);
      const isInteractive = !!srInteractiveSpec(node);
      const isCaptionedMedia = !!srCaptionedMediaSpec(node);
      const isVideo = !!srVideoSpec(node);
      const isAudio = !!srAudioSpec(node);
      const isSizedImage = !!srSizedImageSpec(node) || !!srCroppedImageSpec(node);
      const isMath = node.nodeName === 'SPAN' && node.classList.contains('sr-math');

      // A canonical interactive block owns its iframe. The iframe is an
      // implementation detail of the `::: interactive` content type, not a
      // standalone HTML node that the generic Markdown validator should
      // inspect. Without this early return, interface-inserted interactives
      // are correctly recognized at the wrapper and then rejected one level
      // later as an unsupported raw <iframe>.
      if (isInteractive) return;
      // A canonical media figure owns its media and caption; the children are
      // an implementation detail of the captioned-media representation.
      if (isCaptionedMedia || srCroppedImageSpec(node)) return;
      // KaTeX expands a math span into a subtree of implementation-specific
      // spans. The outer .sr-math element owns that subtree and is serialized
      // by the dedicated Turndown rule below; validating KaTeX's generated
      // children would incorrectly reject them as unsupported HTML.
      if (isMath) return;
      if (isFragment || isAnimate) return;

      const structuralDiv = node.nodeName === 'DIV' && (
        isLayout || isColumns || isAlign
        || node.classList.contains('sr-layout-slot')
        || node.classList.contains('sr-layout-content')
        // RV-COMPAT(columns-directive): REMOVE `.sr-col` BEFORE PUBLIC RELEASE.
        || node.classList.contains('sr-col')
      );

      // Layout structure is slide metadata and must be serialized by
      // slideContentToMarkdown(), never by the generic content converter.
      if (isLayout || isColumns || node.classList.contains('sr-layout-slot') || node.classList.contains('sr-layout-content') || node.classList.contains('sr-col')) {
        throw markdownConversionError(node, 'Layout structure is slide-level metadata, not inline Markdown content.');
      }

      if (node.nodeName === 'TABLE' && !mdIsSimpleTable(node)) {
        throw markdownConversionError(node, 'Complex tables are not represented by the Markdown writer.');
      }
      if (MD_KEEP_TAGS.has(node.nodeName) && !(structuralDiv || isAlign || isInteractive || isVideo || isAudio || isSizedImage)) {
        throw markdownConversionError(node);
      }
      if (node.getAttribute('style') && !(isSizedImage || isVideo || isInteractive || isLayout || structuralDiv)) {
        throw markdownConversionError(node, 'Unexpected inline style.');
      }

      // Canonical Markdown nodes have a deliberately small attribute surface.
      if (/^H[1-6]$/.test(node.nodeName) || ['P','LI','UL','OL','BLOCKQUOTE'].includes(node.nodeName)) {
        if (!allowedAttrs(node, ['class'])) throw markdownConversionError(node, 'Unexpected attribute.');
      } else if (node.nodeName === 'A') {
        if (!allowedAttrs(node, ['href', 'title'])) throw markdownConversionError(node, 'Links may only use href/title in Markdown mode.');
      } else if (node.nodeName === 'IMG') {
        const attrs = isSizedImage ? ['src','alt','title','style','class'] : ['src','alt','title','class'];
        if (!allowedAttrs(node, attrs)) throw markdownConversionError(node, 'Unexpected image attribute.');
      } else if (node.nodeName === 'PRE') {
        if (!allowedAttrs(node, ['class'])) throw markdownConversionError(node, 'Unexpected code-block attribute.');
      } else if (node.nodeName === 'CODE') {
        const inPre = node.parentElement?.nodeName === 'PRE';
        // Code blocks inserted by the code dialog carry `data-trim`, which
        // reveal.js uses to remove incidental indentation at render time.
        // It is a canonical editor-generated attribute, not unsafe arbitrary
        // HTML. Inline code must still remain attribute-free.
        if (!allowedAttrs(node, inPre ? ['class', 'data-trim'] : [])) {
          throw markdownConversionError(node, 'Unexpected code attribute.');
        }
        if (inPre && node.className && !/^language-[^\s]+$/.test(node.className)) throw markdownConversionError(node, 'Unsupported code language class.');
      } else if (['STRONG','EM','BR','HR'].includes(node.nodeName)) {
        if (node.attributes.length) throw markdownConversionError(node, 'Unexpected attribute.');
      } else if (node.nodeName === 'SPAN') {
        if (!isMath) throw markdownConversionError(node, 'Plain/attributed span has no canonical Markdown representation.');
      } else if (['SUP','SUB','MARK','FORM','SVG','CANVAS','IFRAME'].includes(node.nodeName)) {
        throw markdownConversionError(node);
      }

      Array.from(node.children || []).forEach(visit);
    };
    Array.from(root.children || []).forEach(visit);
  }

  function srMdEscapeAlt(text) {
    return String(text || '').replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
  }

  function srMdEscapeTitle(text) {
    return String(text || '').replace(/[\\"\r\n]/g, c => c === '\\' ? '\\\\' : c === '"' ? '\\"' : ' ');
  }

  function srMdDestination(src) {
    const s = String(src || '');
    return /[\s()<>]/.test(s)
      ? `<${s.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/ /g, '%20')}>`
      : s;
  }

  function mdKeepRaw(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node.nodeName === 'TABLE') return !mdIsSimpleTable(node);
    if (MD_KEEP_TAGS.has(node.nodeName)) return true;
    if (node.getAttribute('style')) return true;
    if (node.nodeName === 'CODE' && node.parentElement?.nodeName === 'PRE') return false;
    if (node.classList?.contains('sr-math')) return false;
    if (MD_INLINE_CARRIERS.has(node.nodeName) && node.getAttribute('class')) return true;
    return false;
  }

  function makeMarkdownTurndown() {
    const td = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      // Use *** for <hr> so it can't be confused with reveal's `---` slide
      // separator.
      hr: '***',
      emDelimiter: '*',
    });
    // Unsupported DOM is rejected by assertMarkdownConvertible() before Turndown.
    // No generic raw-HTML fallback exists.

    // Turndown ships no table rule, so a table typed as markdown would come
    // back as HTML on the next round trip. Emit a pipe table for plain grids.
    const inlineTd = new TurndownService({ emDelimiter: '*', bulletListMarker: '-' });
    const cellText = (cell) => inlineTd.turndown(cell.innerHTML || '')
      .replace(/\s*\n\s*/g, ' ')
      .replace(/\|/g, '\\|')
      .trim();
    const ALIGN_BAR = { left: ':---', right: '---:', center: ':---:' };
    td.addRule('revealTable', {
      filter: (node) => node.nodeName === 'TABLE' && mdIsSimpleTable(node),
      replacement: (content, node) => {
        const rows = Array.from(node.rows);
        const head = Array.from(rows[0].cells);
        const lines = [
          '| ' + head.map(cellText).join(' | ') + ' |',
          '| ' + head.map(c => ALIGN_BAR[(c.getAttribute('align') || '').toLowerCase()] || '---').join(' | ') + ' |',
        ];
        rows.slice(1).forEach(r => {
          lines.push('| ' + Array.from(r.cells).map(cellText).join(' | ') + ' |');
        });
        return '\n\n' + lines.join('\n') + '\n\n';
      },
    });
    // Keep reveal/highlight language information in fenced code blocks.
    td.addRule('revealationCodeBlock', {
      filter: (node) => node.nodeName === 'PRE' && node.querySelector(':scope > code'),
      replacement: (content, node) => {
        const code = node.querySelector(':scope > code');
        const cls = code?.getAttribute('class') || '';
        const m = cls.match(/(?:^|\s)language-([^\s]+)/);
        const lang = m ? m[1] : '';
        const text = (code?.textContent || '').replace(/\n$/, '');
        return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
      },
    });
    td.addRule('revealationSemanticBlock', {
      filter: (node) => !!srSemanticBlockSpec(node),
      replacement: (content, node) => {
        const spec = srSemanticBlockSpec(node);
        const inner = htmlToMarkdown(spec.html, makeMarkdownTurndown()).trim();
        return `\n\n::: ${spec.kind}\n${inner}\n:::\n\n`;
      },
    });
    td.addRule('revealationMath', {
      filter: (node) => node.nodeName === 'SPAN' && node.classList.contains('sr-math'),
      replacement: (content, node) => {
        const tex = node.getAttribute('data-tex') || '';
        return node.getAttribute('data-display') === '1'
          ? `\n\n\\[${tex}\\]\n\n`
          : `\\(${tex}\\)`;
      },
    });
    td.addRule('revealationCaptionedMedia', {
      filter: (node) => !!srCaptionedMediaSpec(node),
      replacement: (content, node) => {
        const s = srCaptionedMediaSpec(node);
        if (s.image) {
          const title = ` "${srMdEscapeTitle(s.caption)}"`;
          const width = s.image.width
            ? `{width=${s.image.width}%${s.image.crop ? ` crop=${s.image.crop}` : ''}}`
            : '';
          return `![${srMdEscapeAlt(s.image.alt)}](${srMdDestination(s.image.src)}${title})${width}`;
        }
        const v = s.video;
        const lines = ['::: video', `src: ${v.src}`];
        if (v.width) lines.push(`width: ${v.width}%`);
        lines.push(`caption: ${s.caption.replace(/[\r\n]/g, ' ')}`);
        lines.push(`controls: ${v.controls ? 'true' : 'false'}`);
        lines.push(`autoplay: ${v.autoplay ? 'true' : 'false'}`);
        lines.push(`loop: ${v.loop ? 'true' : 'false'}`);
        lines.push(`muted: ${v.muted ? 'true' : 'false'}`, ':::');
        return '\n\n' + lines.join('\n') + '\n\n';
      },
    });
    td.addRule('revealationSizedImage', {
      filter: (node) => !!srSizedImageSpec(node),
      replacement: (content, node) => {
        const s = srSizedImageSpec(node);
        const title = s.title ? ` \"${s.title.replace(/\\/g, '\\\\').replace(/\"/g, '\\\"')}\"` : '';
        return `![${srMdEscapeAlt(s.alt)}](${srMdDestination(s.src)}${title}){width=${s.width}%}`;
      },
    });
    td.addRule('revealationCroppedImage', {
      filter: (node) => !!srCroppedImageSpec(node),
      replacement: (content, node) => {
        const s = srCroppedImageSpec(node);
        const title = s.title ? ` \"${srMdEscapeTitle(s.title)}\"` : '';
        return `![${srMdEscapeAlt(s.alt)}](${srMdDestination(s.src)}${title}){width=${s.width || 100}% crop=${s.crop}}`;
      },
    });
    td.addRule('revealationVideo', {
      filter: (node) => !!srVideoSpec(node),
      replacement: (content, node) => {
        const s = srVideoSpec(node);
        const lines = ['::: video', `src: ${s.src}`];
        if (s.width) lines.push(`width: ${s.width}%`);
        if (s.caption) lines.push(`caption: ${s.caption.replace(/[\r\n]/g, ' ')}`);
        lines.push(`controls: ${s.controls ? 'true' : 'false'}`);
        lines.push(`autoplay: ${s.autoplay ? 'true' : 'false'}`);
        lines.push(`loop: ${s.loop ? 'true' : 'false'}`);
        lines.push(`muted: ${s.muted ? 'true' : 'false'}`, ':::');
        return '\n\n' + lines.join('\n') + '\n\n';
      },
    });
    td.addRule('revealationAudio', {
      filter: (node) => !!srAudioSpec(node),
      replacement: (content, node) => {
        const s = srAudioSpec(node);
        return `\n\n::: audio\nsrc: ${s.src}\ncontrols: ${s.controls ? 'true' : 'false'}\n:::\n\n`;
      },
    });
    td.addRule('revealationHtmlBlock', {
      filter: (node) => srHtmlSpec(node) != null,
      replacement: (content, node) => `\n\n${htmlContent.toMarkdown(srHtmlSpec(node))}\n\n`,
    });
    td.addRule('revealationInteractive', {
      filter: (node) => !!srInteractiveSpec(node),
      replacement: (content, node) => {
        const s = srInteractiveSpec(node);
        return '\n\n' + interactiveMarkdownBlock(s) + '\n\n';
      },
    });
    td.addRule('revealationMediaTrailingBreak', {
      filter: (node) => node.nodeName === 'BR'
        && (!!srVideoSpec(node.previousElementSibling)
          || !!srCaptionedMediaSpec(node.previousElementSibling)
          || !!srAudioSpec(node.previousElementSibling)),
      replacement: () => '',
    });
    td.addRule('revealationAlign', {
      filter: (node) => !!srAlignBlockSpec(node),
      replacement: (content, node) => {
        const spec = srAlignBlockSpec(node);
        const inner = htmlToMarkdown(node.innerHTML, makeMarkdownTurndown()).trim();
        return `\n\n::: align ${spec.align}\n\n${inner}\n\n:::\n\n`;
      },
    });
    td.addRule('revealationFragment', {
      filter: (node) => !!srFragmentSpec(node) || !!srClassFragmentSpec(node),
      replacement: (content, node) => {
        const spec = srFragmentSpec(node) || srClassFragmentSpec(node);
        const inner = srFragmentSpec(node)
          ? htmlToMarkdown(spec.html, makeMarkdownTurndown()).trim()
          : content.trim();
        return `\n\n::: fragment${spec.effect ? ` effect=${spec.effect}` : ''}\n${inner}\n:::\n\n`;
      },
    });
    td.addRule('revealationAnimate', {
      filter: (node) => !!srAnimateSpec(node),
      replacement: (content, node) => {
        const spec = srAnimateSpec(node);
        const inner = htmlToMarkdown(spec.html, makeMarkdownTurndown()).trim();
        return `\n\n::: animate id=${spec.id}\n${inner}\n:::\n\n`;
      },
    });
    return td;
  }

  function mdKeptRawAncestor(el, root) {
    for (let n = el.parentNode; n && n !== root; n = n.parentNode) {
      // Only an explicit raw-HTML block owns its subtree now. Layout and
      // alignment wrappers still allow their inner Markdown classes to be
      // serialized normally.
      if (srHtmlSpec(n) != null) return true;
    }
    return false;
  }

  // Stamp a marker into a detached copy of the slide so legacy classes survive
  // turndown and can be re-emitted as an .element comment afterwards. Semantic
  // block styles have proper directive syntax and are handled by a Turndown
  // rule instead.
  function mdStampClasses(root) {
    Array.from(root.querySelectorAll('*')).forEach(el => {
      const cls = el.getAttribute('class');
      if (el.matches && (el.matches('pre.sr-code') || el.matches('pre.sr-code code'))) return;
      if (!cls || !MD_BLOCK_MARKABLE.has(el.nodeName)) return;
      if (srSemanticBlockSpec(el)) return;
      if (el.nodeName === 'BLOCKQUOTE' && el.classList.contains('rv-block-quote')) {
        el.classList.remove('rv-block-quote');
        return;
      }
      if (el.classList.contains('fragment')) return;
      if (mdKeepRaw(el) || mdKeptRawAncestor(el, root)) return;
      const marker = document.createTextNode(' ' + MD_MARK_OPEN + cls + MD_MARK_CLOSE);
      if (MD_VOIDISH.has(el.nodeName)) el.parentNode.insertBefore(marker, el.nextSibling);
      else el.appendChild(marker);
      el.removeAttribute('class');
    });
  }

  function htmlToMarkdown(html, td) {
    const holder = document.createElement('div');
    holder.innerHTML = html || '';
    // Also canonicalize old/browser-generated editable wrappers here so
    // non-current slides and imported decks receive the same safe round-trip.
    contentNormalization?.normalizeForSerialization(holder, { includeRoot: false });
    assertSingleLayoutDom(holder);
    assertMarkdownConvertible(holder);
    mdStampClasses(holder);
    return td.turndown(holder.innerHTML)
      .replace(MD_MARK_RE, (_, cls) => `<!-- .element: class="${cls}" -->`);
  }

  const srFenceMarker = (line) => markdownDirectives.fenceMarker(line);
  const srNormalizeDirectiveLines = (md) => markdownDirectives.normalizeLines(md);
  const srFindDirectiveEnd = (lines, start, limit = lines.length) => markdownDirectives.findEnd(lines, start, limit);
  const srDirectiveFields = (lines) => markdownDirectives.fields(lines);
  const srParseBool = (value, fallback = false) => markdownDirectives.parseBool(value, fallback);
  const srParseWidth = (value) => markdownDirectives.parseWidth(value);

  function srVideoDirectiveHtml(lines) {
    const f = srDirectiveFields(lines);
    if (!f || !f.src) return null;
    if (Object.keys(f).some(k => !['src', 'width', 'caption', 'controls', 'autoplay', 'loop', 'muted'].includes(k))) return null;
    const width = f.width ? srParseWidth(f.width) : '';
    if (width === null) return null;
    const controls = srParseBool(f.controls, true);
    const autoplay = srParseBool(f.autoplay, false);
    const loop = srParseBool(f.loop, false);
    const muted = srParseBool(f.muted, false);
    if ([controls, autoplay, loop, muted].some(v => v === null)) return null;
    const attrs = [`src="${escapeAttr(f.src)}"`];
    if (width) attrs.push(`style="width: ${width}%; height: auto;"`);
    if (controls) attrs.push('controls');
    if (autoplay) attrs.push('data-autoplay');
    if (loop) attrs.push('loop');
    if (muted) attrs.push('muted');
    attrs.push('playsinline', 'controlsList="nofullscreen nodownload noremoteplayback noplaybackrate"', 'disablePictureInPicture');
    const video = `<video ${attrs.join(' ')}></video>`;
    const caption = String(f.caption || '').trim();
    return caption
      ? `<figure class="sr-media-caption">${video}<figcaption>${escapeHtml(caption)}</figcaption></figure>`
      : video;
  }

  function srAudioDirectiveHtml(lines) {
    const f = srDirectiveFields(lines);
    if (!f || !f.src) return null;
    if (Object.keys(f).some(k => !['src', 'controls'].includes(k))) return null;
    const controls = srParseBool(f.controls, true);
    if (controls === null) return null;
    return `<audio src="${escapeAttr(f.src)}"${controls ? ' controls' : ''}></audio>`;
  }

  function srInteractiveDirectiveHtml(lines) {
    const fields = srDirectiveFields(lines);
    const spec = interactiveContent.fromDirectiveFields(fields, {
      parseBool: srParseBool,
      parseWidth: srParseWidth,
    });
    return spec ? interactiveContent.toHtml(spec) : null;
  }

  function srExpandSizedImagesInLine(line) {
    // Recognize exactly the compact image-attribute form emitted by our
    // serializer, but allow it inline as well as on a line by itself.
    const re = /!\[((?:\\.|[^\]])*)\]\((<[^>]*>|[^\s)]+)(?:\s+"((?:\\.|[^"])*)")?\)\{width=(\d+(?:\.\d+)?)%(?:\s+crop=((?:\d+(?:\.\d+)?%\s*){4}))?\}/g;
    return String(line).replace(re, (whole, rawAlt, rawSrc, rawTitle, rawWidth, rawCrop) => {
      const width = srParseWidth(`${rawWidth}%`);
      if (width === null) return whole;
      const alt = rawAlt.replace(/\\\]/g, ']').replace(/\\\\/g, '\\');
      let src = rawSrc;
      if (src.startsWith('<') && src.endsWith('>')) src = src.slice(1, -1);
      const title = (rawTitle || '').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      const image = `<img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"`
        + (title ? ` title="${escapeAttr(title)}"` : '')
        + (rawCrop ? '' : ` style="width: ${width}%; height: auto;"`) + '>';
      if (rawCrop) {
        const crop = srCropOffsets(rawCrop);
        if (!crop) return whole;
        const cropped = `<div class="sr-media-crop" data-crop="${crop}" style="width: ${width}%; clip-path: inset(${crop});">${image.replace(/ title="[^"]*"/, '')}</div>`;
        return title
          ? `<figure class="sr-media-caption">${cropped}<figcaption>${escapeHtml(title)}</figcaption></figure>`
          : cropped;
      }
      return title
        ? `<figure class="sr-media-caption">${image.replace(/ title="[^"]*"/, '')}<figcaption>${escapeHtml(title)}</figcaption></figure>`
        : image;
    });
  }

  function materializeImageCaptions(holder) {
    holder.querySelectorAll('img[title]').forEach(img => {
      const caption = String(img.getAttribute('title') || '').trim();
      if (!caption || img.closest('figure.sr-media-caption')) return;
      img.removeAttribute('title');
      const figure = document.createElement('figure');
      figure.className = 'sr-media-caption';
      const figcaption = document.createElement('figcaption');
      figcaption.textContent = caption;
      const carrier = img.closest('a.linked-image') || img;
      carrier.replaceWith(figure);
      figure.append(carrier, figcaption);
    });
  }

  function srColumnsDirectiveSpec(lines, start, end, ratio) {
    let pos = start + 1;
    const skipBlank = () => { while (pos < end && !lines[pos].trim()) pos++; };
    const cols = [];
    skipBlank();
    for (let n = 0; n < 2; n++) {
      if (pos >= end) return null;
      const head = lines[pos].match(/^\s*:::\s+column(?:\s+(left|center|right))?\s*$/i);
      if (!head) return null;
      const align = (head[1] || 'left').toLowerCase();
      const close = srFindDirectiveEnd(lines, pos, end + 1);
      if (close < 0 || close > end) return null;
      cols.push({ raw: lines.slice(pos + 1, close).join('\n'), align });
      pos = close + 1;
      skipBlank();
    }
    if (pos !== end) return null;
    return { ratio, cols };
  }

  function implicitRawHtmlDiagnostics(md) {
    const lines = String(md || '').split(/\r?\n/);
    const diagnostics = [];
    let fence = '';
    let htmlDepth = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const fm = srFenceMarker(line);
      if (fence) {
        if (fm && fm[0] === fence[0] && fm.length >= fence.length) fence = '';
        continue;
      }
      if (fm) { fence = fm; continue; }
      if (/^\s*:::\s+html\s*$/i.test(line)) { htmlDepth += 1; continue; }
      if (htmlDepth && /^\s*:::\s*$/.test(line)) { htmlDepth -= 1; continue; }
      if (htmlDepth) continue;
      if (/<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s+[^>]*|\s*\/?)>/.test(line)) {
        diagnostics.push({
          line: i + 1,
          code: 'implicit-raw-html',
          severity: 'error',
          message: 'Raw HTML is only allowed inside a `::: html` block.',
        });
      }
    }
    return diagnostics;
  }

  function assertNoImplicitRawHtml(md) {
    const diagnostics = implicitRawHtmlDiagnostics(md);
    if (!diagnostics.length) return;
    const first = diagnostics[0];
    const error = new Error(`Line ${first.line}: ${first.message}`);
    error.code = first.code;
    error.line = first.line;
    error.diagnostics = diagnostics;
    throw error;
  }

  function expandSmallRevealMarkdown(md) {
    const lines = srNormalizeDirectiveLines(md);
    const out = [];
    const columns = [];
    const aligns = [];
    const htmlBlocks = [];
    const fragments = [];
    const animations = [];
    const semanticBlocks = [];
    let fence = '';
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fm = srFenceMarker(line);
      if (fence) {
        out.push(line);
        if (fm && fm[0] === fence[0] && fm.length >= fence.length) fence = '';
        continue;
      }
      if (fm) {
        fence = fm;
        out.push(line);
        continue;
      }

      if (/^\s*:::\s+html\s*$/i.test(line)) {
        const end = srFindDirectiveEnd(lines, i);
        if (end > i) {
          const source = lines.slice(i + 1, end).join('\n');
          const token = `SR-HTML-${htmlBlocks.length}-${Math.random().toString(36).slice(2, 10)}`;
          htmlBlocks.push({ token, source });
          out.push('', token, '');
          i = end;
          continue;
        }
      }

      const semanticMatch = line.match(/^\s*:::\s+(emphasis|muted|callout)\s*$/i);
      if (semanticMatch) {
        const end = srFindDirectiveEnd(lines, i);
        if (end > i) {
          const token = `SR-SEMANTIC-${semanticBlocks.length}-${Math.random().toString(36).slice(2, 10)}`;
          semanticBlocks.push({ token, raw: lines.slice(i + 1, end).join('\n'), kind: semanticMatch[1].toLowerCase() });
          out.push('', token, '');
          i = end;
          continue;
        }
      }

      const cm = line.match(/^\s*:::\s+columns\s+(50\/50|60\/40|40\/60)\s*$/i);
      if (cm) {
        const end = srFindDirectiveEnd(lines, i);
        if (end > i) {
          const spec = srColumnsDirectiveSpec(lines, i, end, cm[1]);
          if (spec) {
            // A placeholder prevents the outer markdown/math pass from
            // touching already-rendered content in the columns. Each column
            // is rendered recursively after marked has parsed the outer slide.
            const token = `SR-COLUMNS-${columns.length}-${Math.random().toString(36).slice(2, 10)}`;
            columns.push({ token, ...spec });
            out.push('', token, '');
            i = end;
            continue;
          }
        }
      }

      const fragMatch = line.match(/^\s*:::\s+fragment(?:\s+effect=([a-z][a-z0-9-]*))?\s*$/i);
      if (fragMatch) {
        const end = srFindDirectiveEnd(lines, i);
        if (end > i) {
          const token = `SR-FRAGMENT-${fragments.length}-${Math.random().toString(36).slice(2, 10)}`;
          fragments.push({ token, raw: lines.slice(i + 1, end).join('\n'), effect: (fragMatch[1] || '').toLowerCase() });
          out.push('', token, '');
          i = end;
          continue;
        }
      }

      const animateMatch = line.match(/^\s*:::\s+animate\s+id=([a-z][a-z0-9_-]*)\s*$/i);
      if (animateMatch) {
        const end = srFindDirectiveEnd(lines, i);
        if (end > i) {
          const token = `SR-ANIMATE-${animations.length}-${Math.random().toString(36).slice(2, 10)}`;
          animations.push({ token, raw: lines.slice(i + 1, end).join('\n'), id: animateMatch[1] });
          out.push('', token, '');
          i = end;
          continue;
        }
      }

      // RV-COMPAT(align-shorthand): REMOVE BEFORE PUBLIC RELEASE.
      // Generic alignment blocks. `::: center`, `::: right` and `::: left`
      // remain accepted as concise/backwards-compatible aliases.
      const alignMatch = line.match(/^\s*:::\s+(?:align\s+)?(left|center|right)\s*$/i);
      if (alignMatch) {
        const end = srFindDirectiveEnd(lines, i);
        if (end > i) {
          const raw = lines.slice(i + 1, end).join('\n');
          const align = alignMatch[1].toLowerCase();
          const token = `SR-ALIGN-${aligns.length}-${Math.random().toString(36).slice(2, 10)}`;
          aligns.push({ token, raw, align });
          out.push('', token, '');
          i = end;
          continue;
        }
      }

      // RV-COMPAT(interactive-demo): remove `demo` alternative before public release.
      const dm = line.match(/^\s*:::\s+(video|audio|interactive|demo)\s*$/i);
      if (dm) {
        const end = srFindDirectiveEnd(lines, i);
        if (end > i) {
          const body = lines.slice(i + 1, end);
          const rawKind = dm[1].toLowerCase();
          const kind = rawKind === 'demo' ? 'interactive' : rawKind;
          const html = kind === 'video' ? srVideoDirectiveHtml(body)
            : kind === 'audio' ? srAudioDirectiveHtml(body)
            : srInteractiveDirectiveHtml(body);
          if (html) {
            out.push('', html, '');
            i = end;
            continue;
          }
        }
      }

      out.push(srExpandSizedImagesInLine(line));
    }
    return { text: out.join('\n'), columns, aligns, htmlBlocks, fragments, animations, semanticBlocks };
  }

  // Parse markdown and fold any `<!-- .element: -->` comments back onto the
  // block they describe.
  function markdownMathToHtml(md) {
    // Protect fenced code first so TeX delimiters shown in source examples
    // are not turned into equations.
    const fences = [];
    let text = String(md || '').replace(/(^|\n)(```|~~~)[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g, (m) => {
      const token = `\uE000FENCE${fences.length}\uE001`;
      fences.push(m);
      return token;
    });
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, tex) => mathSpanHtml(tex.trim(), true));
    // Inline math can legitimately contain source newlines. This is especially
    // common for environments such as cases/array when equations are entered
    // through the dialog. The previous [^\n]* matcher failed to recognize the
    // canonical \( ... \) form after a slide round trip; marked then treated
    // the TeX backslashes as Markdown escapes, turning \\ row breaks into \ and
    // stripping the delimiter slashes. Protect the complete math payload before
    // marked sees it, just like display math above.
    text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_, tex) => mathSpanHtml(tex.trim(), false));
    fences.forEach((f, i) => { text = text.replace(`\uE000FENCE${i}\uE001`, f); });
    return text;
  }

  // RV-COMPAT(serialized-math-span): REMOVE BEFORE PUBLIC RELEASE.
  // Older Markdown saves could contain the rendered math span itself instead
  // of LaTeX delimiters. Recover that canonical span before the raw-HTML
  // guard runs, so those documents can make one more round trip through the
  // editor and be rewritten in normal Markdown form.
  function markdownSerializedMathToLatex(md) {
    return String(md || '').replace(
      /<span\b(?=[^>]*\bclass=(['"])[^>]*\bsr-math\b[^>]*\1)(?=[^>]*\bdata-display=(['"])([01])\2)(?=[^>]*\bdata-tex=(['"])(.*?)\4)[^>]*>[\s\S]*?<\/span>/gi,
      (full, _classQuote, _displayQuote, display, _texQuote, tex) => {
        const textarea = document.createElement('textarea');
        textarea.innerHTML = tex;
        const value = textarea.value;
        return display === '1' ? `\\[${value}\\]` : `\\(${value}\\)`;
      },
    );
  }

  function markdownToHtml(md) {
    const normalizedMarkdown = markdownSerializedMathToLatex(md || '');
    assertNoImplicitRawHtml(normalizedMarkdown);
    const holder = document.createElement('div');
    const expanded = expandSmallRevealMarkdown(normalizedMarkdown);
    holder.innerHTML = marked.parse(markdownMathToHtml(expanded.text));
    materializeImageCaptions(holder);
    expanded.htmlBlocks.forEach(spec => {
      const host = Array.from(holder.querySelectorAll('p')).find(
        p => p.textContent.trim() === spec.token && p.children.length === 0);
      if (!host) return;
      const wrap = htmlContent?.createElement(spec.source);
      if (wrap) host.replaceWith(wrap);
    });
    expanded.semanticBlocks.forEach(spec => {
      const host = Array.from(holder.querySelectorAll('p')).find(
        p => p.textContent.trim() === spec.token && p.children.length === 0);
      if (!host) return;
      const content = document.createElement('div');
      content.innerHTML = markdownToHtml(spec.raw.trim());
      content.querySelectorAll(':scope > *').forEach(node => {
        if (MD_BLOCK_MARKABLE.has(node.nodeName)) node.classList.add(`rv-block-${spec.kind}`);
      });
      host.replaceWith(...Array.from(content.childNodes));
    });
    expanded.columns.forEach(spec => {
      const host = Array.from(holder.querySelectorAll('p')).find(
        p => p.textContent.trim() === spec.token && p.children.length === 0);
      if (!host) return;
      const layoutId = spec.ratio === '60/40' ? 'two-columns-60-40'
        : spec.ratio === '40/60' ? 'two-columns-40-60' : 'two-columns';
      const wrap = layoutBlocks?.createElement({
        id: layoutId,
        definition: layoutRegistry?.get(layoutId),
        blocks: spec.cols,
      }, raw => markdownToHtml(raw));
      if (wrap) host.replaceWith(wrap);
    });
    expanded.aligns.forEach(spec => {
      const host = Array.from(holder.querySelectorAll('p')).find(
        p => p.textContent.trim() === spec.token && p.children.length === 0);
      if (!host) return;
      const wrap = document.createElement('div');
      wrap.className = `sr-align-${spec.align}`;
      wrap.innerHTML = markdownToHtml(spec.raw.trim());
      host.replaceWith(wrap);
    });
    expanded.fragments.forEach(spec => {
      const host = Array.from(holder.querySelectorAll('p')).find(
        p => p.textContent.trim() === spec.token && p.children.length === 0);
      if (!host) return;
      const wrap = document.createElement('div');
      wrap.className = 'sr-fragment fragment';
      if (spec.effect) wrap.setAttribute('data-effect', spec.effect);
      wrap.innerHTML = markdownToHtml(spec.raw.trim());
      host.replaceWith(wrap);
    });
    expanded.animations.forEach(spec => {
      const host = Array.from(holder.querySelectorAll('p')).find(
        p => p.textContent.trim() === spec.token && p.children.length === 0);
      if (!host) return;
      const wrap = document.createElement('div');
      wrap.className = 'sr-animate';
      wrap.setAttribute('data-id', spec.id);
      wrap.innerHTML = markdownToHtml(spec.raw.trim());
      host.replaceWith(wrap);
    });
    const walker = document.createTreeWalker(holder, NodeFilter.SHOW_COMMENT);
    const comments = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    comments.forEach(c => {
      const m = c.nodeValue.match(/^\s*\.element:\s*([^]*?)\s*$/);
      if (!m) return;
      const attrs = {};
      m[1].replace(/([\w-]+)\s*=\s*"([^"]*)"/g, (_, k, v) => { attrs[k] = v; return ''; });
      const host = c.parentElement;
      let target = c.previousElementSibling;
      // A comment that landed alone in its own <p> describes whatever block
      // came before that <p>.
      if (!target && host && host !== holder && !host.textContent.trim()) {
        target = host.previousElementSibling;
        c.remove();
        if (!host.textContent.trim() && !host.children.length) host.remove();
      } else {
        if (!target && host && host !== holder) target = host;
        c.remove();
      }
      if (target && attrs.class) {
        target.setAttribute('class', attrs.class);
        // The marker contributed a space before the comment; drop the
        // trailing whitespace it leaves behind in the block's text.
        const last = target.lastChild;
        if (last && last.nodeType === 3) last.nodeValue = last.nodeValue.replace(/\s+$/, '');
      }
    });
    // marked wraps a lone image in a paragraph; reveal's r-stretch expects the
    // image itself, so unwrap paragraphs holding nothing else.
    Array.from(holder.querySelectorAll('p')).forEach(p => {
      const kids = Array.from(p.childNodes).filter(n => n.nodeType !== 3 || n.nodeValue.trim());
      if (kids.length === 1 && (kids[0].nodeName === 'IMG' || kids[0].nodeName === 'FIGURE')) p.replaceWith(kids[0]);
    });
    holder.querySelectorAll('pre > code').forEach(code => code.parentElement?.classList.add('sr-code'));
    return holder.innerHTML;
  }

  function slideLayoutFromContent(slide) {
    return normalizeSlideLayout(slide);
  }

  function slideContentToMarkdown(slide, td) {
    const layoutId = slideLayoutFromContent(slide);
    if (layoutId === 'single') return htmlToMarkdown(slide.content || '', td).trim();

    const def = layoutRegistry?.get(layoutId);
    if (!def) throw new Error(`Unknown slide layout "${layoutId}".`);

    // RV-COMPAT(columns-directive): the cache fallback is migration-only.
    // The positional block model is authoritative. Canonical DOM is a cache
    // for WYSIWYG/preview and is consulted only once for legacy migration.
    if (!hasValidSlideBlocks(slide, layoutId)) {
      const extracted = layoutBlocksFromContent(slide.content || '', layoutId);
      if (extracted) slide.blocks = extracted.blocks;
    }
    if (!hasValidSlideBlocks(slide, layoutId)) {
      throw new Error(`Slide layout "${layoutId}" has no valid positional block model.`);
    }

    return layoutBlocks.toMarkdownBlocks({
      id: layoutId,
      definition: def,
      blocks: slide.blocks,
    }, block => htmlToMarkdown(block.html || '', makeMarkdownTurndown()).trim());
  }

  function projectToMarkdown(p) {
    const td = makeMarkdownTurndown();
    const blocks = [];
    p.slides.forEach((s, i) => {
      const layoutId = slideLayoutFromContent(s);
      // A leading separator is only needed when the first slide has metadata.
      // Later slides always need a separator because it also defines slide vs subslide.
      if (i > 0 || layoutId !== 'single' || Object.keys(slideMetadata(s)).length) {
        blocks.push(markdownDeck.formatSeparator({
          subslide: i > 0 && !!s.vertical,
          layout: layoutId,
          metadata: slideMetadata(s),
        }));
      }
      try {
        blocks.push(slideToMarkdown(s, td));
      } catch (error) {
        const label = slideLabel(s, p.slides.indexOf(s));
        const title = (label && (label.text || label)) ? ` (${label.text || label})` : '';
        const message = error?.message || String(error);
        throw new Error(`Slide ${i + 1}${title}: ${message}`);
      }
    });
    return blocks.join('\n\n') + '\n';
  }

  function slideToMarkdown(s, td) {
    const parts = [];
    const body = slideContentToMarkdown(s, td);
    if (body) parts.push(body);

    const notes = notesSerialization.format(s.notes);
    if (notes) parts.push(notes);

    return parts.join('\n\n');
  }

  function download(content, filename, type) {
    const blob = (content instanceof Blob) ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // -------- Project library ops --------
  function switchProject(id) {
    if (!id || id === state.id) return;
    const p = library.projects.find(x => x.id === id);
    if (!p) return;
    captureCurrentContent();
    markDirty(state.id);          // flush whatever was edited in the outgoing project
    state = p;
    library.currentProjectId = id;
    metaDirty = true;
    clearHistory();
    renderAll();
    flushDirty();
  }

  function createProject(name) {
    captureCurrentContent();
    if (state) markDirty(state.id);
    const p = blankProject(name);
    library.projects.push(p);
    state = p;
    library.currentProjectId = p.id;
    markEdited(p.id);
    metaDirty = true;
    clearHistory();
    renderAll();
    flushDirty();
    renderProjectsList();
  }

  function newProject() {
    createProject();
    closeProjectsModal();
  }

  function duplicateProject(id) {
    const p = library.projects.find(x => x.id === id);
    if (!p) return;
    captureCurrentContent();
    if (state) markDirty(state.id);
    const copy = JSON.parse(JSON.stringify(p));
    copy.id = uid();
    copy.name = (p.name || p.title || 'Untitled') + ' (copy)';
    copy.title = copy.name;
    copy.createdAt = Date.now();
    copy.modifiedAt = Date.now();
    copy.slides.forEach(s => { s.id = uid(); });
    copy.currentId = copy.slides[0].id;
    library.projects.push(copy);
    markEdited(copy.id);
    flushDirty();
    renderProjectsList();
  }

  async function deleteProject(id) {
    const idx = library.projects.findIndex(x => x.id === id);
    if (idx < 0) return;
    const p = library.projects[idx];
    if (!(await dialogs.confirm(`Delete "${p.name || p.title}"? This can't be undone.`, { title: 'Delete presentation', confirmLabel: 'Delete', kind: 'danger' }))) return;
    library.projects.splice(idx, 1);
    deleteProjectRecord(id);
    recordTombstone(id);
    if (library.projects.length === 0) {
      const fresh = blankProject();
      library.projects.push(fresh);
      state = fresh;
      library.currentProjectId = fresh.id;
      markEdited(fresh.id);
      clearHistory();
      renderAll();
    } else if (state.id === id) {
      state = library.projects[Math.max(0, idx - 1)];
      library.currentProjectId = state.id;
      clearHistory();
      renderAll();
    }
    metaDirty = true;
    flushDirty();
    renderProjectsList();
  }

  function renameProject(id, newName) {
    const p = library.projects.find(x => x.id === id);
    if (!p) return;
    const trimmed = (newName || '').trim() || 'Untitled presentation';
    p.name = trimmed;
    p.title = trimmed;
    if (state.id === id) {
      els.deckTitle.textContent = trimmed;
    }
    markEdited(id);
    flushDirty();
    renderProjectsList();
  }

  // Snapshot the complete persisted browser project for backup/transfer.
  function serializeProject(p) {
    // Browser projects contain only structured JSON data. Backups intentionally
    // clone the whole persisted object rather than maintaining a fragile field
    // allow-list, so stable IDs, data-URI assets and future fields survive.
    if (browserBackup?.snapshotProject) return browserBackup.snapshotProject(p);
    return JSON.parse(JSON.stringify(p));
  }

  function safeFilename(s) {
    return String(s || 'untitled').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'untitled';
  }

  async function exportAllAsZip() {
    captureCurrentContent();
    await exportPresentationZip(state);
  }

  async function restoreLibraryBackup(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.projects) || !snapshot.projects.length) {
      throw new Error('Revealation backup contains no projects.');
    }
    const normalized = snapshot.projects.map(project => normalizeProject(project, project?.name || project?.title)).filter(Boolean);
    if (normalized.length !== snapshot.projects.length) throw new Error('Revealation backup contains an invalid project.');
    const ids = new Set(normalized.map(project => project.id));
    if (ids.size !== normalized.length) throw new Error('Revealation backup contains duplicate project IDs.');

    if (browserLibraryFresh && browserStore?.isOpen()) {
      const nextLibrary = {
        version: Number(snapshot.version) || 1,
        currentProjectId: ids.has(snapshot.currentProjectId) ? snapshot.currentProjectId : normalized[0].id,
        projects: normalized,
        deletedIds: Array.isArray(snapshot.deletedIds) ? snapshot.deletedIds : [],
      };
      // Commit the complete restore before changing live application state.
      // A failed request aborts the whole transaction, leaving the original
      // fresh browser library intact rather than half-restored.
      await persistWholeBrowserLibrary(nextLibrary);
      library = nextLibrary;
      state = library.projects.find(project => project.id === library.currentProjectId) || library.projects[0];
      dirtyProjects.clear();
      pushDirty.clear();
      metaDirty = false;
      browserLibraryFresh = false;
      clearHistory();
      renderAll();
      setSaveState('saved', 'Backup restored');
      return normalized.length;
    }

    // Importing into an existing library is deliberately non-destructive.
    // Keep original IDs/timestamps when possible; on collision create a new
    // project identity rather than overwriting an existing local project.
    let count = 0;
    for (const source of normalized) {
      const data = serializeProject(source);
      const collides = library.projects.some(project => project.id === data.id);
      if (collides) {
        data.id = uid();
        data.modifiedAt = Date.now();
      }
      const project = normalizeProject(data, data.name || data.title);
      if (!project) continue;
      library.projects.push(project);
      clearTombstone(project.id);
      pushDirty.add(project.id);
      markDirty(project.id);
      count++;
    }
    return count;
  }

  async function importFiles(fileList) {
    const files = Array.from(fileList || []);
    let added = 0;
    const errors = [];
    for (const f of files) {
      try {
        if (!/\.revealation$/i.test(f.name) && f.type !== 'application/vnd.revealation.deck+zip') {
          throw new Error('Choose a .revealation presentation file.');
        }
        added += await importNativeFile(f);
      } catch (e) {
        errors.push(`${f.name}: ${e.message || e}`);
      }
    }
    if (added > 0) {
      const persisted = await flushDirty({ capture: false });
      renderProjectsList();
      if (persisted) setStatus(`Imported ${added} project${added === 1 ? '' : 's'}`, true);
      else errors.push('Imported projects are still open in memory, but IndexedDB could not save them. Export a backup before closing this tab.');
      if (!workspaceMode) schedulePush();
    }
    if (errors.length) {
      dialogs.alert('Some files could not be imported:\n\n' + errors.join('\n'), { title: 'Import completed with issues', kind: 'warning' });
    }
  }

  async function importNativeFile(file) {
    if (!deckPackage) throw new Error('Native presentation support is unavailable.');
    // The package module validates and fully reads the archive before this
    // function changes the library, so failed imports leave the active deck untouched.
    const imported = await deckPackage.importDeckPackage(file);
    const source = imported.deck;
    const incomingId = source.id;
    const collides = incomingId && library.projects.some(project => project.id === incomingId);
    const data = { ...source, assets: imported.deck.assets || imported.assets.map(asset => ({ ...asset })) };
    data.id = incomingId && !collides ? incomingId : uid();
    if (collides) data.modifiedAt = Date.now();
    const project = normalizeProject(data, data.name || data.title || file.name.replace(/\.revealation$/i, ''));
    if (!project) throw new Error('Deck failed Revealation model validation.');
    library.projects.push(project);
    clearTombstone(project.id);
    pushDirty.add(project.id);
    markDirty(project.id);
    return 1;
  }

  async function importJsonFile(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    const incomingId = data.id;
    const collides = incomingId && library.projects.some(p => p.id === incomingId);
    const id = (incomingId && !collides) ? incomingId : uid();
    if (collides) data.modifiedAt = Date.now();
    const p = normalizeProject({ ...data, id }, file.name.replace(/\.json$/i, ''));
    if (!p) throw new Error('Not a valid project file');
    library.projects.push(p);
    clearTombstone(p.id);
    pushDirty.add(p.id);
    markDirty(p.id);
  }

  async function importMarkdownFile(file) {
    if (typeof marked === 'undefined') {
      throw new Error('Markdown parser (marked) not loaded');
    }
    const text = await file.text();
    const slides = parseMarkdownDeck(text);
    if (slides.length === 0) throw new Error('No slides found in markdown');
    const name = file.name.replace(/\.(md|markdown)$/i, '');
    const now = Date.now();
    const p = normalizeProject({
      id: uid(),
      name,
      title: name,
      theme: (state && state.theme) || themeRegistry?.defaultId || 'clean',
      slides,
      currentId: slides[0].id,
      createdAt: now,
      modifiedAt: now,
    }, name);
    if (!p) throw new Error('Failed to build project from markdown');
    library.projects.push(p);
    clearTombstone(p.id);
    markEdited(p.id);
  }

  // -------- Markdown deck parsing --------
  function parseMarkdownDeck(text) {
    const separatorDiagnostics = markdownDeck.validateSeparators(text);
    if (separatorDiagnostics.length) {
      const first = separatorDiagnostics[0];
      throw new Error(`Line ${first.line}: ${first.message}`);
    }

    const ranges = markdownDeck.scanSlideRanges(text);
    return ranges.map((range) => parseMarkdownSlide(range.chunk, range.subslide, range.layout, range));
  }

  function parseMarkdownSlide(chunk, vertical, layoutId = 'single', sourceRange = null) {
    const slide = newSlide('');
    slide.vertical = !!vertical;
    slide.layout = layoutId || 'single';
    applySlideMetadata(slide, sourceRange?.metadata || {});

    if (!layoutRegistry?.get(slide.layout)) {
      const line = sourceRange?.separatorLine || sourceRange?.startLine || 1;
      throw new Error(`Line ${line}: Unknown layout "${slide.layout}".`);
    }

    let body = chunk.replace(/^\s+|\s+$/g, '');

    const attrMatch = body.match(/^<!--\s*\.slide:\s*([^]*?)\s*-->\s*/);
    if (attrMatch) {
      applyMarkdownSlideAttrs(attrMatch[1], slide);
      body = body.slice(attrMatch[0].length);
    }

    const separatedNotes = notesSerialization.split(body, { lineOffset: (sourceRange?.startLine || 1) - 1 });
    const noteError = separatedNotes.diagnostics.find(item => item.severity === 'error');
    if (noteError) throw new Error(`Line ${noteError.line}: ${noteError.message}`);
    slide.notes = separatedNotes.notes;
    body = separatedNotes.body.trim();

    // RV-COMPAT(layout-wrapper): REMOVE BEFORE PUBLIC RELEASE.
    // Revealation 3.1–3.3 stored the layout id in a `::: layout` wrapper.
    // Accept it only for migration and immediately move that identity onto the
    // slide model; the writer never emits the legacy wrapper again.
    const legacy = layoutBlocks?.parseLegacyLayout(body);
    if (legacy?.detected) {
      const errors = legacy.diagnostics.filter(item => item.severity === 'error');
      if (errors.length || !legacy.spec) {
        const first = errors[0];
        throw new Error(first ? `Line ${first.line}: ${first.message}` : 'Invalid legacy layout.');
      }
      if (slide.layout !== 'single' && slide.layout !== legacy.spec.id) {
        throw new Error(`Separator layout "${slide.layout}" conflicts with legacy layout "${legacy.spec.id}".`);
      }
      slide.layout = legacy.spec.id;
      slide.blocks = legacy.spec.blocks.map(block => ({
        html: markdownToHtml(block.raw.trim()),
        align: block.align || 'left',
      }));
      const rendered = renderSlideBlocks(slide);
      if (rendered == null) throw new Error(`Could not render layout "${slide.layout}".`);
      slide.content = rendered;
      return slide;
    }

    if (slide.layout !== 'single') {
      const parsed = layoutBlocks.parseSlide(body, slide.layout);
      slide.blocks = parsed.blocks.map(block => ({
        html: markdownToHtml(block.raw.trim()),
        align: block.align || 'left',
      }));
      const rendered = renderSlideBlocks(slide);
      if (rendered == null) throw new Error(`Could not render layout "${slide.layout}".`);
      slide.content = rendered;
      return slide;
    }

    slide.content = body ? markdownToHtml(body) : '';

    // RV-COMPAT(columns-directive): REMOVE BEFORE PUBLIC RELEASE.
    // Older `::: columns` syntax is still accepted by markdownToHtml(). It
    // must occupy the complete slide and is migrated to slide-level metadata.
    const detected = contentLayoutId(slide.content);
    if (detected !== 'single') {
      const holder = document.createElement('div');
      holder.innerHTML = slide.content;
      const meaningful = Array.from(holder.childNodes).filter(node =>
        node.nodeType === Node.ELEMENT_NODE || (node.nodeType === Node.TEXT_NODE && String(node.nodeValue || '').trim()));
      if (meaningful.length !== 1) {
        throw new Error('Legacy columns must occupy the complete slide; content beside a layout is not allowed.');
      }
      slide.layout = detected;
      const extracted = layoutBlocksFromContent(slide.content, detected);
      slide.blocks = extracted ? extracted.blocks : null;
    }
    return slide;
  }

  function applyMarkdownSlideAttrs(attrStr, slide) {
    const re = /([\w-]+)\s*=\s*"([^"]*)"/g;
    let m;
    let size = '';
    while ((m = re.exec(attrStr)) !== null) {
      const key = m[1];
      const val = m[2].replace(/&quot;/g, '"');
      // RV-COMPAT(slide-transition): REMOVE BEFORE PUBLIC RELEASE.
      // RV-COMPAT(background-reveal): the data-background branches below are temporary.
      if (key === 'data-transition') {
        slide.transition = val;
      } else if (key === 'data-background') {
        slide.background = { type: 'color', value: val, size: '' };
      } else if (key === 'data-background-size') {
        // Modifies whichever background attribute this slide also carries,
        // which the regex may not have reached yet — apply it after the loop.
        size = val;
      } else if (key.startsWith('data-background-')) {
        const type = key.slice('data-background-'.length);
        if (type === 'color' || type === 'image' || type === 'video' || type === 'iframe') {
          slide.background = { type, value: val, size: '' };
        }
      }
    }
    if (size && slide.background && BG_FIT_TYPES.includes(slide.background.type)) {
      slide.background.size = size;
    }
  }

  async function importZip(file) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip not loaded');
    }
    const zip = await JSZip.loadAsync(file);

    // Versioned browser-library backups are all-or-nothing: validate every
    // manifest reference and project before mutating the live library.
    if (browserBackup?.readLibraryZip) {
      const backup = await browserBackup.readLibraryZip(zip);
      if (backup) return restoreLibraryBackup(backup);
    }

    const all = Object.values(zip.files).filter(e => !e.dir);
    const mdEntries = all.filter(e => /\.(md|markdown)$/i.test(e.name));
    if (mdEntries.length > 0) {
      return await importMarkdownZipEntries(zip, mdEntries, all);
    }
    const jsonEntries = all.filter(e => /\.json$/i.test(e.name));
    let count = 0;
    for (const entry of jsonEntries) {
      try {
        const text = await entry.async('string');
        const data = JSON.parse(text);
        const incomingId = data.id;
        const collides = incomingId && library.projects.some(p => p.id === incomingId);
        const id = (incomingId && !collides) ? incomingId : uid();
        if (collides) data.modifiedAt = Date.now();
        const p = normalizeProject({ ...data, id }, entry.name.replace(/\.json$/i, ''));
        if (p) {
          library.projects.push(p);
          clearTombstone(p.id);
          pushDirty.add(p.id);
          markDirty(p.id);
          count++;
        }
      } catch {
        // Legacy ZIPs predate the manifest and may contain unrelated JSON.
      }
    }
    return count;
  }

  async function importMarkdownZipEntries(zip, mdEntries, allEntries) {
    if (typeof marked === 'undefined') {
      throw new Error('Markdown parser (marked) not loaded');
    }
    // Pre-load every non-md entry as a possible asset, keyed by its path.
    const assetMap = new Map();
    for (const entry of allEntries) {
      if (/\.(md|markdown)$/i.test(entry.name)) continue;
      try {
        const base64 = await entry.async('base64');
        const ext = (entry.name.split('.').pop() || '').toLowerCase();
        const mime = extToMime(ext);
        assetMap.set(entry.name, `data:${mime};base64,${base64}`);
      } catch {
        // Skip unreadable entries.
      }
    }
    let count = 0;
    for (const entry of mdEntries) {
      try {
        const text = await entry.async('string');
        const slides = parseMarkdownDeck(text);
        if (slides.length === 0) continue;
        slides.forEach(s => reinlineSlideAssets(s, assetMap));
        const name = entry.name
          .replace(/^.*\//, '')
          .replace(/\.(md|markdown)$/i, '');
        const now = Date.now();
        const p = normalizeProject({
          id: uid(),
          name,
          title: name,
          theme: (state && state.theme) || themeRegistry?.defaultId || 'clean',
          slides,
          currentId: slides[0].id,
          createdAt: now,
          modifiedAt: now,
        }, name);
        if (p) {
          library.projects.push(p);
          clearTombstone(p.id);
          markEdited(p.id);
          count++;
        }
      } catch {
        // Skip malformed entries.
      }
    }
    return count;
  }

  // Look up a markdown-referenced asset path in the zip. Falls back to a
  // suffix match so a zip made from a containing folder (deck/assets/x.png)
  // still resolves references written as assets/x.png.
  function lookupAsset(assetMap, src) {
    if (assetMap.has(src)) return assetMap.get(src);
    for (const [name, data] of assetMap) {
      if (name.endsWith('/' + src)) return data;
    }
    return null;
  }

  function reinlineSlideAssets(slide, assetMap) {
    if (slide.content) {
      const wrap = parseHtml(slide.content);
      let changed = false;
      wrap.querySelectorAll('img[src]').forEach(img => {
        const src = img.getAttribute('src') || '';
        if (/^(https?:|data:|blob:|\/)/i.test(src)) return;
        const data = lookupAsset(assetMap, src);
        if (data) {
          img.setAttribute('src', data);
          changed = true;
        }
      });
      if (changed) slide.content = wrap.innerHTML;
    }
    // RV-COMPAT(background-reveal): raw background media re-inlining is temporary.
    if (slide.background && slide.background.value
        && !/^(https?:|data:|blob:|\/)/i.test(slide.background.value)) {
      const data = lookupAsset(assetMap, slide.background.value);
      if (data) slide.background = { ...slide.background, value: data };
    }
  }

  // -------- Reveal.js deck configuration defaults --------
  // Visual choices (theme, motion, canvas) live in Style. Functional
  // presentation behavior (navigation, controls, Present/link behavior and
  // playback) lives in Application settings alongside the editor appearance.
  const REVEAL_OPTIONS = [
    { section: 'Navigation' },
    { key: 'controls', label: 'Show navigation controls', type: 'boolean', default: true },
    { key: 'progress', label: 'Show progress bar', type: 'boolean', default: true },
    { key: 'slideNumber', label: 'Slide number', type: 'select', default: false,
      help: 'Display the current slide number in a corner',
      options: [
        { value: false, label: 'Off' },
        { value: true, label: 'On (h.v / h)' },
        { value: 'h.v', label: 'h.v' },
        { value: 'h/v', label: 'h/v' },
        { value: 'c', label: 'flattened (c)' },
        { value: 'c/t', label: 'flattened (c/t)' },
      ] },
    { key: 'keyboard', label: 'Keyboard navigation', type: 'boolean', default: true },
    { key: 'touch', label: 'Touch navigation', type: 'boolean', default: true },
    { key: 'mouseWheel', label: 'Mouse wheel navigation', type: 'boolean', default: false },
    { key: 'overview', label: 'Overview mode (O key)', type: 'boolean', default: true },
    { key: 'loop', label: 'Loop slides', type: 'boolean', default: false },
    { key: 'center', label: 'Vertically center slides', type: 'boolean', default: true },
    { key: 'rtl', label: 'Right-to-left direction', type: 'boolean', default: false,
      help: 'Reverses the primary slide direction (Arabic, Hebrew, etc.)' },
    { key: 'navigationMode', label: 'Navigation mode', type: 'select', default: 'default',
      help: 'How keyboard and controls walk the deck',
      options: [
        { value: 'default', label: 'default (slide + subslide)' },
        { value: 'linear', label: 'linear (slides only)' },
        { value: 'grid', label: 'grid (2D navigation)' },
      ] },
    { key: 'previewLinks', label: 'Open external links inside Present mode', type: 'boolean', default: false,
      help: 'Use Reveal.js link previews instead of leaving the presentation.' },

    { section: 'Transitions' },
    { key: 'transition', label: 'Default slide transition', type: 'select', default: 'slide',
      options: ['none', 'fade', 'slide', 'convex', 'concave', 'zoom'].map(v => ({ value: v, label: v })) },
    { key: 'transitionSpeed', label: 'Transition speed', type: 'select', default: 'default',
      options: ['default', 'fast', 'slow'].map(v => ({ value: v, label: v })) },
    { key: 'backgroundTransition', label: 'Background transition', type: 'select', default: 'fade',
      options: ['none', 'fade', 'slide', 'convex', 'concave', 'zoom'].map(v => ({ value: v, label: v })) },

    { section: 'Auto-advance' },
    { key: 'autoSlide', label: 'Auto-advance interval (ms, 0 = off)', type: 'number', default: 0, min: 0, step: 100 },
    { key: 'autoSlideStoppable', label: 'Stop auto-advance on user input', type: 'boolean', default: true },

    { section: 'Layout' },
    { key: 'width', label: 'Slide width (px)', type: 'number', default: 960, min: 200 },
    { key: 'height', label: 'Slide height (px)', type: 'number', default: 700, min: 200 },
    { key: 'margin', label: 'Presentation outer margin (0–1)', type: 'number', default: 0.04, min: 0, max: 0.5, step: 0.01,
      help: 'Outer breathing room around the logical slide. Revealation preserves the same relative margin in Present and PDF.' },
  ];

  function defaultRevealConfig() {
    const cfg = {};
    REVEAL_OPTIONS.forEach(opt => { if (opt.key) cfg[opt.key] = opt.default; });
    return cfg;
  }

  // -------- Modal focus management --------
  // Move focus into a modal when it opens and back to where the user was
  // when it closes, so keyboard/screen-reader users aren't left focused on
  // an element hidden behind the overlay.
  let modalReturnFocus = null;
  function focusModal(modal) {
    modalReturnFocus = document.activeElement;
    const target = modal.querySelector('button, input, select, textarea, a[href]');
    if (target) target.focus();
  }
  function restoreModalFocus() {
    if (modalReturnFocus && document.contains(modalReturnFocus)) modalReturnFocus.focus();
    modalReturnFocus = null;
  }

  // -------- Deck settings --------
  function formatDeckDate(value) {
    const date = new Date(Number(value) || 0);
    return Number.isFinite(date.getTime()) && date.getTime() > 0
      ? date.toLocaleString()
      : '—';
  }

  function renderDeckSettingsMetadata() {
    if (els.deckSettingsName) els.deckSettingsName.value = state.title || state.name || '';
    if (els.deckSettingsAuthor) els.deckSettingsAuthor.value = state.author || '';
    if (els.deckSettingsCreated) els.deckSettingsCreated.textContent = formatDeckDate(state.createdAt);
    if (els.deckSettingsModified) els.deckSettingsModified.textContent = formatDeckDate(state.modifiedAt);
  }

  function renderDeckSettings() {
    renderDeckSettingsMetadata();
    renderThemePicker();
    renderStyleForms();
  }

  function openDeckSettingsModal() {
    renderDeckSettings();
    els.deckSettingsModal.hidden = false;
    focusModal(els.deckSettingsModal);
  }

  function closeDeckSettingsModal() {
    els.deckSettingsModal.hidden = true;
    endTextEditSession();
    restoreModalFocus();
  }

  function openSettingsModal() {
    syncUiThemeSettings();
    renderPresentationSettings();
    els.settingsModal.hidden = false;
    focusModal(els.settingsModal);
  }

  function closeSettingsModal() {
    els.settingsModal.hidden = true;
    endTextEditSession();
    restoreModalFocus();
  }

  function openExportModal() {
    if (!markdownMode) captureCurrentContent();
    const config = { ...defaultRevealConfig(), ...(state.config || {}) };
    if (els.exportHtmlControls) els.exportHtmlControls.checked = config.controls !== false;
    if (els.exportHtmlProgress) els.exportHtmlProgress.checked = config.progress !== false;
    if (els.exportHtmlWarning) {
      const hasInteractive = !!deckExporter?.containsInteractive?.(state);
      els.exportHtmlWarning.hidden = !hasInteractive;
    }
    els.exportModal.hidden = false;
    focusModal(els.exportModal);
  }

  function closeExportModal() {
    els.exportModal.hidden = true;
    restoreModalFocus();
  }

  function openHelpModal() {
    els.helpModal.hidden = false;
    focusModal(els.helpModal);
  }

  function closeHelpModal() {
    els.helpModal.hidden = true;
    restoreModalFocus();
  }

  const STYLE_MOTION_KEYS = ['transition', 'transitionSpeed', 'backgroundTransition'];
  const STYLE_LAYOUT_KEYS = ['width', 'height', 'margin', 'center'];
  const APP_SETTING_SECTIONS = [
    { title: 'Presentation controls', keys: ['controls', 'progress', 'slideNumber'] },
    { title: 'Navigation', keys: ['keyboard', 'touch', 'mouseWheel', 'overview', 'loop', 'rtl', 'navigationMode'] },
    { title: 'Present mode', keys: ['previewLinks'] },
    { title: 'Playback', keys: ['autoSlide', 'autoSlideStoppable'] },
  ];

  function configDefinitionMap() {
    return new Map(REVEAL_OPTIONS.filter(opt => opt.key).map(opt => [opt.key, opt]));
  }

  function appendConfigRow(form, opt, idPrefix, onChange) {
    const cfg = state.config || (state.config = defaultRevealConfig());
    const row = document.createElement('div');
    row.className = 'settings-row';
    const label = document.createElement('label');
    label.htmlFor = `${idPrefix}-${opt.key}`;
    label.textContent = opt.label;
    if (opt.help) {
      const help = document.createElement('span');
      help.className = 'help';
      help.textContent = opt.help;
      label.appendChild(help);
    }
    row.appendChild(label);

    const input = makeConfigInput(opt, cfg[opt.key]);
    input.id = `${idPrefix}-${opt.key}`;
    input.addEventListener('change', () => {
      snapshotForTextField(idPrefix);
      cfg[opt.key] = readConfigInput(opt, input);
      onChange?.(opt);
      scheduleSave();
    });
    row.appendChild(input);
    form.appendChild(row);
  }

  function renderPresentationSettings() {
    const form = els.presentationSettingsForm;
    if (!form) return;
    const definitions = configDefinitionMap();
    form.replaceChildren();
    APP_SETTING_SECTIONS.forEach(section => {
      const heading = document.createElement('h4');
      heading.textContent = section.title;
      form.appendChild(heading);
      section.keys.forEach(key => {
        const opt = definitions.get(key);
        if (opt) appendConfigRow(form, opt, 'setting');
      });
    });
  }

  function renderStyleConfigForm(form, keys) {
    if (!form) return;
    const definitions = configDefinitionMap();
    form.replaceChildren();
    keys.forEach(key => {
      const opt = definitions.get(key);
      if (!opt) return;
      appendConfigRow(form, opt, 'style', () => {
        if (STYLE_LAYOUT_KEYS.includes(opt.key)) {
          applySlideEffects();
          positionMediaSelection();
        }
      });
    });
  }

  function renderStyleForms() {
    renderStyleConfigForm(els.styleMotionForm, STYLE_MOTION_KEYS);
    renderStyleConfigForm(els.styleLayoutForm, STYLE_LAYOUT_KEYS);
  }

  function makeConfigInput(opt, value) {
    if (opt.type === 'boolean') {
      const el = document.createElement('input');
      el.type = 'checkbox';
      el.checked = !!value;
      return el;
    }
    if (opt.type === 'select') {
      const el = document.createElement('select');
      opt.options.forEach(o => {
        const option = document.createElement('option');
        // Stringify value so booleans/numbers survive the round trip.
        option.value = JSON.stringify(o.value);
        option.textContent = o.label;
        if (o.value === value) option.selected = true;
        el.appendChild(option);
      });
      return el;
    }
    // number
    const el = document.createElement('input');
    el.type = 'number';
    if (typeof opt.min === 'number') el.min = String(opt.min);
    if (typeof opt.max === 'number') el.max = String(opt.max);
    if (typeof opt.step === 'number') el.step = String(opt.step);
    el.value = value;
    return el;
  }

  function readConfigInput(opt, input) {
    if (opt.type === 'boolean') return input.checked;
    if (opt.type === 'select') return JSON.parse(input.value);
    const n = parseFloat(input.value);
    return Number.isFinite(n) ? n : opt.default;
  }



  // -------- Projects modal --------
  function openProjectsModal() {
    captureCurrentContent();
    saveLibrary();
    renderProjectsList();
    els.projectsModal.hidden = false;
    focusModal(els.projectsModal);
  }

  function closeProjectsModal() {
    els.projectsModal.hidden = true;
    restoreModalFocus();
  }

  // -------- Gist contents in Projects modal --------
  async function refreshRemoteProjectsList() {
    const section = els.projectsRemoteSection;
    if (sync.status === 'off' || !sync.gistId) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    els.projectsRemoteStatus.textContent = 'Fetching gist…';
    els.projectsRemoteList.innerHTML = '';
    try {
      const remote = await gistGetResolved(sync.gistId);
      const files = remote.files || {};
      const items = [];
      for (const name of Object.keys(files)) {
        if (name === SYNC_LIBRARY_FILE) continue;
        const file = files[name];
        let parsed = null;
        try { parsed = JSON.parse(file.content); } catch {}
        if (!parsed) continue;
        const idFromName = name.replace(/\.json$/i, '');
        const id = parsed.id || idFromName;
        items.push({
          id,
          filename: name,
          name: parsed.name || parsed.title || '(untitled)',
          title: parsed.title || parsed.name || '(untitled)',
          modifiedAt: parsed.modifiedAt || 0,
          slideCount: Array.isArray(parsed.slides) ? parsed.slides.length : 0,
          parsed,   // kept so Pull can import without refetching the gist
        });
      }
      items.sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0));
      renderRemoteProjects(items);
    } catch (e) {
      els.projectsRemoteStatus.textContent = 'Failed to fetch gist: ' + (e.message || e);
      els.projectsRemoteList.innerHTML = '';
    }
  }

  function renderRemoteProjects(items) {
    const list = els.projectsRemoteList;
    list.innerHTML = '';
    if (items.length === 0) {
      els.projectsRemoteStatus.textContent = 'No projects on the gist yet.';
      return;
    }
    const localById = new Map(library.projects.map(p => [p.id, p]));
    // Index local projects by lowercased name for duplicate detection.
    const localByName = new Map();
    for (const lp of library.projects) {
      const key = (lp.name || lp.title || '').trim().toLowerCase();
      if (!key) continue;
      if (!localByName.has(key)) localByName.set(key, []);
      localByName.get(key).push(lp);
    }

    let matches = 0, orphans = 0, dupes = 0;
    for (const r of items) {
      const li = document.createElement('li');
      const local = localById.get(r.id);
      const nameKey = (r.name || '').trim().toLowerCase();
      const sameNameLocals = localByName.get(nameKey) || [];
      const sameNameDifferentId = sameNameLocals.some(lp => lp.id !== r.id);

      const name = document.createElement('div');
      name.className = 'proj-name';
      name.textContent = r.title || r.name;
      name.title = r.name;
      // Make it look like text (not editable) — it's read-only here.
      name.style.background = 'transparent';
      name.style.border = '1px solid transparent';

      const meta = document.createElement('div');
      meta.className = 'proj-meta';
      const idSpan = document.createElement('span');
      idSpan.className = 'proj-id';
      idSpan.textContent = `id ${r.id.slice(0, 8)}…`;
      idSpan.title = r.id;
      meta.textContent = `${r.slideCount} slide${r.slideCount === 1 ? '' : 's'} · ${formatRelative(r.modifiedAt)} · `;
      meta.appendChild(idSpan);

      const tag = document.createElement('span');
      tag.className = 'proj-tag';
      if (local) {
        tag.classList.add('match');
        tag.textContent = 'synced';
        tag.title = 'This project exists in this browser and on the gist.';
        matches++;
      } else if (sameNameDifferentId) {
        tag.classList.add('duplicate');
        tag.textContent = 'duplicate id';
        tag.title = 'A local project has this name under a different id — usually an older '
          + 'copy from another machine or a re-import. Pull it in to compare and merge by '
          + 'hand, or delete it from the gist if it’s stale.';
        dupes++;
      } else {
        tag.classList.add('orphan');
        tag.textContent = 'remote only';
        tag.title = 'On the gist but not in this browser — usually a project deleted here '
          + 'that another machine still pushes, or one this browser skipped. Pull it in '
          + 'to keep it, or delete it from the gist.';
        orphans++;
      }
      name.appendChild(tag);

      li.appendChild(name);
      li.appendChild(meta);

      // Non-synced entries get remediation actions; synced ones are managed
      // through the local list above.
      if (!local) {
        const actions = document.createElement('div');
        actions.className = 'proj-actions';

        const pullBtn = document.createElement('button');
        pullBtn.type = 'button';
        pullBtn.textContent = 'Pull to this browser';
        pullBtn.title = 'Import this copy from the gist into this browser';
        pullBtn.addEventListener('click', () => pullRemoteProject(r));

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'danger';
        delBtn.textContent = 'Delete from gist';
        delBtn.title = 'Remove this file from the gist; synced browsers that still have '
          + 'the project will delete it on their next sync';
        delBtn.addEventListener('click', () => deleteRemoteGistFile(r));

        actions.appendChild(pullBtn);
        actions.appendChild(delBtn);
        li.appendChild(actions);
      }
      list.appendChild(li);
    }
    const parts = [`${items.length} project${items.length === 1 ? '' : 's'} on gist`];
    if (matches) parts.push(`${matches} synced`);
    if (dupes) parts.push(`${dupes} same-name but different id`);
    if (orphans) parts.push(`${orphans} remote-only`);
    els.projectsRemoteStatus.textContent = parts.join(' · ');
  }

  // Import a remote-only / duplicate-id gist project into this browser.
  // markEdited stamps a fresh modifiedAt on purpose: if this project was
  // deleted here earlier, its tombstone still exists (and tombstone merges
  // are a union, so clearing it locally can't fully retract it) — the pulled
  // copy must be NEWER than the tombstone or the next sync would delete it
  // again.
  function pullRemoteProject(item) {
    if (!item.parsed) return;
    const collides = library.projects.some(p => p.id === item.id);
    const id = collides ? uid() : item.id;
    const p = normalizeProject({ ...item.parsed, id }, item.name);
    if (!p) {
      dialogs.alert('Could not read this project from the gist.', { title: 'Remote project unavailable', kind: 'danger' });
      return;
    }
    // Two identically named projects are hard to tell apart in the list —
    // suffix the pulled one when a same-name local project already exists.
    const nameKey = (p.name || p.title || '').trim().toLowerCase();
    if (library.projects.some(lp => (lp.name || lp.title || '').trim().toLowerCase() === nameKey)) {
      p.name = p.title = (p.name || p.title || 'Untitled') + ' (gist copy)';
    }
    library.projects.push(p);
    clearTombstone(p.id);
    markEdited(p.id);
    flushDirty();
    schedulePush();   // propagate the fresh modifiedAt so other machines keep it too
    renderProjectsList();
    refreshRemoteProjectsList();
    setStatus(`Pulled "${p.name}" from gist`, true);
  }

  // Remove a remote-only / duplicate-id file from the gist. Records a
  // tombstone first — without one, any synced browser that still holds the
  // project alive would simply push the file right back.
  async function deleteRemoteGistFile(item) {
    if (!(await dialogs.confirm(`Delete "${item.name}" from the gist?\n\nAny synced browser that still has this project will delete it on its next sync. This can't be undone.`, { title: 'Delete remote project', confirmLabel: 'Delete', kind: 'danger' }))) return;
    recordTombstone(item.id);
    metaDirty = true;
    els.projectsRemoteStatus.textContent = 'Deleting from gist…';
    try {
      // Re-check the gist before deleting: the panel can be stale, and the
      // file may already be gone (tombstone cleanup in syncPush, or another
      // machine). GitHub rejects a PATCH that nulls a nonexistent file with
      // 422 Validation Failed, so only null it if it's still there — and
      // publish the updated tombstone list either way.
      const remote = await gistGet(sync.gistId);
      const files = { [SYNC_LIBRARY_FILE]: buildLibraryGistFile() };
      if (remote.files && remote.files[item.filename]) files[item.filename] = null;
      await gistPatch(sync.gistId, files);
      setStatus(`Deleted "${item.name}" from gist`, true);
    } catch (e) {
      dialogs.alert('Delete failed: ' + (e.message || e), { title: 'Remote delete failed', kind: 'danger' });
    }
    flushDirty();
    refreshRemoteProjectsList();
  }

  function renderProjectsList() {
    const list = els.projectsList;
    list.innerHTML = '';
    // Sort: most recently modified first.
    const projects = library.projects.slice().sort((a, b) => (b.modifiedAt || 0) - (a.modifiedAt || 0));
    if (projects.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'projects-empty';
      empty.textContent = 'No projects yet — create one.';
      list.appendChild(empty);
      return;
    }
    for (const p of projects) {
      list.appendChild(renderProjectRow(p));
    }
  }

  function renderProjectRow(p) {
    const li = document.createElement('li');
    if (p.id === state.id) li.classList.add('active');

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'proj-name';
    name.value = p.name || p.title || 'Untitled';
    name.title = 'Rename';
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); name.blur(); }
      else if (e.key === 'Escape') { name.value = p.name || p.title || ''; name.blur(); }
    });
    name.addEventListener('change', () => renameProject(p.id, name.value));

    const meta = document.createElement('div');
    meta.className = 'proj-meta';
    const slideCount = (p.slides || []).length;
    meta.textContent = `${slideCount} slide${slideCount === 1 ? '' : 's'} · ${formatRelative(p.modifiedAt)}${p.id === state.id ? ' · open' : ''}`;

    const actions = document.createElement('div');
    actions.className = 'proj-actions';

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.textContent = 'Open';
    openBtn.disabled = p.id === state.id;
    openBtn.addEventListener('click', () => {
      switchProject(p.id);
      closeProjectsModal();
    });

    const dupBtn = document.createElement('button');
    dupBtn.type = 'button';
    dupBtn.textContent = 'Duplicate';
    dupBtn.addEventListener('click', () => duplicateProject(p.id));

    const exportNativeBtn = document.createElement('button');
    exportNativeBtn.type = 'button';
    exportNativeBtn.textContent = '.revealation';
    exportNativeBtn.title = 'Export a portable Revealation presentation';
    exportNativeBtn.addEventListener('click', () => exportProjectAsZip(p.id));

    const exportHtmlBtn = document.createElement('button');
    exportHtmlBtn.type = 'button';
    exportHtmlBtn.textContent = '.html';
    exportHtmlBtn.title = 'Download as standalone reveal.js HTML';
    exportHtmlBtn.addEventListener('click', () => exportProjectAsHtml(p.id));

    const exportPdfBtn = document.createElement('button');
    exportPdfBtn.type = 'button';
    exportPdfBtn.textContent = '.pdf';
    exportPdfBtn.title = 'Open print-to-PDF view in a new tab';
    exportPdfBtn.addEventListener('click', () => exportProjectAsPdf(p.id));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'danger';
    delBtn.textContent = '×';
    delBtn.title = 'Delete project';
    delBtn.addEventListener('click', () => deleteProject(p.id));

    actions.appendChild(openBtn);
    actions.appendChild(dupBtn);
    actions.appendChild(exportNativeBtn);
    actions.appendChild(exportHtmlBtn);
    actions.appendChild(exportPdfBtn);
    actions.appendChild(delBtn);

    li.appendChild(name);
    li.appendChild(meta);
    li.appendChild(actions);
    return li;
  }

  function formatRelative(ts) {
    if (!ts) return 'never';
    const ms = Date.now() - ts;
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return 'just now';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hr ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;
    return new Date(ts).toLocaleDateString();
  }

  // -------- UI theme (application preference, never presentation metadata) --------
  function currentUiTheme() {
    return document.body.classList.contains('light') ? 'light' : 'dark';
  }

  function syncUiThemeSettings() {
    const mode = currentUiTheme();
    for (const button of [els.settingsThemeLight, els.settingsThemeDark]) {
      if (!button) continue;
      const active = button.dataset.uiTheme === mode;
      button.classList.toggle('selected', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  function applyUiTheme(mode) {
    const light = mode === 'light';
    document.body.classList.toggle('light', light);
    syncUiThemeSettings();
  }

  function setUiTheme(mode) {
    if (mode !== 'light' && mode !== 'dark') return;
    applyUiTheme(mode);
    try { localStorage.setItem(THEME_KEY, mode); } catch {}
  }

  function loadUiTheme() {
    let mode = null;
    try { mode = localStorage.getItem(THEME_KEY); } catch {}
    if (mode !== 'light' && mode !== 'dark') {
      mode = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light' : 'dark';
    }
    applyUiTheme(mode);
  }

  // -------- Notes side panel --------
  function isNotesPanelOpen() {
    return !els.notesPanel.hidden;
  }

  function syncNotesPanel() {
    const open = isNotesPanelOpen();
    els.notesToggle?.setAttribute('aria-pressed', String(open));
    els.notesToggle?.classList.toggle('active', open);
    if (!open) return;
    const slide = currentSlide();
    if (!slide) return;
    if (els.notesPanelText.value !== (slide.notes || '')) els.notesPanelText.value = slide.notes || '';
    els.subslide.checked = !!slide.vertical;
    els.wip.checked = slide.underConstruction === true;
    if (els.hiddenSlide) els.hiddenSlide.checked = slide.hidden === true;
    els.notesPanelSlide.textContent = `Slide ${slideNumber(state.slides.findIndex(s => s.id === state.currentId))}`;
  }

  function openNotesPanel() {
    els.notesPanel.hidden = false;
    document.body.classList.add('notes-open');
    syncNotesPanel();
    setTimeout(() => els.notesPanelText.focus(), 0);
  }

  function closeNotesPanel() {
    els.notesPanel.hidden = true;
    document.body.classList.remove('notes-open');
    syncNotesPanel();
  }

  function toggleNotesPanel() {
    if (isNotesPanelOpen()) closeNotesPanel();
    else openNotesPanel();
  }

  // -------- Small-screen shell --------
  // On a phone the desktop shell leaves the slide as a letterbox between four
  // bands of chrome. Here the slide takes the stage and the chrome collapses
  // into a slide-list drawer and a compact topbar overflow. Slide notes and
  // per-slide toggles use the same right sidebar as desktop. None of
  // it is a second implementation — every control below drives the same
  // element or function the desktop chrome does, so there is nothing to keep
  // in step.
  //
  // Kept in sync with the media query in styles/app.css.
  const MOBILE_QUERY = '(max-width: 760px), (max-height: 500px) and (max-width: 950px)';
  const mobileMq = window.matchMedia(MOBILE_QUERY);
  const isMobile = () => mobileMq.matches;

  function isMobileLayerOpen() {
    return document.body.classList.contains('slides-open');
  }

  function syncMobileChrome() {
    els.mobileScrim.hidden = !isMobileLayerOpen();
    els.mPicker.setAttribute('aria-expanded',
      document.body.classList.contains('slides-open') ? 'true' : 'false');
  }

  // Focus moves into the drawer and comes back when it closes.
  let mobileLayerReturnFocus = null;

  function focusMobileLayer(panel) {
    if (!isMobile()) return;
    if (!mobileLayerReturnFocus) mobileLayerReturnFocus = document.activeElement;
    const target = panel.querySelector('li.active')
      || panel.querySelector('button, select, input, textarea');
    if (target) target.focus();
  }

  function releaseMobileLayerFocus() {
    const prev = mobileLayerReturnFocus;
    mobileLayerReturnFocus = null;
    if (prev && document.contains(prev)) prev.focus();
  }

  function openSlidesDrawer() {
    document.body.classList.add('slides-open');
    syncMobileChrome();
    focusMobileLayer(els.sidebar);
  }

  function closeSlidesDrawer() {
    if (!document.body.classList.contains('slides-open')) return;
    document.body.classList.remove('slides-open');
    syncMobileChrome();
    releaseMobileLayerFocus();
  }

  function closeMobileLayers() {
    closeSlidesDrawer();
  }

  // The on-screen keyboard doesn't shrink the layout viewport on iOS, so a
  // full-height shell keeps its bottom strip and toolbar behind the keyboard
  // and the browser scrolls the whole page to chase the caret. The visual
  // viewport is the one measure that does shrink; publishing it as
  // --viewport-height lets the shell give way to the keyboard and keeps the
  // controls on screen. Pinch-zoom shrinks it too, which is not a keyboard
  // and must not compress the layout — hence the scale guard.
  function syncViewportHeight() {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    if (vv.scale > 1.01) root.style.removeProperty('--viewport-height');
    else root.style.setProperty('--viewport-height', `${Math.round(vv.height)}px`);
  }

  // Prev/next walk the flat slide array, so subslides are visited in
  // the same order the deck plays them.
  function stepSlide(delta) {
    const idx = state.slides.findIndex(s => s.id === state.currentId);
    if (idx < 0) return;
    const next = idx + delta;
    if (next < 0 || next >= state.slides.length) return;
    selectSlide(state.slides[next].id);
  }

  // The strip under the stage stands in for the slide list's numbering and
  // its active row, so it is refreshed wherever the sidebar is.
  function updateMobileBar() {
    const total = state.slides.length;
    const idx = state.slides.findIndex(s => s.id === state.currentId);
    els.mPosition.textContent = idx < 0
      ? `${total} slide${total === 1 ? '' : 's'}`
      : `Slide ${slideNumber(idx)} of ${total}`;
    els.mPrev.disabled = idx <= 0;
    els.mNext.disabled = idx < 0 || idx >= total - 1;
  }

  // "off", "ready", "Synced 2 min ago" — whatever the pill is already saying,
  // since the pill itself is hidden at this size.
  function syncSummary() {
    const label = els.syncPill.querySelector('.sync-label');
    return label ? label.textContent.replace(/^Sync:\s*/, '') : '';
  }

  // Everything the topbar drops on a small screen. Reuses the toolbar's
  // popover so there is one menu implementation, not two.
  function openAppMenu() {
    if (toolbarMenuAnchor === els.mobileMenuBtn) { closeToolbarMenu(); return; }
    closeMobileLayers();
    const items = [
      { label: 'Deck settings…', checked: false, action: openDeckSettingsModal },
      { label: 'Export…', checked: false, action: openExportModal },
      { sep: true },
      { label: 'Present', hint: 'Ctrl/Cmd+P', checked: false, action: () => startPresentation() },
      { label: 'Present from here', hint: 'Ctrl/Cmd+Shift+P', checked: false, action: () => startPresentation({ fromCurrent: true }) },
      { label: 'Enter fullscreen when presenting', toggle: true, checked: presentationFullscreenEnabled(),
        action: () => setPresentationFullscreenEnabled(!presentationFullscreenEnabled()) },
      { sep: true },
      { label: 'Application settings…', checked: false, action: openSettingsModal },
      { label: 'Help…', hint: 'F1', checked: false, action: openHelpModal },
      { label: 'About ' + APP_INFO.name, checked: false, action: openAboutModal },
    ];
    openToolbarMenu(els.mobileMenuBtn, items, { restoreFocus: false });
  }



  // -------- Sync via GitHub Gist --------
  // Pre-rename names, kept so a browser that is already connected to a gist
  // stays connected. Renaming these would silently sign people out. See
  // LIBRARY_KEY.
  // RV-COMPAT(storage-old-keys): REMOVE/RENAME BEFORE PUBLIC RELEASE.
  const SYNC_STORAGE = {
    pat: 'reveal-editor:sync:pat',
    gistId: 'reveal-editor:sync:gist',
    lastSync: 'reveal-editor:sync:lastSync',
  };
  const SYNC_LIBRARY_FILE = '_library.json';
  const SYNC_AUTO_PUSH_MS = 3000;

  const sync = {
    pat: null,
    gistId: null,
    status: 'off',     // 'off' | 'idle' | 'syncing' | 'error'
    lastSync: null,
    error: null,
    pushTimer: null,
    inFlight: null,
    rateLimitedUntil: null,   // ms timestamp from X-RateLimit-Reset after a 403 rate-limit; auto-pushes pause until then
  };

  function isRateLimited() {
    return !!(sync.rateLimitedUntil && Date.now() < sync.rateLimitedUntil);
  }

  function formatClockTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function loadSyncConfig() {
    try {
      sync.pat = localStorage.getItem(SYNC_STORAGE.pat) || null;
      sync.gistId = localStorage.getItem(SYNC_STORAGE.gistId) || null;
      const last = localStorage.getItem(SYNC_STORAGE.lastSync);
      sync.lastSync = last ? parseInt(last, 10) : null;
    } catch {}
    sync.status = (sync.pat && sync.gistId) ? 'idle' : 'off';
    updateSyncPill();
  }

  function persistSyncConfig() {
    try {
      if (sync.pat) localStorage.setItem(SYNC_STORAGE.pat, sync.pat);
      else localStorage.removeItem(SYNC_STORAGE.pat);
      if (sync.gistId) localStorage.setItem(SYNC_STORAGE.gistId, sync.gistId);
      else localStorage.removeItem(SYNC_STORAGE.gistId);
      if (sync.lastSync) localStorage.setItem(SYNC_STORAGE.lastSync, String(sync.lastSync));
      else localStorage.removeItem(SYNC_STORAGE.lastSync);
    } catch {}
  }

  function syncDisconnect() {
    sync.pat = null;
    sync.gistId = null;
    sync.lastSync = null;
    sync.status = 'off';
    sync.error = null;
    persistSyncConfig();
    updateSyncPill();
    renderSyncModal();
  }

  const SYNC_ICONS = {
    off: 'bi-cloud-slash',
    syncing: 'bi-arrow-repeat',
    error: 'bi-exclamation-triangle',
    ok: 'bi-cloud-check',
    idle: 'bi-cloud',
  };

  function updateSyncPill() {
    const pill = els.syncPill;
    pill.classList.remove('is-syncing', 'is-error', 'is-ok');
    let label, iconKey;
    if (sync.status === 'off') {
      label = 'Sync: off';
      iconKey = 'off';
    } else if (sync.status === 'syncing') {
      label = 'Syncing…';
      iconKey = 'syncing';
      pill.classList.add('is-syncing');
    } else if (sync.status === 'error') {
      label = isRateLimited() ? `Rate limited · retry ${formatClockTime(sync.rateLimitedUntil)}` : 'Sync error';
      iconKey = 'error';
      pill.classList.add('is-error');
    } else {
      label = sync.lastSync ? `Synced ${formatRelative(sync.lastSync)}` : 'Sync: ready';
      const fresh = sync.lastSync && Date.now() - sync.lastSync < 60000;
      iconKey = fresh ? 'ok' : 'idle';
      if (fresh) pill.classList.add('is-ok');
    }
    const icon = pill.querySelector('.sync-icon');
    const labelEl = pill.querySelector('.sync-label');
    if (icon) {
      // Reset to base classes, then add the state icon.
      icon.className = 'bi sync-icon ' + SYNC_ICONS[iconKey];
    }
    if (labelEl) labelEl.textContent = label;
    else pill.textContent = label;
  }

  async function gistFetch(path, init = {}) {
    if (!sync.pat) throw new Error('No personal access token configured.');
    const r = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        'Authorization': `Bearer ${sync.pat}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      // GitHub's per-user limit (5,000 req/hr, shared by every app and token
      // on the account) surfaces as 403 with X-RateLimit-Remaining: 0 and
      // a Unix-seconds reset time. Remember the reset so schedulePush stops
      // burning further (still-counted) requests until the window rolls over.
      if (r.status === 403 || r.status === 429) {
        const remaining = r.headers.get('X-RateLimit-Remaining');
        const reset = parseInt(r.headers.get('X-RateLimit-Reset') || '', 10);
        const retryAfter = parseInt(r.headers.get('Retry-After') || '', 10);
        if (retryAfter > 0) {
          sync.rateLimitedUntil = Date.now() + retryAfter * 1000;
        } else if (remaining === '0' && reset > 0) {
          sync.rateLimitedUntil = reset * 1000;
        } else if (/rate limit/i.test(body)) {
          // Headers hidden (e.g. CORS-stripped) — GitHub windows are an hour.
          sync.rateLimitedUntil = Date.now() + 60 * 60 * 1000;
        }
        if (sync.rateLimitedUntil) {
          throw new Error(`GitHub rate limit reached — auto-sync paused until ${formatClockTime(sync.rateLimitedUntil)}. This limit is shared by everything using your GitHub account (gh, editors, scripts), not just this editor.`);
        }
      }
      const msg = (() => {
        try {
          const data = JSON.parse(body);
          // 422s carry the useful part in `errors`, not `message` — e.g.
          // "Validation Failed" alone says nothing about which field/file.
          const detail = Array.isArray(data.errors) && data.errors.length
            ? ' — ' + data.errors.map(er =>
                er.message || [er.resource, er.field, er.code].filter(Boolean).join(' ')
              ).join('; ')
            : '';
          return (data.message || '') + detail;
        } catch { return body; }
      })();
      throw new Error(`GitHub API ${r.status}: ${msg || r.statusText}`);
    }
    if (r.status === 204) return null;
    sync.rateLimitedUntil = null;   // a successful call means the window has reset
    return await r.json();
  }

  async function gistGet(id) { return gistFetch(`/gists/${id}`); }

  // GitHub truncates any gist file larger than ~1 MB in the API response:
  // `content` is cut off, `truncated` is true, and the full body lives at
  // `raw_url`. Projects with embedded base64 images routinely exceed that, so
  // resolve the full content before anything tries to JSON.parse it — otherwise
  // large projects silently fail to parse and vanish from the sync/Projects list.
  // raw_url for a secret gist is accessible without auth (and CORS-enabled), so
  // we deliberately omit the token here to avoid a preflight. NOTE: this fetch
  // hits gist.githubusercontent.com — keep that host in the connect-src CSP
  // directive (index.html meta + .htaccess header) or it gets blocked.
  async function gistGetResolved(id) {
    const gist = await gistGet(id);
    const files = gist.files || {};
    await Promise.all(Object.values(files).map(async (file) => {
      if (file && file.truncated && file.raw_url) {
        try {
          const r = await fetch(file.raw_url);
          if (r.ok) file.content = await r.text();
        } catch { /* leave truncated content; parse will skip it */ }
      }
    }));
    return gist;
  }
  async function gistPatch(id, files) {
    return gistFetch(`/gists/${id}`, { method: 'PATCH', body: JSON.stringify({ files }) });
  }
  async function gistCreate(files, description) {
    return gistFetch('/gists', {
      method: 'POST',
      body: JSON.stringify({ description, public: false, files }),
    });
  }

  function buildLibraryGistFile() {
    return {
      content: JSON.stringify({
        version: 1,
        currentProjectId: library.currentProjectId,
        deletedIds: library.deletedIds || [],
        generatedAt: Date.now(),
      }, null, 2),
    };
  }

  function buildProjectGistFiles() {
    const files = {};
    for (const p of library.projects) {
      files[`${p.id}.json`] = { content: JSON.stringify(serializeProject(p), null, 2) };
    }
    return files;
  }

  function parseProjectFromGist(file, idFromFilename) {
    if (!file || typeof file.content !== 'string') return null;
    try {
      const data = JSON.parse(file.content);
      data.id = data.id || idFromFilename;
      return normalizeProject(data, data.name || data.title);
    } catch {
      return null;
    }
  }

  function parseLibraryGist(file) {
    if (!file || typeof file.content !== 'string') return { deletedIds: [], currentProjectId: null };
    try {
      const data = JSON.parse(file.content);
      return {
        deletedIds: Array.isArray(data.deletedIds) ? data.deletedIds : [],
        currentProjectId: data.currentProjectId || null,
      };
    } catch {
      return { deletedIds: [], currentProjectId: null };
    }
  }

  function mergeTombstones(local, remote) {
    const merged = new Map();
    for (const t of local) merged.set(t.id, t);
    for (const t of remote) {
      const ex = merged.get(t.id);
      if (!ex || (t.deletedAt || 0) > (ex.deletedAt || 0)) merged.set(t.id, t);
    }
    return Array.from(merged.values());
  }

  // Push local changes to the gist. Only uploads projects that were edited
  // since the last successful push (pushDirty) or that don't exist on the
  // remote yet — re-uploading the entire library on every keystroke-debounced
  // push is slow and wasteful once projects contain embedded images.
  //
  // Deletions are driven strictly by tombstones. Deleting any remote file
  // that merely isn't in the local library is dangerous: if a large project
  // failed to download or parse during the pull (network blip, >1 MB gist
  // truncation), it never joins the local library and would be wiped from
  // the remote by the very next push.
  async function syncPush(remoteSnapshot) {
    const pushing = new Set(pushDirty);
    pushDirty.clear();

    const remoteFiles = (remoteSnapshot && remoteSnapshot.files) || null;
    const files = {};
    for (const p of library.projects) {
      const name = `${p.id}.json`;
      const missingOnRemote = !remoteFiles || !remoteFiles[name];
      if (pushing.has(p.id) || missingOnRemote) {
        files[name] = { content: JSON.stringify(serializeProject(p), null, 2) };
      }
    }
    files[SYNC_LIBRARY_FILE] = buildLibraryGistFile();

    // A tombstoned id can still be alive locally: if the project was edited
    // on another machine after the deletion, the pull resurrects it. Only
    // delete remote files whose id is tombstoned AND not in the local library.
    const tombIds = new Set((library.deletedIds || []).map(t => t.id));
    const localIds = new Set(library.projects.map(p => p.id));
    if (remoteFiles) {
      for (const name of Object.keys(remoteFiles)) {
        if (name === SYNC_LIBRARY_FILE) continue;
        const id = name.replace(/\.json$/i, '');
        if (tombIds.has(id) && !localIds.has(id) && !files[name]) files[name] = null;
      }
    } else {
      for (const id of tombIds) {
        if (!localIds.has(id)) files[`${id}.json`] = null;
      }
    }

    try {
      await gistPatch(sync.gistId, files);
    } catch (e) {
      // Re-queue what we tried to push so the next attempt retries it.
      pushing.forEach(id => pushDirty.add(id));
      throw e;
    }
  }

  async function syncNow({ silent = false } = {}) {
    if (sync.status === 'off') return;
    if (sync.inFlight) return sync.inFlight;
    // Silent (automatic) syncs respect the pause; a manual "Sync now" is
    // allowed to probe in case the limit has lifted early.
    if (silent && isRateLimited()) { schedulePush(); return; }
    if (sync.pushTimer) { clearTimeout(sync.pushTimer); sync.pushTimer = null; }
    sync.status = 'syncing';
    sync.error = null;
    updateSyncPill();
    renderSyncModal();
    captureCurrentContent();
    if (state) markDirty(state.id);
    await flushDirty();

    sync.inFlight = (async () => {
      try {
        // Pull first, then push the merged state — keeps both sides in lockstep.
        // On silent (auto) syncs, protect the open project from being clobbered
        // by remote state — prevents the user's in-progress edits from being
        // reverted mid-stream. Manual "Sync now" still replaces everything.
        const remoteBefore = await gistGetResolved(sync.gistId);
        applyPulledGist(remoteBefore, { protectOpen: silent });
        // Persist pulled/merged projects to IndexedDB now — otherwise a
        // pull-then-close session leaves the local store stale.
        await flushDirty();
        await syncPush(remoteBefore);
        sync.lastSync = Date.now();
        sync.status = 'idle';
        sync.error = null;
        persistSyncConfig();
        // A push may have changed what's on the gist (tombstone cleanup,
        // uploads) — keep the Projects modal's remote panel from going
        // stale while it's open, or its actions can target missing files.
        if (!els.projectsModal.hidden) refreshRemoteProjectsList();
      } catch (e) {
        sync.status = 'error';
        sync.error = e.message || String(e);
        if (!silent) console.warn('sync failed:', e);
      } finally {
        sync.inFlight = null;
        updateSyncPill();
        renderSyncModal();
      }
    })();
    return sync.inFlight;
  }

  // Pulled-gist application split out so syncNow can reuse the fetched data.
  // `protectOpen` skips replacing the currently-open project even if remote
  // looks newer — protects in-progress edits from clock-skew or simultaneous
  // edits on another machine during an auto-push cycle.
  function applyPulledGist(remote, { protectOpen = false } = {}) {
    if (!remote || !remote.files) return;
    const files = remote.files;
    const remoteLib = parseLibraryGist(files[SYNC_LIBRARY_FILE]);
    ensureDeletedIds();

    const remoteProjects = [];
    for (const name of Object.keys(files)) {
      if (name === SYNC_LIBRARY_FILE) continue;
      const idFromName = name.replace(/\.json$/i, '');
      const p = parseProjectFromGist(files[name], idFromName);
      if (p) remoteProjects.push(p);
    }

    const tombstones = mergeTombstones(library.deletedIds, remoteLib.deletedIds);
    const tombMap = new Map(tombstones.map(t => [t.id, t.deletedAt || 0]));
    const localById = new Map(library.projects.map(p => [p.id, p]));
    const openId = state && state.id;

    for (const p of [...library.projects]) {
      if (protectOpen && p.id === openId) continue;
      const ts = tombMap.get(p.id);
      if (ts && ts > (p.modifiedAt || 0)) {
        const idx = library.projects.indexOf(p);
        if (idx >= 0) library.projects.splice(idx, 1);
        deleteProjectRecord(p.id);
        localById.delete(p.id);
      }
    }
    for (const rp of remoteProjects) {
      const ts = tombMap.get(rp.id);
      if (ts && ts > (rp.modifiedAt || 0)) continue;
      const lp = localById.get(rp.id);
      if (!lp) {
        library.projects.push(rp);
        markDirty(rp.id);
      } else if ((rp.modifiedAt || 0) > (lp.modifiedAt || 0)) {
        if (protectOpen && lp.id === openId) continue;
        Object.assign(lp, rp);
        markDirty(lp.id);   // persist the merged version — IDB still has the old one
        if (state && state.id === lp.id) renderAll();
      }
    }
    if (library.projects.length === 0) {
      const fresh = blankProject();
      library.projects.push(fresh);
      state = fresh;
      library.currentProjectId = fresh.id;
      markEdited(fresh.id);
      renderAll();
    } else if (!library.projects.some(p => p.id === library.currentProjectId)) {
      state = library.projects[0];
      library.currentProjectId = state.id;
      renderAll();
    } else {
      renderSidebar();
    }
    library.deletedIds = tombstones;
    metaDirty = true;
  }

  // Hard-reset: replace the gist with local state, dropping anything remote-only.
  async function syncResetGist() {
    if (!(await dialogs.confirm('Replace the remote gist with this browser\'s state? Anything on the gist that isn\'t local will be deleted.', { title: 'Reset remote gist', confirmLabel: 'Replace remote', kind: 'danger' }))) return;
    sync.status = 'syncing';
    updateSyncPill();
    renderSyncModal();
    // Fold the open slide's in-flight edits into state before serializing, and
    // cancel any pending auto-push so it can't race the reset PATCH.
    captureCurrentContent();
    if (sync.pushTimer) { clearTimeout(sync.pushTimer); sync.pushTimer = null; }
    try {
      const remote = await gistGet(sync.gistId);
      // Mark every existing remote file null, then add local files back.
      const files = {};
      for (const name of Object.keys(remote.files || {})) files[name] = null;
      Object.assign(files, buildProjectGistFiles(), { [SYNC_LIBRARY_FILE]: buildLibraryGistFile() });
      await gistPatch(sync.gistId, files);
      pushDirty.clear();   // everything was just uploaded
      sync.lastSync = Date.now();
      sync.status = 'idle';
      sync.error = null;
      persistSyncConfig();
    } catch (e) {
      sync.status = 'error';
      sync.error = e.message || String(e);
    }
    updateSyncPill();
    renderSyncModal();
    // Re-read the gist so the Projects list reflects the just-pushed state.
    refreshRemoteProjectsList();
  }

  // Schedule a debounced push after local edits.
  function schedulePush() {
    if (sync.status === 'off') return;
    clearTimeout(sync.pushTimer);
    // While rate-limited, defer the push to just past the reset instead of
    // retrying every few seconds — each 403 still counts against the quota.
    // Edits stay queued in pushDirty and go up in that one deferred sync.
    const delay = isRateLimited()
      ? Math.max(SYNC_AUTO_PUSH_MS, sync.rateLimitedUntil - Date.now() + 2000)
      : SYNC_AUTO_PUSH_MS;
    sync.pushTimer = setTimeout(() => {
      sync.pushTimer = null;
      syncNow({ silent: true });
    }, delay);
  }

  // -------- Sync modal --------
  function openSyncModal() {
    renderSyncModal();
    els.syncModal.hidden = false;
    focusModal(els.syncModal);
  }

  function closeSyncModal() {
    els.syncModal.hidden = true;
    restoreModalFocus();
  }

  function renderSyncModal() {
    const configured = !!(sync.pat && sync.gistId);
    els.syncSetup.hidden = configured;
    els.syncConnected.hidden = !configured;
    if (configured) {
      els.syncStatusText.textContent = (sync.status === 'error' && isRateLimited())
        ? `rate limited until ${formatClockTime(sync.rateLimitedUntil)}`
        : sync.status;
      els.syncLast.textContent = sync.lastSync ? formatRelative(sync.lastSync) : 'never';
      els.syncGistLink.href = `https://gist.github.com/${sync.gistId}`;
      els.syncGistIdDisplay.textContent = sync.gistId;
      if (sync.error) {
        els.syncError.hidden = false;
        els.syncError.textContent = sync.error;
      } else {
        els.syncError.hidden = true;
        els.syncError.textContent = '';
      }
      els.syncNow.disabled = sync.status === 'syncing';
    } else {
      els.syncPat.value = '';
      els.syncGistId.value = '';
    }
  }

  async function syncConnect() {
    const pat = els.syncPat.value.trim();
    const gistId = els.syncGistId.value.trim();
    if (!pat) { dialogs.alert('Paste a personal access token first.', { title: 'Token required', kind: 'warning' }); return; }
    sync.pat = pat;
    sync.gistId = gistId || null;
    sync.status = 'syncing';
    sync.error = null;
    updateSyncPill();
    try {
      // Validate the token by hitting /user.
      await gistFetch('/user');
      if (!sync.gistId) {
        const created = await gistCreate(
          { [SYNC_LIBRARY_FILE]: buildLibraryGistFile(), ...buildProjectGistFiles() },
          'Revealation projects (sync)',
        );
        sync.gistId = created.id;
        pushDirty.clear();   // everything was just uploaded

      }
      persistSyncConfig();
      sync.status = 'idle';
      renderSyncModal();
      await syncNow();
    } catch (e) {
      sync.pat = null;
      sync.gistId = gistId || null;
      sync.status = 'off';
      sync.error = e.message || String(e);
      persistSyncConfig();
      updateSyncPill();
      renderSyncModal();
      dialogs.alert('Connection failed: ' + sync.error, { title: 'Sync connection failed', kind: 'danger' });
    }
  }

  function handleEditorKeydown(event) {
    if (richText?.handleListTab?.(event, els.editor, {
      beforeChange: recordHistory,
      afterChange: (node) => onEditorInput({ target: node }),
    })) return true;
    if (richText?.handleSelectAll?.(event, els.editor)) {
      rememberEditorRange();
      syncToolbarState();
      return true;
    }
    return false;
  }

  // -------- Wiring --------
  function wire() {
    els.workspaceChangeReload?.addEventListener('click', () => {
      reloadWorkspaceFromDisk().catch(error => {
        setStatus('Could not reload the presentation: ' + (error.message || error), false);
      });
    });
    els.workspaceChangeKeep?.addEventListener('click', async () => {
      const revision = workspaceExternalRevision?.deckToken || workspaceRevision?.deckToken || null;
      if (!revision) return;
      captureCurrentContent();
      if (state) markDirty(state.id);
      setSaveState('saving', 'Overwriting…');
      await flushDirty({ capture: false, expectedRevision: revision });
    });
    els.workspaceChangeExport?.addEventListener('click', async () => {
      captureCurrentContent();
      await exportPresentationZip(state);
    });
    els.themeSelect.addEventListener('change', () => {
      selectPresentationTheme(els.themeSelect.value);
    });
    els.deckSettingsBtn?.addEventListener('click', openDeckSettingsModal);
    els.deckSettingsClose.addEventListener('click', closeDeckSettingsModal);
    els.deckSettingsModal.addEventListener('click', (e) => {
      if (e.target === els.deckSettingsModal) closeDeckSettingsModal();
    });
    els.deckSettingsName?.addEventListener('input', () => {
      snapshotForTextField('deckSettingsName');
      state.title = els.deckSettingsName.value;
      state.name = els.deckSettingsName.value;
      els.deckTitle.textContent = els.deckSettingsName.value || 'Untitled presentation';
      scheduleSave();
    });
    els.deckSettingsName?.addEventListener('blur', endTextEditSession);
    els.deckSettingsAuthor?.addEventListener('input', () => {
      snapshotForTextField('deckSettingsAuthor');
      state.author = els.deckSettingsAuthor.value;
      scheduleSave();
    });
    els.deckSettingsAuthor?.addEventListener('blur', endTextEditSession);
    els.themeChoices?.addEventListener('click', event => {
      const button = event.target.closest('[data-theme-id]');
      if (!button) return;
      selectPresentationTheme(button.dataset.themeId || '');
    });

    els.addSlide.addEventListener('click', () => openNewSlideLayoutModal());

    // Double-clicking the empty area below the slide list appends a new
    // slide at the end of the deck.
    els.slideList.addEventListener('dblclick', (e) => {
      if (e.target === els.slideList) openNewSlideLayoutModal({ atEnd: true });
    });

    els.editor.addEventListener('focusin', () => { contentNormalization?.setDefaultParagraphSeparator(); });
    els.editor.addEventListener('keydown', handleEditorKeydown);
    els.editor.addEventListener('beforeinput', (e) => { layoutBlocks?.guardBeforeInput(e, els.editor); });
    els.editor.addEventListener('input', onEditorInput);
    // Commit once more when WYSIWYG focus leaves the slide. This is a
    // deliberately redundant safety net for browser/IME edit sequences that
    // may coalesce input events immediately before sidebar navigation.
    els.editor.addEventListener('focusout', (event) => {
      if (sourceMode) return;
      // Sidebar/context-menu actions either select a slide (which captures
      // explicitly) or mutate slide metadata without touching the WYSIWYG
      // content. Do not let focus movement for those actions sweep an
      // incomplete protected layout and report a misleading save error.
      const next = event.relatedTarget;
      if (next && (els.slideList.contains(next) || els.slideMenu.contains(next))) return;
      captureCurrentContent();
    });
    els.source.addEventListener('input', onEditorInput);

    document.addEventListener('selectionchange', () => {
      rememberEditorRange();
      syncFragmentDropdown();
      syncToolbarState();
    });

    const toggleMarkdownMode = () => {
      if (!els.helpModal.hidden) closeHelpModal();
      if (markdownMode) closeMarkdownMode();
      else openMarkdownMode();
    };
    [els.markdownBtn, els.markdownToolbarBtn].filter(Boolean).forEach(button => {
      button.addEventListener('click', toggleMarkdownMode);
    });
    els.markdownRecover?.addEventListener('click', () => {
      if (!els.helpModal.hidden) closeHelpModal();
      openMarkdownRecoveryMode();
    });
    els.exportButton?.addEventListener('click', openExportModal);
    els.exportClose?.addEventListener('click', closeExportModal);
    els.exportModal?.addEventListener('click', (e) => {
      if (e.target === els.exportModal) closeExportModal();
    });
    if (els.exportHtmlBtn) els.exportHtmlBtn.addEventListener('click', () => {
      closeExportModal();
      exportStandaloneHtml(state, {
        revealConfig: {
          controls: els.exportHtmlControls?.checked !== false,
          progress: els.exportHtmlProgress?.checked !== false,
        },
      });
    });
    if (els.exportZipBtn) els.exportZipBtn.addEventListener('click', () => {
      closeExportModal();
      exportPresentationZip(state);
    });
    const pdfBtn = $('#btn-export-pdf');
    if (pdfBtn) pdfBtn.addEventListener('click', () => {
      closeExportModal();
      exportProjectAsPdf(state.id);
    });
    els.markdownApply.addEventListener('click', () => { applyAndCloseMarkdownMode(); });
    els.markdownClose.addEventListener('click', () => { closeMarkdownMode(); });
    els.markdownText.addEventListener('input', () => {
      setMarkdownStatus(els.markdownText.value === markdownBaseline ? '' : 'Unapplied changes');
      updateMarkdownHighlight();
      if (markdownNavTimer) clearTimeout(markdownNavTimer);
      markdownNavTimer = setTimeout(() => { markdownNavTimer = null; refreshMarkdownNavigation(); }, 140);
    });
    els.markdownText.addEventListener('scroll', syncMarkdownHighlightScroll);
    els.markdownText.addEventListener('click', updateMarkdownNavActive);
    els.markdownText.addEventListener('keyup', updateMarkdownNavActive);
    els.markdownText.addEventListener('select', updateMarkdownNavActive);

    els.codeClose.addEventListener('click', closeCodeModal);
    els.codeCancel.addEventListener('click', closeCodeModal);
    els.codeInsert.addEventListener('click', commitCodeModal);
    els.codeModal.addEventListener('click', (e) => { if (e.target === els.codeModal) closeCodeModal(); });
    els.codeText.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); commitCodeModal(); }
    });

    els.mathClose.addEventListener('click', closeMathModal);
    els.mathCancel.addEventListener('click', closeMathModal);
    els.mathInsert.addEventListener('click', commitMathModal);
    els.mathModal.addEventListener('click', (e) => { if (e.target === els.mathModal) closeMathModal(); });
    els.mathText.addEventListener('input', renderMathDialogPreview);
    els.mathDisplay.addEventListener('change', renderMathDialogPreview);
    els.mathText.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); commitMathModal(); }
    });

    els.layoutClose.addEventListener('click', closeLayoutModal);
    els.layoutModal.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-layout]');
      if (btn) { insertLayout(btn.dataset.layout); return; }
      if (e.target === els.layoutModal) closeLayoutModal();
    });

    els.backgroundButton?.addEventListener('click', openBackgroundModal);
    els.backgroundClose?.addEventListener('click', closeBackgroundModal);
    els.backgroundModal?.addEventListener('click', (e) => {
      if (e.target === els.backgroundModal) closeBackgroundModal();
    });

    els.interactiveClose.addEventListener('click', closeInteractiveModal);
    els.interactiveCancel.addEventListener('click', closeInteractiveModal);
    els.interactiveInsert.addEventListener('click', commitInteractiveModal);
    els.interactiveModal.addEventListener('click', (e) => { if (e.target === els.interactiveModal) closeInteractiveModal(); });
    els.interactiveSrc.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); commitInteractiveModal(); }
    });

    els.assetsClose.addEventListener('click', closeAssetsModal);
    els.assetsSearch.addEventListener('input', () => {
      assetQuery = els.assetsSearch.value.trim().toLowerCase();
      renderAssetsModal();
    });
    if (els.assetsRefresh) els.assetsRefresh.addEventListener('click', async () => { await refreshWorkspaceFiles(); renderAssetsModal(); });
    els.assetsModal.addEventListener('click', (e) => { if (e.target === els.assetsModal) closeAssetsModal(); });
    els.assetFileInput.addEventListener('change', async () => {
      await addFilesToAssetLibrary(els.assetFileInput.files);
      els.assetFileInput.value = '';
    });

    // Clicking an image/video selects it for resizing and playback options.
    // The selection box itself is outside contenteditable, so it is never
    // stored in slide HTML.
    els.editor.addEventListener('pointerdown', (e) => {
      const media = mediaFromTarget(e.target);
      if (media) selectMedia(media);
      else clearMediaSelection();
    });
    els.editor.addEventListener('scroll', positionMediaSelection);
    let selectionFrame = 0;
    const scheduleSelectionPosition = () => {
      if (selectionFrame) return;
      selectionFrame = requestAnimationFrame(() => {
        selectionFrame = 0;
        positionMediaSelection();
      });
    };
    if (typeof ResizeObserver !== 'undefined') {
      const selectionResizeObserver = new ResizeObserver(scheduleSelectionPosition);
      selectionResizeObserver.observe(els.editor);
      selectionResizeObserver.observe(els.frame);
    }
    if (typeof MutationObserver !== 'undefined') {
      const selectionMutationObserver = new MutationObserver(scheduleSelectionPosition);
      selectionMutationObserver.observe(els.editor, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'src'] });
    }
    els.editor.addEventListener('load', (e) => {
      handleEditorIntrinsicLoad(e);
      scheduleSelectionPosition();
    }, true);
    // Video intrinsic dimensions become reliable at loadedmetadata rather than
    // the generic load event. Treat them like delayed image loads for centering.
    els.editor.addEventListener('loadedmetadata', (e) => {
      handleEditorIntrinsicLoad(e);
      scheduleSelectionPosition();
    }, true);
    els.mediaSelection?.querySelectorAll('[data-media-resize]').forEach(handle => {
      handle.addEventListener('pointerdown', startMediaResize);
    });

    els.mediaWidth.addEventListener('input', () => {
      if (!selectedMediaEl) return;
      if (!mediaWidthEditing) { recordHistory(); mediaWidthEditing = true; }
      setSelectedMediaWidth(els.mediaWidth.value);
    });
    els.mediaWidth.addEventListener('change', () => { mediaWidthEditing = false; });
    els.mediaWidth.addEventListener('blur', () => { mediaWidthEditing = false; });
    els.mediaResetSize.addEventListener('click', resetSelectedMediaSize);
    els.mediaResetCrop?.addEventListener('click', resetSelectedMediaCrop);
    els.mediaCaption.addEventListener('change', () => setSelectedMediaCaption(els.mediaCaption.value));
    els.videoAutoplay.addEventListener('change', () => setSelectedVideoOption('autoplay', els.videoAutoplay.checked));
    els.videoControls.addEventListener('change', () => setSelectedVideoOption('controls', els.videoControls.checked));
    els.videoLoop.addEventListener('change', () => setSelectedVideoOption('loop', els.videoLoop.checked));
    els.videoMuted.addEventListener('change', () => setSelectedVideoOption('muted', els.videoMuted.checked));
    els.interactiveHeight.addEventListener('change', () => setSelectedInteractiveHeight(els.interactiveHeight.value));
    els.interactiveEnabled.addEventListener('change', () => setSelectedInteractiveOption('interactive', els.interactiveEnabled.checked));
    els.interactivePreload.addEventListener('change', () => setSelectedInteractiveOption('preload', els.interactivePreload.checked));
    els.interactiveBorder.addEventListener('change', () => setSelectedInteractiveOption('border', els.interactiveBorder.checked));
    els.interactiveScrollbars.addEventListener('change', () => setSelectedInteractiveOption('scrollbars', els.interactiveScrollbars.checked));
    els.interactiveEdit.addEventListener('click', () => { if (isInteractiveElement(selectedMediaEl)) openInteractiveModal(selectedMediaEl); });

    els.editor.addEventListener('dblclick', (e) => {
      const math = e.target.closest('.sr-math');
      if (math && els.editor.contains(math)) { e.preventDefault(); openMathModal(math); return; }
      // RV-COMPAT(interactive-demo): REMOVE `.sr-demo` BEFORE PUBLIC RELEASE.
      const demo = e.target.closest('.sr-interactive, .sr-demo');
      if (demo && els.editor.contains(demo)) { e.preventDefault(); openInteractiveModal(demo); return; }
      const pre = e.target.closest('pre.sr-code');
      if (pre && els.editor.contains(pre)) { e.preventDefault(); openCodeModal(pre); }
    });

    els.blockStyle.addEventListener('change', () => {
      const style = els.blockStyle.value;
      if (!style) return;
      applyParagraphStyle(style);
    });

    els.undoBtn.addEventListener('click', undo);
    els.redoBtn.addEventListener('click', redo);

    // Stop toolbar buttons from stealing focus from the editor — otherwise
    // contenteditable loses its selection before the click handler runs.
    els.toolbar.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) e.preventDefault();
    });

    els.toolbar.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      if (btn === els.undoBtn) { undo(); return; }
      if (btn === els.redoBtn) { redo(); return; }
      const cmd = btn.dataset.cmd;
      const arg = btn.dataset.arg || null;
      const action = btn.dataset.action;
      if (cmd) {
        recordHistory();
        execCmd(cmd, arg);
      } else if (action) {
        // Actions snapshot history themselves, once they know they'll
        // actually change something — a cancelled Link/Image prompt must
        // not leave a no-op undo entry behind.
        handleToolbarAction(action);
      }
      syncToolbarState();
    });

    els.toggleSource.addEventListener('click', () => {
      captureCurrentContent();
      clearMediaSelection();
      sourceMode = !sourceMode;
      els.editor.hidden = sourceMode;
      els.source.hidden = !sourceMode;
      syncToolbarState();
      renderEditor();
    });

    els.bgChoices?.addEventListener('click', event => {
      const button = event.target.closest('[data-background-id]');
      if (!button) return;
      const id = String(button.dataset.backgroundId || '');
      const slide = currentSlide();
      if (!slide) return;
      // RV-COMPAT(background-reveal): choosing a curated background replaces raw legacy metadata.
    if (backgroundExtensionId(slide.background) === id && !legacyBackground(slide.background)) return;
      recordHistory();
      slide.background = { id };
      renderBackgroundChoices();
      applyEditorBackground();
      renderSidebar();
      scheduleSave();
      if (els.backgroundModal && !els.backgroundModal.hidden) closeBackgroundModal();
    });
    els.subslide.addEventListener('change', () => {
      recordHistory();
      // RV-COMPAT(subslide-vertical): persisted field remains `vertical` until pre-release cleanup.
      currentSlide().vertical = els.subslide.checked;
      renderSidebar();
      scheduleSave();
    });
    els.wip.addEventListener('change', () => {
      recordHistory();
      currentSlide().underConstruction = els.wip.checked;
      renderSidebar();
      scheduleSave();
    });
    els.hiddenSlide?.addEventListener('change', () => {
      recordHistory();
      currentSlide().hidden = els.hiddenSlide.checked;
      renderSidebar();
      scheduleSave();
    });
    els.fileInput?.addEventListener('change', () => {
      const file = els.fileInput.files && els.fileInput.files[0];
      const linkHref = els.fileInput.dataset.linkHref || null;
      delete els.fileInput.dataset.linkHref;
      if (file) insertImageFromFile(file, linkHref);
      els.fileInput.value = '';
    });

    $('#btn-preview').addEventListener('click', () => startPresentation());
    $('#btn-preview-here').addEventListener('click', () => startPresentation({ fromCurrent: true }));
    $('#btn-new').addEventListener('click', () => { if (!els.helpModal.hidden) closeHelpModal(); createProject(); });
    // The presentation iframe forwards Escape / Cmd+P here (see preview.js): key
    // events don't cross the frame boundary, so the document-level handler
    // below never sees them while the deck has focus. Verify the sender by
    // window identity rather than origin so this keeps working if
    // preview.html is hosted on a separate subdomain.
    window.addEventListener('message', (ev) => {
      if ((ev.data?.type === 'speaker-opening' || ev.data?.type === 'speaker-opened')
          && ev.source === els.presentFrame.contentWindow) {
        speakerViewOpen = true;
        return;
      }
      if (ev.data?.type === 'speaker-closed' && ev.source === els.presentFrame.contentWindow) {
        speakerViewOpen = false;
        return;
      }
      if (ev.data?.type === 'slide-position' && ev.source === els.presentFrame.contentWindow) {
        presentationPosition = { h: ev.data.h | 0, v: ev.data.v | 0 };
        return;
      }
      if (ev.data?.type !== 'close-preview') return;
      if (ev.source !== els.presentFrame.contentWindow) return;
      if (!els.presentModal.hidden) closePresentation();
    });
    // Escape is consumed by the browser when document fullscreen is active,
    // so the iframe never gets a keydown to forward. Treat leaving fullscreen
    // while Present is open as leaving Present too; this makes one Escape
    // close both the presentation and its speaker view.
    document.addEventListener('fullscreenchange', () => {
      if (els.presentModal.hidden || window.Revealation?.platform?.isFullscreen?.() || speakerViewOpen) return;
      // Speaker view opening and fullscreen changes are separate browser
      // tasks. Give the speaker-opening message a chance to arrive before
      // treating the fullscreen exit as an intentional Present exit.
      setTimeout(() => {
        if (!els.presentModal.hidden && !window.Revealation?.platform?.isFullscreen?.() && !speakerViewOpen) {
          closePresentation();
        }
      }, 0);
    });
    els.settingsThemeLight?.addEventListener('click', () => setUiTheme('light'));
    els.settingsThemeDark?.addEventListener('click', () => setUiTheme('dark'));
    els.notesToggle?.addEventListener('click', toggleNotesPanel);
    els.notesPanelClose.addEventListener('click', closeNotesPanel);
    els.notesPanelText.addEventListener('input', () => {
      snapshotForTextField('notes');
      const slide = currentSlide();
      if (!slide) return;
      slide.notes = els.notesPanelText.value;
      scheduleSave();
    });
    els.notesPanelText.addEventListener('blur', endTextEditSession);

    // Small-screen chrome. Each of these drives a control the desktop layout
    // already owns, so none of them carries editor logic of its own.
    els.mobileMenuBtn.addEventListener('click', openAppMenu);
    els.slidesClose.addEventListener('click', closeSlidesDrawer);
    els.mobileScrim.addEventListener('click', closeMobileLayers);
    els.mPicker.addEventListener('click', openSlidesDrawer);
    els.mPrev.addEventListener('click', () => stepSlide(-1));
    els.mNext.addEventListener('click', () => stepSlide(1));
    els.mAdd.addEventListener('click', () => openNewSlideLayoutModal());
    // Rotating a phone, or dragging a desktop window across the breakpoint,
    // otherwise leaves a drawer open with nowhere for it to sit.
    mobileMq.addEventListener('change', (e) => {
      if (!e.matches) closeMobileLayers();
      updateStageScale();
    });
    if (window.visualViewport) {
      syncViewportHeight();
      window.visualViewport.addEventListener('resize', () => {
        syncViewportHeight();
        updateStageScale();
      });
    }

    // About modal. Identity and links live in the application namespace so the
    // shell does not become a second source of truth for product metadata.
    function renderAboutModal() {
      els.appName.textContent = APP_INFO.name;
      els.aboutTitle.textContent = 'About ' + APP_INFO.name;
      els.aboutBody.replaceChildren();

      const logo = document.createElement('div');
      logo.className = 'about-logo';
      logo.setAttribute('role', 'img');
      logo.setAttribute('aria-label', APP_INFO.name + ' project logo');
      const logoImage = document.createElement('img');
      logoImage.src = window.Revealation?.urls?.app('logo/revealation_logo.png') || './__app__/logo/revealation_logo.png';
      logoImage.alt = '';
      logoImage.setAttribute('aria-hidden', 'true');
      logo.appendChild(logoImage);
      els.aboutBody.appendChild(logo);

      const heading = document.createElement('h3');
      heading.textContent = APP_INFO.name;
      els.aboutBody.appendChild(heading);
      const tagline = document.createElement('p');
      tagline.className = 'about-tagline';
      tagline.textContent = APP_INFO.tagline || '';
      els.aboutBody.appendChild(tagline);

      const description = document.createElement('p');
      description.textContent = APP_INFO.description || '';
      els.aboutBody.appendChild(description);

      const details = document.createElement('dl');
      details.className = 'about-details';
      const addDetail = (label, value, href) => {
        const term = document.createElement('dt');
        term.textContent = label;
        const definition = document.createElement('dd');
        if (href) {
          const link = document.createElement('a');
          link.href = href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = value;
          definition.appendChild(link);
        } else definition.textContent = value;
        details.append(term, definition);
      };
      const runtimePlatform = window.Revealation?.platform?.kind || 'browser';
      const platformLabel = runtimePlatform === 'browser'
        ? 'Browser · hosted static/PWA shell'
        : runtimePlatform;
      const backendLabel = workspaceMode
        ? (workspaceInfo?.kind === 'server'
          ? 'Python workspace server'
          : 'Local folder · File System Access API')
        : 'Browser storage · IndexedDB';
      addDetail('Version', APP_VERSION);
      addDetail('Platform', platformLabel);
      addDetail('Backend', backendLabel);
      addDetail('Project', APP_INFO.projectLabel || APP_INFO.projectUrl, APP_INFO.projectUrl);
      addDetail('Presentation engine', APP_INFO.revealLabel || APP_INFO.revealUrl, APP_INFO.revealUrl);
      addDetail('License', APP_INFO.license || '');
      els.aboutBody.appendChild(details);
    }
    const openAboutModal = () => {
      els.aboutModal.hidden = false;
      focusModal(els.aboutModal);
    };
    const closeAboutModal = () => { els.aboutModal.hidden = true; restoreModalFocus(); };
    renderAboutModal();
    els.appBrand.addEventListener('click', openAboutModal);
    els.aboutClose.addEventListener('click', closeAboutModal);
    els.aboutModal.addEventListener('click', (e) => {
      if (e.target === els.aboutModal) closeAboutModal();
    });

    // Settings modal
    els.settingsButton.addEventListener('click', openSettingsModal);
    els.settingsClose.addEventListener('click', closeSettingsModal);
    els.settingsModal.addEventListener('click', (e) => {
      if (e.target === els.settingsModal) closeSettingsModal();
    });

    // Help modal
    els.helpButton.addEventListener('click', openHelpModal);
    els.helpClose.addEventListener('click', closeHelpModal);
    els.helpModal.addEventListener('click', (e) => {
      if (e.target === els.helpModal) closeHelpModal();
    });

    // PWA update and browser-directory workspace controls.
    els.pwaUpdateLater?.addEventListener('click', () => { els.pwaUpdateBanner.hidden = true; });
    els.pwaUpdateNow?.addEventListener('click', async () => {
      if (saveTimer != null) { clearTimeout(saveTimer); saveTimer = null; }
      captureCurrentContent();
      if (state) markDirty(state.id);
      const saved = await flushDirty({ capture: false });
      if (!saved) {
        setStatus('Update postponed because the current presentation could not be saved', false);
        return;
      }
      if (!pwaRuntime?.activateUpdate?.()) {
        els.pwaUpdateBanner.hidden = true;
        setStatus('Update is no longer waiting; checking again', true);
        pwaRuntime?.checkForUpdates?.();
      }
    });
    els.workspaceFolderButton?.addEventListener('click', async () => {
      if (workspaceInfo?.kind !== 'directory' || !directoryWorkspaceStorage) return;
      if (!els.helpModal.hidden) closeHelpModal();
      if (saveTimer != null) { clearTimeout(saveTimer); saveTimer = null; }
      captureCurrentContent();
      if (state) markDirty(state.id);
      const saved = await flushDirty({ capture: false });
      if (!saved) {
        setStatus('Project switch was cancelled because the current presentation could not be saved', false);
        return;
      }
      const choice = await chooseDirectoryWorkspace({ allowCancel: true });
      // `true` means a directory was activated, `false` means browser storage;
      // both require a clean reinitialization of the storage model. `null` is
      // the explicit Cancel action and leaves the current folder untouched.
      if (choice !== null) globalThis.location.reload();
    });
    els.workspaceOpenButton?.addEventListener('click', async () => {
      if (workspaceInfo?.kind !== 'directory' || !directoryWorkspaceStorage) return;
      if (saveTimer != null) { clearTimeout(saveTimer); saveTimer = null; }
      captureCurrentContent();
      if (state) markDirty(state.id);
      const saved = await flushDirty({ capture: false });
      if (!saved) {
        setStatus('Project switch was cancelled because the current presentation could not be saved', false);
        return;
      }
      const choice = await chooseDirectoryWorkspace({ allowCancel: true });
      if (choice !== null) globalThis.location.reload();
    });

    // Projects modal
    els.projectsButton.addEventListener('click', () => { if (!els.helpModal.hidden) closeHelpModal(); openProjectsModal(); });
    els.projectsClose.addEventListener('click', closeProjectsModal);
    els.projectsNew.addEventListener('click', newProject);
    els.projectsExportAll.addEventListener('click', exportAllAsZip);
    els.projectsImportInput.addEventListener('change', () => {
      const files = els.projectsImportInput.files;
      if (files && files.length) importFiles(files);
      els.projectsImportInput.value = '';
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', async (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const inEditor = e.target === els.editor || els.editor.contains(e.target);
      const inTextControl = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
      const inModal = e.target.closest?.('.modal:not([hidden]), dialog[open]');
      if (!mod && !inEditor && !inTextControl && !inModal
          && ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        stepSlide(e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      if (e.key === 'Delete' && selectedMediaEl && selectedMediaEl.isConnected
          && !markdownMode && !sourceMode && inEditor) {
        e.preventDefault();
        e.stopPropagation();
        removeSelectedMedia();
        return;
      }
      if (mod && e.altKey && (e.key === 'u' || e.key === 'U') && !markdownMode && !sourceMode && !inModal
          && (!inTextControl || inEditor)) {
        e.preventDefault();
        toggleSlideUnderConstruction(state.currentId);
      }
      else if (mod && e.shiftKey && (e.key === 'M' || e.key === 'm') && !inModal) {
        e.preventDefault();
        if (markdownMode) await closeMarkdownMode();
        else await openMarkdownMode();
      }
      else if (mod && e.key === 's') {
        e.preventDefault();
        if (markdownMode) await applyAndCloseMarkdownMode({ save: true });
        else saveProject();
      }
      else if (mod && e.shiftKey && e.key === 'Enter') { e.preventDefault(); openNewSlideLayoutModal(); }
      else if (mod && e.shiftKey && e.key === ',') { e.preventDefault(); openDeckSettingsModal(); }
      else if (mod && !e.shiftKey && e.key === ',') { e.preventDefault(); openSettingsModal(); }
      else if (mod && e.shiftKey && (e.key === 'E' || e.key === 'e')) { e.preventDefault(); openExportModal(); }
      else if (!mod && e.key === 'F1') { e.preventDefault(); openHelpModal(); }
      else if (mod && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        // Cmd/Ctrl+P toggles Present mode. The iframe forwards the same
        // shortcut while it has focus, so returning to the editor is quick.
        if (!els.presentModal.hidden) closePresentation();
        else startPresentation({ fromCurrent: e.shiftKey });
      }
      // Undo/redo: only when focus is OUTSIDE the slide editor, so the
      // browser's native contenteditable undo keeps working for typing.
      else if (mod && !inEditor && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault(); redo();
      }
      else if (mod && !inEditor && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault(); undo();
      }
      else if (mod && !inEditor && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault(); redo();
      }
      else if (e.key === 'Escape') {
        if (!els.toolbarMenu.hidden) closeToolbarMenu();
        else if (!els.slideMenu.hidden) hideSlideContextMenu();
        else if (!els.presentModal.hidden) closePresentation();
        else if (!els.projectsModal.hidden) closeProjectsModal();
        else if (!els.deckSettingsModal.hidden) closeDeckSettingsModal();
        else if (!els.exportModal.hidden) closeExportModal();
        else if (!els.layoutModal.hidden) closeLayoutModal();
        else if (!els.settingsModal.hidden) closeSettingsModal();
        else if (!els.helpModal.hidden) closeHelpModal();
        else if (!els.aboutModal.hidden) { els.aboutModal.hidden = true; restoreModalFocus(); }
        else if (markdownMode) await closeMarkdownMode();
        else if (isNotesPanelOpen()) closeNotesPanel();
        else if (isMobileLayerOpen()) closeMobileLayers();
      }
    });

    // Arrow-key navigation inside the slide context menu.
    els.slideMenu.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const btns = Array.from(els.slideMenu.querySelectorAll('button:not(:disabled)'));
      if (!btns.length) return;
      const i = btns.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown'
        ? (i + 1) % btns.length
        : (i - 1 + btns.length) % btns.length;
      btns[next].focus();
    });

    els.toolbarMenu.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const btns = Array.from(els.toolbarMenu.querySelectorAll('button:not(:disabled)'));
      if (!btns.length) return;
      const i = btns.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown'
        ? (i + 1) % btns.length
        : (i - 1 + btns.length) % btns.length;
      btns[next].focus();
    });

    // Keep the caret in the editor when a menu item is clicked, exactly as
    // the toolbar itself does — otherwise contenteditable drops the range
    // before the handler runs.
    els.toolbarMenu.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) e.preventDefault();
    });

    // Dismiss menus on outside click, scroll, or window blur.
    document.addEventListener('mousedown', (e) => {
      if (!els.slideMenu.hidden && !els.slideMenu.contains(e.target)) hideSlideContextMenu();
      if (!els.toolbarMenu.hidden
          && !els.toolbarMenu.contains(e.target)
          && e.target !== toolbarMenuAnchor
          && !(toolbarMenuAnchor && toolbarMenuAnchor.contains(e.target))) {
        closeToolbarMenu(false);
      }
    });
    const dismissMenus = () => { hideSlideContextMenu(); closeToolbarMenu(false); };
    window.addEventListener('scroll', dismissMenus, true);
    window.addEventListener('blur', dismissMenus);

    setupDropZone();
    setupPaste();

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        applySlideEffects();
        positionMediaSelection();
        backgroundRegistry?.refreshPreview?.(els.bgLayer);
      }, 80);
    });

    // Flush pending work when the tab is hidden — that's the last reliable
    // moment before a close: beforeunload can't await the async IndexedDB
    // write, and a hidden-but-alive tab still completes fetches, so the
    // debounced gist push gets its chance to run instead of being dropped.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') {
        checkWorkspaceChanges({ force: true });
        return;
      }
      if (saveTimer != null) {
        clearTimeout(saveTimer);
        saveTimer = null;
        captureCurrentContent();
        saveProject();
      }
    });

    window.addEventListener('beforeunload', () => {
      // Backstop for the visibilitychange flush.
      if (saveTimer != null) {
        captureCurrentContent();
        if (workspaceMode && state && workspaceStorage?.saveBeacon) {
          workspaceStorage.saveBeacon(state, workspaceRevision?.deckToken || null);
        } else saveProject();
      }
    });

    window.addEventListener('message', (event) => {
      const request = event.data;
      if (!request || request.type !== 'revealation-platform') return;
      if (request.action === 'print') window.Revealation.platform.print?.();
      else if (request.action === 'fullscreen-enter') window.Revealation.platform.requestFullscreen?.(document.documentElement);
      else if (request.action === 'fullscreen-exit') window.Revealation.platform.exitFullscreen?.();
      else if (request.action === 'open-window') window.Revealation.platform.openWindow?.(request.url, request.target, request.features);
      else if (request.action === 'open-external') window.Revealation.platform.openExternal?.(request.url);
    });
  }

  // -------- Init --------
  window.Revealation?.ui?.applyToolbarLayout?.();
  window.Revealation?.ui?.applyTopbarLayout?.();
  loadUiTheme();
  setStatus('Loading…', false);
  try {
    await Promise.all([themeRegistry?.load?.(), backgroundRegistry?.load?.()]);
  } catch (error) {
    // A missing optional extension must not make existing decks inaccessible.
    console.error('Extension catalog loading failed', error);
  }
  populateThemeOptions();
  await detectWorkspace();
  if (!workspaceMode) await prepareHostedMode();
  library = await loadLibrary();
  state = library.projects.find(p => p.id === library.currentProjectId) || library.projects[0];
  renderAll();
  wire();
  configureWorkspaceUi();
  document.body.classList.remove('app-starting');
  if (els.appLoadingScreen) els.appLoadingScreen.hidden = true;
  setStatus(workspaceLoadWarning || (workspaceMode ? `Ready · ${workspaceInfo?.name || 'workspace'}` : 'Ready'), !workspaceLoadWarning);
  startWorkspaceMonitor();
})();
