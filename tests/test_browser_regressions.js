/**
 * Browser-level regression checks for WYSIWYG/layout/Markdown UI behavior.
 *
 * Uses only Node's standard library + an installed Chromium. The script is
 * optional in tests/check.sh so contributors without Chromium can still run
 * the dependency-free unit/static suite.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9337 + (process.pid % 200);
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'revealation-chrome-'));

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function assert(condition, message) { if (!condition) throw new Error(message); }

async function waitForTarget(chrome, getStderr) {
  for (let i = 0; i < 300; i += 1) {
    if (chrome.exitCode !== null) {
      throw new Error(`Chromium exited before its DevTools endpoint became ready (code ${chrome.exitCode}).${getStderr()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find(t => t.type === 'page');
        if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
      }
    } catch (_) {}
    await sleep(100);
  }
  throw new Error(`Chromium DevTools endpoint did not become ready after 30 seconds.${getStderr()}`);
}

async function main() {
  const chrome = spawn('chromium', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  chrome.stderr.setEncoding('utf8');
  chrome.stderr.on('data', chunk => { stderr += chunk; });

  let ws;
  try {
    const endpoint = await waitForTarget(chrome, () => stderr.trim() ? `\nChromium stderr:\n${stderr.trim()}` : '');
    ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    let nextId = 1;
    const pending = new Map();
    ws.addEventListener('message', event => {
      const msg = JSON.parse(String(event.data));
      if (!msg.id || !pending.has(msg.id)) return;
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await cdp('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed');
      return result.result?.value;
    };

    await cdp('Runtime.enable');
    // Use standards mode like the real editor. KaTeX refuses DOM rendering in
    // quirks mode, which previously meant the browser suite could only test
    // math serialization, not the actual editor render/remount lifecycle.
    await cdp('Page.enable');
    await cdp('Page.navigate', {
      url: 'data:text/html,%3C!doctype%20html%3E%3Chtml%3E%3Chead%3E%3C/head%3E%3Cbody%3E%3C/body%3E%3C/html%3E',
    });
    await sleep(100);

    const scripts = [
      'src/core/revealation.js',
      'src/config/toolbar.js',
      'src/ui/toolbar.js',
      'src/ui/dialogs.js',
      'src/theme/registry.js',
      'src/background/registry.js',
      'src/background/runtime.js',
      'src/core/slide-model.js',
      'src/core/history.js',
      'src/content/interactive.js',
      'src/layout/registry.js',
      'src/layout/builtins.js',
      'src/serialization/directives.js',
  'src/serialization/notes.js',
      'src/layout/blocks.js',
      'src/serialization/deck.js',
      'src/editor/dom-selection.js',
      'src/editor/content-normalization.js',
      'src/editor/rich-text.js',
      'src/content/html.js',
      'src/ui/sidebar.js',
      'src/export/deck.js',
    ];
    for (const relative of scripts) {
      const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
      await evaluate(`${source}\n//# sourceURL=${relative}`);
    }

    const cleanManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes/clean/theme.json'), 'utf8'));
    const darkManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes/dark/theme.json'), 'utf8'));
    const classicManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes/classic/theme.json'), 'utf8'));
    const kineticManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes/kinetic/theme.json'), 'utf8'));
    const gridManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extensions/backgrounds/grid/extension.json'), 'utf8'));
    await evaluate(`(() => {
      Revealation.theme.register(${JSON.stringify(cleanManifest)}, Revealation.urls.app('themes/clean/theme.json'));
      Revealation.theme.register(${JSON.stringify(darkManifest)}, Revealation.urls.app('themes/dark/theme.json'));
      Revealation.theme.register(${JSON.stringify(classicManifest)}, Revealation.urls.app('themes/classic/theme.json'));
      Revealation.theme.register(${JSON.stringify(kineticManifest)}, Revealation.urls.app('themes/kinetic/theme.json'));
      Revealation.theme.setDefault('clean');
      ['white','simple','beige','sky','solarized','serif'].forEach(id => Revealation.theme.registerAlias(id, 'clean'));
      ['black','league','night','blood','moon'].forEach(id => Revealation.theme.registerAlias(id, 'dark'));
      Revealation.background.register(${JSON.stringify(gridManifest)}, Revealation.urls.app('extensions/backgrounds/grid/extension.json'));
      Revealation.background.register({
        id:'motion-test', name:'Motion test', version:'1.0', css:'background.css', js:'background.js',
        preview:'preview.svg', assets:['dot.svg']
      }, Revealation.urls.app('extensions/backgrounds/motion-test/extension.json'));
    })()`);

    // Dynamic backgrounds are presentation-only. The generic runtime mounts
    // each host once, runs only the active slide, and cleans removed hosts.
    const backgroundLifecycle = await evaluate(`(() => {
      document.body.innerHTML = '<section id="s1"><div id="h1" class="rv-background-host" data-rv-background="motion-test"></div></section>'
        + '<section id="s2"><div id="h2" class="rv-background-host" data-rv-background="motion-test"></div></section>';
      const counts = { mount:0, start:0, stop:0, destroy:0 };
      let resolvedAsset = '';
      RevealationBackgroundRuntime.setAssets({ 'motion-test': { 'dot.svg': 'data:image/svg+xml,test' } });
      RevealationBackgroundRuntime.register('motion-test', (host, context) => {
        counts.mount += 1;
        resolvedAsset = context.asset('dot.svg');
        return {
          start(){ counts.start += 1; },
          stop(){ counts.stop += 1; },
          destroy(){ counts.destroy += 1; },
        };
      });
      let current = document.getElementById('s1');
      const listeners = {};
      const reveal = {
        on(name, fn){ listeners[name] = fn; },
        off(name, fn){ if (listeners[name] === fn) delete listeners[name]; },
        getCurrentSlide(){ return current; },
      };
      const unbind = RevealationBackgroundRuntime.bindReveal(reveal, document);
      current = document.getElementById('s2');
      listeners.slidechanged({ currentSlide: current });
      document.getElementById('h1').remove();
      RevealationBackgroundRuntime.refresh(document, { reveal, presentation:true });
      unbind();
      return { ...counts, resolvedAsset, listeners: Object.keys(listeners).length };
    })()`);
    assert(backgroundLifecycle.mount === 2 && backgroundLifecycle.start === 2, 'dynamic backgrounds did not mount/start per active slide');
    assert(backgroundLifecycle.stop === 2 && backgroundLifecycle.destroy === 2, 'dynamic backgrounds did not stop/destroy cleanly');
    assert(backgroundLifecycle.resolvedAsset === 'data:image/svg+xml,test', 'background lifecycle asset resolver failed');
    assert(backgroundLifecycle.listeners === 0, 'background lifecycle did not unregister reveal listeners');

    // The editor/static-preview boundary must never load animation JavaScript.
    const backgroundEditorLoad = await evaluate(`(() => {
      Revealation.background.ensureStyle('motion-test');
      return {
        css: !!document.getElementById('rv-background-css-motion-test'),
        scripts: Array.from(document.scripts).filter(s => /motion-test\\/background\\.js/.test(s.src)).length,
      };
    })()`);
    assert(backgroundEditorLoad.css, 'editor background preview did not request extension CSS');
    assert(backgroundEditorLoad.scripts === 0, 'editor background preview loaded animation JS');

    // Regression: Chromium paragraph DIVs inside layout slots must become
    // canonical paragraphs/blocks before Markdown serialization.
    const normalized = await evaluate(`(() => {
      document.body.innerHTML = '<div id="root"><div class="sr-layout"><div class="sr-layout-slot"><div class="sr-layout-content"><div><strong>Rich title</strong></div></div></div><div class="sr-layout-slot"><div class="sr-layout-content"><div><ul><li>One</li><li>Two</li></ul></div><div data-authored="1"><em>Keep raw</em></div></div></div></div></div>';
      const root = document.getElementById('root');
      Revealation.editor.contentNormalization.normalizeForSerialization(root);
      return {
        title: root.querySelectorAll('.sr-layout-content')[0].innerHTML,
        body: root.querySelectorAll('.sr-layout-content')[1].innerHTML,
        rawDivs: root.querySelectorAll('.sr-layout-content > div:not([class]):not([id]):not([data-authored])').length,
        authored: root.querySelector('[data-authored]')?.outerHTML || '',
      };
    })()`);
    assert(normalized.rawDivs === 0, 'layout rich-text DIV wrappers survived normalization');
    assert(normalized.title.includes('<p><strong>Rich title</strong></p>'), 'rich title did not normalize to paragraph');
    assert(/^<ul>/.test(normalized.body), 'block wrapper around list was not unwrapped');
    assert(normalized.authored.includes('data-authored=\"1\"'), 'attributed authored raw HTML was incorrectly normalized');

    const paragraphMode = await evaluate(`(() => {
      document.body.innerHTML = '<div id="host" contenteditable="true">alpha</div>';
      const host = document.getElementById('host');
      host.focus();
      const range = document.createRange(); range.selectNodeContents(host); range.collapse(false);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      Revealation.editor.contentNormalization.setDefaultParagraphSeparator();
      document.execCommand('insertParagraph', false);
      document.execCommand('insertText', false, 'beta');
      return host.innerHTML;
    })()`);
    assert(!/<div(?:\s|>)/i.test(paragraphMode), `default paragraph mode created DIV wrappers: ${paragraphMode}`);

    const headingMode = await evaluate(`(() => {
      document.body.innerHTML = '<div id="editor" contenteditable="true"><div class="sr-layout" data-layout="header-body" contenteditable="false"><div class="sr-layout-slot" data-slot="header"><div id="host" class="sr-layout-content" contenteditable="true"><p>Heading text</p></div></div><div class="sr-layout-slot" data-slot="body"><div class="sr-layout-content" contenteditable="true"><p>Body</p></div></div></div></div>';
      const host = document.getElementById('host');
      const text = host.querySelector('p').firstChild;
      const range = document.createRange(); range.selectNodeContents(text);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      host.focus();
      Revealation.editor.contentNormalization.setDefaultParagraphSeparator();
      document.execCommand('formatBlock', false, 'h1');
      Revealation.editor.contentNormalization.normalizeForSerialization(host);
      return host.innerHTML;
    })()`);
    assert(/^<h1>Heading text<\/h1>$/.test(headingMode), `formatBlock heading produced non-canonical DOM: ${headingMode}`);

    // Regression: clipboard HTML must be reduced to the small canonical DOM
    // vocabulary before it reaches contenteditable. Office/browser markup
    // commonly contains styled spans, FONT tags, attributed DIV wrappers and
    // unsafe URLs; none of those should make a later Markdown save fail.
    const pastedHtml = await evaluate(`(() => Revealation.editor.contentNormalization.sanitizePastedHtml(
      '<div class="WordSection1"><p><span style="font-size:18pt;color:red"><b>Copied title</b></span></p>'
      + '<p><a href="javascript:alert(1)" onclick="alert(2)">unsafe link</a> <i>italic</i></p>'
      + '<script>alert(3)</script><p><img src="data:image/png;base64,AAAA" style="width:99%" onerror="alert(4)" alt="photo"></p>'
    ))()`);
    assert(pastedHtml.includes('<p><strong>Copied title</strong></p>'), `pasted formatting was not canonicalized: ${pastedHtml}`);
    assert(pastedHtml.includes('<p><a>unsafe link</a> <em>italic</em></p>'), `pasted links/italics were not sanitized: ${pastedHtml}`);
    assert(pastedHtml.includes('<img src="data:image/png;base64,AAAA" alt="photo">'), `pasted image was not preserved safely: ${pastedHtml}`);
    assert(!/style=|onclick=|onerror=|<script|class="WordSection1"/i.test(pastedHtml), `unsafe paste attributes survived: ${pastedHtml}`);

    const pastedDivLines = await evaluate(`(() => Revealation.editor.contentNormalization.sanitizePastedHtml('<div>first</div><div>second</div>'))()`);
    assert(pastedDivLines === '<p>first</p><p>second</p>', `pasted DIV paragraph boundaries were lost: ${pastedDivLines}`);

    const pastedPlain = await evaluate(`Revealation.editor.contentNormalization.plainTextToHtml('one\\ntwo\\n\\nthree')`);
    assert(pastedPlain === '<p>one</p><p>two</p><p><br></p><p>three</p>', `plain-text paste was not block-normalized: ${pastedPlain}`);

    // Regression: an atomic layout cannot be deleted by Backspace from the
    // outer editor boundary.
    const protectedDelete = await evaluate(`(() => {
      document.body.innerHTML = '<div id="editor" contenteditable="true"><div class="sr-layout" contenteditable="false"><div class="sr-layout-slot"><div class="sr-layout-content" contenteditable="true"><p>A</p></div></div></div><p>After</p></div>';
      const editor = document.getElementById('editor');
      const range = document.createRange();
      range.setStart(editor, 1); range.collapse(true);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      let prevented = false;
      const event = { inputType: 'deleteContentBackward', preventDefault() { prevented = true; } };
      const guarded = Revealation.layout.blocks.guardBeforeInput(event, editor);
      return { prevented, guarded, layouts: editor.querySelectorAll('.sr-layout').length };
    })()`);
    assert(protectedDelete.guarded && protectedDelete.prevented && protectedDelete.layouts === 1, 'layout boundary delete is not protected');

    const crossSlot = await evaluate(`(() => {
      document.body.innerHTML = '<div id="editor" contenteditable="true"><div class="sr-layout" contenteditable="false"><div class="sr-layout-slot"><div id="a" class="sr-layout-content" contenteditable="true"><p>AAA</p></div></div><div class="sr-layout-slot"><div id="b" class="sr-layout-content" contenteditable="true"><p>BBB</p></div></div></div></div>';
      const editor = document.getElementById('editor');
      const a = document.querySelector('#a p').firstChild; const b = document.querySelector('#b p').firstChild;
      const range = document.createRange(); range.setStart(a, 1); range.setEnd(b, 2);
      const host = Revealation.editor.domSelection?.editingHostFromRange?.(range, editor);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      let prevented = false;
      const guarded = Revealation.layout.blocks.guardBeforeInput({ inputType:'insertText', preventDefault(){ prevented=true; } }, editor);
      return { prevented, guarded, host: host?.id || '' };
    })()`);
    assert(crossSlot.guarded && crossSlot.prevented, 'cross-slot replacement is not protected');
    assert(crossSlot.host === 'a', 'range did not resolve to the concrete first slot editing host');

    // Regression: separator metadata + positional blocks must create a DOM
    // that the canonical writer can recognize again. This catches the exact
    // metadata/DOM mismatch reported by Markdown mode.
    const canonicalHeaderBody = await evaluate(`(() => {
      const source = '::: block\\n# Header\\n:::\\n\\n::: block\\nBody\\n:::';
      const spec = Revealation.layout.blocks.parseSlide(source, 'header-body');
      const el = Revealation.layout.blocks.createElement(spec, raw => '<p>' + raw.replace(/[<&]/g, c => c === '<' ? '&lt;' : '&amp;') + '</p>');
      const holder = document.createElement('div'); holder.innerHTML = el.outerHTML;
      const roundTrip = Revealation.layout.blocks.fromCanonicalElement(holder.firstElementChild);
      return { ok: !!roundTrip, id: roundTrip?.id || '', blocks: roundTrip?.blocks?.length || 0 };
    })()`);
    assert(canonicalHeaderBody.ok && canonicalHeaderBody.id === 'header-body' && canonicalHeaderBody.blocks === 2,
      'header-body did not round-trip through canonical layout DOM');

    // Load the real editor CSS for thumbnail + Markdown metric checks.
    const css = ['styles/app.css', 'styles/layouts.css', 'styles/sidebar.css']
      .map(relative => fs.readFileSync(path.join(ROOT, relative), 'utf8')).join('\n');
    await evaluate(`(() => { const s=document.createElement('style'); s.textContent=${JSON.stringify(css)}; document.head.appendChild(s); })()`);

    const thumbnail = await evaluate(`new Promise(resolve => {
      document.body.innerHTML = '<div id="slide-frame" style="background-color:rgb(18,52,86);color:rgb(254,220,186);font-family:Arial"></div><aside id="sidebar" class="sidebar"><div id="head" class="sidebar-head"><button id="add">+</button></div><ul id="list" class="slide-list"></ul></aside>';
      const controller = Revealation.ui.createSidebar({
        sidebarElement: document.getElementById('sidebar'),
        listElement: document.getElementById('list'),
        headElement: document.getElementById('head'),
        addButton: document.getElementById('add'),
        labelForSlide: () => ({ text: 'Visible slide' }),
        onSelect() {}, onDelete() {}, onMove() {},
      });
      controller.setView('thumbnails');
      controller.renderMarkdown({
        items: [{ start:0, end:20, label:'Visible slide', subslide:false }],
        slides: [{ id:'a', content:'<h1>Visible slide</h1><p>Body</p>', background:{type:'',value:''} }],
        width:960, height:700, onJump() {},
      });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const surface = document.querySelector('.thumbnail-surface');
        const cs = getComputedStyle(surface);
        resolve({ text: surface?.textContent || '', color: cs.color, background: cs.backgroundColor, height: document.querySelector('.thumbnail-viewport')?.getBoundingClientRect().height || 0 });
      }));
    })`);
    assert(thumbnail.text.includes('Visible slide'), 'thumbnail lost slide content');
    assert(thumbnail.color === 'rgb(254, 220, 186)', `thumbnail theme text color wrong: ${thumbnail.color}`);
    assert(thumbnail.background === 'rgb(18, 52, 86)', `thumbnail theme background wrong: ${thumbnail.background}`);
    assert(thumbnail.height > 20, 'thumbnail viewport remained empty/zero-height');

    // Regression: visible Markdown text and caret are rendered by the same
    // textarea. The old PRE overlay is deliberately disabled, eliminating the
    // class of metric/zoom drift bugs rather than trying to approximate it.
    const markdownEditor = await evaluate(`(() => {
      document.body.innerHTML = '<div class="markdown-editor-shell" style="position:relative;width:700px;height:280px"><pre id="markdown-highlight" class="markdown-highlight" aria-hidden="true"></pre><textarea id="markdown-text" wrap="off"></textarea></div>';
      const ta = document.getElementById('markdown-text');
      const hi = document.getElementById('markdown-highlight');
      ta.value = Array.from({length: 320}, (_, i) => 'line ' + i).join('\\n');
      const t = getComputedStyle(ta); const h = getComputedStyle(hi);
      return { textColor:t.color, fill:t.webkitTextFillColor, overlayDisplay:h.display, scrollHeight:ta.scrollHeight };
    })()`);
    assert(markdownEditor.overlayDisplay === 'none', 'legacy Markdown highlight overlay is still visible');
    assert(markdownEditor.textColor !== 'rgba(0, 0, 0, 0)' && markdownEditor.textColor !== 'transparent', 'Markdown textarea text is still transparent');
    assert(markdownEditor.scrollHeight > 1000, 'long Markdown textarea did not render its own text flow');

    // Regression: layout identity + positional block content live in the slide
    // model, not in the WYSIWYG DOM cache. A stale/non-canonical `content`
    // string must therefore not make Markdown export fail for a non-default
    // layout. This reproduces the reported header-body failure on slide 3.
    const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const bodyHtml = (indexHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [])[1] || '';
    await evaluate(`document.body.innerHTML=${JSON.stringify(bodyHtml)}`);
    for (const relative of ['vendor/marked/marked.min.js', 'vendor/turndown/turndown.js', 'vendor/katex/dist/katex.min.js']) {
      const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
      await evaluate(`${source}\n//# sourceURL=${relative}`);
    }
    let applicationSource = fs.readFileSync(path.join(ROOT, 'src/core/application.js'), 'utf8');
    const initMarker = '  // -------- Init --------';
    const initAt = applicationSource.indexOf(initMarker);
    assert(initAt > 0, 'application init marker missing');
    applicationSource = applicationSource.slice(0, initAt)
      + `  window.__revealationRegression={
        parseMarkdownDeck, projectToMarkdown, projectToMarkdownRecovery, markdownMathToHtml, markdownSerializedMathToLatex, markdownToHtml, htmlToMarkdown, makeMarkdownTurndown, setAlignment, captureCurrentContent, renderEditor, onEditorInput, selectSlide, themePayloadBits, applySlideEffects, updateStageScale, handleEditorIntrinsicLoad, handleEditorKeydown, cleanEditorContent,
        normalizeProject, serializeProject, backgroundResources, backgroundPayloadResources, buildSections, presentationSlides, presentationStartSlide, deckContentCss, deckExporter, selectPresentationTheme, renderThemePicker, renderStyleForms, renderPresentationSettings, renderBackgroundChoices, renderLayoutChoices, slideLabel,
        openMarkdownMode, closeMarkdownMode, applyMarkdownToDeck, applyAndCloseMarkdownMode,
        insertLayout, transferMarkdownLayoutContent, insertHTMLAtCursor, editorRangeSnapshot, applyParagraphStyle,
        clipboardPayload, validatedInternalClipboardHtml, selectMedia, setSelectedInteractiveHeight,
        setTestState(project) {
          state = project;
          library = { version: 1, currentProjectId: project.id, projects: [project], deletedIds: [] };
          lastEditorRange = null;
          selectedMediaEl = null;
          selectedSlideIds = project.currentId ? [project.currentId] : [];
        },
        getSelectedSlideIds() { return selectedSlideIds.slice(); }
      };\n  return;\n})();\n`;
    await evaluate(applicationSource + '\n//# sourceURL=src/core/application-regression.js');
    await evaluate(`Revealation.ui.applyToolbarLayout()`);

    // RV-COMPAT(theme-reveal-aliases), RV-COMPAT(theme-custom): compatibility migration coverage.
    // Manifest-backed themes are presentation-level metadata. Legacy reveal
    // theme names migrate deterministically and unknown ids fall back safely.
    const visualModel = await evaluate(`(() => {
      const makeSlide = (id, background={id:''}) => ({
        id, content:'<h2>Content ' + id + '</h2>', notes:'', transition:'', background,
        vertical:false, layout:'single', blocks:null,
        autoAnimate:{enabled:false,id:'',duration:'',easing:'',unmatched:''}, underConstruction:false
      });
      const clean = __revealationRegression.normalizeProject({
        id:'theme-clean', name:'Clean deck', title:'Clean deck', author:'Ada Lovelace', theme:'clean', slides:[makeSlide('a')], currentId:'a', config:{}
      }, 'Clean deck');
      const alias = __revealationRegression.normalizeProject({
        id:'theme-alias', name:'Alias deck', title:'Alias deck', theme:'black', slides:[makeSlide('a')], currentId:'a', config:{}
      }, 'Alias deck');
      const missing = __revealationRegression.normalizeProject({
        id:'theme-missing', name:'Missing deck', title:'Missing deck', theme:'not-installed', slides:[makeSlide('a')], currentId:'a', config:{}
      }, 'Missing deck');
      const legacy = __revealationRegression.normalizeProject({
        id:'theme-legacy', name:'Legacy deck', title:'Legacy deck', theme:'custom',
        customTheme:{base:'black',fontSize:'31',textColor:'#123456'}, slides:[makeSlide('a')], currentId:'a', config:{}
      }, 'Legacy deck');
      const saved = __revealationRegression.serializeProject(clean);
      return {
        savedTheme:saved.theme,
        savedAuthor:saved.author,
        aliasTheme:alias.theme,
        missingTheme:missing.theme,
        legacyTheme:legacy.theme,
        legacySize:legacy.legacyCustomTheme?.fontSize || '',
        cleanCss:__revealationRegression.themePayloadBits(clean).themeCssHref,
        legacyCss:__revealationRegression.themePayloadBits(legacy).customCss,
      };
    })()`);
    assert(visualModel.savedTheme === 'clean', 'presentation theme metadata did not survive serialization');
    assert(visualModel.savedAuthor === 'Ada Lovelace', 'presentation author metadata did not survive serialization');
    assert(visualModel.aliasTheme === 'dark', 'legacy reveal.js theme name did not map deterministically');
    assert(visualModel.missingTheme === 'clean', 'unknown theme did not fall back safely');
    assert(visualModel.legacyTheme === 'dark' && visualModel.legacySize === '31', 'legacy custom theme compatibility data was not retained');
    assert(/\/themes\/clean\/theme\.css$/.test(visualModel.cleanCss), 'theme payload does not use registered Revealation theme CSS');
    assert(/--rv-size-body:\s*31px/.test(visualModel.legacyCss), 'legacy custom size compatibility overlay was lost');

    // Semantic background ids share separator metadata with layout identity;
    // changing one must not corrupt the other or write defaults everywhere.
    const semanticBackgroundRoundTrip = await evaluate(`(() => {
      const source = [
        '--- layout=header-body background=grid', '',
        '::: block', '# Header', ':::', '',
        '::: block', 'Body', ':::', '',
        '---', '', '# Plain'
      ].join('\\n');
      const slides = __revealationRegression.parseMarkdownDeck(source);
      const markdown = __revealationRegression.projectToMarkdown({ slides, title:'Background round trip' });
      return {
        id:slides[0]?.background?.id || '',
        layout:slides[0]?.layout || '',
        plain:slides[1]?.background?.id || '',
        markdown,
      };
    })()`);
    assert(semanticBackgroundRoundTrip.id === 'grid', 'slide background metadata did not survive parse');
    assert(semanticBackgroundRoundTrip.layout === 'header-body', 'background metadata corrupted layout identity');
    assert(semanticBackgroundRoundTrip.plain === '', 'default background was written onto an unrelated slide');
    assert(semanticBackgroundRoundTrip.markdown.includes('layout=header-body') && semanticBackgroundRoundTrip.markdown.includes('background=grid'), 'background/layout metadata did not survive Markdown write');

    const notesRoundTrip = await evaluate(`(() => {
      const source = ['# Notes', '', '::: notes', 'Remember the timing.', 'Second line.', ':::'].join('\\n');
      const slides = __revealationRegression.parseMarkdownDeck(source);
      const markdown = __revealationRegression.projectToMarkdown({ slides, title:'Notes' });
      const oldPrefix = __revealationRegression.parseMarkdownDeck('# Legacy\\n\\nNote: this is visible content')[0];
      return {
        notes: slides[0]?.notes || '',
        content: slides[0]?.content || '',
        markdown,
        oldNotes: oldPrefix?.notes || '',
        oldContent: oldPrefix?.content || '',
      };
    })()`);
    assert(notesRoundTrip.notes === 'Remember the timing.\nSecond line.', 'speaker notes block did not parse');
    assert(!notesRoundTrip.content.includes('Remember the timing.'), 'speaker notes leaked into visual slide content');
    assert(notesRoundTrip.markdown.includes('::: notes\nRemember the timing.\nSecond line.\n:::'), 'speaker notes block did not round-trip');
    assert(notesRoundTrip.oldNotes === '' && notesRoundTrip.oldContent.includes('Note: this is visible content'), 'legacy Note prefix is still treated as speaker notes');

    // Export includes only the selected theme and backgrounds referenced by
    // the deck. Dynamic extensions pull in the generic runtime.
    const exportResources = await evaluate(`(() => {
      const slide = (id, bg) => ({ id, content:'<h2>' + id + '</h2>', notes:'', transition:'', background:bg, vertical:false, layout:'single', blocks:null, autoAnimate:{} });
      const gridProject = { id:'pg', title:'Grid', name:'Grid', theme:'clean', slides:[slide('g',{id:'grid'})], currentId:'g', config:{} };
      const motionProject = { id:'pm', title:'Motion', name:'Motion', theme:'clean', slides:[slide('m',{id:'motion-test'})], currentId:'m', config:{} };
      const unknownProject = { id:'pu', title:'Unknown', name:'Unknown', theme:'clean', slides:[slide('u',{id:'missing-background'})], currentId:'u', config:{} };
      return {
        gridHtml:__revealationRegression.deckExporter.buildLinkedHtml(gridProject),
        motionHtml:__revealationRegression.deckExporter.buildLinkedHtml(motionProject),
        gridPaths:__revealationRegression.deckExporter.packagePaths(gridProject),
        motionPaths:__revealationRegression.deckExporter.packagePaths(motionProject),
        unknownCount:__revealationRegression.backgroundResources(unknownProject).length,
      };
    })()`);
    assert(exportResources.gridHtml.includes('extensions/backgrounds/grid/background.css'), 'used grid background CSS missing from exported HTML');
    assert(exportResources.gridHtml.includes('extensions/backgrounds/grid/grid.js'), 'used grid background JS missing from exported HTML');
    assert(exportResources.gridHtml.includes('src/background/runtime.js'), 'grid background runtime missing from exported HTML');
    assert(!exportResources.gridHtml.includes('motion-test/background.js') && !exportResources.gridHtml.includes('motion-test/background.css'), 'unused/dynamic background resources leaked into static export');
    assert(exportResources.motionHtml.includes('motion-test/background.css') && exportResources.motionHtml.includes('motion-test/background.js'), 'used dynamic background resources missing from exported HTML');
    assert(exportResources.motionHtml.includes('src/background/runtime.js'), 'dynamic background runtime missing from exported HTML');
    assert(exportResources.gridPaths.includes('themes/clean/theme.css') && exportResources.gridPaths.includes('extensions/backgrounds/grid/background.css') && exportResources.gridPaths.includes('extensions/backgrounds/grid/grid.js'), 'workspace package paths omit used grid resources');
    assert(exportResources.gridPaths.includes('src/background/runtime.js'), 'workspace package paths omit grid lifecycle runtime');
    assert(!exportResources.gridPaths.some(path => path.includes('motion-test')), 'workspace package paths include unused background resources');
    assert(exportResources.motionPaths.includes('src/background/runtime.js'), 'workspace package paths omit dynamic lifecycle runtime');
    assert(exportResources.unknownCount === 0, 'unknown background should not include missing resources');

    const pickerMutation = await evaluate(`(() => {
      const slide = { id:'visual-slide', content:'<h2>Do not mutate me</h2>', notes:'speaker note', background:{id:'grid'}, vertical:false, layout:'single', blocks:null, autoAnimate:{} };
      const project = { id:'visual-project', title:'Visual', name:'Visual', theme:'clean', slides:[slide], currentId:slide.id, config:{} };
      __revealationRegression.setTestState(project);
      __revealationRegression.renderThemePicker();
      __revealationRegression.renderBackgroundChoices();
      const before = JSON.stringify(project.slides);
      const nativeSetTimeout = window.setTimeout;
      window.setTimeout = () => 0;
      try { __revealationRegression.selectPresentationTheme('dark', { record:false }); }
      finally { window.setTimeout = nativeSetTimeout; }
      return {
        theme:project.theme,
        unchanged:before === JSON.stringify(project.slides),
        themeCards:Array.from(document.querySelectorAll('#theme-choices .theme-choice')).map(x => x.dataset.themeId),
        backgroundCards:Array.from(document.querySelectorAll('#background-choices .background-choice')).map(x => x.dataset.backgroundId),
      };
    })()`);
    assert(pickerMutation.theme === 'dark' && pickerMutation.unchanged, 'changing themes altered presentation content');
    assert(['clean','dark','classic','kinetic'].every(id => pickerMutation.themeCards.includes(id)), 'theme picker does not show all registered built-in themes');


    // Semantic paragraph styles are content meaning, not theme-specific CSS.
    // They must survive Markdown round trips and switching back to structural
    // paragraph styles must remove the semantic class cleanly.
    const semanticBlocks = await evaluate(`(() => {
      const html = '<p class="rv-block-callout">Important <strong>result</strong></p>';
      const markdown = __revealationRegression.htmlToMarkdown(html, __revealationRegression.makeMarkdownTurndown()).trim();
      const reparsed = __revealationRegression.markdownToHtml(markdown);
      const slide={id:'semantic',content:'<p>Statement</p>',notes:'',transition:'',background:{id:''},vertical:false,layout:'single',blocks:null,autoAnimate:{enabled:false},underConstruction:false,hidden:false};
      __revealationRegression.setTestState({id:'semantic-project',title:'Semantic',name:'Semantic',author:'',theme:'clean',slides:[slide],currentId:slide.id,config:{}});
      __revealationRegression.renderEditor();
      const p=document.querySelector('#slide-editor p');
      const range=document.createRange(); range.selectNodeContents(p); range.collapse(false);
      const sel=getSelection(); sel.removeAllRanges(); sel.addRange(range);
      document.getElementById('slide-editor').dispatchEvent(new Event('input',{bubbles:true}));
      __revealationRegression.applyParagraphStyle('emphasis');
      const emphasized=document.querySelector('#slide-editor .rv-block-emphasis')?.nodeName || '';
      __revealationRegression.applyParagraphStyle('h2');
      const structural=document.querySelector('#slide-editor h2');
      return {
        markdown,
        reparsedClass:/rv-block-callout/.test(reparsed),
        emphasized,
        structuralTag:structural?.nodeName || '',
        structuralClass:structural?.className || ''
      };
    })()`);
    assert(semanticBlocks.markdown.includes('::: callout') && semanticBlocks.reparsedClass, 'semantic block did not survive WYSIWYG/Markdown round trip');
    assert(semanticBlocks.emphasized === 'P', `Emphasis did not create a semantic paragraph: ${JSON.stringify(semanticBlocks)}`);
    assert(semanticBlocks.structuralTag === 'H2' && !/rv-block-/.test(semanticBlocks.structuralClass), 'switching from semantic style to heading left stale semantic classes');
    assert(pickerMutation.backgroundCards.includes('grid') && pickerMutation.backgroundCards.includes('motion-test'), 'background picker is not registry-driven');

    // RV-COMPAT(serialized-math-span): legacy rendered-span recovery coverage below.
    // Math round-trip coverage: inline/display delimiters and previously
    // emitted canonical math spans must remain recoverable.
    const mathRoundTrip = await evaluate(`(() => {
      const inline = __revealationRegression.markdownMathToHtml('Text \\\\(x,y\\\\)');
      const display = __revealationRegression.markdownMathToHtml('\\\\[x^2\\\\]');
      const legacy = __revealationRegression.markdownSerializedMathToLatex('<span class="sr-math" data-display="0" data-tex="x &amp; y">\\\\(x &amp; y\\\\)</span>');
      return { inline, display, legacy };
    })()`);
    assert(mathRoundTrip.inline.includes('data-display="0"') && mathRoundTrip.inline.includes('data-tex="x,y"'), 'inline math was not recognized');
    assert(mathRoundTrip.display.includes('data-display="1"') && mathRoundTrip.display.includes('data-tex="x^2"'), 'display math was not recognized');
    assert(mathRoundTrip.legacy === '\\(x & y\\)', `serialized math span was not restored to inline LaTeX: ${JSON.stringify(mathRoundTrip.legacy)}`);

    const legacyDisplay = await evaluate(`(() => __revealationRegression.markdownSerializedMathToLatex('<span class="sr-math" data-display="1" data-tex="SLIKA: \\\\(x,y\\\\)">\\\\[SLIKA: \\\\(x,y\\\\)\\\\]</span>'))()`);
    assert(legacyDisplay === '\\[SLIKA: \\(x,y\\)\\]', 'serialized display math span was not restored to display LaTeX');

    const serializedMathHtml = String.raw`<span class="sr-math" data-display="1" data-tex="SLIKA: koordinatni sistem slike z označeno piko \((x,y)\)">\[SLIKA: koordinatni sistem slike z označeno piko \((x,y)\)\]</span>`;
    const serializedMathMarkdown = await evaluate(`(() => __revealationRegression.htmlToMarkdown(${JSON.stringify(serializedMathHtml)}, __revealationRegression.makeMarkdownTurndown()).trim())()`);
    const expectedMathMarkdown = String.raw`\[SLIKA: koordinatni sistem slike z označeno piko \((x,y)\)\]`;
    assert(serializedMathMarkdown === expectedMathMarkdown,
      `serialized math HTML was not converted to LaTeX: ${serializedMathMarkdown}`);

    // Regression: TeX source must have a single canonical home. A cases
    // expression combines alignment `&`, row breaks `\\` and many commands;
    // keeping a second raw copy inside the math span lets Markdown/HTML
    // parsers consume those backslashes when the slide is captured/remounted.
    const complexMathTex = String.raw`H = 60 \cdot \begin{cases} 0 & d = 0 \\ \left(\frac{G-B}{d} + 6\right) \bmod 6 & M = R \\ \frac{B-R}{d} + 2 & M = G \\ \frac{R-G}{d} + 4 & M = B \end{cases}`;
    const complexMathB64 = Buffer.from(complexMathTex, 'utf8').toString('base64');
    const complexMathRoundTrip = await evaluate(`(() => {
      const tex = atob('${complexMathB64}');
      const slash = String.fromCharCode(92);
      const source = slash + '[' + tex + slash + ']';
      const html = __revealationRegression.markdownToHtml(source);
      const firstHolder = document.createElement('div');
      firstHolder.innerHTML = html;
      const first = firstHolder.querySelector('.sr-math');
      const markdown = __revealationRegression.htmlToMarkdown(html, __revealationRegression.makeMarkdownTurndown()).trim();
      const html2 = __revealationRegression.markdownToHtml(markdown);
      const secondHolder = document.createElement('div');
      secondHolder.innerHTML = html2;
      const second = secondHolder.querySelector('.sr-math');

      const makeSlide = (id, content) => ({
        id, content, notes:'', transition:'', background:{id:''}, vertical:false,
        layout:'single', blocks:null, autoAnimate:{enabled:false,id:'',duration:'',easing:'',unmatched:''},
        underConstruction:false, hidden:false,
      });
      const project = {
        id:'complex-math', name:'Complex math', title:'Complex math', author:'', theme:'clean',
        slides:[makeSlide('math-a', html), makeSlide('math-b', '<p>Second</p>')],
        currentId:'math-a', config:{},
      };
      __revealationRegression.setTestState(project);
      __revealationRegression.renderEditor();
      const editor = document.getElementById('slide-editor');
      const before = editor.querySelector('.sr-math');
      const beforeRendered = !!before?.querySelector('.katex');
      __revealationRegression.selectSlide('math-b');
      const stored = project.slides[0].content;
      __revealationRegression.selectSlide('math-a');
      const after = editor.querySelector('.sr-math');
      return {
        source,
        firstTex:first?.getAttribute('data-tex') || '',
        firstInner:first?.innerHTML || '',
        markdown,
        secondTex:second?.getAttribute('data-tex') || '',
        secondInner:second?.innerHTML || '',
        stored,
        storedText:(() => { const h=document.createElement('div'); h.innerHTML=stored; return h.querySelector('.sr-math')?.textContent || ''; })(),
        beforeRendered,
        afterRendered:!!after?.querySelector('.katex'),
        afterTex:after?.getAttribute('data-tex') || '',
      };
    })()`);
    assert(complexMathRoundTrip.firstTex === complexMathTex && complexMathRoundTrip.secondTex === complexMathTex,
      `complex TeX source changed across HTML/Markdown round trip: ${JSON.stringify(complexMathRoundTrip)}`);
    assert(complexMathRoundTrip.markdown === `\\[${complexMathTex}\\]`,
      `complex TeX Markdown changed during round trip: ${complexMathRoundTrip.markdown}`);
    assert(complexMathRoundTrip.firstInner === '\u200b' && complexMathRoundTrip.secondInner === '\u200b',
      'canonical math HTML does not contain the zero-width atomic sentinel');
    assert(complexMathRoundTrip.storedText === '\u200b',
      `captured slide persisted math runtime/source children: ${complexMathRoundTrip.stored}`);
    assert(complexMathRoundTrip.beforeRendered && complexMathRoundTrip.afterRendered && complexMathRoundTrip.afterTex === complexMathTex,
      `complex KaTeX equation did not survive a slide remount: ${JSON.stringify(complexMathRoundTrip)}`);

    // Regression: the equation dialog defaults to inline math. Inline TeX may
    // still contain source newlines (for example a cases environment). The
    // Markdown preprocessor must protect the entire \( ... \) payload before
    // marked interprets backslashes as escapes. Otherwise \\ row separators
    // collapse to \ and the math delimiters become literal parentheses.
    const multilineInlineTex = String.raw`H = 60 \cdot
\begin{cases}
0 & d = 0 \\
\left(\frac{G-B}{d} + 6\right) \bmod 6 & M = R \\
\frac{B-R}{d} + 2 & M = G \\
\frac{R-G}{d} + 4 & M = B
\end{cases}`;
    const multilineInlineB64 = Buffer.from(multilineInlineTex, 'utf8').toString('base64');
    const multilineInlineRoundTrip = await evaluate(`(() => {
      const tex = atob('${multilineInlineB64}');
      const slash = String.fromCharCode(92);
      const source = slash + '(' + tex + slash + ')';
      const html1 = __revealationRegression.markdownToHtml(source);
      const holder1 = document.createElement('div');
      holder1.innerHTML = html1;
      const first = holder1.querySelector('.sr-math');
      const markdown = __revealationRegression.htmlToMarkdown(html1, __revealationRegression.makeMarkdownTurndown()).trim();
      const html2 = __revealationRegression.markdownToHtml(markdown);
      const holder2 = document.createElement('div');
      holder2.innerHTML = html2;
      const second = holder2.querySelector('.sr-math');

      const makeSlide = (id, content) => ({
        id, content, notes:'', transition:'', background:{id:''}, vertical:false,
        layout:'single', blocks:null, autoAnimate:{enabled:false,id:'',duration:'',easing:'',unmatched:''},
        underConstruction:false, hidden:false,
      });
      const project = {
        id:'multiline-inline-math', name:'Multiline inline math', title:'Multiline inline math', author:'', theme:'clean',
        slides:[makeSlide('math-a', html1), makeSlide('math-b', '<p>Second</p>')],
        currentId:'math-a', config:{},
      };

      // Workspace mode persists deck.md and reparses it on reload. Cover that
      // complete boundary too; this is where the old one-line inline matcher
      // turned a multiline equation into ordinary Markdown text.
      const deckMarkdown = __revealationRegression.projectToMarkdown(project);
      const reparsedSlides = __revealationRegression.parseMarkdownDeck(deckMarkdown);
      const reparsedHolder = document.createElement('div');
      reparsedHolder.innerHTML = reparsedSlides[0]?.content || '';
      const reparsedMath = reparsedHolder.querySelector('.sr-math');

      __revealationRegression.setTestState(project);
      __revealationRegression.renderEditor();
      __revealationRegression.selectSlide('math-b');
      const stored = project.slides[0].content;
      __revealationRegression.selectSlide('math-a');
      const after = document.getElementById('slide-editor').querySelector('.sr-math');
      return {
        source,
        html1,
        firstTex:first?.getAttribute('data-tex') || '',
        markdown,
        html2,
        secondTex:second?.getAttribute('data-tex') || '',
        deckMarkdown,
        reparsedTex:reparsedMath?.getAttribute('data-tex') || '',
        reparsedText:reparsedHolder.textContent || '',
        stored,
        afterTex:after?.getAttribute('data-tex') || '',
        rendered:!!after?.querySelector('.katex'),
      };
    })()`);
    assert(multilineInlineRoundTrip.firstTex === multilineInlineTex,
      `multiline inline math was not recognized before marked parsed it: ${JSON.stringify(multilineInlineRoundTrip)}`);
    assert(multilineInlineRoundTrip.markdown === `\\(${multilineInlineTex}\\)`,
      `multiline inline math changed during HTML/Markdown serialization: ${JSON.stringify(multilineInlineRoundTrip.markdown)}`);
    assert(multilineInlineRoundTrip.secondTex === multilineInlineTex && multilineInlineRoundTrip.afterTex === multilineInlineTex,
      `multiline inline TeX changed after reparsing/remount: ${JSON.stringify(multilineInlineRoundTrip)}`);
    assert(multilineInlineRoundTrip.reparsedTex === multilineInlineTex,
      `workspace deck.md save/reload corrupted multiline inline TeX: ${JSON.stringify(multilineInlineRoundTrip)}`);
    assert(multilineInlineRoundTrip.rendered,
      `multiline inline equation did not render after slide remount: ${JSON.stringify(multilineInlineRoundTrip)}`);

    const modelRoundTrip = await evaluate(`(() => {
      const source = [
        '--- layout=two-columns',
        '', '::: block', 'Left', ':::', '', '::: block', 'Right', ':::',
        '', '---', '', '# Plain',
        '', '--- layout=header-body', '', '::: block', '# Course objectives', ':::',
        '', '::: block', 'Body', '', '::: align center', 'Centered', ':::', ':::'
      ].join('\\n');
      const slides = __revealationRegression.parseMarkdownDeck(source);
      const third = slides[2];
      const before = { layout: third.layout, blocks: third.blocks?.length || 0 };
      third.content = '<h1>stale non-canonical cache</h1>';
      let markdown = '', error = '';
      try { markdown = __revealationRegression.projectToMarkdown({ slides, title:'Regression' }); }
      catch (e) { error = e.message || String(e); }
      return { before, error, markdown };
    })()`);
    assert(modelRoundTrip.before.layout === 'header-body' && modelRoundTrip.before.blocks === 2,
      'non-default layout did not persist its positional block model');
    assert(!modelRoundTrip.error, `non-default layout export still depended on canonical DOM: ${modelRoundTrip.error}`);
    assert(modelRoundTrip.markdown.includes('--- layout=header-body'), 'header-body metadata was lost during model round-trip');
    assert(modelRoundTrip.markdown.includes('::: block'), 'positional blocks were lost during model round-trip');

    // Parser coverage for the supported content families in one realistic
    // slide: formatting, lists, links, image sizing, math, code, fragments,
    // animation, alignment, audio, video and interactive directives.
    const syntaxDeck = await evaluate(`(() => {
      const source = [
        '# Syntax coverage',
        '', '**bold** *italic* ~~strike~~ [link](https://example.test)',
        '', '- one', '- two', '', '![image](images/a.png "Image caption"){width=63%}',
        '', '\\(x+y\\)', '', '\\\\[x^2\\\\]', '',
        '~~~python', 'print("ok")', '~~~', '',
        '::: fragment effect=fade-up', 'Appears later', ':::', '',
        '::: animate id=hero', 'Animated', ':::', '',
        '::: align center', 'Centered', ':::', '',
        '::: audio', 'src: audio/a.ogg', 'controls: true', ':::', '',
        '::: video', 'src: video/a.mp4', 'width: 80%', 'caption: Video caption', 'controls: true',
        'autoplay: false', 'loop: true', 'muted: true', ':::', '',
        '::: interactive', 'src: interactive/a/index.html', 'width: 75%',
        'height: 420', 'interactive: true', 'preload: false', 'border: true', ':::'
      ].join('\\n');
      let slides = [], error = '', roundTrip = '';
      try {
        slides = __revealationRegression.parseMarkdownDeck(source);
        roundTrip = __revealationRegression.projectToMarkdown({ slides, title:'Syntax coverage' });
      }
      catch (e) { error = e.message || String(e); }
      return { slides: slides.length, error, content: slides[0]?.content || '', roundTrip };
    })()`);
    assert(!syntaxDeck.error && syntaxDeck.slides === 1, `supported syntax deck failed to parse: ${syntaxDeck.error}`);
    assert(syntaxDeck.content.includes('sr-interactive'), 'interactive syntax was not materialized');
    assert(syntaxDeck.content.includes('sr-media-caption'), 'media captions were not materialized');
    assert(syntaxDeck.roundTrip.includes('Image caption'), 'image caption did not survive the round trip');
    assert(syntaxDeck.roundTrip.includes('caption: Video caption'), `video caption did not survive the round trip: ${syntaxDeck.roundTrip}`);

    // Nested lists are a first-class WYSIWYG structure: after Tab indentation
    // they must survive the actual HTML -> Markdown -> HTML codec used by decks.
    const nestedListCodec = await evaluate(`(() => {
      const html='<ul><li>Parent<ul><li><strong>Child</strong></li></ul></li><li>Peer</li></ul>';
      const markdown=__revealationRegression.htmlToMarkdown(html,__revealationRegression.makeMarkdownTurndown()).trim();
      const reparsed=__revealationRegression.markdownToHtml(markdown);
      return {markdown,reparsed};
    })()`);
    assert(/Parent[\s\S]*\n\s{2,}[-*+]\s+\*\*Child\*\*/.test(nestedListCodec.markdown), `nested list indentation was lost in Markdown serialization: ${nestedListCodec.markdown}`);
    assert(nestedListCodec.reparsed.includes('<ul>') && nestedListCodec.reparsed.includes('<strong>Child</strong>'), `nested list formatting did not survive Markdown round trip: ${nestedListCodec.reparsed}`);

    // Cropped images use an editor-only wrapper, but the Markdown codec owns
    // that wrapper and must emit/consume the compact crop attribute instead
    // of falling back to unsupported raw HTML.
    const cropDeck = await evaluate(`(() => {
      const source = '![portrait](images/portrait.png "Portrait"){width=72% crop=10% 5% 20% 0%}';
      let slides = [], error = '', markdown = '', reparsed = '';
      try {
        slides = __revealationRegression.parseMarkdownDeck(source);
        markdown = __revealationRegression.projectToMarkdown({ slides, title:'Crop' });
        reparsed = __revealationRegression.parseMarkdownDeck(markdown)[0]?.content || '';
      } catch (e) { error = e.message || String(e); }
      return { error, markdown, content: slides[0]?.content || '', reparsed };
    })()`);
    assert(!cropDeck.error, `cropped image round trip failed: ${cropDeck.error}`);
    assert(cropDeck.content.includes('sr-media-crop'), 'crop wrapper was not materialized');
    assert(cropDeck.markdown.includes('{width=72% crop=10% 5% 20% 0%}'), 'crop offsets were not serialized');
    assert(!cropDeck.markdown.includes('sr-media-crop'), 'editor crop wrapper leaked into Markdown');
    assert(cropDeck.reparsed.includes('sr-media-crop'), 'crop wrapper was not restored from Markdown');

    const freeformCrop = await evaluate(`(() => {
      const source = '![wide](images/wide.png){width=61% crop=0% 12.5% 7.25% 3%}';
      let slides = [], error = '', markdown = '';
      try {
        slides = __revealationRegression.parseMarkdownDeck(source);
        markdown = __revealationRegression.projectToMarkdown({ slides, title:'Freeform crop' });
      } catch (e) { error = e.message || String(e); }
      return { error, markdown, content: slides[0]?.content || '' };
    })()`);
    assert(!freeformCrop.error, `freeform crop round trip failed: ${freeformCrop.error}`);
    assert(freeformCrop.markdown.includes('{width=61% crop=0% 12.5% 7.25% 3%}'), 'crop offsets were not preserved');
    assert(freeformCrop.content.includes('data-crop="0% 12.5% 7.25% 3%"'), 'crop offsets were not materialized');

    // Regression: the iframe owned by a canonical interactive block must not
    // be validated as standalone raw HTML. This reproduces interface-inserted
    // interactive content failing with "Cannot convert <iframe>".
    const interactiveRoundTrip = await evaluate(`(() => {
      const slide = {
        id:'interactive-slide', content:Revealation.content.interactive.toHtml({
          src:'interactive/example/index.html', width:80, height:420,
          interactive:true, preload:false, border:true,
        }), notes:'', transition:'', background:{id:''},
        vertical:false, layout:'single', blocks:null,
      };
      let markdown = '', error = '';
      try { markdown = __revealationRegression.projectToMarkdown({ slides:[slide], title:'Interactive' }); }
      catch (e) { error = e.message || String(e); }
      return { markdown, error };
    })()`);
    assert(!interactiveRoundTrip.error, `canonical interactive iframe was rejected: ${interactiveRoundTrip.error}`);

    const recoveryMarkdown = await evaluate(`(() => __revealationRegression.projectToMarkdownRecovery({
      slides: [{
        id:'bad-html', content:'<h2>Keep this text</h2><span style="color:red">unsupported formatting</span>',
        notes:'', transition:'', background:{id:''}, vertical:false,
        layout:'single', blocks:null,
      }], title:'Recovery',
    }))()`);
    assert(recoveryMarkdown.includes('Keep this text') && recoveryMarkdown.includes('unsupported formatting'), 'Markdown recovery lost slide text');
    assert(recoveryMarkdown.includes('Recovery: unsupported HTML was stripped'), 'Markdown recovery warning is missing');
    assert(!recoveryMarkdown.includes('<span'), 'Markdown recovery retained unsupported HTML');

    // Regression: WYSIWYG alignment on an ordinary single-layout block must
    // persist as canonical alignment markup, not as a transient browser style
    // or an empty wrapper inserted at the caret.
    const singleAlignment = await evaluate(`(() => {
      const slide = {
        id:'s1', content:'<h2>Aligned heading</h2><p>Body</p>', notes:'', transition:'',
        background:{id:''}, vertical:false, layout:'single', blocks:null
      };
      const project = { id:'p1', title:'Alignment', name:'Alignment', theme:'clean', slides:[slide], currentId:'s1', config:{} };
      __revealationRegression.setTestState(project);
      const editor = document.getElementById('slide-editor');
      editor.innerHTML = slide.content;
      const text = editor.querySelector('h2').firstChild;
      const range = document.createRange(); range.setStart(text, 3); range.collapse(true);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      editor.dispatchEvent(new Event('selectionchange'));
      __revealationRegression.setAlignment('center');
      __revealationRegression.captureCurrentContent();
      let markdown='', error='';
      try { markdown = __revealationRegression.projectToMarkdown(project); }
      catch (e) { error = e.message || String(e); }
      return { html:slide.content, markdown, error };
    })()`);
    assert(!singleAlignment.error, `single-layout alignment failed to serialize: ${singleAlignment.error}`);
    assert(singleAlignment.html.includes('sr-align-center') && singleAlignment.html.includes('<h2>Aligned heading</h2>'),
      `single-layout alignment was not persisted around the full heading: ${singleAlignment.html}`);
    assert(singleAlignment.html.includes('sr-align-center'), 'single-layout alignment did not survive capture for a later slide switch');

    // Regression: slot alignment is slide-model data. Moving away from the
    // slide must not lose it because `slide.blocks[index].align` is updated at
    // the same time as the WYSIWYG projection.
    const layoutAlignment = await evaluate(`(() => {
      const blocks = [
        { html:'<h1>Header</h1>', align:'left' },
        { html:'<p>Body text</p>', align:'left' },
      ];
      const wrap = Revealation.layout.blocks.createElementFromHtml('header-body', blocks);
      const slide = {
        id:'s2', content:wrap.outerHTML, notes:'', transition:'',
        background:{id:''}, vertical:false, layout:'header-body', blocks:JSON.parse(JSON.stringify(blocks))
      };
      const project = { id:'p2', title:'Layout alignment', name:'Layout alignment', theme:'clean', slides:[slide], currentId:'s2', config:{} };
      __revealationRegression.setTestState(project);
      const editor = document.getElementById('slide-editor');
      editor.innerHTML = slide.content;
      Revealation.layout.blocks.decorateEditor(editor);
      const text = editor.querySelector('[data-slot="body"] .sr-layout-content p').firstChild;
      const range = document.createRange(); range.setStart(text, 2); range.collapse(true);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      __revealationRegression.setAlignment('center');
      __revealationRegression.captureCurrentContent();
      let markdown='', error='';
      try { markdown = __revealationRegression.projectToMarkdown(project); }
      catch (e) { error = e.message || String(e); }
      return { align:slide.blocks?.[1]?.align || '', html:slide.content, markdown, error };
    })()`);
    assert(!layoutAlignment.error, `layout alignment failed to serialize: ${layoutAlignment.error}`);
    assert(layoutAlignment.align === 'center', `layout slot alignment was not persisted in slide.blocks: ${layoutAlignment.align}`);
    assert(layoutAlignment.markdown.includes('::: block align=center'), 'layout WYSIWYG alignment did not become block metadata');

    // Regression: ordinary WYSIWYG typing is model data, not merely live DOM.
    // Edit -> input -> switch slide -> return must preserve both single-body
    // content and positional layout-block content.
    const wysiwygPersistence = await evaluate(`(() => {
      const editor = document.getElementById('slide-editor');
      const singleSlides = [
        { id:'a', content:'<h2>First original</h2><p>Body A</p>', notes:'', transition:'', background:{id:''}, vertical:false, layout:'single', blocks:null },
        { id:'b', content:'<h2>Second</h2><p>Body B</p>', notes:'', transition:'', background:{id:''}, vertical:false, layout:'single', blocks:null }
      ];
      const singleProject={id:'pw',title:'W',name:'W',theme:'clean',slides:singleSlides,currentId:'a',config:{}};
      __revealationRegression.setTestState(singleProject);
      __revealationRegression.renderEditor();
      const singleHandler = __revealationRegression.onEditorInput;
      editor.addEventListener('input', singleHandler);
      editor.querySelector('h2').textContent='First edited';
      editor.querySelector('h2').dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'x'}));
      __revealationRegression.selectSlide('b');
      __revealationRegression.selectSlide('a');
      const singleResult = {
        state: singleSlides[0].content,
        rendered: editor.querySelector('h2')?.textContent || ''
      };
      editor.removeEventListener('input', singleHandler);

      const blocks=[{html:'<h2>Header</h2>',align:'left'},{html:'<p>Body original</p>',align:'left'}];
      const wrap=Revealation.layout.blocks.createElementFromHtml('header-body',blocks);
      const layoutSlides=[
        { id:'c', content:wrap.outerHTML, notes:'', transition:'', background:{id:''}, vertical:false, layout:'header-body', blocks:JSON.parse(JSON.stringify(blocks)) },
        { id:'d', content:'<h2>Other</h2>', notes:'', transition:'', background:{id:''}, vertical:false, layout:'single', blocks:null }
      ];
      const layoutProject={id:'pwl',title:'W',name:'W',theme:'clean',slides:layoutSlides,currentId:'c',config:{}};
      __revealationRegression.setTestState(layoutProject);
      __revealationRegression.renderEditor();
      const layoutHandler = __revealationRegression.onEditorInput;
      editor.addEventListener('input', layoutHandler);
      const bodyHost = editor.querySelector('[data-slot="body"] .sr-layout-content');
      const body = bodyHost.querySelector('p');
      body.textContent='Body edited';
      // Chromium/contenteditable may leave harmless siblings around a nested
      // editing host. Persistence must be slot-targeted and semantic, not
      // require an exact wrapper child count on every keystroke.
      bodyHost.parentElement.appendChild(document.createElement('br'));
      editor.appendChild(document.createElement('br'));
      body.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'x'}));
      __revealationRegression.selectSlide('d');
      __revealationRegression.selectSlide('c');
      const layoutResult = {
        block: layoutSlides[0].blocks?.[1]?.html || '',
        rendered: editor.querySelector('[data-slot="body"] p')?.textContent || ''
      };
      editor.removeEventListener('input', layoutHandler);
      return { singleResult, layoutResult };
    })()`);
    assert(wysiwygPersistence.singleResult.state.includes('First edited'), 'single-layout WYSIWYG typing was not committed to slide.content');
    assert(wysiwygPersistence.singleResult.rendered === 'First edited', 'single-layout WYSIWYG typing disappeared after slide switch');
    assert(wysiwygPersistence.layoutResult.block.includes('Body edited'), 'multi-block WYSIWYG typing was not committed to slide.blocks');
    assert(wysiwygPersistence.layoutResult.rendered === 'Body edited', 'multi-block WYSIWYG typing disappeared after slide switch');

    // Layout changes are semantic transfers, not positional rewrites. Matching
    // field ids stay in place; every unmatched field flows into the target
    // master without losing nested lists, media or inline formatting.
    const layoutTransferUi = await evaluate(`(() => {
      const blocks=[
        {html:'<h1>Stable <em>heading</em></h1>',align:'center'},
        {html:'<ul><li>Left<ul><li>Nested</li></ul></li></ul>',align:'left'},
        {html:'<p>Right <strong>content</strong></p><img src="data:image/png;base64,AAAA" alt="diagram">',align:'left'}
      ];
      const wrap=Revealation.layout.blocks.createElementFromHtml('header-two-columns',blocks);
      const slide={id:'transfer',content:wrap.outerHTML,notes:'',transition:'',background:{id:''},vertical:false,layout:'header-two-columns',blocks:JSON.parse(JSON.stringify(blocks)),autoAnimate:{}};
      const project={id:'pt',title:'Transfer',name:'Transfer',author:'',theme:'clean',slides:[slide],currentId:'transfer',config:{}};
      __revealationRegression.setTestState(project); __revealationRegression.renderEditor();
      __revealationRegression.insertLayout('header-body');
      const afterBody={
        layout:slide.layout,
        header:slide.blocks?.[0]?.html || '',
        body:slide.blocks?.[1]?.html || '',
        headerDom:document.querySelector('#slide-editor [data-slot="header"] .sr-layout-content')?.innerHTML || '',
      };
      __revealationRegression.insertLayout('single');
      const single={layout:slide.layout,content:slide.content};
      return {afterBody,single};
    })()`);
    assert(layoutTransferUi.afterBody.layout === 'header-body', 'layout switch did not update slide metadata');
    assert(layoutTransferUi.afterBody.header.includes('Stable <em>heading</em>'), 'same-name header field was not preserved');
    assert(layoutTransferUi.afterBody.body.indexOf('Left') < layoutTransferUi.afterBody.body.indexOf('Right'), 'unmatched layout fields were not merged into master in source order');
    assert(layoutTransferUi.afterBody.body.includes('<ul><li>Nested</li></ul>') && layoutTransferUi.afterBody.body.includes('<strong>content</strong>') && layoutTransferUi.afterBody.body.includes('<img'), 'layout transfer destroyed structured block content');
    assert(layoutTransferUi.single.layout === 'single' && layoutTransferUi.single.content.indexOf('Stable') < layoutTransferUi.single.content.indexOf('Left') && layoutTransferUi.single.content.indexOf('Left') < layoutTransferUi.single.content.indexOf('Right'), 'multi-block to single layout lost source ordering/content');

    const newHeaderScaffold = await evaluate(`(() => {
      const slide={id:'scaffold',content:'<p>Existing body</p>',notes:'',transition:'',background:{id:''},vertical:false,layout:'single',blocks:null,autoAnimate:{}};
      __revealationRegression.setTestState({id:'ps',title:'S',name:'S',author:'',theme:'clean',slides:[slide],currentId:'scaffold',config:{}});
      __revealationRegression.renderEditor(); __revealationRegression.insertLayout('header-body');
      return {
        header:document.querySelector('#slide-editor [data-slot="header"] .sr-layout-content')?.innerHTML || '',
        body:document.querySelector('#slide-editor [data-slot="body"] .sr-layout-content')?.innerHTML || '',
      };
    })()`);
    assert(newHeaderScaffold.header === '<h1><br></h1>', `new header field is not initialized as H1: ${newHeaderScaffold.header}`);
    assert(newHeaderScaffold.body.includes('Existing body'), 'single body did not match header-body body field');

    // The whole-deck Markdown layout picker uses the same semantic transfer
    // contract as WYSIWYG, so switching modes cannot reintroduce positional loss.
    const markdownLayoutTransfer = await evaluate(`(() => {
      const moved=__revealationRegression.transferMarkdownLayoutContent('header-two-columns','header-body','',[
        {raw:'# Stable heading',align:'center'},
        {raw:'- Left\\n  - Nested',align:'left'},
        {raw:'Right **bold**',align:'left'}
      ]);
      return moved;
    })()`);
    assert(markdownLayoutTransfer?.blocks?.[0]?.raw === '# Stable heading', 'Markdown layout switch did not preserve same-name header field');
    assert(markdownLayoutTransfer?.blocks?.[1]?.raw.indexOf('Left') < markdownLayoutTransfer?.blocks?.[1]?.raw.indexOf('Right'), 'Markdown layout switch did not merge unmatched fields into master in source order');
    assert(markdownLayoutTransfer?.blocks?.[1]?.raw.includes('  - Nested') && markdownLayoutTransfer?.blocks?.[1]?.raw.includes('**bold**'), 'Markdown layout switch flattened structured source content');

    // Internal clipboard content uses a Revealation-specific canonical flavor,
    // so nested lists and media formatting can move between layout fields
    // without going through the intentionally lossy external-HTML sanitizer.
    const crossFieldClipboard = await evaluate(`(() => {
      const blocks=[
        {html:'<h1>Clipboard</h1>',align:'left'},
        {html:'<ul><li>Parent<ul><li><strong>Child</strong></li></ul></li></ul><figure class="sr-media-caption"><img src="data:image/png;base64,AAAA" alt="diagram" style="width: 55%;"><figcaption>Caption</figcaption></figure>',align:'left'},
        {html:'<p><br></p>',align:'left'}
      ];
      const wrap=Revealation.layout.blocks.createElementFromHtml('header-two-columns',blocks);
      const slide={id:'clip',content:wrap.outerHTML,notes:'',transition:'',background:{id:''},vertical:false,layout:'header-two-columns',blocks:JSON.parse(JSON.stringify(blocks)),autoAnimate:{}};
      __revealationRegression.setTestState({id:'pc',title:'C',name:'C',author:'',theme:'clean',slides:[slide],currentId:'clip',config:{}});
      __revealationRegression.renderEditor();
      const left=document.querySelector('#slide-editor [data-slot="left"] .sr-layout-content');
      const right=document.querySelector('#slide-editor [data-slot="right"] .sr-layout-content');
      const list=left.querySelector('ul');
      let r=document.createRange(); r.selectNode(list); let sel=getSelection(); sel.removeAllRanges(); sel.addRange(r); left.focus(); sel.removeAllRanges(); sel.addRange(r);
      const listPayload=__revealationRegression.clipboardPayload();
      const safeList=__revealationRegression.validatedInternalClipboardHtml(listPayload?.html || '');
      const rightP=right.querySelector('p'); r=document.createRange(); r.selectNodeContents(rightP); sel.removeAllRanges(); sel.addRange(r); right.focus(); sel.removeAllRanges(); sel.addRange(r);
      __revealationRegression.insertHTMLAtCursor(safeList, r.cloneRange());
      const listResult=right.innerHTML;

      // Media selection does not create a native Range; the custom clipboard
      // path must still preserve the canonical figure, caption and width.
      sel.removeAllRanges(); left.focus();
      const image=left.querySelector('img'); __revealationRegression.selectMedia(image);
      const imagePayload=__revealationRegression.clipboardPayload();
      const safeImage=__revealationRegression.validatedInternalClipboardHtml(imagePayload?.html || '');
      r=document.createRange(); r.selectNodeContents(right); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); right.focus(); sel.removeAllRanges(); sel.addRange(r);
      __revealationRegression.insertHTMLAtCursor(safeImage, r.cloneRange());
      return {listPayload:listPayload?.html || '',listResult,imagePayload:imagePayload?.html || '',right:right.innerHTML};
    })()`);
    assert(crossFieldClipboard.listPayload.includes('<ul') && crossFieldClipboard.listPayload.includes('<strong>Child</strong>'), 'internal text/list clipboard lost structure before paste');
    assert(crossFieldClipboard.listResult.includes('<ul') && crossFieldClipboard.listResult.includes('<ul><li><strong>Child</strong></li></ul>'), `nested list did not paste between fields: ${crossFieldClipboard.listResult}`);
    assert(crossFieldClipboard.imagePayload.includes('sr-media-caption') && crossFieldClipboard.imagePayload.includes('width: 55%') && crossFieldClipboard.imagePayload.includes('<figcaption>Caption</figcaption>'), 'internal media clipboard lost caption/size formatting');
    assert(crossFieldClipboard.right.includes('sr-media-caption') && crossFieldClipboard.right.includes('width: 55%'), 'image paste between fields lost canonical formatting');

    // A snapshotted insertion Range wins over later focus movement. This is
    // the contract used by async clipboard image optimization/upload.
    const stableAsyncTarget = await evaluate(`(() => {
      const blocks=[{html:'<h1>Paste</h1>',align:'left'},{html:'<p>LEFT</p>',align:'left'},{html:'<p>RIGHT</p>',align:'left'}];
      const wrap=Revealation.layout.blocks.createElementFromHtml('header-two-columns',blocks);
      const slide={id:'async',content:wrap.outerHTML,notes:'',transition:'',background:{id:''},vertical:false,layout:'header-two-columns',blocks:JSON.parse(JSON.stringify(blocks)),autoAnimate:{}};
      __revealationRegression.setTestState({id:'pa',title:'A',name:'A',author:'',theme:'clean',slides:[slide],currentId:'async',config:{}}); __revealationRegression.renderEditor();
      const left=document.querySelector('#slide-editor [data-slot="left"] p').firstChild; const right=document.querySelector('#slide-editor [data-slot="right"] p').firstChild;
      let r=document.createRange(); r.setStart(left,left.length); r.collapse(true); let sel=getSelection(); sel.removeAllRanges(); sel.addRange(r); const target=r.cloneRange();
      r=document.createRange(); r.setStart(right,right.length); r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
      __revealationRegression.insertHTMLAtCursor('<img src="data:image/png;base64,AAAA" alt="pasted">',target);
      return {left:document.querySelector('#slide-editor [data-slot="left"] .sr-layout-content').innerHTML,right:document.querySelector('#slide-editor [data-slot="right"] .sr-layout-content').innerHTML};
    })()`);
    assert(stableAsyncTarget.left.includes('alt="pasted"'), 'snapshotted paste target did not receive inserted image');
    assert(!stableAsyncTarget.right.includes('alt="pasted"'), 'async-style paste followed later focus into the wrong field');

    // Alignment is selection-aware inside semantic layout fields. A text
    // selection aligns only the paragraph-like units it touches, an explicit
    // media selection aligns only that media, and a collapsed caret aligns the
    // complete current layout field.
    const scopedAlignment = await evaluate(`(() => {
      const blocks=[
        {html:'<h1>Heading</h1>',align:'left'},
        {html:'<p id="p1">Alpha beta gamma</p><p id="p2">Second paragraph</p><img id="pic" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="diagram">',align:'left'}
      ];
      const slide={id:'align-1',content:'',notes:'',transition:'',background:{id:''},vertical:false,layout:'header-body',blocks:JSON.parse(JSON.stringify(blocks)),autoAnimate:{}};
      __revealationRegression.setTestState({id:'align-project',title:'Align',name:'Align',author:'',theme:'clean',slides:[slide],currentId:'align-1',config:{center:false}});
      __revealationRegression.renderEditor();
      const host=document.querySelector('#slide-editor [data-slot="body"] .sr-layout-content');
      const p1=host.querySelector('#p1');
      let range=document.createRange(); range.setStart(p1.firstChild,2); range.setEnd(p1.firstChild,6);
      let sel=getSelection(); sel.removeAllRanges(); sel.addRange(range); p1.focus?.(); sel.removeAllRanges(); sel.addRange(range);
      __revealationRegression.setAlignment('center');
      const afterText=host.innerHTML;
      const textHostClass=host.className;
      const storedAfterText=slide.blocks[1].html;

      const pic=host.querySelector('#pic'); __revealationRegression.selectMedia(pic);
      __revealationRegression.setAlignment('right');
      const afterImage=host.innerHTML;
      const imageHostClass=host.className;

      __revealationRegression.selectMedia(null);
      const p2=host.querySelector('#p2'); range=document.createRange(); range.setStart(p2.firstChild,3); range.collapse(true);
      sel.removeAllRanges(); sel.addRange(range); p2.focus?.(); sel.removeAllRanges(); sel.addRange(range);
      __revealationRegression.setAlignment('right');
      return {
        afterText,textHostClass,storedAfterText,afterImage,imageHostClass,
        finalHostClass:host.className,finalHtml:host.innerHTML,storedAlign:slide.blocks[1].align
      };
    })()`);
    assert(scopedAlignment.afterText.includes('<div class="sr-align-center"><p id="p1">Alpha beta gamma</p></div>'),
      `partial text selection did not align its complete paragraph only: ${scopedAlignment.afterText}`);
    assert(!/sr-align-center/.test(scopedAlignment.textHostClass) && scopedAlignment.afterText.includes('<p id="p2">Second paragraph</p>'),
      `partial text alignment changed the complete layout field: ${JSON.stringify(scopedAlignment)}`);
    assert(scopedAlignment.storedAfterText.includes('sr-align-center'), 'partial text alignment was not persisted in the layout block HTML');
    assert(scopedAlignment.afterImage.includes('<div class="sr-align-right"><img id="pic"'),
      `selected image was not aligned independently: ${scopedAlignment.afterImage}`);
    assert(!/sr-align-right/.test(scopedAlignment.imageHostClass), 'selected image alignment leaked to the complete layout field');
    assert(/sr-align-right/.test(scopedAlignment.finalHostClass) && scopedAlignment.storedAlign === 'right',
      `collapsed-caret alignment did not update the complete layout field: ${JSON.stringify(scopedAlignment)}`);
    assert(!scopedAlignment.finalHtml.includes('sr-align-center'), 'whole-field alignment left stale partial alignment wrappers behind');

    const appSelectAll = await evaluate(`(() => {
      const blocks=[{html:'<h1>Header</h1>',align:'left'},{html:'<p>Body one</p><p>Body two</p>',align:'left'}];
      const slide={id:'selectall-1',content:'',notes:'',transition:'',background:{id:''},vertical:false,layout:'header-body',blocks,autoAnimate:{}};
      __revealationRegression.setTestState({id:'selectall-project',title:'Select all',name:'Select all',author:'',theme:'clean',slides:[slide],currentId:'selectall-1',config:{}});
      __revealationRegression.renderEditor();
      const host=document.querySelector('#slide-editor [data-slot="body"] .sr-layout-content'); const text=host.querySelector('p').firstChild;
      const r=document.createRange(); r.setStart(text,2); r.collapse(true); const sel=getSelection(); sel.removeAllRanges(); sel.addRange(r); host.focus(); sel.removeAllRanges(); sel.addRange(r);
      let prevented=0; const handled=__revealationRegression.handleEditorKeydown({key:'a',ctrlKey:true,metaKey:false,altKey:false,preventDefault(){prevented++},stopPropagation(){}});
      return {handled,prevented,text:sel.toString(),headerSelected:sel.toString().includes('Header')};
    })()`);
    assert(appSelectAll.handled && appSelectAll.prevented === 1 && appSelectAll.text.includes('Body one') && appSelectAll.text.includes('Body two') && !appSelectAll.headerSelected,
      `application Ctrl+A did not select only the current layout field: ${JSON.stringify(appSelectAll)}`);

    // Regression: editor affordances mark editing hosts, not every paragraph.
    const editableBorders = await evaluate(`(() => {
      const probe = document.createElement('div');
      probe.className = 'slide-editor';
      probe.innerHTML = '<div class="sr-layout" data-layout="header-body"><div class="sr-layout-slot" data-slot="body"><div class="sr-layout-content" contenteditable="true"><p>Text</p></div></div></div>';
      document.body.appendChild(probe);
      const host = probe.querySelector('.sr-layout-content');
      const p = probe.querySelector('p');
      const result = {
        hostOutline: getComputedStyle(host).outlineStyle,
        paragraphOutline: getComputedStyle(p).outlineStyle,
      };
      probe.remove();
      return result;
    })()`);
    assert(editableBorders.hostOutline !== 'none', 'editable layout host is no longer visually marked');
    assert(editableBorders.paragraphOutline === 'none', `inner paragraph still has an editor outline: ${editableBorders.paragraphOutline}`);

    const themePayload = await evaluate(`(() => ({
      clean: __revealationRegression.themePayloadBits({theme:'clean'}),
      dark: __revealationRegression.themePayloadBits({theme:'dark'}),
      // RV-COMPAT(theme-custom): REMOVE legacy payload fixture BEFORE PUBLIC RELEASE.
      legacy: __revealationRegression.themePayloadBits({theme:'dark',legacyCustomTheme:{base:'black',fontSize:'31'}}),
    }))()`);
    assert(/\/themes\/clean\/theme\.css$/.test(themePayload.clean.themeCssHref), 'clean theme CSS is not registry-backed');
    assert(/\/themes\/dark\/theme\.css$/.test(themePayload.dark.themeCssHref), 'dark theme CSS is not registry-backed');
    assert(themePayload.clean.customCss === '', 'curated theme unexpectedly generates arbitrary custom CSS');
    assert(/--r-main-font-size:\s*31px/.test(themePayload.legacy.customCss), 'legacy custom presentation size no longer renders as a compatibility overlay');

    // Whole-deck Markdown has explicit exit semantics: dirty Close asks before
    // discarding, while a successful Apply rebuilds the deck and leaves source
    // mode. Merely opening the source does not make it dirty.
    const markdownExitFlow = await evaluate(`(async () => {
      const slide = { id:'md-1', content:'<h2>Markdown exit</h2><p>Body</p>', notes:'', transition:'', background:{id:''}, vertical:false, layout:'single', blocks:null, autoAnimate:{enabled:false,id:'',duration:'',easing:'',unmatched:''}, underConstruction:false };
      __revealationRegression.setTestState({ id:'md-project', name:'Markdown exit', title:'Markdown exit', author:'', theme:'clean', slides:[slide], currentId:'md-1', config:{} });
      __revealationRegression.renderEditor();
      await __revealationRegression.openMarkdownMode();
      const pane = document.getElementById('markdown-pane');
      const ta = document.getElementById('markdown-text');
      const opened = !pane.hidden && document.body.classList.contains('markdown-mode');
      const cleanClosed = await __revealationRegression.closeMarkdownMode();
      const cleanCloseNoDialog = !document.querySelector('.app-dialog');

      await __revealationRegression.openMarkdownMode();
      ta.value += '\\n';
      const discardPromise = __revealationRegression.closeMarkdownMode();
      await new Promise(resolve => setTimeout(resolve, 0));
      const discardDialog = document.querySelector('.app-dialog');
      const discardPrompted = !!discardDialog && /Discard your unapplied Markdown changes/.test(discardDialog.textContent || '');
      discardDialog?.querySelector('.app-dialog-cancel')?.click();
      const cancelled = !(await discardPromise) && !pane.hidden;

      const discardPromise2 = __revealationRegression.closeMarkdownMode();
      await new Promise(resolve => setTimeout(resolve, 0));
      document.querySelector('.app-dialog .app-dialog-confirm')?.click();
      const discarded = await discardPromise2;
      const closedAfterDiscard = pane.hidden && !document.body.classList.contains('markdown-mode');

      await __revealationRegression.openMarkdownMode();
      ta.value = ta.value.replace('Markdown exit', 'Markdown applied');
      const applied = await __revealationRegression.applyAndCloseMarkdownMode();
      const closedAfterApply = pane.hidden && !document.body.classList.contains('markdown-mode');
      return { opened, cleanClosed, cleanCloseNoDialog, discardPrompted, cancelled, discarded, closedAfterDiscard, applied, closedAfterApply };
    })()`);
    assert(markdownExitFlow.opened && markdownExitFlow.cleanClosed && markdownExitFlow.cleanCloseNoDialog,
      `clean Markdown close is not immediate: ${JSON.stringify(markdownExitFlow)}`);
    assert(markdownExitFlow.discardPrompted && markdownExitFlow.cancelled && markdownExitFlow.discarded && markdownExitFlow.closedAfterDiscard,
      `dirty Markdown discard guard is broken: ${JSON.stringify(markdownExitFlow)}`);
    assert(markdownExitFlow.applied && markdownExitFlow.closedAfterApply,
      `Markdown Apply no longer returns to slide editing: ${JSON.stringify(markdownExitFlow)}`);

    // Dark-mode form controls must not inherit light text onto browser-default
    // white number/text surfaces. Check representative controls from all three
    // dialogs where this was reported: Deck settings, App settings and
    // Interactive content.
    const darkFormContrast = await evaluate(`(() => {
      document.body.classList.remove('light');
      __revealationRegression.renderPresentationSettings();
      const contrast = (el) => {
        const cs=getComputedStyle(el);
        const parse=(value)=>{ const m=String(value).match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/); return m ? m.slice(1).map(Number) : [0,0,0]; };
        const lum=(rgb)=>{ const v=rgb.map(x=>{x/=255; return x<=.03928?x/12.92:Math.pow((x+.055)/1.055,2.4)}); return .2126*v[0]+.7152*v[1]+.0722*v[2]; };
        const a=lum(parse(cs.color)), b=lum(parse(cs.backgroundColor));
        return {ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),color:cs.color,background:cs.backgroundColor};
      };
      return {
        deck:contrast(document.getElementById('deck-settings-name')),
        app:contrast(document.getElementById('setting-autoSlide')),
        interactiveText:contrast(document.getElementById('interactive-src')),
        interactiveNumber:contrast(document.getElementById('interactive-modal-height')),
      };
    })()`);
    for (const [name, sample] of Object.entries(darkFormContrast)) {
      assert(sample.ratio >= 4.5, `${name} dark form control has insufficient text contrast: ${JSON.stringify(sample)}`);
    }

    // Delayed intrinsic media sizing must trigger a second centering pass. The
    // synthetic image starts short, then becomes tall as if its dimensions
    // arrived after decoding; the reflow hook should reduce vertical padding.
    const delayedMediaCentering = await evaluate(`new Promise(resolve => {
      const slide={id:'center-1',content:'<p>Centered content</p>',notes:'',transition:'',background:{id:''},vertical:false,layout:'single',blocks:null,autoAnimate:{}};
      __revealationRegression.setTestState({id:'center-project',title:'Center',name:'Center',author:'',theme:'clean',slides:[slide],currentId:'center-1',config:{center:true,width:960,height:700,margin:0.04}});
      __revealationRegression.renderEditor();
      const editor=document.getElementById('slide-editor');
      editor.innerHTML='<p>Centered content</p><img id="late-media" alt="late" style="display:block;width:100px;height:20px">';
      __revealationRegression.applySlideEffects();
      const before=parseFloat(editor.style.paddingTop)||0;
      const image=document.getElementById('late-media'); image.style.height='300px';
      __revealationRegression.handleEditorIntrinsicLoad({target:image});
      requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
        resolve({before,after:parseFloat(editor.style.paddingTop)||0,overflow:document.getElementById('slide-frame').hasAttribute('data-content-overflow')});
      })));
    })`);
    assert(delayedMediaCentering.before > delayedMediaCentering.after + 40,
      `delayed media load did not recenter the editor: ${JSON.stringify(delayedMediaCentering)}`);

    // Interactive iframe heights are authored in logical Reveal pixels. The
    // editor uses a physically scaled canvas, so the live iframe wrapper must
    // use the same stage scale without persisting that editor-only height.
    const interactiveStageScale = await evaluate(`(() => {
      const stage=document.querySelector('.stage');
      stage.style.width='500px'; stage.style.height='400px'; stage.style.flex='none';
      const content=Revealation.content.interactive.toHtml({src:'interactive/example/index.html',width:100,height:480,interactive:true,preload:false,border:false,scrollbars:false});
      const slide={id:'interactive-scale',content,notes:'',transition:'',background:{id:''},vertical:false,layout:'single',blocks:null,autoAnimate:{}};
      const project={id:'interactive-scale-project',title:'Interactive scale',name:'Interactive scale',author:'',theme:'clean',slides:[slide],currentId:slide.id,config:{center:true,width:960,height:700,margin:0.04}};
      __revealationRegression.setTestState(project);
      __revealationRegression.renderEditor();
      __revealationRegression.updateStageScale();
      const frame=document.getElementById('slide-frame');
      const el=document.querySelector('#slide-editor .sr-interactive');
      const scale=Number(getComputedStyle(frame).getPropertyValue('--stage-scale'));
      const liveHeight=parseFloat(el.style.height);
      const logicalHeight=Number(el.dataset.height);
      __revealationRegression.captureCurrentContent();
      return {scale,liveHeight,logicalHeight,stored:project.slides[0].content};
    })()`);
    assert(interactiveStageScale.scale > 0 && interactiveStageScale.scale < 1,
      `interactive scale regression did not exercise a scaled editor: ${JSON.stringify(interactiveStageScale)}`);
    assert(Math.abs(interactiveStageScale.liveHeight - 480 * interactiveStageScale.scale) < 1,
      `interactive iframe did not follow editor stage scale: ${JSON.stringify(interactiveStageScale)}`);
    assert(interactiveStageScale.logicalHeight === 480 && /height:\s*480px/.test(interactiveStageScale.stored),
      `editor-scaled interactive height leaked into persisted content: ${JSON.stringify(interactiveStageScale)}`);

    // Regression: the selected-media height input must update the canonical
    // logical data-height, not only the editor's scaled inline projection.
    const interactiveHeightEdit = await evaluate(`(() => {
      const stage=document.querySelector('.stage');
      stage.style.width='500px'; stage.style.height='400px'; stage.style.flex='none';
      const content=Revealation.content.interactive.toHtml({src:'interactive/example/index.html',width:100,height:480,interactive:true,preload:false,border:false,scrollbars:false});
      const slide={id:'interactive-height',content,notes:'',transition:'',background:{id:''},vertical:false,layout:'single',blocks:null,autoAnimate:{}};
      const project={id:'interactive-height-project',title:'Interactive height',name:'Interactive height',author:'',theme:'clean',slides:[slide],currentId:slide.id,config:{center:true,width:960,height:700,margin:0.04}};
      __revealationRegression.setTestState(project);
      __revealationRegression.renderEditor();
      const el=document.querySelector('#slide-editor .sr-interactive');
      __revealationRegression.selectMedia(el);
      __revealationRegression.setSelectedInteractiveHeight(640);
      const frame=document.getElementById('slide-frame');
      const scale=Number(getComputedStyle(frame).getPropertyValue('--stage-scale'));
      const live=document.querySelector('#slide-editor .sr-interactive');
      return {dataHeight:Number(live.dataset.height),liveHeight:parseFloat(live.style.height),scale,stored:project.slides[0].content};
    })()`);
    assert(interactiveHeightEdit.dataHeight === 640,
      `interactive height inspector did not update canonical data-height: ${JSON.stringify(interactiveHeightEdit)}`);
    assert(Math.abs(interactiveHeightEdit.liveHeight - 640 * interactiveHeightEdit.scale) < 1,
      `interactive height inspector did not update scaled editor height: ${JSON.stringify(interactiveHeightEdit)}`);
    assert(/data-height="640"/.test(interactiveHeightEdit.stored) && /height:\s*640px/.test(interactiveHeightEdit.stored),
      `interactive height inspector did not persist its value: ${JSON.stringify(interactiveHeightEdit)}`);

    // Editor geometry must preserve theme vertical padding when centering is
    // disabled. The old centering helper forcibly set padding-top/bottom=0,
    // so editor/Present/PDF could never be genuinely WYSIWYG.
    const editorThemePadding = await evaluate(`(() => {
      document.documentElement.style.setProperty('--rv-slide-padding','64px');
      const stage=document.querySelector('.stage'); stage.style.width='1000px'; stage.style.height='760px'; stage.style.flex='none';
      const slide={id:'padding-slide',content:'<h1>Top aligned</h1><p>Body</p>',notes:'',transition:'',background:{id:''},vertical:false,layout:'single',blocks:null,autoAnimate:{}};
      const project={id:'padding-project',title:'Padding',name:'Padding',author:'',theme:'clean',slides:[slide],currentId:slide.id,config:{center:false,width:960,height:700,margin:0.04}};
      __revealationRegression.setTestState(project); __revealationRegression.renderEditor(); __revealationRegression.applySlideEffects();
      const editor=document.getElementById('slide-editor'); const frame=document.getElementById('slide-frame');
      const scale=Number(getComputedStyle(frame).getPropertyValue('--stage-scale'));
      const cs=getComputedStyle(editor);
      const fontSize=parseFloat(cs.fontSize);
      document.documentElement.style.removeProperty('--rv-slide-padding');
      stage.style.width=''; stage.style.height=''; stage.style.flex='';
      return {scale,padTop:parseFloat(cs.paddingTop),padBottom:parseFloat(cs.paddingBottom),fontSize};
    })()`);
    assert(Math.abs(editorThemePadding.padTop - 64 * editorThemePadding.scale) < 1 && Math.abs(editorThemePadding.padBottom - 64 * editorThemePadding.scale) < 1,
      `editor discarded theme vertical padding: ${JSON.stringify(editorThemePadding)}`);
    assert(Math.abs(editorThemePadding.fontSize - 22 * editorThemePadding.scale) < 1,
      `editor body font does not use the same logical size/scale as Reveal: ${JSON.stringify(editorThemePadding)}`);

    // Main toolbar exposes only the deliberate deck/application command set.
    // Curated visual controls live in Deck settings; App settings remains
    // application/presentation behavior rather than arbitrary styling.
    // Regression: keyboard/command navigation must move the primary sidebar
    // selection with the active slide. Multi-selection is opt-in only.
    const sidebarSelection = await evaluate(`(() => {
      const mk=(id,text)=>({id,content:'<h2>'+text+'</h2>',notes:'',transition:'',background:{id:''},vertical:false,layout:'single',blocks:null,autoAnimate:{},underConstruction:false,hidden:false});
      const project=__revealationRegression.normalizeProject({id:'nav-project',name:'Nav',title:'Nav',author:'',theme:'clean',slides:[mk('a','A'),mk('b','B')],currentId:'a',config:{}},'Nav');
      __revealationRegression.setTestState(project);
      __revealationRegression.renderEditor();
      __revealationRegression.selectSlide('b');
      return {
        selected:__revealationRegression.getSelectedSlideIds(),
        active:Array.from(document.querySelectorAll('#slide-list li.active')).map(li=>li.dataset.id),
        selectedRows:Array.from(document.querySelectorAll('#slide-list li.selected')).map(li=>li.dataset.id),
      };
    })()`);
    assert(JSON.stringify(sidebarSelection.selected) === JSON.stringify(['b']), `keyboard/navigation selection stayed on the old slide: ${JSON.stringify(sidebarSelection)}`);
    assert(JSON.stringify(sidebarSelection.active) === JSON.stringify(['b']) && JSON.stringify(sidebarSelection.selectedRows) === JSON.stringify(['b']),
      `sidebar active and selected states diverged: ${JSON.stringify(sidebarSelection)}`);

    // Sidebar titles come from exactly one slot selected by the layout schema.
    // Media/backgrounds or unrelated body fields must never invent a title.
    const titleSourcePolicy = await evaluate(`(() => {
      const headerBody={id:'t1',content:'',notes:'',transition:'',background:{id:''},vertical:false,layout:'header-body',blocks:[
        {html:'<h1>Configured title</h1>',align:'left'},
        {html:'<p>Body text that must not join the title</p>',align:'left'}
      ],autoAnimate:{},underConstruction:false,hidden:false};
      const imageHeader={...headerBody,id:'t2',blocks:[
        {html:'<img src="data:image/png;base64,AAAA" alt="diagram">',align:'left'},
        {html:'<h2>Body heading should not become title</h2>',align:'left'}
      ]};
      const columns={id:'t3',content:'',notes:'',transition:'',background:{id:''},vertical:false,layout:'two-columns',blocks:[
        {html:'<p>Left label</p>',align:'left'},
        {html:'<p>Right text ignored</p>',align:'left'}
      ],autoAnimate:{},underConstruction:false,hidden:false};
      return {
        header:__revealationRegression.slideLabel(headerBody,0).text,
        image:__revealationRegression.slideLabel(imageHeader,1).text,
        columns:__revealationRegression.slideLabel(columns,2).text,
      };
    })()`);
    assert(titleSourcePolicy.header === 'Configured title', `slide title included content outside configured field: ${JSON.stringify(titleSourcePolicy)}`);
    assert(titleSourcePolicy.image === 'Slide 2', `non-text title field did not fall back to Slide N: ${JSON.stringify(titleSourcePolicy)}`);
    assert(titleSourcePolicy.columns === 'Left label', `two-column title source did not use the configured field: ${JSON.stringify(titleSourcePolicy)}`);

    // The current layout is communicated in the picker, never painted over
    // the editing canvas itself.
    const layoutPickerState = await evaluate(`(() => {
      const slide={id:'layout-current',content:'',notes:'',transition:'',background:{id:''},vertical:false,layout:'header-body',blocks:[{html:'<h1>Title</h1>',align:'left'},{html:'<p>Body</p>',align:'left'}],autoAnimate:{},underConstruction:false,hidden:false};
      __revealationRegression.setTestState({id:'layout-project',name:'Layout',title:'Layout',author:'',theme:'clean',slides:[slide],currentId:slide.id,config:{}});
      __revealationRegression.renderEditor();
      __revealationRegression.renderLayoutChoices();
      const current=document.querySelector('#layout-choices [data-layout="header-body"]');
      const layout=document.querySelector('#slide-editor .sr-layout');
      return {
        active:current?.classList.contains('active') || false,
        aria:current?.getAttribute('aria-current') || '',
        currentText:current?.querySelector('.layout-choice-current')?.textContent?.trim() || '',
        canvasLabel:getComputedStyle(layout,'::before').content,
        toolbarIcon:document.querySelector('#btn-slide-layout i')?.className || '',
      };
    })()`);
    assert(layoutPickerState.active && layoutPickerState.aria === 'true' && /Current/.test(layoutPickerState.currentText),
      `current layout is not clear in the picker: ${JSON.stringify(layoutPickerState)}`);
    assert(!/layout:/i.test(layoutPickerState.canvasLabel || ''), `layout label is still painted on the editor canvas: ${JSON.stringify(layoutPickerState)}`);
    assert(layoutPickerState.toolbarIcon.includes('bi-grid-3x2-gap'), `layout toolbar icon was not changed to the multi-rectangle icon: ${layoutPickerState.toolbarIcon}`);

    // Hidden slides stay authorable but disappear at the presentation/export
    // boundary. The current hidden slide starts "Present from here" at the
    // next visible slide when possible.
    const hiddenSlides = await evaluate(`(() => {
      const mk=(id,text,extra={})=>Object.assign({id,content:'<h2>'+text+'</h2>',notes:'',transition:'',background:{id:''},vertical:false,layout:'single',blocks:null,autoAnimate:{},underConstruction:false,hidden:false},extra);
      const project=__revealationRegression.normalizeProject({id:'hidden-project',name:'Hidden',title:'Hidden',author:'',theme:'clean',slides:[
        mk('v1','Visible one'),
        mk('h1','SECRET HIDDEN',{hidden:true,background:{id:'grid'},content:'<div class="sr-interactive" data-src="secret.html" data-interactive="1" data-preload="0" data-border="0" data-scrollbars="0" style="width: 100%; height: 480px;"><iframe src="secret.html" title="Interactive content" loading="lazy" scrolling="no" allow="fullscreen"></iframe></div>'}),
        mk('v2','Visible two')
      ],currentId:'h1',config:{}},'Hidden');
      const md=__revealationRegression.projectToMarkdown(project);
      const parsed=__revealationRegression.parseMarkdownDeck(md);
      return {
        visibleIds:__revealationRegression.presentationSlides(project).map(s=>s.id),
        startId:__revealationRegression.presentationStartSlide(project)?.id || '',
        sections:__revealationRegression.buildSections(project.slides,project),
        linkedHtml:__revealationRegression.deckExporter.buildLinkedHtml(project),
        backgrounds:__revealationRegression.backgroundResources(project).map(bg=>bg.id),
        warnsInteractive:__revealationRegression.deckExporter.containsInteractive(project),
        md,
        parsedHidden:parsed.map(s=>!!s.hidden),
        stackProjection:__revealationRegression.presentationSlides({slides:[
          mk('before','Before'),
          mk('parent','Hidden parent',{hidden:true}),
          mk('sub1','Visible sub 1',{vertical:true}),
          mk('sub2','Visible sub 2',{vertical:true})
        ]}).map(s=>({id:s.id,vertical:s.vertical})),
      };
    })()`);
    assert(JSON.stringify(hiddenSlides.visibleIds) === JSON.stringify(['v1','v2']), `hidden slide was not filtered from presentation slides: ${JSON.stringify(hiddenSlides)}`);
    assert(hiddenSlides.startId === 'v2', `Present from here on a hidden slide did not advance to the next visible slide: ${JSON.stringify(hiddenSlides)}`);
    assert(hiddenSlides.sections.includes('Visible one') && hiddenSlides.sections.includes('Visible two') && !hiddenSlides.sections.includes('SECRET HIDDEN') && !hiddenSlides.sections.includes('secret.html'),
      `hidden slide leaked into presentation/export sections: ${hiddenSlides.sections}`);
    assert(!hiddenSlides.linkedHtml.includes('SECRET HIDDEN') && !hiddenSlides.linkedHtml.includes('secret.html'),
      'hidden slide leaked into linked/ZIP presentation HTML');
    assert(!hiddenSlides.backgrounds.includes('grid'), `background used only by a hidden slide leaked into presentation resources: ${JSON.stringify(hiddenSlides.backgrounds)}`);
    assert(hiddenSlides.warnsInteractive === false, 'hidden interactive slide still triggers standalone export warning');
    assert(JSON.stringify(hiddenSlides.stackProjection) === JSON.stringify([{id:'before',vertical:false},{id:'sub1',vertical:false},{id:'sub2',vertical:true}]),
      `hiding a stack parent incorrectly attached its subslides to the previous slide: ${JSON.stringify(hiddenSlides.stackProjection)}`);
    assert(/hidden=true/.test(hiddenSlides.md) && JSON.stringify(hiddenSlides.parsedHidden) === JSON.stringify([false,true,false]),
      `hidden status did not round-trip through Markdown metadata: ${JSON.stringify(hiddenSlides)}`);

    // Editor and Present must agree on authored block geometry. In particular,
    // browser-default heading/paragraph top margins used to make a tall
    // interactive slide appear lower in Present and clip at the bottom.
    const cleanThemeCss = fs.readFileSync(path.join(ROOT, 'themes/clean/theme.css'), 'utf8');
    const presentationGeometry = await evaluate(`(() => {
      const theme=document.createElement('style'); theme.id='geometry-theme'; theme.textContent=${JSON.stringify(cleanThemeCss)}; document.head.appendChild(theme);
      const content=document.createElement('style'); content.id='geometry-content'; content.textContent=__revealationRegression.deckContentCss(); document.head.appendChild(content);
      const probe=document.createElement('div'); probe.id='geometry-probe'; probe.className='reveal'; probe.innerHTML='<div class="slides"><section class="rv-slide"><h1 id="geometry-title">Interactive demo</h1><p id="geometry-copy">Intro</p><div class="sr-interactive" data-height="480" style="width:100%;height:480px"><iframe></iframe></div></section></div>'; document.body.appendChild(probe);
      const title=getComputedStyle(document.getElementById('geometry-title'));
      const copy=getComputedStyle(document.getElementById('geometry-copy'));
      const reveal=getComputedStyle(probe);
      const result={titleTop:title.marginTop,titleBottom:title.marginBottom,titleLine:title.lineHeight,copyTop:copy.marginTop,revealLine:reveal.lineHeight};
      probe.remove(); theme.remove(); content.remove();
      return result;
    })()`);
    assert(presentationGeometry.titleTop === '0px' && presentationGeometry.copyTop === '0px',
      `Present still inherits browser top margins: ${JSON.stringify(presentationGeometry)}`);
    assert(presentationGeometry.titleLine !== 'normal' && presentationGeometry.revealLine !== 'normal',
      `Present block line-height is not normalized to editor geometry: ${JSON.stringify(presentationGeometry)}`);

    // Code blocks use one bounded slide geometry in editor/Present/PDF. The
    // Highlight.js theme must not inflate a code block back to body-sized text
    // or let a long token force the PRE wider than its slide.
    const codeGeometry = await evaluate(`(() => {
      const theme=document.createElement('style'); theme.id='code-theme'; theme.textContent=${JSON.stringify(cleanThemeCss)}; document.head.appendChild(theme);
      const content=document.createElement('style'); content.id='code-content'; content.textContent=__revealationRegression.deckContentCss(); document.head.appendChild(content);
      const highlight=document.createElement('style'); highlight.textContent='.hljs{display:block;overflow-x:auto;padding:1em;background:#272822;color:#ddd}'; document.head.appendChild(highlight);
      const probe=document.createElement('div'); probe.className='reveal'; probe.style.width='640px'; probe.style.fontSize='22px';
      probe.innerHTML='<div class="slides"><section id="code-slide" class="rv-slide" style="width:640px"><pre id="code-pre" class="sr-code"><code id="code-el" class="hljs">const extremelyLongIdentifierWithoutNaturalBreaks123456789012345678901234567890 = 42;</code></pre></section></div>';
      document.body.appendChild(probe);
      const slide=document.getElementById('code-slide'); const pre=document.getElementById('code-pre'); const code=document.getElementById('code-el');
      const ps=getComputedStyle(pre); const cs=getComputedStyle(code);
      const result={font:parseFloat(ps.fontSize),body:parseFloat(getComputedStyle(probe).fontSize),preWidth:pre.getBoundingClientRect().width,slideWidth:slide.getBoundingClientRect().width,scrollWidth:code.scrollWidth,clientWidth:code.clientWidth,whiteSpace:cs.whiteSpace,wrap:cs.overflowWrap};
      probe.remove(); theme.remove(); content.remove(); highlight.remove();
      return result;
    })()`);
    assert(codeGeometry.font < codeGeometry.body * 0.8, `code block is still effectively body-sized: ${JSON.stringify(codeGeometry)}`);
    assert(codeGeometry.preWidth <= codeGeometry.slideWidth + 1, `code block exceeds slide width: ${JSON.stringify(codeGeometry)}`);
    assert(codeGeometry.scrollWidth <= codeGeometry.clientWidth + 2, `long highlighted code still overflows horizontally: ${JSON.stringify(codeGeometry)}`);
    assert(codeGeometry.whiteSpace === 'pre-wrap' && codeGeometry.wrap === 'anywhere', `code wrapping safeguards are missing: ${JSON.stringify(codeGeometry)}`);

    const visualControlsUi = await evaluate(`(() => {
      __revealationRegression.renderStyleForms();
      __revealationRegression.renderPresentationSettings();
      const directTopbarIds = Array.from(document.querySelectorAll('.topbar-left [id], .topbar-center [id], .topbar-right [id]')).map(el => el.id);
      return {
        deckSettingsButton: !!document.getElementById('btn-deck-settings'),
        deckMetadata: !!document.querySelector('#deck-settings-modal #deck-settings-name'),
        deckAuthor: !!document.querySelector('#deck-settings-modal #deck-settings-author'),
        deckTitleEditable: document.getElementById('deck-title')?.matches('input, textarea, [contenteditable="true"]') || false,
        themeChoices: !!document.querySelector('#deck-settings-modal #theme-choices'),
        backgroundChoices: !!document.getElementById('background-choices'),
        styleTransition: !!document.querySelector('#deck-settings-modal #style-transition'),
        styleLayout: !!document.querySelector('#deck-settings-modal #style-width') && !!document.querySelector('#deck-settings-modal #style-height'),
        appAppearance: !!document.querySelector('#settings-modal #settings-theme-light') && !!document.querySelector('#settings-modal #settings-theme-dark'),
        appPresentationControls: !!document.querySelector('#settings-modal #setting-controls')
          && !!document.querySelector('#settings-modal #setting-progress')
          && !!document.querySelector('#settings-modal #setting-slideNumber'),
        appNavigation: !!document.querySelector('#settings-modal #setting-keyboard')
          && !!document.querySelector('#settings-modal #setting-navigationMode'),
        appPresentOptions: !!document.querySelector('#settings-modal #setting-previewLinks'),
        appPlayback: !!document.querySelector('#settings-modal #setting-autoSlide'),
        appStyleLeak: !!document.querySelector('#settings-modal #setting-transition')
          || !!document.querySelector('#settings-modal #setting-width')
          || !!document.querySelector('#settings-modal #setting-center'),
        presentLabel: document.getElementById('btn-preview')?.textContent?.trim(),
        presentFrame: !!document.getElementById('present-frame'),
        presentHasBanner: !!document.querySelector('#present-modal > .modal-head'),
        perSlideTransition: !!document.getElementById('slide-transition'),
        oldThemePicker: !!document.getElementById('btn-theme-picker'),
        saveIndicator: !!document.getElementById('save-indicator'),
        exportDialog: !!document.querySelector('#export-modal #btn-export-html')
          && !!document.querySelector('#export-modal #btn-export-zip')
          && !!document.querySelector('#export-modal .export-warning'),
        helpDialog: !!document.querySelector('#help-modal #btn-markdown')
          && !!document.querySelector('#help-modal #btn-markdown-recover'),
        undoInFormattingToolbar: !!document.querySelector('#toolbar #btn-undo, #toolbar #btn-redo'),
        footerMeta: !!document.querySelector('.editor > .meta'),
        notesSidebar: !!document.querySelector('#notes-panel #notes-panel-text'),
        notesSubslide: !!document.querySelector('#notes-panel #slide-subslide'),
        notesWip: !!document.querySelector('#notes-panel #slide-wip'),
        notesHidden: !!document.querySelector('#notes-panel #slide-hidden'),
        slideToolbarActions: Array.from(document.querySelectorAll('#toolbar [data-toolbar-group="slide"] [id]')).map(el => el.id),
        topbarIds: directTopbarIds,
        topbarLeftIds: Array.from(document.querySelectorAll('.topbar-left > [id]')).map(el => el.id),
        topbarCenterIds: Array.from(document.querySelectorAll('.topbar-center > [id]')).map(el => el.id),
        topbarRightIds: Array.from(document.querySelectorAll('.topbar-right > [id]')).map(el => el.id),
        fromHereHasIcon: !!document.querySelector('#btn-preview-here .bi'),
        markdownClose: document.getElementById('markdown-close')?.textContent?.trim() || '',
        markdownApply: document.getElementById('markdown-apply')?.textContent?.trim() || '',
        markdownShortcutInHelp: Array.from(document.querySelectorAll('#help-modal .shortcut-list dd')).some(el => /markdown/i.test(el.textContent || '')),
        topbarDisplay: getComputedStyle(document.querySelector('.topbar')).display,
        topbarCenterOffset: (() => {
          const rect = document.querySelector('.topbar-center').getBoundingClientRect();
          return Math.abs((rect.left + rect.width / 2) - (window.innerWidth / 2));
        })(),
        forbidden: ['ct-font-size','ct-heading-font','ct-body-font','ct-text-color','ct-background-color','ct-heading-shadow','background-type','background-value','background-fit','btn-theme-edit']
          .filter(id => document.getElementById(id)),
      };
    })()`);
    assert(visualControlsUi.deckSettingsButton && visualControlsUi.deckMetadata && visualControlsUi.deckAuthor && visualControlsUi.themeChoices && visualControlsUi.backgroundChoices,
      'Deck settings metadata or curated theme/background UI is missing');
    assert(!visualControlsUi.deckTitleEditable, 'deck title is still editable inline in the main toolbar');
    assert(visualControlsUi.styleTransition && visualControlsUi.styleLayout, 'presentation motion/layout controls are not in Deck settings');
    assert(visualControlsUi.appAppearance, 'Application settings lack the editor appearance toggle');
    assert(visualControlsUi.appPresentationControls && visualControlsUi.appNavigation && visualControlsUi.appPresentOptions && visualControlsUi.appPlayback,
      'Application settings are missing supported presentation behavior controls');
    assert(!visualControlsUi.appStyleLeak, 'Deck-style transition/canvas controls leaked back into Application settings');
    assert(visualControlsUi.presentLabel.includes('Present') && visualControlsUi.presentFrame && !visualControlsUi.presentHasBanner,
      'Present mode is not exposed as a banner-free presentation surface');
    assert(!visualControlsUi.perSlideTransition, 'per-slide transition is still exposed in Slide options');
    assert(!visualControlsUi.oldThemePicker, 'old top-bar theme picker remains exposed');
    assert(visualControlsUi.saveIndicator && visualControlsUi.exportDialog && visualControlsUi.helpDialog,
      'save indicator, export dialog, or help/recovery dialog is missing');
    assert(!visualControlsUi.undoInFormattingToolbar, 'undo/redo remain in the formatting toolbar');
    assert(!visualControlsUi.footerMeta, 'large per-slide footer settings strip still exists');
    assert(visualControlsUi.notesSidebar && visualControlsUi.notesSubslide && visualControlsUi.notesWip && visualControlsUi.notesHidden,
      'notes sidebar does not own notes/subslide/WIP/Hidden controls');
    assert(['btn-slide-layout','btn-slide-background','btn-notes-toggle'].every(id => visualControlsUi.slideToolbarActions.includes(id)),
      `slide toolbar actions are not grouped at the right: ${JSON.stringify(visualControlsUi.slideToolbarActions)}`);
    const expectedTopbar = ['app-brand','deck-title','btn-deck-settings','btn-export','btn-undo','btn-redo','btn-preview','btn-preview-here','btn-settings','btn-help','btn-mobile-menu'];
    assert(expectedTopbar.every(id => visualControlsUi.topbarIds.includes(id)), `main toolbar is missing required controls: ${JSON.stringify(visualControlsUi.topbarIds)}`);
    assert(JSON.stringify(visualControlsUi.topbarLeftIds) === JSON.stringify(['app-brand']),
      `left topbar should contain only the logo: ${JSON.stringify(visualControlsUi.topbarLeftIds)}`);
    assert(['deck-title'].every(id => visualControlsUi.topbarCenterIds.includes(id)),
      `deck identity is not centered in the topbar: ${JSON.stringify(visualControlsUi.topbarCenterIds)}`);
    assert(visualControlsUi.topbarDisplay === 'grid',
      `topbar is not using the configured grid layout: display=${visualControlsUi.topbarDisplay}`);
    assert(['btn-deck-settings','btn-export'].every(id => visualControlsUi.topbarRightIds.includes(id)),
      `deck settings/export are not in the right command group: ${JSON.stringify(visualControlsUi.topbarRightIds)}`);
    assert(visualControlsUi.fromHereHasIcon, 'Present from here is missing its menu icon');
    assert(visualControlsUi.markdownClose === 'Close' && visualControlsUi.markdownApply === 'Apply' && visualControlsUi.markdownShortcutInHelp,
      'Markdown mode does not expose Close/Apply actions and its keyboard shortcut');
    assert(!['btn-markdown','btn-markdown-recover','btn-export-html','btn-export-zip','btn-export-pdf','btn-projects','btn-new','btn-sync'].some(id => visualControlsUi.topbarIds.includes(id)),
      'advanced/recovery/project actions leaked back into the main toolbar');
    assert(visualControlsUi.forbidden.length === 0, `arbitrary visual controls remain in normal UI: ${visualControlsUi.forbidden.join(', ')}`);

    // RV-COMPAT(html-source-mode): REMOVE this test with the dormant source path BEFORE PUBLIC RELEASE.
    // Direct per-slide HTML source editing is intentionally not exposed in
    // the UI. The dormant control remains only as an internal compatibility
    // hook for old code paths.
    const htmlSourceUi = await evaluate(`(() => ({
      hidden: !document.getElementById('toggle-source') || document.getElementById('toggle-source').hidden === true,
      toolbarContains: !!document.querySelector('#toolbar #toggle-source:not([hidden])'),
    }))()`);
    assert(htmlSourceUi.hidden && !htmlSourceUi.toolbarContains, 'direct HTML source editor is still exposed in the toolbar');

    // Present runtime regression: preview.html receives its payload after the
    // shell has loaded. Theme CSS therefore arrives dynamically and Reveal must
    // not initialize until that stylesheet has fired `load`. This reproduces
    // the vertical-centering race that was most visible on tall iframes.
    await cdp('Page.navigate', {
      url: 'data:text/html,%3C!doctype%20html%3E%3Chtml%3E%3Chead%3E%3C%2Fhead%3E%3Cbody%3E%3C%2Fbody%3E%3C%2Fhtml%3E',
    });
    await sleep(80);
    await evaluate(`(() => {
      document.head.innerHTML='<base href="http://example.test/"><link rel="stylesheet" id="reveal-css"><link rel="stylesheet" id="theme-css"><link rel="stylesheet" id="highlight-css">';
      document.body.innerHTML='<div class="reveal"><div class="slides"></div></div>';
      window.__previewInitCalls=0; window.__previewLayoutCalls=0; window.__previewPrintCalls=0; window.__revealEvents={};
      window.print=function(){ window.__previewPrintCalls++; };
      // This fixture uses synthetic stylesheet load events; keep the font
      // readiness boundary deterministic so the test isolates stylesheet
      // ordering rather than waiting on Chromium's real font loader.
      Object.defineProperty(document, 'fonts', { configurable:true, value:{ ready:Promise.resolve() } });
      ['reveal-css','theme-css','highlight-css'].forEach(id => {
        const link=document.getElementById(id);
        Object.defineProperty(link,'href',{configurable:true,get(){return this.__href||'';},set(v){this.__href=v;}});
      });
      document.head.appendChild=(function(original){ return function(node){
        if(node && node.tagName==='LINK'){ setTimeout(()=>node.dispatchEvent(new Event('load')),0); return node; }
        return original.call(this,node);
      }; })(document.head.appendChild);
      document.body.appendChild=(function(original){ return function(node){
        if(node && node.tagName==='SCRIPT'){
          const src=String(node.src||'');
          if(src.includes('katex.min.js')) window.katex={render(){}};
          else if(src.includes('/dist/reveal.js')) window.Reveal={initialize(){window.__previewInitCalls++;return Promise.resolve();},layout(){window.__previewLayoutCalls++;},getIndices(){return {h:0,v:0};},on(name,fn){window.__revealEvents[name]=fn;},slide(){}};
          else if(src.includes('/plugin/notes/')) window.RevealNotes={};
          else if(src.includes('/plugin/highlight/')) window.RevealHighlight={};
          else if(src.includes('/plugin/math/')) window.RevealMath={KaTeX:{}};
          setTimeout(()=>{ if(node.onload) node.onload(); },0);
          return node;
        }
        return original.call(this,node);
      }; })(document.body.appendChild);
      window.RevealationBackgroundRuntime={setAssets(){},bindReveal(){}};
    })()`);
    const previewRuntimeSource = fs.readFileSync(path.join(ROOT, 'src/rendering/preview.js'), 'utf8');
    await evaluate(previewRuntimeSource + '\n//# sourceURL=src/rendering/preview-runtime-regression.js');
    await evaluate(`(() => {
      window.dispatchEvent(new MessageEvent('message',{data:{
        type:'render-deck',title:'Theme wait',theme:'clean',themeCssHref:'/held-theme.css',
        sections:'<section class="rv-slide"><h1>Title</h1><div class="sr-interactive" data-height="480" style="height:480px"><iframe></iframe></div></section>',
        contentCss:'.reveal .slides section.rv-slide{padding:64px}',backgroundResources:[],config:{width:960,height:700,center:true}
      }}));
      document.getElementById('reveal-css').dispatchEvent(new Event('load'));
      document.getElementById('highlight-css').dispatchEvent(new Event('load'));
    })()`);
    await sleep(80);
    const initBeforeTheme = await evaluate('window.__previewInitCalls');
    assert(initBeforeTheme === 0, `Reveal initialized before theme CSS loaded (${initBeforeTheme} calls)`);
    await evaluate(`document.getElementById('theme-css').dispatchEvent(new Event('load'))`);
    await sleep(120);
    const previewReady = await evaluate(`({init:window.__previewInitCalls,layout:window.__previewLayoutCalls})`);
    assert(previewReady.init === 1, `Reveal did not initialize after theme CSS loaded: ${JSON.stringify(previewReady)}`);
    assert(previewReady.layout >= 1, `Present runtime did not perform the post-paint layout pass: ${JSON.stringify(previewReady)}`);

    // PDF runtime regression: print must wait for reveal.js's `pdf-ready`
    // signal *and* iframe-backed interactive content. Lazy iframes on print
    // pages can otherwise remain blank because Chromium never scrolls them
    // into a normal lazy-loading threshold before the print snapshot.
    await evaluate(`(() => {
      window.__previewPrintCalls=0; window.__revealEvents={};
      const originalAdd=HTMLIFrameElement.prototype.addEventListener;
      const originalRemove=HTMLIFrameElement.prototype.removeEventListener;
      HTMLIFrameElement.prototype.addEventListener=function(type,fn,options){
        if(type==='load' && this.dataset.pdfDelay==='1'){ this.__pdfLoad=fn; return; }
        return originalAdd.call(this,type,fn,options);
      };
      HTMLIFrameElement.prototype.removeEventListener=function(type,fn,options){
        if(type==='load' && this.dataset.pdfDelay==='1') return;
        return originalRemove.call(this,type,fn,options);
      };
      window.__restorePdfIframeEvents=()=>{ HTMLIFrameElement.prototype.addEventListener=originalAdd; HTMLIFrameElement.prototype.removeEventListener=originalRemove; };
      window.dispatchEvent(new MessageEvent('message',{data:{
        type:'render-deck',title:'PDF readiness',theme:'clean',themeCssHref:'/held-theme.css',printMode:true,
        sections:'<section class="rv-slide"><h1>PDF</h1><div class="sr-interactive" data-height="480" style="height:480px"><iframe id="pdf-interactive-frame" data-pdf-delay="1" loading="lazy"></iframe></div></section>',
        contentCss:'.reveal .slides section.rv-slide{padding:64px}',backgroundResources:[],config:{width:960,height:700,center:true,margin:0}
      }}));
      document.getElementById('reveal-css').dispatchEvent(new Event('load'));
      document.getElementById('theme-css').dispatchEvent(new Event('load'));
      document.getElementById('highlight-css').dispatchEvent(new Event('load'));
    })()`);
    await sleep(120);
    const printBeforeReady = await evaluate('window.__previewPrintCalls');
    assert(printBeforeReady === 0, `PDF printed before pdf-ready (${printBeforeReady} calls)`);
    const hasPdfReady = await evaluate(`typeof window.__revealEvents['pdf-ready'] === 'function'`);
    assert(hasPdfReady, 'PDF runtime did not subscribe to reveal.js pdf-ready');
    const iframePdfState = await evaluate(`({loading:document.getElementById('pdf-interactive-frame')?.getAttribute('loading'),hasDelayedLoad:typeof document.getElementById('pdf-interactive-frame')?.__pdfLoad==='function'})`);
    assert(iframePdfState.loading === 'eager' && iframePdfState.hasDelayedLoad, `PDF runtime did not eagerly stage the interactive iframe: ${JSON.stringify(iframePdfState)}`);
    await evaluate(`window.__revealEvents['pdf-ready']()`);
    await sleep(80);
    const printWhileIframePending = await evaluate('window.__previewPrintCalls');
    assert(printWhileIframePending === 0, `PDF printed while interactive iframe was still pending (${printWhileIframePending} calls)`);
    await evaluate(`document.getElementById('pdf-interactive-frame').__pdfLoad(); window.__restorePdfIframeEvents();`);
    await sleep(1450);
    const printAfterReady = await evaluate('window.__previewPrintCalls');
    assert(printAfterReady === 1, `PDF did not print exactly once after pdf-ready + iframe load (${printAfterReady} calls)`);

    const geometrySource = fs.readFileSync(path.join(ROOT, 'src/core/application.js'), 'utf8');
    assert(/html\.reveal-print \.reveal \.slides section\.rv-slide\{padding:var\(--rv-slide-padding,0px\)!important\}/.test(geometrySource),
      'PDF print CSS does not restore the theme slide padding erased by reveal.js');
    assert(/pre\.sr-code>code\.hljs/.test(geometrySource) && /font-size:inherit!important/.test(geometrySource)
      && /white-space:pre-wrap!important/.test(geometrySource),
      'presentation code CSS does not constrain highlighted code geometry');

    console.log('browser regressions: OK');
  } finally {
    try { ws?.close(); } catch (_) {}
    chrome.kill('SIGTERM');
    await sleep(150);
    try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {}
  }
}

main().catch(error => {
  console.error(`browser regressions: FAILED: ${error.stack || error}`);
  process.exitCode = 1;
});
