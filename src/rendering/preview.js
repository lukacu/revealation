/**
 * Revealation — reveal.js presentation runtime
 * ============================================
 *
 * Purpose
 * -------
 * Run inside `preview.html`, receive a prepared deck payload from the editor,
 * construct reveal.js sections and initialize the presentation. The same
 * runtime serves in-editor Present mode and PDF print mode.
 *
 * Responsibilities
 * ----------------
 * - read presentation/PDF payloads from sessionStorage or parent messaging;
 * - load reveal.js/theme/plugin resources and wait for presentation-critical CSS/fonts;
 * - apply deck configuration and start position only after geometry is stable;
 * - enter reveal.js print mode when requested.
 *
 * Does NOT
 * --------
 * - edit or save a deck;
 * - parse Revealation Markdown;
 * - create the PDF file itself.
 *
 * Entry point
 * -----------
 * Loaded only by `preview.html`; it self-starts from the staged presentation/PDF
 * payload and intentionally exposes no editor-facing API.
 */
(function () {
  'use strict';

  // RV-COMPAT(preview-protocol): REMOVE/RENAME BEFORE PUBLIC RELEASE; keep in sync with src/export/pdf.js.
  var PDF_PAYLOAD_KEY = 'reveal_editor_pdf_payload';
  var PRESENTATION_PAYLOAD_PREFIX = 'revealation:presentation:';
  var speakerWindow = null;
  var speakerWindowPoll = null;

  // Reveal's notes plugin opens the speaker view directly with window.open.
  // Keep that window reachable so the editor can close it together with the
  // iframe-backed presentation.
  var nativeOpen = window.open;
  window.open = function () {
    var isSpeakerWindow = arguments[1] === 'reveal.js - Notes';
    if (isSpeakerWindow) {
      try { window.parent.postMessage({ type: 'speaker-opening' }, '*'); } catch (err) {}
    }
    var popup = nativeOpen.apply(window, arguments);
    if (isSpeakerWindow) {
      speakerWindow = popup;
      try { window.parent.postMessage({ type: 'speaker-opened' }, '*'); } catch (err) {}
      if (speakerWindowPoll) clearInterval(speakerWindowPoll);
      speakerWindowPoll = setInterval(function () {
        if (speakerWindow && !speakerWindow.closed) return;
        clearInterval(speakerWindowPoll);
        speakerWindowPoll = null;
        speakerWindow = null;
        try { window.parent.postMessage({ type: 'speaker-closed' }, '*'); } catch (err) {}
      }, 500);
    }
    return popup;
  };

  /**
   * Set one of preview.html's predeclared stylesheet links and resolve only
   * after the CSS is usable. Present mode receives its payload after the host
   * document has already loaded, so simply assigning `href` and immediately
   * initializing Reveal creates a race: Reveal can measure/center slides before
   * theme padding and typography exist.
   */
  function loadLinkedStylesheet(id, href) {
    return new Promise(function (resolve, reject) {
      var link = document.getElementById(id);
      if (!link) { reject(new Error('Missing stylesheet link #' + id)); return; }
      var done = function () { cleanup(); resolve(link); };
      var failed = function () { cleanup(); reject(new Error('Failed to load ' + href)); };
      var cleanup = function () {
        link.removeEventListener('load', done);
        link.removeEventListener('error', failed);
      };
      link.addEventListener('load', done);
      link.addEventListener('error', failed);
      link.href = href;
    });
  }

  function waitForDocumentFonts() {
    if (!document.fonts || !document.fonts.ready) return Promise.resolve();
    return Promise.resolve(document.fonts.ready).catch(function () {});
  }

  function layoutAfterPaint() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          try { if (window.Reveal && Reveal.layout) Reveal.layout(); } catch (e) {}
          resolve();
        });
      });
    });
  }

  function afterTwoPaints() {
    return new Promise(function (resolve) {
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
    });
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function afterFramePaint(frame) {
    var childPaint = Promise.resolve();
    try {
      var win = frame.contentWindow;
      if (win && typeof win.requestAnimationFrame === 'function') {
        childPaint = new Promise(function (resolve) {
          win.requestAnimationFrame(function () { win.requestAnimationFrame(resolve); });
        });
      }
    } catch (e) {}
    return childPaint.then(afterTwoPaints);
  }

  function waitForFrameMedia(doc) {
    if (!doc) return Promise.resolve();
    var pending = [];
    Array.prototype.slice.call(doc.images || []).forEach(function (image) {
      if (image.complete) return;
      pending.push(new Promise(function (resolve) {
        var done = function () {
          image.removeEventListener('load', done);
          image.removeEventListener('error', done);
          resolve();
        };
        image.addEventListener('load', done, { once: true });
        image.addEventListener('error', done, { once: true });
      }));
    });
    Array.prototype.slice.call(doc.querySelectorAll ? doc.querySelectorAll('video') : []).forEach(function (video) {
      if (video.readyState >= 1) return;
      pending.push(new Promise(function (resolve) {
        var done = function () {
          video.removeEventListener('loadedmetadata', done);
          video.removeEventListener('error', done);
          resolve();
        };
        video.addEventListener('loadedmetadata', done, { once: true });
        video.addEventListener('error', done, { once: true });
      }));
    });
    return Promise.all(pending).then(function () {});
  }

  // A load event is too early for many small interactive apps: they commonly
  // render once or twice from requestAnimationFrame, web-font completion or a
  // same-origin async DOM update. Wait for a short DOM-quiet window after load
  // (bounded so animated demos cannot block export forever), then give both
  // the child frame and print document a couple of paint opportunities.
  function waitForFrameDomQuiet(doc) {
    if (!doc || !doc.documentElement || typeof MutationObserver === 'undefined') return delay(180);
    return new Promise(function (resolve) {
      var done = false;
      var quietTimer = null;
      var maxTimer = null;
      var observer = null;
      var finish = function () {
        if (done) return;
        done = true;
        if (quietTimer) clearTimeout(quietTimer);
        if (maxTimer) clearTimeout(maxTimer);
        if (observer) observer.disconnect();
        resolve();
      };
      var armQuiet = function () {
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, 220);
      };
      try {
        observer = new MutationObserver(armQuiet);
        observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
        armQuiet();
        maxTimer = setTimeout(finish, 1400);
      } catch (e) {
        finish();
      }
    });
  }

  function settlePrintFrame(frame) {
    var doc = null;
    try { doc = frame.contentDocument; } catch (e) {}
    var waits = [];
    if (doc) {
      if (doc.fonts && doc.fonts.ready) waits.push(Promise.resolve(doc.fonts.ready).catch(function () {}));
      waits.push(waitForFrameMedia(doc));
      waits.push(waitForFrameDomQuiet(doc));
    } else {
      // Cross-origin frames are opaque. A short compositor grace period after
      // `load` is still more reliable than printing in the same task.
      waits.push(delay(300));
    }
    return Promise.all(waits)
      .then(function () { return afterFramePaint(frame); })
      .then(function () { return delay(120); });
  }

  /**
   * PDF pages are constructed before the browser necessarily loads lazy
   * iframes. `pdf-ready` only means Reveal has laid out the print pages; it
   * does not mean iframe-backed interactive content has painted. Force every
   * presentation iframe eager immediately, then wait for its real load and a
   * small post-load visual-settle boundary before opening the native print
   * dialog. This matches the user's successful manual-print behavior without
   * depending on an arbitrary multi-second delay.
   */
  function preparePrintIframes(root) {
    var frames = Array.prototype.slice.call(root.querySelectorAll('.sr-interactive iframe, .sr-demo iframe'));
    if (!frames.length) return Promise.resolve();

    return Promise.all(frames.map(function (frame) {
      frame.loading = 'eager';
      frame.setAttribute('loading', 'eager');
      // Some authored/legacy embeds can still use data-src. Make print mode
      // eager even if Reveal has not visited that slide yet.
      if (!frame.getAttribute('src') && frame.getAttribute('data-src')) {
        frame.setAttribute('src', frame.getAttribute('data-src'));
      }
      return new Promise(function (resolve) {
        var settled = false;
        var timer = null;
        var finish = function () {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          frame.removeEventListener('load', loaded);
          settlePrintFrame(frame).then(resolve);
        };
        var loaded = function () { finish(); };
        frame.addEventListener('load', loaded);

        // A local/srcdoc frame can already be complete before this helper is
        // attached. Do not wait for an event that has already happened.
        try {
          var doc = frame.contentDocument;
          var url = doc && doc.URL;
          if (doc && doc.readyState === 'complete' && (frame.hasAttribute('srcdoc') || (url && url !== 'about:blank'))) {
            Promise.resolve().then(finish);
          }
        } catch (e) {}

        // External/broken frames must never make PDF export hang forever.
        timer = setTimeout(finish, 9000);
      });
    })).then(function () {});
  }

  function settleVisiblePrintIframes(root) {
    var frames = Array.prototype.slice.call(root.querySelectorAll('.sr-interactive iframe, .sr-demo iframe'));
    if (!frames.length) return Promise.resolve();
    // Run this after reveal.js has created/moved content into `.pdf-page`. An
    // iframe may have completed loading while its slide was hidden, which is
    // not enough to guarantee a painted surface in Chromium's print snapshot.
    return Promise.all(frames.map(settlePrintFrame)).then(function () {});
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Failed to load ' + src)); };
      document.body.appendChild(s);
    });
  }

  function loadScriptsSequentially(sources) {
    return (sources || []).reduce(function (promise, src) {
      return promise.then(function () { return loadScript(src); });
    }, Promise.resolve());
  }

  function loadStylesheet(href) {
    return new Promise(function (resolve, reject) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = resolve;
      link.onerror = function () { reject(new Error('Failed to load ' + href)); };
      document.head.appendChild(link);
    });
  }

  // Reveal's math plugin normally discovers and renders delimiters during
  // its own lifecycle. Revealation stores equations as canonical `.sr-math`
  // elements, though, so relying on that discovery makes preview rendering
  // timing-dependent (and leaves raw delimiters visible in some loads).
  function renderStoredMath(root) {
    root.querySelectorAll('.sr-math').forEach(function (el) {
      var tex = el.getAttribute('data-tex') || '';
      var display = el.getAttribute('data-display') === '1';
      try {
        window.katex.render(tex, el, {
          displayMode: display,
          throwOnError: false,
          strict: 'ignore',
        });
      } catch (e) {
        // Keep a readable source fallback if KaTeX rejects malformed TeX.
        el.textContent = display ? '\\[' + tex + '\\]' : '\\(' + tex + '\\)';
      }
    });
  }

  // Re-create <script> nodes that landed in the DOM via innerHTML so they
  // actually execute — matches the standalone HTML export's behavior.
  function activateScripts(root) {
    var scripts = root.querySelectorAll('script');
    for (var i = 0; i < scripts.length; i++) {
      var old = scripts[i];
      var fresh = document.createElement('script');
      for (var j = 0; j < old.attributes.length; j++) {
        var a = old.attributes[j];
        fresh.setAttribute(a.name, a.value);
      }
      fresh.text = old.textContent;
      old.parentNode.replaceChild(fresh, old);
    }
  }

  function render(payload) {
    var appRoot = new URL('__app__/', document.baseURI).href;
    var vendor = appRoot + 'vendor/reveal';
    var presentationStyles = [
      loadLinkedStylesheet('reveal-css', vendor + '/dist/reveal.css'),
      loadLinkedStylesheet('theme-css', payload.themeCssHref || (vendor + '/dist/theme/' + payload.theme + '.css')),
      loadLinkedStylesheet('highlight-css', vendor + '/plugin/highlight/monokai.css'),
    ];
    if (payload.contentCss) {
      var deckStyle = document.createElement('style');
      deckStyle.textContent = payload.contentCss;
      document.head.appendChild(deckStyle);
    }
    // RV-COMPAT(theme-custom): REMOVE BEFORE PUBLIC RELEASE.
    // Legacy custom-theme compatibility: old decks may still carry a Google
    // Fonts stylesheet plus variable overrides. New decks use only the
    // registered theme CSS above.
    if (payload.fontsHref) {
      // Legacy web-font CSS is presentation-critical too; await it before
      // Reveal measures centered slide contents.
      presentationStyles.push(loadStylesheet(payload.fontsHref));
    }
    if (payload.customCss) {
      var customStyle = document.createElement('style');
      customStyle.textContent = payload.customCss;
      document.head.appendChild(customStyle);
    }
    document.title = payload.title || 'Presentation';

    var slides = document.querySelector('.slides');
    slides.innerHTML = payload.sections;
    activateScripts(slides);
    // Start loading every interactive frame immediately for PDF output. Lazy
    // loading is desirable during authoring/Present, but print mode may never
    // scroll an off-screen page into the iframe loading threshold.
    var printIframesReady = payload.printMode ? preparePrintIframes(slides) : Promise.resolve();

    var backgroundResources = Array.isArray(payload.backgroundResources) ? payload.backgroundResources : [];
    var backgroundStyles = backgroundResources.map(function (resource) { return resource.cssHref; }).filter(Boolean);
    var backgroundScripts = payload.printMode ? [] : backgroundResources.map(function (resource) { return resource.jsHref; }).filter(Boolean);
    var backgroundAssets = {};
    backgroundResources.forEach(function (resource) { backgroundAssets[resource.id] = resource.assets || {}; });
    if (window.RevealationBackgroundRuntime) window.RevealationBackgroundRuntime.setAssets(backgroundAssets);

    var katexVendor = appRoot + 'vendor/katex';
    Promise.all([
      Promise.all(presentationStyles),
      loadStylesheet(katexVendor + '/dist/katex.min.css'),
      loadScript(katexVendor + '/dist/katex.min.js'),
      Promise.all(backgroundStyles.map(loadStylesheet)),
    ])
      .then(function () { renderStoredMath(slides); })
      // Theme CSS may request web fonts, and KaTeX uses its own fonts. Wait for
      // their final metrics before Reveal computes section heights/centering.
      .then(waitForDocumentFonts)
      .then(function () { return loadScript(vendor + '/dist/reveal.js'); })
      .then(function () { return loadScript(vendor + '/plugin/notes/notes.js'); })
      .then(function () { return loadScript(vendor + '/plugin/highlight/highlight.js'); })
      .then(function () { return loadScript(vendor + '/plugin/math/math.js'); })
      .then(function () { return loadScriptsSequentially(backgroundScripts); })
      .then(function () {
        var opts = Object.assign({}, payload.config || {}, {
          hash: false,
          katex: { local: appRoot + 'vendor/katex' },
          plugins: [RevealNotes, RevealHighlight, RevealMath.KaTeX]
        });
        if (payload.printMode) {
          opts.controls = false;
          opts.progress = false;
        }
        // Print view performs its own asynchronous page construction after
        // Reveal initialization. Register before initialize so we print only
        // after Reveal has finished turning logical slides into `.pdf-page`
        // elements. A fixed timeout here is both slower and race-prone.
        if (payload.printMode) {
          var printStarted = false;
          Reveal.on('pdf-ready', function () {
            if (printStarted) return;
            printStarted = true;
            // `pdf-ready` covers Reveal's own page construction, not embedded
            // documents. Wait for iframe-backed interactive content as well so
            // Chromium does not snapshot blank lazy frames into the PDF.
            Promise.resolve(printIframesReady)
              // `pdf-ready` has now moved slides into their final visible
              // print pages. Settle the iframe surfaces once more in that
              // final geometry; the pre-layout settle may have happened while
              // their slide was hidden.
              .then(function () { return settleVisiblePrintIframes(slides); })
              .then(waitForDocumentFonts)
              .then(afterTwoPaints)
              // Chromium's native print compositor can snapshot an iframe one
              // task before its final painted surface becomes available. Keep
              // a tiny post-paint grace period; manual Ctrl/Cmd+P worked for
              // exactly this reason.
              .then(function () { return delay(180); })
              .then(afterTwoPaints)
              .then(function () {
                try { window.focus(); } catch (e) {}
                var platform = window.Revealation && window.Revealation.platform;
                if (platform && platform.print) platform.print(); else window.print();
              });
          });
        }

        var p = Reveal.initialize(opts);
        // Screen presentation gets one post-init double-RAF layout to close
        // the remaining browser paint boundary. Print view has its own layout
        // pipeline and signals completion via `pdf-ready` above.
        if (!payload.printMode) p.then(layoutAfterPaint);
        if (!payload.printMode && window.RevealationBackgroundRuntime) {
          p.then(function () { window.RevealationBackgroundRuntime.bindReveal(Reveal, slides); });
        }
        if (payload.start) {
          p.then(function () { Reveal.slide(payload.start[0], payload.start[1]); });
        }
        if (!payload.printMode && window.parent !== window) {
          var report = function () {
            var ix = Reveal.getIndices();
            try { window.parent.postMessage({ type: 'slide-position', h: ix.h, v: ix.v }, '*'); } catch (e) {}
          };
          Reveal.on('slidechanged', report);
        }
        try { window.focus(); } catch (e) {}
      })
      .catch(function (err) {
        document.body.innerHTML =
          '<pre style="color:#fff;background:#000;padding:20px;white-space:pre-wrap">' +
          'Presentation failed to load reveal.js:\n' + (err && err.message || err) + '</pre>';
      });
  }

  // PDF export path: the opener stashes the payload in sessionStorage.
  if (/print-pdf/i.test(window.location.search)) {
    Promise.resolve().then(function () {
      var raw = null;
      try { raw = sessionStorage.getItem(PDF_PAYLOAD_KEY); } catch (e) {}
      if (raw) return raw;
      return null;
    }).then(function (raw) {
      if (!raw) {
        document.body.textContent = 'No PDF payload found — re-open the PDF export from the editor.';
        return;
      }
      try {
        try { sessionStorage.removeItem(PDF_PAYLOAD_KEY); } catch (e) {}
        var payload = JSON.parse(raw);
        payload.printMode = true;
        render(payload);
      } catch (e) {
        document.body.textContent = 'Could not load PDF payload: ' + (e && e.message || e);
      }
    }).catch(function (e) {
      document.body.textContent = 'Could not load PDF payload: ' + (e && e.message || e);
    });
  } else {
    var query = new URLSearchParams(window.location.search);
    var receiverPayload = null;
    if (/receiver/i.test(window.location.search)) {
      var presentationId = query.get('present');
      if (presentationId) {
        try {
          var storedPayload = sessionStorage.getItem(PRESENTATION_PAYLOAD_PREFIX + presentationId);
          if (storedPayload) receiverPayload = JSON.parse(storedPayload);
        } catch (e) {}
      }
    }
    if (receiverPayload) {
      render(receiverPayload);
    } else {
      window.addEventListener('message', function (ev) {
        var d = ev.data;
        if (!d || d.type !== 'render-deck') return;
        render(d);
      });
    }
  }

  // Editor keyboard shortcuts that must work while the presentation iframe has
  // focus. Keydown events never bubble across the frame boundary, so we
  // forward them to the parent via postMessage. Capture phase on document
  // runs before reveal.js's own (bubble-phase) keyboard handler.
  //
  //   Escape        -> leave Present mode, unless reveal's overview is open,
  //                    in which case reveal handles it (exits overview).
  //                    Fullscreen is exited by the browser before we see it.
  //   Cmd/Ctrl+P    -> leave Present mode (the key that opened it closes it),
  //                    and keeps the browser's print dialog from opening.
  //
  // Overview stays reachable via reveal's `O` key.
  document.addEventListener('keydown', function (e) {
    if (window.parent === window) return;              // opened standalone
    var mod = e.metaKey || e.ctrlKey;
    var isEsc = e.key === 'Escape';
    var isPrint = mod && !e.altKey && (e.key === 'p' || e.key === 'P');
    if (!isEsc && !isPrint) return;
    if (isEsc) {
      var inOverview = false;
      try { inOverview = !!(window.Reveal && Reveal.isOverview && Reveal.isOverview()); } catch (err) {}
      if (inOverview) return;                            // let reveal exit overview
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    try { window.parent.postMessage({ type: 'close-preview' }, '*'); } catch (err) {}
  }, true);

  window.addEventListener('message', function (ev) {
    if (!ev.data || ev.data.type !== 'close-speaker') return;
    try {
      if (speakerWindow && !speakerWindow.closed) speakerWindow.close();
    } catch (err) {}
    if (speakerWindowPoll) clearInterval(speakerWindowPoll);
    speakerWindowPoll = null;
    speakerWindow = null;
  });

  // Click handler for <a class="linked-image"> elements — open the URL in a
  // sized, centered popup window over the presentation rather than a new tab.
  // Capture phase + stopImmediatePropagation prevents any other listener from
  // also acting on the click; if a fullscreen element is active, exit it
  // first because browsers won't honor sized popup features in fullscreen.
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a.linked-image');
    if (!a) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var href = a.getAttribute('href');
    if (!href) return;
    function openWindow() {
      var w = Math.min(window.innerWidth - 80, 1200);
      var h = Math.min(window.innerHeight - 80, 800);
      var left = (window.screenX || 0) + Math.max(0, (window.innerWidth - w) / 2);
      var top = (window.screenY || 0) + Math.max(0, (window.innerHeight - h) / 2);
      var features = 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top;
      // Deliberately not calling .focus() on the popup: macOS won't raise it
      // visually anyway, and calling focus() registers it as Chrome's active
      // window — which then makes Cmd+` skip past it on the first press.
      // Without focus(), the opener stays active and Cmd+` cycles straight
      // to the buried popup on the first keystroke.
      var platform = window.Revealation && window.Revealation.platform;
      if (platform && platform.openWindow) platform.openWindow(href, 'reveal-linked-preview', features);
      else window.open(href, 'reveal-linked-preview', features);
    }
    var platform = window.Revealation && window.Revealation.platform;
    if (platform && platform.isFullscreen && platform.isFullscreen()) {
      Promise.resolve(platform.exitFullscreen()).then(openWindow, openWindow);
    } else if (document.fullscreenElement && document.exitFullscreen) {
      Promise.resolve(document.exitFullscreen()).then(openWindow, openWindow);
    } else {
      openWindow();
    }
  }, true);
})();
