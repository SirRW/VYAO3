const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { createDiscovery } = require('../discovery/engine.js');
const { encodeUrl, decodeUrl } = require('../discovery/state.js');
const { makeCatalog } = require('./discovery-fixture.cjs');

const built = process.env.RADIOAPPLE_BUILT_SITE;
const fixture = process.env.RADIOAPPLE_FIXTURE_SITE;
const pages = process.env.RADIOAPPLE_PAGES_SITE;

function catalogAt(root) {
  const source = fs.readFileSync(path.join(root, 'fic-data', 'catalog.js'), 'utf8');
  const { window } = vm.runInNewContext(`${source}\n;({window})`, { window: {} });
  return { source, rows: JSON.parse(JSON.stringify(window.RADIOAPPLE_CATALOG)), version: window.RADIOAPPLE_CATALOG_VERSION };
}

test('published build contains legacy works and excludes import files and snapshot payloads', { skip: !built }, () => {
  const { rows, version } = catalogAt(built);
  assert.equal(version, 2);
  const ids = rows.map(row => row.id);
  assert.deepEqual([...ids].sort(), ['just-business', 'radioapple']);
  const legacy = rows.find(row => row.id === 'just-business');
  assert.equal(typeof legacy.additionalTags, 'string');
  assert.equal(legacy.wordCount, null);
  assert.equal(legacy.stats, null);
  assert.equal(createDiscovery(rows).discover({ mode: 'search', title: 'business' }).works[0].id, 'just-business');
  for (const name of ['Archive of MY own', '.radioapple-import', 'docs', 'tools', 'tests']) {
    assert.ok(!fs.existsSync(path.join(built, name)), name);
  }
  const payloads = fs.readdirSync(path.join(built, 'fic-data'));
  assert.deepEqual(payloads.sort(), ['catalog.js', 'just-business', 'radioapple']);
  assert.ok(!fs.readdirSync(built, { recursive: true }).some(file => /\.pdf$|(?:^|[/\\])(?:staged|reports|logs)(?:[/\\]|$)/i.test(file)));
});

test('Pages export opts out of Jekyll and contains compiled reader files only', { skip: !pages }, () => {
  const { rows } = catalogAt(pages);
  assert.ok(rows.length > 0);
  assert.ok(rows.every(row => /^[a-z0-9-]+$/.test(row.id) && !/^(?:ao3|local)-.*--/.test(row.id)));
  assert.equal(fs.readFileSync(path.join(pages, '.nojekyll'), 'utf8'), '');
  assert.deepEqual(fs.readdirSync(pages).sort(),
    ['.nojekyll', 'ao3-logo.png', 'app.js', 'browse.css', 'discovery', 'fic-data', 'index.html', 'styles.css']);
  const payloads = fs.readdirSync(path.join(pages, 'fic-data')).sort();
  assert.deepEqual(payloads, ['catalog.js', ...rows.map(row => row.id).sort()]);
  for (const row of rows) {
    const folder = path.join(pages, 'fic-data', row.id);
    assert.deepEqual(fs.readdirSync(folder), ['work.js']);
    assert.match(fs.readFileSync(path.join(folder, 'work.js'), 'utf8'), /^window\.RADIOAPPLE_WORK = /);
  }
});

test('isolated build projects v2 nested metadata with an explicit privacy boundary', { skip: !fixture }, () => {
  const { source, rows } = catalogAt(fixture);
  assert.equal(rows.length, 44);
  const imported = rows.find(row => row.id === 'ao3-36640207');
  assert.equal(imported.schemaVersion, 2);
  assert.equal(imported.wordCount, 1136);
  assert.equal(imported.wordCountSource, 'archive');
  assert.deepEqual(imported.creators, [{ name: imported.author }]);
  assert.deepEqual(imported.source, { archive: 'ao3', workId: '36640207', url: 'http://archiveofourown.org/works/36640207' });
  assert.ok(Array.isArray(imported.fandom));
  const sentinel = rows.find(row => row.id === 'sample-00000');
  assert.deepEqual(sentinel.creators, [{ name: sentinel.author }]);
  assert.deepEqual(sentinel.series, [{ title: 'Letters from the Station', position: 1 }]);
  assert.deepEqual(sentinel.stats, { hits: 0, kudos: 8, comments: null, bookmarks: null, asOf: null });
  assert.equal(sentinel.source, null);
  assert.ok(!source.includes('PRIVATE_SENTINEL'));
  assert.ok(!source.includes('BODY_ONLY_SENTINEL'));
  assert.ok(!fs.readdirSync(path.join(fixture, 'fic-data')).some(name => name.includes('--')));
});

test('browser preserves legacy chapter URLs, preferences, pagination, contextual return and lazy bodies', {
  skip: !fixture || !built || !process.env.RADIOAPPLE_PLAYWRIGHT
}, async () => {
  const { chromium } = require(process.env.RADIOAPPLE_PLAYWRIGHT);
  const browser = await chromium.launch({ executablePath: process.env.RADIOAPPLE_CHROMIUM });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const errors = [];
    const bodies = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().endsWith('/work.js')) bodies.push(request.url()); });
    page.setDefaultTimeout(7000);
    const local = pathToFileURL(path.join(fixture, 'index.html')).href;
    await page.goto(`${local}?view=search&title=business`);
    assert.equal(await page.locator('body').evaluate(body => getComputedStyle(body).backgroundColor), 'rgb(34, 34, 34)');
    await page.locator('#library-list li').first().waitFor();
    assert.equal(await page.locator('.work-blurb').count(), 1);
    assert.equal(await page.locator('.blurb-work-link').textContent(), 'just business');
    await page.goto(`${local}?view=search&q=title%3Abusiness`);
    assert.match(await page.locator('#library-status').textContent(), /structured filters/);
    const state = { mode: 'tag', scope: { type: 'additionalTags', value: 'AU' },
      exclude: [{ type: 'fandom', value: 'Absent Fandom' }], sort: { by: 'revisedAt', direction: 'asc' } };
    await page.goto(local + encodeUrl(state));
    await page.locator('.work-blurb').first().waitFor();
    assert.equal(await page.locator('.work-blurb').count(), 20);
    assert.equal(bodies.length, 0);
    await page.locator('#library-pagination-top a[rel=next]').click();
    assert.equal(await page.locator('#library-pagination [aria-current=page]').textContent(), '2');
    assert.equal(await page.locator('.work-blurb').count(), 20);
    const listing = new URL(page.url()).search;
    assert.equal(listing, encodeUrl({ ...state, page: 2 }));
    await page.locator('.work-blurb').filter({ has: page.getByRole('link', { name: /Last available chapter/ }) })
      .first().locator('.blurb-work-link').click();
    await page.locator('#reader').waitFor();
    assert.equal(bodies.length, 1);
    assert.equal(new URL(await page.locator('#library-link').getAttribute('href'), page.url()).search, listing);
    await page.getByRole('link', { name: 'Read Chapter 1' }).click();
    await page.locator('#chapter-view').waitFor();
    await page.getByRole('link', { name: 'Next Chapter' }).first().click();
    assert.match(page.url(), /#chapter-2-text$/);
    assert.match(await page.locator('#chapter-body').textContent(), /Second fixture chapter/);
    await page.locator('#settings-trigger').click();
    await page.locator('#font-increase').click();
    assert.equal(await page.locator('#theme-toggle').count(), 0);
    const preferences = () => page.locator('html').evaluate(html => [getComputedStyle(html).colorScheme, html.style.getPropertyValue('--reader-font-size')]);
    assert.deepEqual(await preferences(), ['dark', '17px']);
    await page.evaluate(() => localStorage.setItem('radioapple-reader:settings:v2', JSON.stringify({ fontSize: 17, theme: 'light' })));
    await page.reload();
    await page.locator('#chapter-view').waitFor();
    assert.deepEqual(await preferences(), ['dark', '17px']);
    await page.locator('#library-link').click();
    assert.equal(new URL(page.url()).search, listing);
    assert.equal(await page.locator('.work-blurb').count(), 20);

    const prefix = 'https://radioapple.invalid/VYAO3/';
    await page.route(`${prefix}**`, async route => {
      const relative = new URL(route.request().url()).pathname.slice('/VYAO3/'.length) || 'index.html';
      const type = relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css'
        : relative.endsWith('.png') ? 'image/png' : 'text/html';
      await route.fulfill({ path: path.join(built, relative), contentType: type });
    });
    await page.goto(prefix);
    assert.equal(await page.locator('.work-blurb').count(), 2);
    assert.ok((await page.locator('.blurb-fandoms a').first().evaluate(anchor => anchor.href)).startsWith(prefix));
    await page.locator('.blurb-fandoms a').first().click();
    await page.locator('#library[data-mode="tag"]').waitFor();
    assert.ok(page.url().startsWith(prefix));
    assert.equal(await page.locator('#library').getAttribute('data-mode'), 'tag');
    assert.equal(await page.locator('.work-blurb').count(), 1);
    await page.goto(`${prefix}#chapter-2`);
    await page.waitForURL(url => url.searchParams.get('fic') === 'radioapple');
    await page.locator('#chapter-view').waitFor();
    assert.equal(await page.locator('#chapter-title').textContent(), 'Chapter 2: The Tour');
    assert.ok(bodies.includes(`${prefix}fic-data/radioapple/work.js`));
    await page.goto(`${prefix}?fic=just-business#chapter-7`);
    await page.locator('#chapter-view').waitFor();
    assert.equal(await page.locator('#chapter-list li').count(), 7);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('mobile browse menus, typed metadata, fandom directory and separate search results', {
  skip: !fixture || !process.env.RADIOAPPLE_PLAYWRIGHT
}, async () => {
  const { chromium } = require(process.env.RADIOAPPLE_PLAYWRIGHT);
  const browser = await chromium.launch({ executablePath: process.env.RADIOAPPLE_CHROMIUM });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const local = pathToFileURL(path.join(fixture, 'index.html')).href;
    const errors = [];
    const bodies = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().endsWith('/work.js')) bodies.push(request.url()); });
    await page.goto(local);
    assert.equal(await page.locator('.work-blurb').count(), 20);
    const dense = page.locator('[data-work-id="sample-00040"]');
    const optOut = page.locator('[data-work-id="sample-00039"]');
    const sparse = page.locator('[data-work-id="sample-00038"]');
    assert.match(await dense.locator('.blurb-title').textContent(), /^À la lumière.* by Élodie/);
    assert.equal(await dense.locator('.blurb-byline a').count(), 0);
    assert.equal(await dense.locator('.blurb-fandoms a').count(), 2);
    assert.equal(await dense.locator('.blurb-categories a').count(), 2);
    assert.equal(await dense.locator('.blurb-date').textContent(), '04 Jun 2026');
    assert.equal(await dense.locator('.blurb-summary p').count(), 3);
    assert.match(await dense.locator('.blurb-series').textContent(), /Part 1 of Letters/);
    assert.match(await dense.locator('.blurb-stats').textContent(), /Chapters:3\/5 \(2 available\)/);
    assert.ok(await dense.locator('.blurb-tags a').count() >= 30);
    assert.equal(await dense.locator('.blurb-tags li').first().getAttribute('class'), 'blurb-warning');
    assert.equal(await dense.locator('.symbol-warning [data-symbol=warning]').getAttribute('aria-label'), 'Archive warnings: Major Character Death');
    assert.equal(await dense.locator('.symbol-completion [data-symbol=in-progress]').count(), 1);
    assert.equal(await optOut.getByRole('link', { name: 'Rating: Not Rated' }).getAttribute('data-symbol'), 'blank');
    assert.equal(await optOut.locator('.symbol-warning [data-symbol=opt-out]').count(), 1);
    assert.equal(await optOut.locator('.symbol-completion [data-symbol=complete]').count(), 1);
    assert.equal(await sparse.locator('[data-symbol=unknown]').count(), 4);
    assert.doesNotMatch(await sparse.textContent(), /No Archive Warnings Apply|Words:|Kudos:|Hits:/);
    assert.equal(await sparse.locator('.blurb-summary').count(), 0);
    const typed = dense.getByRole('link', { name: 'Letters, Never Sent', exact: true });
    const scopeFrom = async anchor => decodeUrl(new URL(await anchor.getAttribute('href'), page.url()).search).state.scope;
    assert.deepEqual(await scopeFrom(typed), { type: 'additionalTags', value: 'Letters, Never Sent' });
    assert.equal((await scopeFrom(dense.locator('.blurb-relationship a'))).type, 'relationship');
    assert.equal((await scopeFrom(dense.locator('.blurb-characters a').first())).type, 'characters');
    await dense.getByRole('link', { name: 'AU', exact: true }).tap();
    assert.match(await page.locator('#library-heading').textContent(), /42 Works in Alternate Universe/);
    assert.equal(await page.locator('#library-pagination-top').isVisible(), true);
    assert.equal(await page.locator('#library-search-context').isVisible(), false);
    await page.goBack();
    assert.equal(new URL(page.url()).search, '');
    const lastChapter = dense.getByRole('link', { name: 'Last available chapter, Chapter 2' });
    assert.equal(new URL(await lastChapter.getAttribute('href'), page.url()).hash, '#chapter-2');

    const fandomMenu = page.locator('summary', { hasText: 'Fandoms' });
    await fandomMenu.focus();
    await page.keyboard.press('Enter');
    const allFandoms = page.getByRole('link', { name: 'All Fandoms' });
    assert.equal(await allFandoms.isVisible(), true);
    await page.keyboard.press('Escape');
    assert.equal(await allFandoms.isVisible(), false);
    assert.equal(await fandomMenu.evaluate(node => document.activeElement === node), true);
    await fandomMenu.tap();
    await allFandoms.tap();
    assert.equal(await page.locator('#library-heading').textContent(), 'Fandoms');
    const groups = await page.locator('#library-fandoms h2').allTextContents();
    assert.ok(groups.includes('E') && groups.includes('O') && !groups.includes('T'));
    await page.getByRole('link', { name: 'Échos de la nuit', exact: true }).tap();
    assert.equal(await page.locator('#library-heading').textContent(), '3 Works in Échos de la nuit');
    await page.getByRole('searchbox', { name: 'Search works' }).fill('Élodie');
    await page.getByRole('button', { name: 'Search', exact: true }).tap();
    await page.locator('#library[data-mode="search"]').waitFor();
    assert.equal(await page.locator('#library-heading').textContent(), 'Search Results');
    assert.match(await page.locator('#library-search-context').textContent(), /Élodie/);
    assert.equal(await page.locator('#library-pagination-top').isVisible(), false);
    assert.equal(await page.locator('#library-pagination').isVisible(), true);
    await page.goto(local + '?view=search&title=zzznomatcheszzz');
    assert.equal(await page.locator('#library-status').textContent(), 'No results found.');
    assert.equal(await page.locator('.work-blurb').count(), 0);
    await page.goto(local + '?view=search&title=Caf%C3%A9+Encounters+1');
    const zero = page.locator('[data-work-id="sample-00000"]');
    assert.match(await zero.locator('.blurb-stats').textContent(), /Kudos:8.*Hits:0/);
    assert.equal(await zero.locator('.symbol-warning [data-symbol=unknown]').count(), 1);
    await page.goto(local + '?view=search&title=Quiet+Spaces+2');
    assert.equal(await page.locator('[data-work-id="sample-00001"] .symbol-warning [data-symbol=blank]').count(), 1);
    assert.deepEqual(bodies, []);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});

test('dense blurbs and catalog pagination fit phone, tablet and desktop widths', {
  skip: !fixture || !process.env.RADIOAPPLE_PLAYWRIGHT
}, async () => {
  const { chromium } = require(process.env.RADIOAPPLE_PLAYWRIGHT);
  const browser = await chromium.launch({ executablePath: process.env.RADIOAPPLE_CHROMIUM });
  try {
    const local = pathToFileURL(path.join(fixture, 'index.html')).href;
    const scope = encodeUrl({ mode: 'tag', scope: { type: 'additionalTags', value: 'AU' } });
    const screenshotDir = process.env.RADIOAPPLE_SCREENSHOTS;
    if (screenshotDir) fs.mkdirSync(screenshotDir, { recursive: true });
    for (const width of [320, 390, 430, 768, 1280]) {
      const phone = width <= 430;
      const page = await browser.newPage({ viewport: { width, height: phone ? 844 : 960 }, isMobile: phone, hasTouch: phone });
      await page.goto(local + scope);
      const widths = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      assert.deepEqual(widths, [width, width], `Overflow at ${width}px`);
      assert.equal(await page.locator('.work-blurb').count(), 20);
      const hasDateGap = await page.locator('.blurb-header.has-date').first().evaluate(header =>
        header.querySelector('.blurb-title').getBoundingClientRect().right + 4 <=
        header.querySelector('.blurb-date').getBoundingClientRect().left);
      assert.ok(hasDateGap, 'Title touches the date at ' + width + 'px');
      assert.ok(await page.locator('#browse-header summary', { hasText: 'Fandoms' }).evaluate(node => node.getBoundingClientRect().height >= 24));
      assert.ok(await page.locator('#library-pagination-top [rel=next]').evaluate(node => node.getBoundingClientRect().height >= 24));
      if (screenshotDir && [390, 1280].includes(width)) {
        await page.screenshot({ path: path.join(screenshotDir, `tag-${width}.png`) });
        if (phone) {
          await page.locator('.blurb-summary').first().evaluate(node => node.scrollIntoView({ block: 'center' }));
          await page.screenshot({ path: path.join(screenshotDir, 'tag-390-scrolled.png') });
          await page.goto(local + '?view=search&title=lantern');
          await page.screenshot({ path: path.join(screenshotDir, 'search-390.png') });
        }
      }
      await page.close();
    }
    const large = await browser.newPage({ viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true });
    let payloads = 0;
    await large.route('https://radioapple.invalid/VYAO3/**', async route => {
      const relative = new URL(route.request().url()).pathname.slice('/VYAO3/'.length) || 'index.html';
      if (relative === 'fic-data/catalog.js') {
        await route.fulfill({ contentType: 'text/javascript',
          body: 'window.RADIOAPPLE_CATALOG_VERSION = 2; window.RADIOAPPLE_CATALOG = ' + JSON.stringify(makeCatalog(1300)) + ';' });
        return;
      }
      if (relative.endsWith('/work.js')) payloads++;
      const type = relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css'
        : relative.endsWith('.png') ? 'image/png' : 'text/html';
      await route.fulfill({ path: path.join(fixture, relative), contentType: type });
    });
    await large.goto('https://radioapple.invalid/VYAO3/?page=33');
    assert.equal(await large.locator('#library-heading').textContent(), '641 - 660 of 1,300 Works');
    assert.equal(await large.locator('.work-blurb').count(), 20);
    assert.equal(await large.locator('#library-pagination-top [aria-current=page]').textContent(), '33');
    assert.ok(await large.locator('#library-pagination-top .browse-pages-gap').count() > 0);
    assert.equal(await large.evaluate(() => document.documentElement.scrollWidth), 320);
    await large.locator('#library-pagination-top a[rel=next]').tap();
    assert.equal(await large.locator('#library-pagination-top [aria-current=page]').textContent(), '34');
    assert.equal(await large.locator('.work-blurb').count(), 20);
    assert.equal(payloads, 0);
  } finally {
    await browser.close();
  }
});
