/**
 * Dependency-free tests for Revealation modules that do not require a DOM.
 * Run with: node tests/test_modules.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const storage = new Map();
let opened = null;
const window = {
  sessionStorage: {
    setItem: (key, value) => storage.set(key, value),
    getItem: (key) => storage.get(key) || null,
  },
  open: (url, target) => { opened = { url, target }; return {}; },
  alert: (message) => { throw new Error(`Unexpected alert: ${message}`); },
  location: { href: 'http://example.test/' },
};
window.window = window;

const context = { window, console, URL };
vm.createContext(context);
for (const relative of [
  'src/core/revealation.js',
  'src/theme/registry.js',
  'src/background/registry.js',
  'src/core/slide-model.js',
  'src/core/history.js',
  'src/layout/registry.js',
  'src/layout/builtins.js',
  'src/serialization/directives.js',
  'src/serialization/notes.js',
  'src/layout/blocks.js',
  'src/serialization/deck.js',
  'src/content/interactive.js',
  'src/content/html.js',
  'src/export/deck.js',
  'src/export/pdf.js',
]) {
  const filename = path.join(ROOT, relative);
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename: relative });
}

const R = window.Revealation;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

// Installed theme manifests are application resources, not workspace files.
// Regression: relative `themes/...` URLs resolve against `/` in workspace mode
// and therefore hit the presentation directory instead of `/__app__/themes/...`.
{
  const registered = [];
  const catalogWindow = {
    Revealation: {
      urls: { app: path => `http://example.test/__app__/${path}` },
      theme: {
        registerManifest: url => registered.push(String(url)),
        registerAlias: () => {},
      },
    },
  };
  catalogWindow.window = catalogWindow;
  const catalogContext = { window: catalogWindow, console };
  vm.createContext(catalogContext);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'extensions/themes/register.js'), 'utf8'),
    catalogContext,
    { filename: 'extensions/themes/register.js' },
  );
  assert(registered.length === 4, 'installed theme catalog must register all four built-in themes');
  assert(
    registered.every(url => url.startsWith('http://example.test/__app__/themes/')),
    'installed theme manifests must be requested from /__app__/themes, not the workspace root',
  );
}

// Curated visual systems are manifest data, not hard-coded UI choices.
const cleanManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes/clean/theme.json'), 'utf8'));
const darkManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes/dark/theme.json'), 'utf8'));
const classicManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes/classic/theme.json'), 'utf8'));
const kineticManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'themes/kinetic/theme.json'), 'utf8'));
const gridManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'extensions/backgrounds/grid/extension.json'), 'utf8'));
R.theme.register(cleanManifest, 'http://example.test/__app__/themes/clean/theme.json');
R.theme.register(darkManifest, 'http://example.test/__app__/themes/dark/theme.json');
R.theme.register(classicManifest, 'http://example.test/__app__/themes/classic/theme.json');
R.theme.register(kineticManifest, 'http://example.test/__app__/themes/kinetic/theme.json');
R.theme.setDefault('clean');
R.theme.registerAlias('black', 'dark');
R.background.register(gridManifest, 'http://example.test/__app__/extensions/backgrounds/grid/extension.json');
assert(R.theme.list().map(theme => theme.id).join('|') === 'clean|dark|classic|kinetic', 'theme registry loads all built-in themes');
for (const id of ['clean', 'dark', 'classic', 'kinetic']) {
  const css = fs.readFileSync(path.join(ROOT, `themes/${id}/theme.css`), 'utf8');
  for (const selector of ['table', 'rv-block-emphasis', 'rv-block-muted', 'rv-block-callout', 'blockquote']) {
    assert(css.includes(selector), `${id} theme does not style ${selector}`);
  }
}
// RV-COMPAT(theme-reveal-aliases): REMOVE BEFORE PUBLIC RELEASE.
assert(R.theme.resolve('black') === 'dark', 'legacy reveal theme alias');
assert(R.theme.resolveOrDefault('not-installed') === 'clean', 'unknown theme safe fallback');
assert(R.theme.get('clean').cssUrl.endsWith('/themes/clean/theme.css'), 'theme resources resolve relative to manifest');
assert(R.theme.get('clean').backgrounds.recommended[0] === 'grid', 'theme background recommendations');
assert(R.background.get('grid').cssUrl.endsWith('/extensions/backgrounds/grid/background.css'), 'background resources resolve relative to manifest');

// HTML/ZIP packaging is an export-domain service with an explicit rendering
// adapter. Core does not need to expose exporter internals or mutable state.
R.background.register({
  id: 'motion-unit', name: 'Motion unit', version: '1.0',
  css: 'background.css', js: 'background.js', assets: ['dot.svg'],
}, 'http://example.test/__app__/extensions/backgrounds/motion-unit/extension.json');
const deckExporter = R.exporters.deck.create({
  themeDefinition: () => R.theme.get('clean'),
  themePayload: () => ({ themeCssHref: R.theme.get('clean').cssUrl, fontsHref: '', customCss: '' }),
  backgrounds: project => (project.slides || [])
    .map(slide => R.background.get(slide.background?.id))
    .filter(Boolean),
  renderSections: slides => slides.map(slide => `<section>${slide.content || ''}</section>`).join('\n'),
  contentCss: () => '.rv-slide{display:block}',
  revealConfig: () => ({ width: 1280, height: 720 }),
});
const linkedGrid = deckExporter.buildLinkedHtml({
  title: 'Grid export', author: 'Ada Lovelace', theme: 'clean', config: {},
  slides: [{ content: '<h2>Grid</h2>', background: { id: 'grid' } }],
});
assert(linkedGrid.includes('themes/clean/theme.css'), 'deck exporter links resolved theme CSS');
assert(linkedGrid.includes('<meta name="author" content="Ada Lovelace">'), 'deck exporter omits author metadata');
assert(linkedGrid.includes('extensions/backgrounds/grid/background.css'), 'deck exporter links used background CSS');
assert(linkedGrid.includes('extensions/backgrounds/grid/grid.js'), 'dynamic grid background JS missing');
assert(linkedGrid.includes('src/background/runtime.js'), 'dynamic grid background lifecycle runtime missing');
const motionPaths = deckExporter.packagePaths({ slides: [{ background: { id: 'motion-unit' } }] });
assert(motionPaths.includes('extensions/backgrounds/motion-unit/background.js'), 'dynamic background JS package path');
assert(motionPaths.includes('src/background/runtime.js'), 'dynamic background lifecycle package path');
assert(deckExporter.containsInteractive({ slides: [{ content: '<div class="sr-interactive" data-src="interactive/a/index.html"></div>' }] }), 'interactive export detection');

// Application identity is the source of truth for the header and About view.
assert(R.info.name === 'Revealation', 'application metadata name');
assert(R.info.projectUrl && R.info.revealUrl && R.info.upstreamUrl, 'application metadata links');
assert(R.info.logoIcon, 'application metadata logo');

// Slide/subslide numbering and reveal.js coordinates.
// RV-COMPAT(subslide-vertical): fixtures still use the historical persisted `vertical` field.
const slides = [
  { id: 'a' }, { id: 'b' }, { id: 'c', vertical: true },
  { id: 'd', vertical: true }, { id: 'e' },
];
assert(slides.map((_, i) => R.core.slideModel.number(slides, i)).join('|') === '1|2|2.1|2.2|3', 'slide numbering');
const position = R.core.slideModel.position(slides, 'd');
assert(position.h === 1 && position.v === 2, 'slide reveal position');

// Opaque undo/redo mechanics.
let model = { value: 0 };
let beforeSnapshotCalls = 0;
const history = R.core.createHistory({
  snapshot: () => ({ value: model.value, bytes: 1 }),
  restore: (snapshot) => { model = { value: snapshot.value }; },
  beforeSnapshot: () => { beforeSnapshotCalls += 1; },
  maxEntries: 2,
});
history.record();
model.value = 1;
history.record();
model.value = 2;
assert(history.undo() && model.value === 1, 'history undo');
assert(history.redo() && model.value === 2, 'history redo');
assert(beforeSnapshotCalls === 4, 'history beforeSnapshot contract');

// Structured directives.
const directives = R.serialization.directives;
assert(
  directives.normalizeLines('::: column center\nhello :::').join('\n') === '::: column center\nhello\n:::',
  'trailing directive closer normalization',
);
// RV-COMPAT(interactive-demo): REMOVE BEFORE PUBLIC RELEASE.
assert(directives.scanRanges('::: demo\nsrc: a.html\n:::\n')[0].kind === 'interactive', 'legacy demo alias');

// Directive grammar/value coverage: every supported opener, aliases, nested
// ranges, fenced-code protection, field validation, booleans and widths.
const directiveHeads = [
  // RV-COMPAT(layout-wrapper): REMOVE BEFORE PUBLIC RELEASE.
  ['::: layout header-body', 'layout'],
  ['::: block align=center', 'block'],
  // RV-COMPAT(columns-directive): REMOVE BEFORE PUBLIC RELEASE.
  ['::: columns 60/40', 'columns'],
  ['::: column right', 'column'],
  ['::: align left', 'align'],
  // RV-COMPAT(align-shorthand): REMOVE BEFORE PUBLIC RELEASE.
  ['::: right', 'align'],
  ['::: fragment effect=fade-up', 'fragment'],
  ['::: animate id=robot_1', 'animate'],
  ['::: video', 'video'],
  ['::: audio', 'audio'],
  ['::: interactive', 'interactive'],
  // RV-COMPAT(interactive-demo): REMOVE BEFORE PUBLIC RELEASE.
  ['::: demo', 'interactive'],
];
directiveHeads.forEach(([source, kind]) => {
  const parsed = directives.parseHead(source);
  assert(parsed?.kind === kind, `directive head ${source}`);
});
assert(directives.fields(['src: demo.html', 'width: 75%']).width === '75%', 'directive field parsing');
assert(directives.fields(['src: a', 'src: b']) === null, 'duplicate directive fields rejected');
assert(directives.parseBool('yes') === true && directives.parseBool('off') === false, 'directive booleans');
assert(directives.parseBool('maybe') === null, 'invalid directive boolean');
assert(directives.parseWidth('33.33%') === '33.3' && directives.parseWidth('101%') === null, 'directive widths');
const nestedDirectives = directives.scanRanges('::: align center\n::: fragment effect=fade\nText\n:::\n:::');
assert(nestedDirectives.length === 2 && nestedDirectives[0].end > nestedDirectives[1].end, 'nested directive ranges');
const fencedDirectives = directives.scanRanges('```md\n::: video\n```\n\n::: audio\nsrc: a.ogg\n:::');
assert(fencedDirectives.length === 1 && fencedDirectives[0].kind === 'audio', 'directives inside fences ignored');

// Speaker notes are a first-class slide-level directive. The old `Note:`
// prefix is intentionally ordinary slide content now.
const noteBlock = R.serialization.notes.split('# Slide\n\n::: notes\nRemember this\nSecond line\n:::');
assert(noteBlock.body === '# Slide' && noteBlock.notes === 'Remember this\nSecond line', 'speaker notes block split');
assert(R.serialization.notes.format('Remember this') === '::: notes\nRemember this\n:::', 'speaker notes block formatting');
const oldNotePrefix = R.serialization.notes.split('# Slide\n\nNote: ordinary paragraph');
assert(oldNotePrefix.notes === '' && oldNotePrefix.body.includes('Note: ordinary paragraph'), 'old Note prefix must not be treated as speaker notes');
assert(R.serialization.notes.split('# Slide\n\n::: notes\nA\n:::\nTrailing').diagnostics.some(d => d.code === 'notes-not-last'), 'speaker notes must be final slide block');


// Layout registry and strict positional block validation.
const layouts = R.layout;
assert(layouts.get('header-two-columns').slots.length === 3, 'built-in layout registry');
assert(layouts.get('two-columns-60-40').slots[0].id === 'left', 'layout slot semantics');
assert(layouts.get('header-three-columns').slots.length === 4, 'header-three-columns layout registry');
assert(layouts.get('header-three-columns').slots[2].id === 'center', 'header-three-columns slot semantics');
assert(layouts.get('header-three-columns').grid.areas === '"header header header" "left center right"', 'header-three-columns grid geometry');
assert(layouts.get('header-two-columns-footer').slots.length === 4, 'header-two-columns-footer layout registry');
assert(layouts.get('header-two-columns-footer').slots[3].id === 'footer', 'header-two-columns-footer slot semantics');
assert(layouts.get('header-two-columns-footer').grid.areas === '"header header" "left right" "footer footer"', 'header-two-columns-footer grid geometry');
const customLayout = layouts.register({ id: 'test-custom', label: 'Test custom', slots: [{ id:'first', master:true }, { id:'second' }], grid: { areas: '"first second"' } });
assert(customLayout.slots[1].id === 'second' && layouts.get('test-custom') === customLayout, 'layout extension registration');
assert(layouts.get('header-body').slots[0].initialBlock === 'h1', 'header slot starts as an H1 editing block');
assert(layouts.get('header-body').slots[0].titleSource === true, 'header slot is the configured slide-title source');
assert(layouts.get('header-body').slots.filter(slot => slot.titleSource).length === 1, 'layout exposes at most one slide-title source');
assert(layouts.get('header-body').slots[1].master === true, 'header-body declares body as master field');
const toHeaderColumns = layouts.transferPlan('header-body', 'header-two-columns');
assert(toHeaderColumns.targets[0].sourceIndexes.join(',') === '0', 'matching header field transfers by semantic id');
assert(toHeaderColumns.targets[1].sourceIndexes.join(',') === '1', 'unmatched body transfers to target master field');
assert(toHeaderColumns.targets[2].sourceIndexes.length === 0, 'new unmatched target field starts empty');
const toHeaderBody = layouts.transferPlan('header-two-columns', 'header-body');
assert(toHeaderBody.targets[0].sourceIndexes.join(',') === '0', 'header survives reverse layout transfer');
assert(toHeaderBody.targets[1].sourceIndexes.join(',') === '1,2', 'all unmatched source fields merge into the body master in source order');
let rejectedNoMaster = false;
try { layouts.register({ id:'no-master', slots:[{id:'a'},{id:'b'}] }); } catch (_) { rejectedNoMaster = true; }
assert(rejectedNoMaster, 'layout definitions without exactly one master slot are rejected');

let rejectedMultipleTitleSources = false;
try { layouts.register({ id:'two-titles', slots:[{id:'a',master:true,titleSource:true},{id:'b',titleSource:true}] }); } catch (_) { rejectedMultipleTitleSources = true; }
assert(rejectedMultipleTitleSources, 'layout definitions with multiple titleSource slots are rejected');

for (const [id, expected] of [['header-three-columns', 4], ['header-two-columns-footer', 4]]) {
  const body = Array.from({ length: expected }, (_, i) => `::: block\nBlock ${i + 1}\n:::`).join('\n\n');
  const parsed = layouts.blocks.parseSlide(body, id);
  assert(parsed.blocks.length === expected, `${id} positional block parsing`);
  assert(layouts.blocks.validateSlideMarkdown(body, id).length === 0, `${id} positional block validation`);
}

const validBlocks = `::: block
# Header
:::

::: block
Left
:::

::: block align=center
Right
:::`;
assert(layouts.blocks.validateSlideMarkdown(validBlocks, 'header-two-columns').length === 0, 'valid positional blocks');
const parsedBlocks = layouts.blocks.parseSlide(validBlocks, 'header-two-columns');
assert(parsedBlocks.blocks.length === 3 && parsedBlocks.blocks[2].align === 'center', 'block parsing and alignment');
const canonicalBlocks = layouts.blocks.toMarkdownBlocks(parsedBlocks, block => block.raw);
assert(!canonicalBlocks.includes('::: layout'), 'canonical block writer must not emit layout wrapper');
assert(canonicalBlocks.startsWith('::: block\n# Header'), 'canonical block writer');

const missingBlock = `::: block
# Header
:::

::: block
Left
:::`;
assert(layouts.blocks.validateSlideMarkdown(missingBlock, 'header-two-columns').some(d => d.code === 'block-count'), 'missing layout block diagnostic');
const orphanBlock = `::: block
Text
:::`;
assert(layouts.blocks.validateSlideMarkdown(orphanBlock, 'single').some(d => d.code === 'block-with-single-layout'), 'block requires multi-block layout');
let invalidThrew = false;
try { layouts.blocks.parseSlide(missingBlock, 'header-two-columns'); } catch (error) { invalidThrew = !!error.diagnostics; }
assert(invalidThrew, 'invalid layout refuses round trip');

// 3.1–3.3 wrapper is migration-only input.
// RV-COMPAT(layout-wrapper): REMOVE BEFORE PUBLIC RELEASE.
const legacyLayout = `::: layout header-two-columns

${validBlocks}

:::`;
const legacy = layouts.blocks.parseLegacyLayout(legacyLayout);
assert(legacy.detected && legacy.spec && legacy.spec.id === 'header-two-columns', 'legacy layout migration parser');

const nestedLikeContent = `::: block
# Header
:::

::: block
::: align center
A
:::
:::`;
assert(layouts.blocks.validateSlideMarkdown(nestedLikeContent, 'header-body').length === 0, 'ordinary nested content directive remains valid inside a block');
const mixedLayout = `Intro outside

${validBlocks}`;
assert(layouts.blocks.validateSlideMarkdown(mixedLayout, 'header-two-columns').some(d => d.code === 'layout-content-outside-block'), 'content beside positional blocks must be rejected');
const fencedBlockText = `\`\`\`md
::: block
\`\`\``;
assert(layouts.blocks.validateSlideMarkdown(fencedBlockText, 'single').length === 0, 'block syntax ignored in fenced code');

// Top-level Markdown slide/subslide metadata ignores separators in code.
const markdown = '# One\n\n```txt\n--- layout=two-columns\n```\n\n--- layout=header-body\n\n::: block\n# Two\n:::\n\n::: block\nBody\n:::\n\n-- layout=two-columns\n\n::: block\nA\n:::\n\n::: block\nB\n:::';
assert(R.serialization.deck.validateSeparators(markdown).length === 0, 'separator metadata validation');
const ranges = R.serialization.deck.scanSlideRanges(markdown);
assert(ranges.length === 3, 'Markdown slide range count');
assert(!ranges[0].subslide && !ranges[1].subslide && ranges[2].subslide, 'Markdown subslide flags');
assert(ranges[0].layout === 'single' && ranges[1].layout === 'header-body' && ranges[2].layout === 'two-columns', 'separator layout metadata');
assert(R.serialization.deck.fallbackLabel(ranges[1].chunk, 1) === 'Two', 'Markdown fallback label');
assert(R.serialization.deck.formatSeparator({ subslide: false, layout: 'two-columns' }) === '--- layout=two-columns', 'slide separator formatting');
assert(R.serialization.deck.formatSeparator({ subslide: true, layout: 'single' }) === '--', 'single-layout subslide separator formatting');
const semanticBackgroundSeparator = R.serialization.deck.parseSeparator('--- layout=single background=grid');
assert(semanticBackgroundSeparator.valid && semanticBackgroundSeparator.metadata.background === 'grid', 'semantic background metadata parsing');
assert(
  R.serialization.deck.formatSeparator({ subslide: false, layout: 'single', metadata: { background: 'grid' } }) === '--- background=grid',
  'semantic background metadata formatting',
);
// RV-COMPAT(slide-transition), RV-COMPAT(background-reveal): REMOVE legacy metadata coverage BEFORE PUBLIC RELEASE.
const metadataSeparator = R.serialization.deck.parseSeparator('--- layout=single transition=fade background-image="images/title slide.jpg"');
assert(metadataSeparator.valid && metadataSeparator.metadata.transition === 'fade', 'slide metadata parsing');
assert(metadataSeparator.metadata['background-image'] === 'images/title slide.jpg', 'quoted slide metadata parsing');
assert(R.serialization.deck.validateSeparators('--- transition=fade\nTitle\n\n-- background-color=black\nBody').length === 0, 'supported slide metadata validation');
const leading = R.serialization.deck.scanSlideRanges('--- layout=two-columns\n\n::: block\nA\n:::\n\n::: block\nB\n:::');
assert(leading.length === 1 && leading[0].layout === 'two-columns' && leading[0].separatorStart === 0, 'first slide may declare layout on a leading separator');
assert(layouts.blocks.validateSlideMarkdown('', 'missing-layout').some(d => d.code === 'unknown-layout'), 'unknown layout diagnostic');
assert(R.serialization.deck.validateSeparators('--- layout two-columns\nX').some(d => d.code === 'invalid-slide-metadata'), 'malformed separator metadata diagnostic');

// Slide metadata coverage: all currently supported separator keys survive
// parsing/formatting, including quoted values containing spaces.
// RV-COMPAT(slide-transition), RV-COMPAT(background-reveal): REMOVE legacy metadata fixture BEFORE PUBLIC RELEASE.
const metadataMarkdown = `--- transition=fade background-color=black background-image="images/title slide.jpg" background-video=video.mp4 background-iframe=https://example.test background-size=cover auto-animate=true auto-animate-id=hero auto-animate-duration=1.2 auto-animate-easing=ease-in auto-animate-unmatched=true under-construction=true hidden=true\nTitle`;
assert(R.serialization.deck.validateSeparators(metadataMarkdown).length === 0, 'all supported slide metadata validates');
const metadata = R.serialization.deck.parseSeparator(metadataMarkdown.split('\n')[0]);
assert(metadata.metadata['background-image'] === 'images/title slide.jpg', 'quoted metadata value');
assert(metadata.metadata['auto-animate-id'] === 'hero' && metadata.metadata['auto-animate-duration'] === '1.2', 'auto-animate metadata');
assert(metadata.metadata['under-construction'] === 'true', 'under-construction metadata');
assert(metadata.metadata.hidden === 'true', 'hidden slide metadata');
assert(R.serialization.deck.validateSeparators('--- unknown=value\nTitle').some(d => d.code === 'unsupported-slide-metadata'), 'unknown slide metadata rejected');

// Regression: a real-world sequence with a leading multi-block slide, a
// normal single slide, header/body slides, and nested alignment remains
// structurally valid. This mirrors the deck that exposed the stale-cache bug.
const workspaceLayoutDeck = `--- layout=two-columns

::: block
# Title
:::

::: block align=center
![Image](images/title.jpg){width=100%}
:::

---

# Lecturers

--- layout=header-body

::: block
# Course objectives
:::

::: block
- First point
- Second point
:::

--- layout=header-body

::: block
# Excellence
:::

::: block
- Weight: 1.5

::: align center

![Form](images/form.png){width=70%}

:::
:::`;
const workspaceRanges = R.serialization.deck.scanSlideRanges(workspaceLayoutDeck);
assert(workspaceRanges.length === 4, 'workspace layout deck range count');
workspaceRanges.forEach((range, index) => {
  const errors = R.layout.blocks.validateSlideMarkdown(range.chunk, range.layout, { lineOffset: (range.startLine || 1) - 1 })
    .filter(d => d.severity === 'error');
  assert(errors.length === 0, `workspace layout deck slide ${index + 1} validation`);
});

// Every built-in layout must accept the canonical positional block syntax and
// write it back without legacy `::: layout` wrappers.
['header-body', 'two-columns', 'two-columns-60-40', 'two-columns-40-60',
  'header-two-columns-60-40', 'header-two-columns-40-60',
  'header-two-columns', 'header-three-columns', 'header-two-columns-footer', 'grid-2x2'].forEach(id => {
  const definition = layouts.get(id);
  const body = definition.slots.map((slot, index) =>
    `::: block${index === 1 ? ' align=center' : ''}\nBlock ${slot.id}\n:::`).join('\n\n');
  const parsed = layouts.blocks.parseSlide(body, id);
  assert(parsed.blocks.length === definition.slots.length, `${id} block count round trip`);
  const written = layouts.blocks.toMarkdownBlocks(parsed, block => block.raw);
  assert(written.includes('::: block') && !written.includes('::: layout'), `${id} canonical block writer`);
});

// Interactive content uses the canonical directive on output.
const interactive = R.content.interactive;
const spec = interactive.fromDirectiveFields({
  src: 'interactive/x/index.html', width: '75%', height: '420',
  interactive: 'false', border: 'true', scrollbars: 'true',
}, { parseBool: directives.parseBool, parseWidth: directives.parseWidth });
assert(spec && spec.width === 75 && spec.height === 420 && spec.interactive === false && spec.border === true && spec.scrollbars === true, 'interactive field parsing');
assert(interactive.toMarkdown(spec).startsWith('::: interactive\n'), 'interactive canonical Markdown');
assert(interactive.normalize({}).scrollbars === false, 'interactive scrollbars default off');
[
  { src: 'a.html', width: 100, height: 120, interactive: true, preload: false, border: false, scrollbars: false },
  { src: 'nested/demo.html', width: 62.5, height: 900, interactive: false, preload: true, border: true, scrollbars: true },
].forEach((input, index) => {
  const normalized = interactive.normalize(input);
  const fields = directives.fields(interactive.toMarkdown(normalized).split('\n').slice(1, -1));
  const parsed = interactive.fromDirectiveFields(fields, { parseBool: directives.parseBool, parseWidth: directives.parseWidth });
  assert(parsed && parsed.src === normalized.src && parsed.height === normalized.height, `interactive variant ${index + 1} round trip`);
  assert(parsed.width === normalized.width && parsed.border === normalized.border && parsed.scrollbars === normalized.scrollbars, `interactive flags ${index + 1} round trip`);
});

// Raw HTML has one explicit, canonical Markdown escape hatch.
const rawHtml = R.content.html;
assert(rawHtml.toMarkdown('<div class="x">Hello</div>') === '::: html\n<div class="x">Hello</div>\n:::', 'explicit html block serialization');

// PDF exporter stages reveal.js print defaults and opens the dedicated preview route.
assert(R.exporters.pdf.open({ title: 'Test', config: { hash: true } }), 'PDF open result');
const pdf = JSON.parse(storage.get(R.exporters.pdf.payloadKey));
assert(pdf.printMode, 'PDF print mode');
assert(pdf.config.pdfMaxPagesPerSlide === 1, 'PDF one-page default');
assert(pdf.config.pdfSeparateFragments === false, 'PDF fragment default');
assert(Math.abs(pdf.config.margin - (0.04 / 0.96)) < 1e-9, 'PDF default outer margin matches Present visual fraction');
assert(Math.abs(R.exporters.pdf.screenMarginToPrintMargin(0.10) - (0.10 / 0.90)) < 1e-9, 'PDF converts screen-space margin to print-space margin');
assert(R.exporters.pdf.screenMarginToPrintMargin(0) === 0, 'zero presentation margin remains zero in PDF');
const screenFraction = 1 - 0.10;
const pdfFraction = 1 / (1 + R.exporters.pdf.screenMarginToPrintMargin(0.10));
assert(Math.abs(screenFraction - pdfFraction) < 1e-9, 'PDF and Present preserve the same relative outer margin');
assert(pdf.config.hash === true, 'PDF preserves normal reveal config');
assert(opened && opened.url === 'http://example.test/__app__/preview.html?print-pdf=1', 'PDF preview URL');

console.log('modules: OK');
