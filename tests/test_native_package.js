/** Native .revealation package smoke and safety tests. */
'use strict';
const fs = require('fs');
const JSZip = require('../vendor/jszip/jszip.min.js');
global.window = global;
global.Revealation = { version: 'test-fixture', info: { name: 'Revealation' }, storage: {} };
global.JSZip = JSZip;
eval(fs.readFileSync(require('path').join(__dirname, '..', 'src/storage/package.js'), 'utf8'));

const assert = (condition, message) => { if (!condition) throw new Error(message); };

(async () => {
  const api = Revealation.storage.deckPackage;
  const source = {
    id: 'native-test', name: 'Živjo', createdAt: 1700000000000,
    slides: [{ id: 'slide-1', notes: 'speaker note', content: '<img src="data:image/svg+xml;base64,PHN2Zy8+">' }],
  };
  const blob = await api.exportDeckPackage(source, []);
  const bytes = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(bytes);
  assert(Object.keys(zip.files)[0] === 'mimetype', 'mimetype is not first');
  assert(await zip.file('mimetype').async('string') === api.MIME, 'mimetype is incorrect');
  const restored = await api.importDeckPackage(bytes);
  assert(restored.deck.name === source.name, 'deck metadata did not round trip');
  assert(restored.deck.slides[0].notes === source.slides[0].notes, 'speaker notes did not round trip');
  assert(restored.deck.slides[0].content.includes('data:image/svg+xml'), 'asset bytes did not round trip');

  const bad = new JSZip();
  bad.file('mimetype', 'wrong');
  bad.file('manifest.json', JSON.stringify({ format: 'revealation', formatVersion: 1 }));
  bad.file('deck.json', JSON.stringify(source));
  try { await api.importDeckPackage(await (await bad.generateAsync({ type: 'blob' })).arrayBuffer()); throw new Error('invalid mimetype accepted'); }
  catch (error) { assert(/mimetype/i.test(error.message), 'invalid mimetype produced an unhelpful error'); }
  console.log('native package: OK');
})().catch(error => { console.error(error); process.exit(1); });
