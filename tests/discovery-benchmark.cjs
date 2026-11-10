const { gzipSync } = require('node:zlib');
const { performance } = require('node:perf_hooks');
const { makeCatalog } = require('./discovery-fixture.cjs');
const { normalizeCatalog } = require('../discovery/model.js');
const { createDiscovery, sortMatches, paginate } = require('../discovery/engine.js');

function medianTime(action, iterations = 21, batch = 1, precision = 3) {
  for (let i = 0; i < 6; i++) action();
  const samples = Array.from({ length: iterations }, () => {
    const start = performance.now();
    for (let i = 0; i < batch; i++) action();
    return (performance.now() - start) / batch;
  }).sort((a, b) => a - b);
  return Number(samples[Math.floor(samples.length / 2)].toFixed(precision));
}

const measurements = [];
for (const count of [24, 300, 1300, 5000]) {
  const raw = makeCatalog(count);
  const payload = Buffer.from(`window.RADIOAPPLE_CATALOG_VERSION = 2;\nwindow.RADIOAPPLE_CATALOG = ${JSON.stringify(raw)};\n`);
  const normalizeMs = medianTime(() => normalizeCatalog(raw));
  const buildMs = medianTime(() => createDiscovery(raw), 11);
  global.gc?.();
  const before = process.memoryUsage().heapUsed;
  const engine = createDiscovery(raw);
  global.gc?.();
  const baseHeapMiB = global.gc ? Number(((process.memoryUsage().heapUsed - before) / 2 ** 20).toFixed(2)) : null;
  const search = { mode: 'search', q: '(train OR letters) AND archiv* -"major character death"' };
  const coldSearchMs = medianTime(() => createDiscovery(raw).discover(search), 9);
  engine.discover(search);
  global.gc?.();
  const heapMiB = global.gc ? Number(((process.memoryUsage().heapUsed - before) / 2 ** 20).toFixed(2)) : null;
  const all = raw.map(work => ({ work, score: 0 }));
  const ordered = sortMatches(all, { by: 'wordCount', direction: 'desc' });
  const filter = { mode: 'tag', scope: { type: 'additionalTags', value: 'AU' },
    include: [{ type: 'rating', value: 'Mature' }], exclude: [{ type: 'relationship', value: 'Alex/Robin' }],
    ranges: { wordCount: { min: 2000, max: 30000 } }, language: 'en' };
  measurements.push({ works: count, bytes: payload.length, gzip: gzipSync(payload).length, normalizeMs, buildMs, coldSearchMs,
    searchMs: medianTime(() => engine.discover(search)), filteredMs: medianTime(() => engine.discover(filter)),
    sortMs: medianTime(() => sortMatches(all, { by: 'wordCount', direction: 'desc' })),
    pageMs: medianTime(() => paginate(ordered, 10), 21, 2000, 6), baseHeapMiB, heapMiB });
}
console.log(process.version, process.platform, process.arch);
console.table(measurements);
