const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeWork, normalizeCatalog } = require('../discovery/model.js');
const { parseQuery, parseNumberRange } = require('../discovery/query.js');
const { createTagGraph } = require('../discovery/tags.js');
const { createDiscovery } = require('../discovery/engine.js');
const { decodeUrl, encodeUrl, resetFilters, changeCriteria } = require('../discovery/state.js');
const { makeCatalog } = require('./discovery-fixture.cjs');

const tag = (type, value) => ({ type, value });
const additional = value => tag('additionalTags', value);
const seed = [
  { id: 'a', title: 'Café at Dawn', author: 'Harry', summary: 'A quiet café by the river.', schemaVersion: 2,
    fandom: ['Fandom One'], additionalTags: ['AU', 'Alternate Universe', 'Friendship'], characters: ['Robin'],
    relationship: ['Alex/Robin'], rating: 'Mature', warning: ['No Archive Warnings Apply'], language: 'Français', languageCode: 'fr',
    wordCount: 1000, wordCountSource: 'archive', chaptersAvailable: 1, chaptersPosted: 1, chaptersTotal: 1,
    publishedAt: '2024-02-29', stats: { kudos: 0 } },
  { id: 'b', title: 'The Boats', author: 'Élodie', summary: 'The café is still open after the rain.', schemaVersion: 2,
    fandom: ['Fandom One', 'Fandom Two'], additionalTags: ['Canon Divergence', 'Friendship'], characters: ['Robin'],
    relationship: ['Alex & Robin'], rating: 'General Audiences', warning: [], language: 'English',
    wordCount: 1500, chaptersAvailable: 1, chaptersPosted: 1, chaptersTotal: 2, updatedAt: '2025-02-01' },
  { id: 'c', title: 'Harry James Potter', author: 'Morgan', summary: 'A night journey and a quiet rain.', schemaVersion: 2,
    fandom: ['Fandom Two'], additionalTags: ['Alternate Universe', 'Major Character Death'], characters: ['Alex/Robin'],
    rating: 'Mature', language: 'English', chaptersAvailable: 1, chaptersPosted: 1, chaptersTotal: null },
  { id: 'd', title: 'Crossing', author: '', summary: 'A letter from Sherman Potter.', additionalTags: 'Quiet, Found Family' }
];
const engine = createDiscovery(seed);
const search = state => engine.discover({ mode: 'search', ...state });
const browse = state => engine.discover({ mode: 'tag', scope: additional('AU'), ...state });

test('legacy lists preserve punctuation and bylines without inventing source metadata', () => {
  const work = normalizeWork({ id: 'radioapple', title: ' Café ', author: 'Smith, Jr.', warning: '',
    fandom: 'Fandom (Series), Another: Story', relationship: 'A/B, A & B', additionalTags: 'x-y,z, Tag (note)', language: 'English' });
  assert.equal(work.title, ' Café ');
  assert.equal(work.author, 'Smith, Jr.');
  assert.deepEqual(work.fandom, ['Fandom (Series)', 'Another: Story']);
  assert.deepEqual(work.relationship, ['A/B', 'A & B']);
  assert.deepEqual(work.additionalTags, ['x-y,z', 'Tag (note)']);
  assert.equal(work.creators, null);
  assert.equal(work.warning, null);
  assert.equal(work.languageCode, 'en');
  assert.equal(work.completionStatus, null);
  assert.equal(work.stats, null);
  assert.equal(work.wordCount, null);
});

test('v2 lists are lossless, with zero stats, optional provenance and a verified source', () => {
  const source = { archive: 'ao3', workId: '120', url: 'http://archiveofourown.org/works/120', path: 'private.pdf' };
  const work = normalizeWork({ id: 'ao3-120', schemaVersion: 2, title: 'Test', source,
    creators: [{ name: 'Writer, Jr.', localPath: 'private.pdf' }], additionalTags: ['Café, Sugar & Tea', ' Déjà Vu '],
    warning: [], category: null, wordCount: 0, wordCountSource: 'archive', stats: { kudos: 0, hits: null },
    series: [{ title: 'Series', position: 2 }], publishedAt: '2024-02-29', updatedAt: '2024-02-30' });
  assert.deepEqual(work.additionalTags, ['Café, Sugar & Tea', ' Déjà Vu ']);
  assert.deepEqual(work.creators, [{ name: 'Writer, Jr.' }]);
  assert.equal(work.author, 'Writer, Jr.');
  assert.deepEqual(work.warning, []);
  assert.equal(work.category, null);
  assert.equal(work.wordCount, 0);
  assert.equal(work.wordCountSource, 'archive');
  assert.equal(work.stats.kudos, 0);
  assert.equal(work.stats.hits, null);
  assert.equal(work.publishedAt, '2024-02-29');
  assert.equal(work.updatedAt, null);
  assert.deepEqual(work.source, { archive: 'ao3', workId: '120', url: source.url });
  assert.equal(normalizeWork({ ...seed[0], source: { ...source, url: 'file:///secret.pdf' } }).source, null);
  assert.deepEqual(work.series, [{ title: 'Series', position: 2 }]);
});

test('invalid versions, duplicate IDs, malformed IDs and staging slugs are diagnosed', () => {
  const { works, issues } = normalizeCatalog([seed[0], seed[0], { ...seed[1], schemaVersion: 3 },
    { ...seed[1], id: 'test/evil' }, { ...seed[1], id: `ao3-123--${'f'.repeat(64)}` }]);
  assert.deepEqual(works.map(work => work.id), ['a']);
  assert.deepEqual(issues.map(issue => issue.code), ['duplicate-work-id', 'invalid-work', 'invalid-work', 'invalid-work']);
});

test('typed tags normalize Unicode and preserve relationship separators and type identity', () => {
  const tags = createDiscovery([{ ...seed[0], additionalTags: ['Café, Sugar & Tea'] }, seed[1], seed[2]]);
  const include = value => tags.discover({ mode: 'search', include: [value] }).matchingIds;
  assert.deepEqual(include(additional('CAFE\u0301, SUGAR & TEA')), ['a']);
  assert.deepEqual(include(additional('Cafe, Sugar & Tea')), []);
  assert.deepEqual(include(tag('relationship', 'alex/robin')), ['a']);
  assert.deepEqual(include(tag('relationship', 'Alex & Robin')), ['b']);
  assert.deepEqual(include(tag('characters', 'Alex/Robin')), ['c']);
});

test('structured search, scope and filters expand canonical synonyms and descendant tags', () => {
  assert.deepEqual(new Set(search({ include: [additional('Alternate Universe')] }).matchingIds), new Set(['a', 'b', 'c']));
  assert.deepEqual(new Set(browse({ scope: additional('AU') }).matchingIds), new Set(['a', 'b', 'c']));
  assert.deepEqual(browse({ scope: additional('AU - Canon Divergence') }).matchingIds, ['b']);
  assert.deepEqual(browse({ exclude: [additional('Canon Divergence')] }).matchingIds, ['a', 'c']);
  assert.deepEqual(browse({ exclude: [additional('Alternate Universe')] }).matchingIds, []);
  assert.equal(engine.getWork('b').additionalTags[0], 'Canon Divergence');
  const [suggestion] = engine.suggestTags('au', { type: 'additionalTags' });
  assert.equal(suggestion.value, 'Alternate Universe');
  assert.equal(suggestion.matchedValue, 'AU');
  assert.equal(suggestion.count, 3);
  assert.equal(engine.suggestTags('Friendship')[0].value, 'Friendship');
});

test('graph rejects ambiguous aliases and cyclic or unknown parents', () => {
  const entry = (canonical, options) => ({ type: 'additionalTags', canonical, ...options });
  assert.throws(() => createTagGraph([entry('A', { aliases: ['other'] }), entry('B', { aliases: ['Other'] })]), /alias/);
  assert.throws(() => createTagGraph([entry('A', { parents: ['B'] }), entry('B', { parents: ['A'] })]), /cycle/);
  assert.throws(() => createTagGraph([entry('A', { parents: ['unknown'] })]), /parent/);
});

test('include is AND, exclude is OR, and include rating is single-choice', () => {
  assert.deepEqual(browse({ include: [additional('Friendship'), tag('fandom', 'Fandom Two')] }).matchingIds, ['b']);
  assert.deepEqual(browse({ exclude: [tag('relationship', 'Alex & Robin'), additional('Major Character Death')] }).matchingIds, ['a']);
  assert.deepEqual(browse({ include: [additional('Friendship')], exclude: [tag('warning', 'No Archive Warnings Apply')] }).matchingIds, ['b']);
  assert.deepEqual(search({ include: [tag('warning', 'No Archive Warnings Apply')] }).matchingIds, ['a']);
  assert.equal(browse({ include: [tag('rating', 'Mature'), tag('rating', 'General Audiences')] }).errors[0].code, 'multiple-ratings');
  assert.deepEqual(browse({ exclude: [tag('rating', 'Mature'), tag('rating', 'General Audiences')] }).matchingIds, []);
});

test('free text indexes original and filter names without injecting every alias', () => {
  assert.deepEqual(search({ q: '"Canon Divergence"' }).matchingIds, ['b']);
  assert.deepEqual(search({ q: 'AU' }).matchingIds, ['a']);
  assert.deepEqual(search({ q: '"Alternate Universe"' }).matchingIds, ['c', 'b', 'a']);
  assert.deepEqual(search({ q: 'body-only-token' }).matchingIds, []);
});

test('phrases, same-field spacing, AND, OR, groups, exclusions and wildcards', () => {
  const examples = createDiscovery([...seed, { id: 'cross', title: 'Sherman Potter', author: 'Harry' }]);
  const ids = q => examples.discover({ mode: 'search', q }).matchingIds;
  assert.deepEqual(ids('Harry Potter'), ['c']);
  assert.deepEqual(ids('Harry AND Potter'), ['c', 'cross']);
  assert.deepEqual(ids('"Harry Potter"'), []);
  assert.deepEqual(ids('"Harry James"'), ['c']);
  assert.deepEqual(ids('café || crossing'), ['d', 'a', 'b']);
  assert.deepEqual(ids('(CAFÉ OR Harry) -"Major Character Death"'), ['a', 'cross', 'b']);
  assert.deepEqual(ids('CAFÉ OR Harry -"Major Character Death"'), ['a', 'cross', 'b']);
  assert.deepEqual(ids('boat*'), ['b']);
  assert.deepEqual(search({ title: 'café', creator: 'harry' }).matchingIds, ['a']);
  assert.deepEqual(search({ q: 'CAFE\u0301' }).matchingIds, ['a', 'b']);
});

test('unsupported and invalid text syntax produces structured errors and no broad results', () => {
  for (const q of ['title:café', '@harry', '*boat', 'b*at', 'boat~2', 'Harry AND', '(Harry OR café', '"broken', 'A | B', 'A && B', '()']) {
    assert.ok(parseQuery(q).errors.length, q);
    assert.deepEqual(search({ q }).matchingIds, [], q);
  }
  assert.equal(search({ title: 'title:fish' }).errors[0].field, 'title');
});

test('numeric syntax and exact, inclusive and strict ranges compare typed values', () => {
  assert.deepEqual(parseNumberRange('1,000-1.500').range, { min: 1000, max: 1500 });
  assert.deepEqual(parseNumberRange('> 1,000').range, { gt: 1000 });
  assert.deepEqual(parseNumberRange('< 1000').range, { lt: 1000 });
  assert.deepEqual(parseNumberRange('1000').range, { eq: 1000 });
  assert.ok(parseNumberRange('1e3').errors.length);
  assert.ok(parseNumberRange('1500-1000').errors.length);
  assert.deepEqual(search({ ranges: { wordCount: { min: 1000, max: 1500 } } }).matchingIds, ['b', 'a']);
  assert.deepEqual(search({ ranges: { wordCount: { gt: 1000, lt: 1501 } } }).matchingIds, ['b']);
  assert.deepEqual(search({ ranges: { kudos: { eq: 0 } } }).matchingIds, ['a']);
  assert.deepEqual(search({ ranges: { wordCount: { min: 0, max: 0 } } }).matchingIds, []);
});

test('unknown completion, dates and local chapter counts do not become source facts', () => {
  assert.equal(engine.getWork('a').completionStatus, 'complete');
  assert.equal(engine.getWork('b').completionStatus, 'in-progress');
  assert.equal(engine.getWork('c').completionStatus, null);
  assert.equal(normalizeWork({ ...seed[2], chaptersTotal: '?' }).completionStatus, 'in-progress');
  assert.deepEqual(search({ singleChapter: true }).matchingIds, ['a']);
  assert.deepEqual(search({ completion: 'in-progress' }).matchingIds, ['b']);
  assert.deepEqual(search({ language: 'fRaNÇais' }).matchingIds, ['a']);
  assert.deepEqual(search({ language: 'FR' }).matchingIds, ['a']);
  assert.deepEqual(search({ ranges: { publishedAt: { eq: '2024-02-29' } } }).matchingIds, ['a']);
  assert.deepEqual(search({ ranges: { updatedAt: { min: '2024-01-01' } } }).matchingIds, ['b']);
  assert.ok(search({ ranges: { updatedAt: { min: 'last week' } } }).errors.length);
});

test('unknown values sort last in both directions, with deterministic IDs for ties', () => {
  assert.deepEqual(search({ sort: { by: 'wordCount', direction: 'asc' } }).matchingIds, ['a', 'b', 'c', 'd']);
  assert.deepEqual(search({ sort: { by: 'wordCount', direction: 'desc' } }).matchingIds, ['b', 'a', 'd', 'c']);
  assert.deepEqual(browse({}).matchingIds, ['b', 'a', 'c']);
  assert.deepEqual(search({ sort: { by: 'title', direction: 'asc' } }).matchingIds, ['b', 'a', 'd', 'c']);
  assert.deepEqual(search({ sort: { by: 'updatedAt', direction: 'asc' } }).matchingIds, ['b', 'a', 'c', 'd']);
  assert.ok(engine.availableSorts.includes('kudos'));
  assert.ok(!engine.availableSorts.includes('hits'));
});

test('facets count matching works once and retain conflicting selections at zero', () => {
  const result = browse({});
  assert.equal(result.total, 3);
  const parent = result.facets.additionalTags.find(item => item.value === 'Alternate Universe');
  assert.deepEqual([parent.count, parent.matchingCount], [2, 3]);
  assert.ok(!result.facets.additionalTags.some(item => item.value === 'Alternate Universe - Canon'));
  const inherited = browse({ scope: additional('Alternate Universe - Canon') }).facets.additionalTags;
  assert.equal(inherited.find(item => item.inScope).matchingCount, 1);
  assert.equal(inherited.find(item => item.inScope).count, 0);
  assert.equal(result.facets.fandom.find(item => item.value === 'Fandom Two').count, 2);
  const empty = browse({ include: [additional('AU')], exclude: [additional('Alternate Universe')], language: 'fr' });
  assert.equal(empty.total, 0);
  assert.equal(empty.facets.additionalTags.length, 1);
  const [selection] = empty.facets.additionalTags;
  assert.deepEqual([selection.count, selection.included, selection.excluded, selection.inScope], [0, true, true, true]);
  assert.equal(empty.facets.language[0].count, 0);
  assert.equal(empty.pagination.totalPages, 0);
  assert.equal(empty.pagination.page, 1);
});

test('URL round trips preserve typed labels, ranges, repeated filters and sort', () => {
  const state = { mode: 'tag', scope: tag('relationship', 'A & Béa/Robin: 夜'), q: '"café" OR 100%',
    include: [additional('AU'), tag('rating', 'Mature')], exclude: [additional('X & Y'), tag('warning', 'No Archive Warnings Apply')],
    language: 'fr', completion: 'complete', singleChapter: true,
    ranges: { wordCount: { min: 100, lt: 2000 }, publishedAt: { min: '2020-01-01' } }, sort: { by: 'wordCount', direction: 'asc' }, page: 3 };
  const encoded = encodeUrl(state);
  const decoded = decodeUrl(encoded);
  assert.deepEqual(decoded.errors, []);
  assert.equal(decoded.state.scope.value, state.scope.value);
  assert.equal(decoded.state.q, state.q);
  assert.equal(decoded.state.page, 3);
  assert.equal(new URLSearchParams(encoded).getAll('include').length, 2);
  assert.equal(encodeUrl(decoded.state), encoded);
  assert.equal(encodeUrl({ mode: 'works', page: 1, sort: { by: 'revisedAt', direction: 'desc' } }), '');
  const reset = resetFilters(decoded.state);
  assert.deepEqual(reset.scope, state.scope);
  assert.equal(reset.page, 1);
  assert.deepEqual(reset.include, []);
  assert.equal(changeCriteria(decoded.state, { language: 'en' }).page, 1);
});

test('URL validation rejects unknown, repeated and malformed constraints; reader routes stay reserved', () => {
  for (const raw of ['?unknown=x', '?view=tag', '?view=tag&tag=untyped', '?view=search&include=oops',
    '?view=search&view=tag', '?view=search&q=%E0%A4', '?view=search&wordCount.min=-1',
    '?view=search&updatedAt.min=2024-02-30', '?dir=asc', '?view=search&single=no', '?view=works&q=x']) {
    assert.ok(decodeUrl(raw).errors.length, raw);
  }
  assert.equal(decodeUrl('?page=bogus').state.page, 1);
  assert.equal(decodeUrl('?page=bogus').warnings[0].code, 'invalid-page');
  assert.equal(decodeUrl('?fic=radioapple&view=search').route, 'reader');
  const safe = new URLSearchParams({ fic: 'radioapple', from: '?view=search&q=apple' });
  assert.deepEqual(decodeUrl(`?${safe}`), { route: 'reader', workId: 'radioapple', returnQuery: '?view=search&q=apple' });
  assert.equal(decodeUrl('?fic=radioapple&from=https%3A%2F%2Fexample.org').returnQuery, '');
  assert.equal(decodeUrl('?fic=radioapple&from=%3Ffic%3Dother').returnQuery, '');
});

test('paginated IDs are stable and large metadata-only catalogs return complete counts', () => {
  for (const size of [24, 300, 1300, 5000]) {
    const discovery = createDiscovery(makeCatalog(size));
    const first = discovery.discover();
    const second = discovery.discover({ page: 2 });
    const last = discovery.discover({ page: 999999 });
    assert.equal(first.total, size);
    assert.equal(first.works.length, 20);
    assert.equal(first.pagination.hasPrevious, false);
    assert.equal(second.pagination.hasPrevious, true);
    assert.deepEqual(first.matchingIds, second.matchingIds);
    assert.deepEqual(second.works.map(work => work.id), first.matchingIds.slice(20, 40));
    assert.equal(last.pagination.page, Math.ceil(size / 20));
    assert.equal(last.pagination.hasNext, false);
    const tagList = discovery.discover({ mode: 'tag', scope: additional('AU'), language: 'en',
      include: [tag('rating', 'Mature')], exclude: [tag('relationship', 'Alex/Robin')] });
    assert.ok(tagList.total > 0 && tagList.total < size);
    assert.equal(tagList.facets.rating[0].count, tagList.total);
    assert.deepEqual(discovery.discover(decodeUrl(encodeUrl(tagList.state)).state).matchingIds, tagList.matchingIds);
  }
});
