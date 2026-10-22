/** Static guards for lifecycle boundaries that are easy to regress. */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const worker = read('pwa/sw.template.js');
assert(!worker.includes('setInterval('), 'service worker must remain event-driven');
assert(worker.includes('workspaceHandlePromise = null'), 'service worker handle cache invalidation was removed');

for (const relative of [
  'extensions/backgrounds/grid/grid.js',
  'extensions/backgrounds/bubbles/bubbles.js',
  'extensions/backgrounds/mesh/mesh.js',
]) {
  assert(read(relative).includes('document.hidden'), `${relative} does not pause while hidden`);
}

const application = read('src/core/application.js');
assert(application.includes('workspaceMonitorTimer = null'), 'workspace monitor does not stop while hidden');
assert(application.includes('onControllerChange: handlePwaControllerChange'), 'late worker control has no asset recovery callback');

const directory = read('src/storage/directory.js');
assert(directory.includes('await notifyServiceWorker();'), 'restored directory does not refresh the worker handle');
assert(directory.includes('notifyServiceWorker,') , 'worker handle refresh is not exposed to startup coordination');

console.log('lifecycle regressions: OK');
