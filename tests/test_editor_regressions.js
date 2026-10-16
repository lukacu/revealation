/**
 * Focused Chromium regressions for the WYSIWYG + layout editing boundary.
 *
 * Keep this file small and deterministic: when a contenteditable regression
 * appears, contributors should be able to run only this test while debugging.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9537 + (process.pid % 200);
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'revealation-editor-chrome-'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function waitForTarget(chrome, getStderr) {
  for (let i = 0; i < 300; i += 1) {
    if (chrome.exitCode !== null) {
      throw new Error(`Chromium exited before its DevTools endpoint became ready (code ${chrome.exitCode}).${getStderr()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (response.ok) {
        const page = (await response.json()).find(target => target.type === 'page');
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
    ws = new WebSocket(await waitForTarget(chrome, () => stderr.trim() ? `\nChromium stderr:\n${stderr.trim()}` : ''));
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    let nextId = 1;
    const pending = new Map();
    ws.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !pending.has(message.id)) return;
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'evaluation failed');
      return result.result?.value;
    };
    await cdp('Runtime.enable');

    for (const relative of [
      'src/core/revealation.js',
      'src/layout/registry.js',
      'src/layout/builtins.js',
      'src/serialization/directives.js',
      'src/serialization/notes.js',
      'src/layout/blocks.js',
      'src/editor/dom-selection.js',
      'src/editor/content-normalization.js',
      'src/editor/rich-text.js',
    ]) {
      const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
      await evaluate(`${source}\n//# sourceURL=${relative}`);
    }

    const listTab = await evaluate(`(() => {
      document.body.innerHTML = '<div id="editor" contenteditable="true"><ul><li id="parent">Parent</li><li id="child">Child <strong>bold</strong></li></ul></div>';
      const editor=document.getElementById('editor');
      const child=document.getElementById('child');
      const text=child.firstChild;
      const range=document.createRange(); range.setStart(text, 2); range.collapse(true);
      const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range);
      let prevented=0, stopped=0, before=0, after=0;
      Revealation.editor.richText.handleListTab({key:'Tab',shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,preventDefault(){prevented++},stopPropagation(){stopped++}}, editor, {beforeChange(){before++},afterChange(){after++}});
      const indented=editor.innerHTML;
      const currentRange=getSelection().rangeCount ? getSelection().getRangeAt(0) : null;
      const caretText=currentRange?.startContainer?.nodeValue || '';
      Revealation.editor.richText.handleListTab({key:'Tab',shiftKey:true,altKey:false,ctrlKey:false,metaKey:false,preventDefault(){prevented++},stopPropagation(){stopped++}}, editor, {beforeChange(){before++},afterChange(){after++}});
      return { indented, outdented:editor.innerHTML, prevented, stopped, before, after, caretText };
    })()`);
    assert(/<li id="parent">Parent<ul><li id="child">Child <strong>bold<\/strong><\/li><\/ul><\/li>/.test(listTab.indented), `Tab did not create a nested list: ${listTab.indented}`);
    assert(/<li id="parent">Parent<\/li><li id="child">Child <strong>bold<\/strong><\/li>/.test(listTab.outdented), `Shift+Tab did not restore list level: ${listTab.outdented}`);
    assert(listTab.prevented === 2 && listTab.stopped === 2 && listTab.before === 2 && listTab.after === 2, 'list Tab did not use the deterministic edit path');
    assert(listTab.caretText.includes('Child'), 'caret was not retained in the moved list item');

    const firstItemTab = await evaluate(`(() => {
      document.body.innerHTML='<div id="editor" contenteditable="true"><ul><li id="only">Only</li></ul></div>';
      const editor=document.getElementById('editor'); const text=document.getElementById('only').firstChild;
      const r=document.createRange(); r.setStart(text,1); r.collapse(true); const s=getSelection(); s.removeAllRanges(); s.addRange(r);
      let prevented=false, changed=false;
      const handled=Revealation.editor.richText.handleListTab({key:'Tab',shiftKey:false,altKey:false,ctrlKey:false,metaKey:false,preventDefault(){prevented=true},stopPropagation(){}},editor,{beforeChange(){changed=true}});
      return {handled,prevented,changed,html:editor.innerHTML};
    })()`);
    assert(firstItemTab.handled && firstItemTab.prevented && !firstItemTab.changed, 'Tab on first list item should stay in the editor without mutating structure');

    const blockSelectAll = await evaluate(`(() => {
      document.body.innerHTML='<div id="editor" contenteditable="true"><div class="sr-layout" contenteditable="false"><div class="sr-layout-slot"><div id="left" class="sr-layout-content" contenteditable="true"><p>Left first</p><p>Left second</p></div></div><div class="sr-layout-slot"><div id="right" class="sr-layout-content" contenteditable="true"><p>Right only</p></div></div></div></div>';
      const editor=document.getElementById('editor'); const text=document.querySelector('#left p').firstChild;
      const range=document.createRange(); range.setStart(text,2); range.collapse(true); const sel=getSelection(); sel.removeAllRanges(); sel.addRange(range);
      let prevented=0,stopped=0;
      const handled=Revealation.editor.richText.handleSelectAll({key:'a',ctrlKey:true,metaKey:false,altKey:false,preventDefault(){prevented++},stopPropagation(){stopped++}},editor);
      return {handled,prevented,stopped,text:sel.toString(),rightSelected:sel.toString().includes('Right only')};
    })()`);
    assert(blockSelectAll.handled && blockSelectAll.prevented === 1 && blockSelectAll.stopped === 1, 'Ctrl+A was not captured by the current editing host');
    assert(blockSelectAll.text.includes('Left first') && blockSelectAll.text.includes('Left second') && !blockSelectAll.rightSelected,
      `Ctrl+A escaped the current layout block: ${JSON.stringify(blockSelectAll)}`);

    const selectionBlocks = await evaluate(`(() => {
      document.body.innerHTML='<div id="editor" contenteditable="true"><div id="host" class="sr-layout-content" contenteditable="true"><p id="one">Alpha beta</p><div class="sr-align-center"><p id="two">Gamma delta</p><p id="three">Epsilon</p></div></div></div>';
      const editor=document.getElementById('editor'); const start=document.getElementById('two').firstChild; const end=document.getElementById('three').firstChild;
      const oneWord=document.createRange(); oneWord.setStart(start,1); oneWord.setEnd(start,5);
      const one=Revealation.editor.richText.blocksForRange(oneWord,editor).map(el=>el.id);
      const several=document.createRange(); several.setStart(start,1); several.setEnd(end,3);
      const many=Revealation.editor.richText.blocksForRange(several,editor).map(el=>el.id);
      return {one,many};
    })()`);
    assert(JSON.stringify(selectionBlocks.one) === JSON.stringify(['two']), `partial text selection did not resolve to its paragraph: ${JSON.stringify(selectionBlocks)}`);
    assert(JSON.stringify(selectionBlocks.many) === JSON.stringify(['two','three']), `multi-paragraph selection did not resolve only touched blocks: ${JSON.stringify(selectionBlocks)}`);

    const normalizedList = await evaluate(`(() => {
      document.body.innerHTML='<div id="root"><ul><li>Parent</li><ul><li>Child</li></ul><div>Loose</div></ul><ol><li><div>One</div><div>Two</div></li></ol></div>';
      const root=document.getElementById('root'); Revealation.editor.contentNormalization.normalizeForSerialization(root);
      return root.innerHTML;
    })()`);
    assert(normalizedList.includes('<li>Parent<ul><li>Child</li></ul></li>'), `orphan nested list was not repaired: ${normalizedList}`);
    assert(normalizedList.includes('<li><p>Loose</p></li>'), `invalid direct list child was not preserved canonically: ${normalizedList}`);
    assert(normalizedList.includes('<li><p>One</p><p>Two</p></li>'), `DIV paragraphs inside a list item were not canonicalized: ${normalizedList}`);

    const inlinePaste = await evaluate(`Revealation.editor.contentNormalization.toInlinePasteHtml('<p><b>First</b></p><p>Second <img src="data:image/png;base64,AAAA" alt="x"></p>')`);
    assert(inlinePaste === '<strong>First</strong><br>Second <img src="data:image/png;base64,AAAA" alt="x">', `inline paste normalization lost formatting/media: ${inlinePaste}`);

    const transfer = await evaluate(`(() => {
      const moved=Revealation.layout.blocks.transferContent('header-two-columns','header-body',{blocks:[
        {html:'<h1>Heading <em>A</em></h1>',align:'center'},
        {html:'<ul><li>Left<ul><li>Nested</li></ul></li></ul>',align:'left'},
        {html:'<p>Right <strong>B</strong></p><img src="data:image/png;base64,AAAA" alt="diagram">',align:'left'}
      ]});
      const rendered=Revealation.layout.blocks.createElementFromHtml(moved.layout,moved.blocks);
      return {moved,html:rendered.outerHTML};
    })()`);
    assert(transfer.moved.blocks[0].html.includes('<h1>Heading <em>A</em></h1>'), 'same-name header content/formats were not preserved');
    assert(transfer.moved.blocks[1].html.indexOf('Left') < transfer.moved.blocks[1].html.indexOf('Right'), 'unmatched fields did not merge into master in source order');
    assert(transfer.moved.blocks[1].html.includes('<ul><li>Nested</li></ul>') && transfer.moved.blocks[1].html.includes('<strong>B</strong>') && transfer.moved.blocks[1].html.includes('<img'), 'master-field merge lost structured content');

    const singleToHeader = await evaluate(`(() => {
      const moved=Revealation.layout.blocks.transferContent('single','header-body',{singleHtml:'<p>Existing body</p>'});
      const el=Revealation.layout.blocks.createElementFromHtml(moved.layout,moved.blocks); Revealation.layout.blocks.decorateEditor(el);
      return {header:el.querySelector('[data-slot="header"] .sr-layout-content').innerHTML, body:el.querySelector('[data-slot="body"] .sr-layout-content').innerHTML, master:el.querySelector('[data-slot="body"] .sr-layout-content').dataset.master};
    })()`);
    assert(singleToHeader.header === '<h1><br></h1>', `new header field did not start as H1: ${singleToHeader.header}`);
    assert(singleToHeader.body === '<p>Existing body</p>', 'same-name body was not transferred from single layout');
    assert(singleToHeader.master === 'true', 'master field decoration is missing');

    console.log('editor regressions: OK');
  } finally {
    try { ws?.close(); } catch (_) {}
    chrome.kill('SIGTERM');
    fs.rmSync(PROFILE, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
