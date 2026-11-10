const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { decodeUrl, encodeUrl } = require('../discovery/state.js');
const { makeCatalog } = require('./discovery-fixture.cjs');

const fixture = process.env.RADIOAPPLE_FIXTURE_SITE;
const built = process.env.RADIOAPPLE_BUILT_SITE;
const playwright = process.env.RADIOAPPLE_PLAYWRIGHT;
const screenshots = process.env.RADIOAPPLE_PHASE5_SCREENSHOTS;
const skip = !fixture || !built || !playwright;
const scope = { mode: 'tag', scope: { type: 'additionalTags', value: 'AU' } };
const library = '#library';
const filters = '#library-filters';
const advanced = '.advanced-work-search';
const prefix = 'https://radioapple.invalid/VYAO3/';
const filename = root => pathToFileURL(path.join(root, 'index.html')).href;
const route = page => decodeUrl(new URL(page.url()).search);

async function browserTest(run) {
  const { chromium } = require(playwright);
  const browser = await chromium.launch({ executablePath: process.env.RADIOAPPLE_CHROMIUM });
  try {
    await run(browser);
  } finally {
    await browser.close();
  }
}

async function serveFixture(page, rows) {
  await page.route(prefix + '**', async route => {
    const relative = new URL(route.request().url()).pathname.slice('/VYAO3/'.length) || 'index.html';
    if (relative === 'fic-data/catalog.js') {
      await route.fulfill({ contentType: 'text/javascript',
        body: 'window.RADIOAPPLE_CATALOG_VERSION=2; window.RADIOAPPLE_CATALOG=' + JSON.stringify(rows) + ';' });
      return;
    }
    const contentType = relative.endsWith('.js') ? 'text/javascript' : relative.endsWith('.css') ? 'text/css'
      : relative.endsWith('.png') ? 'image/png' : 'text/html';
    await route.fulfill({ path: path.join(fixture, relative), contentType });
  });
}

function submit(form, name) {
  return form.getByRole('button', { name, exact: true }).first().click();
}

function toggle(form, name) {
  return form.locator('summary', { hasText: new RegExp('^' + name + '$') });
}

test('search edit is a presentation flag and reader return accepts result URLs only', () => {
  const state = { mode: 'search', q: 'A & B', ranges: { publishedAt: { min: '2020-01-01' } },
    include: [{ type: 'relationship', value: 'Alex & Robin' }] };
  const encoded = encodeUrl(state);
  const edit = decodeUrl(encoded + '&edit_search=true');
  assert.equal(edit.editing, true);
  assert.equal(encodeUrl(edit.state), encoded);
  assert.ok(decodeUrl('?view=search&edit_search=true&q=%FC').errors.length);
  assert.ok(decodeUrl('?view=search&edit_search=true&edit_search=true').errors.length);
  assert.ok(decodeUrl('?view=tag&tag=fandom%3AA&edit_search=true').errors.length);
  assert.equal(decodeUrl('?fic=radioapple&from=' + encodeURIComponent(encoded + '&edit_search=true')).returnQuery, '');
});

test('advanced Work Search validates and edits canonical criteria from shareable URLs', { skip }, async () => {
  await browserTest(async browser => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const local = filename(fixture);
    await page.goto(local);
    const menu = page.locator('#browse-header summary', { hasText: /^Search$/ });
    await menu.click();
    await page.locator('#browse-header').getByRole('link', { name: 'Works', exact: true }).click();
    const form = page.locator(advanced);
    await form.waitFor();
    assert.equal(await page.locator('#library-heading').textContent(), 'Work Search');
    assert.equal(await form.locator('fieldset').first().evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(48, 48, 48)');
    assert.equal(await page.locator(filters).isVisible(), false);
    const any = form.getByLabel('Any Field', { exact: true });
    const words = form.getByLabel('Word Count', { exact: true });
    const date = form.getByLabel('Date', { exact: true });
    const additional = form.getByRole('combobox', { name: 'Additional Tags', exact: true });
    await form.getByLabel('Creator', { exact: true }).fill('Élodie');
    await form.getByLabel('Date Posted', { exact: true }).fill('2020-01-01 to 2026-12-31');
    await form.getByLabel('Language', { exact: true }).selectOption('en');
    await form.getByLabel('Hits', { exact: true }).fill('>=1; <=10000');
    await form.getByLabel('Sort by', { exact: true }).selectOption('title');
    await form.getByLabel('Sort direction', { exact: true }).selectOption('asc');
    await additional.fill('AU');
    await page.locator('#search-tags-additionalTags-suggestions [role=option]').first().waitFor();
    assert.match(await page.locator('#search-tags-additionalTags-suggestions').textContent(), /Alternate Universe.*alias: AU/);
    await additional.press('ArrowDown');
    await additional.press('Enter');
    assert.equal(await form.getByRole('button', { name: 'Remove Alternate Universe', exact: true }).count(), 1);
    await additional.fill('Alternate Universe');
    await additional.press('Enter');
    assert.equal(await form.getByRole('button', { name: 'Remove Alternate Universe', exact: true }).count(), 1);
    await additional.fill('NoSuchLocalTagZZ');
    await additional.press('Enter');
    assert.match(await page.locator('#search-tags-additionalTags-feedback').textContent(), /No exact local tag/);
    await additional.fill('');
    await any.fill('"unclosed');
    await words.fill('more than a lot');
    await date.fill('2025-02-30');
    const before = page.url();
    await submit(form, 'Search');
    assert.equal(page.url(), before);
    for (const control of [any, words, date]) assert.equal(await control.getAttribute('aria-invalid'), 'true');
    assert.equal(await form.getByLabel('Creator', { exact: true }).inputValue(), 'Élodie');

    await any.fill('lantern* OR clock*');
    await words.fill('1000-5000');
    await date.fill('2020-01-01 to 2026-12-31');
    await submit(form, 'Search');
    await page.locator('#library-search-context').waitFor();
    const resultUrl = page.url();
    const result = route(page);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.state.include, [{ type: 'additionalTags', value: 'Alternate Universe' }]);
    assert.deepEqual(result.state.ranges.hits, { min: 1, max: 10000 });
    assert.deepEqual(result.state.ranges.wordCount, { min: 1000, max: 5000 });
    assert.deepEqual(result.state.ranges.updatedAt, { min: '2020-01-01', max: '2026-12-31' });
    assert.deepEqual(result.state.ranges.publishedAt, result.state.ranges.updatedAt);
    assert.deepEqual(result.state.sort, { by: 'title', direction: 'asc' });
    assert.equal(await page.locator(filters).isVisible(), false);
    assert.ok(await page.locator('.work-blurb').count() > 0);
    await page.reload();
    await page.getByRole('link', { name: 'Edit Your Search' }).click();
    await form.waitFor();
    assert.equal(await any.inputValue(), 'lantern* OR clock*');
    assert.equal(await words.inputValue(), '1000-5000');
    assert.equal(await date.inputValue(), '2020-01-01 to 2026-12-31');
    assert.equal(await form.getByLabel('Sort direction', { exact: true }).inputValue(), 'asc');
    assert.equal(await form.getByRole('button', { name: 'Remove Alternate Universe', exact: true }).count(), 1);
    await form.getByLabel('Title', { exact: true }).fill('zzznomatcheszzz');
    await submit(form, 'Search');
    await page.locator('#library-status').waitFor();
    assert.equal(await page.locator('#library-status').textContent(), 'No results found.');
    assert.equal(route(page).state.title, 'zzznomatcheszzz');
    await page.goBack();
    await form.waitFor();
    assert.equal(await form.getByLabel('Title', { exact: true }).inputValue(), '');
    await page.goBack();
    assert.equal(page.url(), resultUrl);
    await page.goto(filename(built) + '?view=search&edit_search=true');
    await form.waitFor();
    assert.equal(await form.getByText('Work Stats', { exact: true }).count(), 0);
    assert.equal(await form.getByLabel('Sort by', { exact: true }).getByRole('option', { name: 'Hits', exact: true }).count(), 0);
    assert.deepEqual(errors, []);
  });
});

test('tag filters combine facet choices, preserve zero counts and return to a filtered page', { skip }, async () => {
  await browserTest(async browser => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
    const local = filename(fixture);
    await page.goto(local + encodeUrl(scope));
    const form = page.locator(filters);
    const include = form.locator('.filter-include');
    const exclude = form.locator('.filter-exclude');
    const warnings = toggle(exclude, 'Exclude Archive Warnings').locator('..');
    const bodies = [];
    page.on('request', request => { if (request.url().endsWith('/work.js')) bodies.push(request.url()); });
    const originals = await page.locator('.work-blurb').count();
    assert.equal(await form.isVisible(), true);
    assert.equal(await page.getByRole('button', { name: 'Filters', exact: true }).isVisible(), false);
    assert.equal(await toggle(include, 'Include Characters').evaluate(node => node.parentElement.open), false);
    const expectFacet = async (type, name) => page.evaluate(([type, name]) => {
      const discovery = window.RadioAppleDiscovery;
      const engine = discovery.engine.createDiscovery(window.RADIOAPPLE_CATALOG);
      return engine.discover(discovery.state.decodeUrl(location.search).state).facets[type].find(tag => tag.value === name)?.count;
    }, [type, name]);
    const alex = await expectFacet('characters', 'Alex');
    assert.ok(alex > 0);
    await toggle(include, 'Include Characters').click();
    await toggle(include, 'Include Additional Tags').click();
    await toggle(exclude, 'Exclude Archive Warnings').click();
    await toggle(exclude, 'Exclude Relationships').click();
    await include.getByText('Alex (' + alex + ')', { exact: true }).click();
    await include.getByText(/^Friendship \(\d+\)$/).click();
    await warnings.getByText(/^Major Character Death \(\d+\)$/).click();
    await exclude.getByText(/^Alex\/Robin \(\d+\)$/).click();
    assert.equal(await page.locator('.work-blurb').count(), originals);
    assert.equal(new URL(page.url()).search, encodeUrl(scope));
    await submit(form, 'Sort and Filter');
    await page.waitForURL(url => url.searchParams.getAll('exclude').length === 2);
    await page.locator(library).waitFor();
    const applied = route(page).state;
    assert.deepEqual(applied.scope, scope.scope);
    assert.deepEqual(applied.include, [{ type: 'additionalTags', value: 'Friendship' }, { type: 'characters', value: 'Alex' }]);
    assert.deepEqual(applied.exclude, [{ type: 'relationship', value: 'Alex/Robin' }, { type: 'warning', value: 'Major Character Death' }]);
    assert.ok(await page.locator('.work-blurb').count() < originals);
    const changedCount = await expectFacet('characters', 'Alex');
    assert.equal(await include.getByRole('checkbox', { name: 'Alex (' + changedCount + ')', exact: true }).isChecked(), true);
    await page.reload();
    assert.equal(await exclude.getByRole('checkbox', { name: 'Major Character Death (0)', exact: true }).isChecked(), true);
    await toggle(exclude, 'Exclude Characters').click();
    await exclude.getByText(/^Alex \(\d+\)$/).click();
    await submit(form, 'Sort and Filter');
    await page.waitForURL(url => url.searchParams.getAll('exclude').length === 3);
    await page.locator('#library-status').waitFor();
    assert.equal(await page.locator('.work-blurb').count(), 0);
    assert.match(await page.locator('#library-heading').textContent(), /0 Works in Alternate Universe/);
    assert.equal(await include.getByRole('checkbox', { name: 'Alex (0)', exact: true }).isChecked(), true);
    assert.equal(await exclude.getByRole('checkbox', { name: 'Alex (0)', exact: true }).isChecked(), true);
    await form.getByRole('link', { name: 'Clear Filters' }).click();
    await page.waitForURL(url => url.search === encodeUrl(scope));
    await form.waitFor();
    assert.equal(route(page).state.include.length + route(page).state.exclude.length, 0);
    await toggle(exclude, 'Exclude Archive Warnings').click();
    await warnings.getByText(/^Major Character Death \(\d+\)$/).click();
    await submit(form, 'Sort and Filter');
    await page.waitForURL(url => url.searchParams.has('exclude'));
    await page.locator('#library-pagination-top [rel=next]').click();
    await page.waitForURL(url => url.searchParams.get('page') === '2');
    const from = new URL(page.url()).search;
    assert.equal(bodies.length, 0);
    await page.locator('.blurb-work-link').first().click();
    await page.locator('#reader').waitFor();
    assert.equal(route(page).returnQuery, from);
    await page.locator('#library-link').click();
    await page.waitForURL(url => url.search === from);
    assert.equal(route(page).state.page, 2);
  });
});

test('mobile filter panel shifts the page, contains focus and scrolls at phone widths', { skip }, async () => {
  await browserTest(async browser => {
    for (const width of [320, 390, 430, 768, 1280]) {
      const phone = width < 500;
      const page = await browser.newPage({ viewport: { width, height: phone ? 844 : 960 }, isMobile: phone, hasTouch: phone });
      const local = filename(fixture);
      const query = encodeUrl(scope);
      await page.goto(local + query);
      const form = page.locator(filters);
      const trigger = page.getByRole('button', { name: 'Filters', exact: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      assert.equal(await trigger.isVisible(), phone);
      if (!phone) {
        assert.equal(await form.isVisible(), true);
        const ratio = await form.evaluate(node => node.getBoundingClientRect().width / node.parentElement.getBoundingClientRect().width);
        assert.ok(Math.abs(ratio - 0.23) < 0.01);
        await page.close();
        continue;
      }
      assert.equal(await form.isVisible(), false);
      await trigger.tap();
      assert.equal(await form.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(48, 48, 48)');
      assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
      assert.equal(await form.getAttribute('aria-modal'), 'true');
      assert.equal(await page.locator('#library-list').evaluate(list => list.inert), true);
      const geometry = await form.evaluate(node => ({
        right: node.getBoundingClientRect().right, width: node.getBoundingClientRect().width,
        shell: document.getElementById('top').getBoundingClientRect().left,
        scrollWidth: document.documentElement.scrollWidth, focus: document.activeElement.textContent
      }));
      assert.equal(geometry.right, width);
      assert.equal(geometry.shell, -geometry.width);
      assert.equal(geometry.scrollWidth, width);
      assert.equal(geometry.focus, 'Sort and Filter');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Close Filters');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Clear Filters');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Close Filters');
      const scroll = await form.locator('form').evaluate(node => {
        node.scrollTop = node.scrollHeight;
        return [node.scrollTop, node.scrollHeight, node.clientHeight];
      });
      assert.ok(scroll[0] > 0 && scroll[1] > scroll[2]);
      const box = form.getByRole('combobox', { name: 'Other tags to include' });
      await box.fill('Major Character Death');
      const suggestions = form.locator('#filter-other-include-suggestions');
      await suggestions.waitFor();
      await box.press('Enter');
      assert.match(await form.locator('#filter-other-include-feedback').textContent(), /several tag types/);
      await suggestions.getByRole('option', { name: /Additional Tag/ }).tap();
      const chosen = form.getByRole('button', { name: /Remove Major Character Death/ });
      const checked = toggle(form, 'Include Additional Tags').locator('..').locator('input:checked');
      const selectedValues = await checked.evaluateAll(nodes => nodes.map(node => node.value));
      assert.equal(Number(selectedValues.includes('Major Character Death')) + await chosen.count(), 1);
      await page.keyboard.press('Escape');
      assert.equal(await form.isVisible(), false);
      assert.equal(await trigger.evaluate(node => document.activeElement === node), true);
      assert.equal(await page.locator('#library-list').evaluate(list => list.inert), false);
      assert.equal(new URL(page.url()).search, query);
      await trigger.tap();
      await form.locator('.filter-backdrop').tap({ position: { x: 10, y: 60 } });
      assert.equal(await form.isVisible(), false);
      assert.equal(new URL(page.url()).search, query);
      if (width === 390) {
        const labels = ['Night-Train-' + 'Étincelle'.repeat(15), ...makeCatalog(41)[40].additionalTags.slice(0, 12)];
        const selected = { ...scope, include: labels.map(value => ({ type: 'additionalTags', value })) };
        await page.goto(local + encodeUrl(selected));
        await trigger.tap();
        assert.equal(await toggle(form, 'Include Additional Tags').evaluate(node => node.parentElement.open), true);
        const applied = toggle(form, 'Include Additional Tags').locator('..');
        assert.equal(await applied.locator('input:checked').count(), labels.length);
        assert.ok(await form.locator('form').evaluate(node => node.scrollWidth <= node.clientWidth));
        await box.fill('A');
        await suggestions.waitFor();
        assert.equal(await suggestions.getByRole('option').count(), 10);
        assert.ok(await suggestions.evaluate(node => node.scrollHeight > node.clientHeight));
        await box.press('Escape');
        assert.equal(await suggestions.isVisible(), false);
        assert.equal(await form.isVisible(), true);
        await page.keyboard.press('Escape');
        await page.goto(local + '?view=search&edit_search=true');
        await page.locator(advanced).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      }
      await page.close();
    }
  });
});

test('tag more options validate dates and bounds, retain one rating and reset the page', { skip }, async () => {
  await browserTest(async browser => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
    const original = filename(fixture) + encodeUrl({ ...scope, page: 2 });
    await page.goto(original);
    const panel = page.locator(filters);
    const ratings = toggle(panel, 'Include Ratings').locator('..');
    await toggle(panel, 'Include Ratings').click();
    await ratings.getByText(/^Mature \(\d+\)$/).click();
    await ratings.getByText(/^General Audiences \(\d+\)$/).click();
    assert.equal(await ratings.locator('input:checked').inputValue(), 'General Audiences');
    await toggle(panel, 'Word Count').click();
    await toggle(panel, 'Date Updated').click();
    await toggle(panel, 'Completion Status').click();
    await panel.getByText('Complete works only', { exact: true }).click();
    await panel.getByLabel('Word Count From', { exact: true }).fill('1,000');
    await panel.getByLabel('Word Count To', { exact: true }).fill('8000');
    const dateFrom = panel.getByLabel('Date Updated From', { exact: true });
    await dateFrom.fill('2024-02-31');
    await panel.getByLabel('Date Updated To', { exact: true }).fill('2026-12-31');
    await panel.getByLabel('Search within results', { exact: true }).fill('station OR lantern*');
    await panel.getByLabel('Language', { exact: true }).selectOption('en');
    await panel.getByLabel('Sort by', { exact: true }).selectOption('wordCount');
    await panel.getByLabel('Sort direction', { exact: true }).selectOption('asc');
    await submit(panel, 'Sort and Filter');
    assert.equal(page.url(), original);
    assert.equal(await dateFrom.getAttribute('aria-invalid'), 'true');
    await dateFrom.fill('2024-01-01');
    await submit(panel, 'Sort and Filter');
    await page.waitForURL(url => url.searchParams.has('wordCount.min'));
    await panel.waitFor();
    const state = route(page).state;
    assert.equal(state.page, 1);
    assert.deepEqual(state.scope, scope.scope);
    assert.deepEqual(state.ranges, {
      wordCount: { min: 1000, max: 8000 }, updatedAt: { min: '2024-01-01', max: '2026-12-31' }
    });
    assert.equal(state.q, 'station OR lantern*');
    assert.equal(state.language, 'en');
    assert.equal(state.completion, 'complete');
    assert.deepEqual(state.include, [{ type: 'rating', value: 'General Audiences' }]);
    assert.deepEqual(state.sort, { by: 'wordCount', direction: 'asc' });
    assert.equal(await toggle(panel, 'Word Count').evaluate(node => node.parentElement.open), true);
    assert.equal(await toggle(panel, 'Date Updated').evaluate(node => node.parentElement.open), true);
    await page.goBack();
    await panel.waitFor();
    assert.equal(page.url(), original);
    assert.equal(await toggle(panel, 'Word Count').evaluate(node => node.parentElement.open), false);
    await page.goForward();
    await panel.waitFor();
    assert.deepEqual(route(page).state.ranges, state.ranges);
  });
});

test('1,300 works keep autocomplete bounded and filtering metadata-only under the hosted prefix', { skip }, async t => {
  await browserTest(async browser => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    let bodies = 0;
    page.on('request', request => { if (request.url().endsWith('/work.js')) bodies++; });
    await serveFixture(page, makeCatalog(1300));
    const start = performance.now();
    await page.goto(prefix + encodeUrl(scope));
    await page.getByRole('button', { name: 'Filters', exact: true }).tap();
    const ready = performance.now();
    const form = page.locator(filters);
    const box = form.getByRole('combobox', { name: 'Other tags to include' });
    await box.fill('Canon Divergence');
    const suggestions = form.locator('#filter-other-include-suggestions');
    await suggestions.waitFor();
    const lookup = performance.now();
    assert.ok(await suggestions.getByRole('option').count() <= 10);
    await suggestions.getByRole('option', { name: /Alternate Universe - Canon Divergence/ }).tap();
    await submit(form, 'Sort and Filter');
    await page.waitForURL(url => url.searchParams.has('include'));
    await page.locator('.work-blurb').first().waitFor();
    assert.match(await page.locator('#library-heading').textContent(), /433 Works in Alternate Universe/);
    assert.equal(await page.locator('.work-blurb').count(), 20);
    assert.equal(bodies, 0);
    t.diagnostic('Hosted fixture navigation plus panel open: ' + Math.round(ready - start) +
      ' ms; input plus bounded suggestions (includes debounce): ' + Math.round(lookup - ready) + ' ms');
  });
});

test('capture visual verification with synthetic-only metadata', { skip: skip || !screenshots }, async () => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(fixture, 'fic-data', 'catalog.js'), 'utf8'), sandbox);
  const rows = sandbox.window.RADIOAPPLE_CATALOG.filter(row => /^sample-\d+$/.test(row.id));
  assert.equal(rows.length, 41);
  fs.mkdirSync(screenshots, { recursive: true });
  const capture = (name, fullPage = false) => ({ path: path.join(screenshots, name + '.png'), fullPage });
  await browserTest(async browser => {
    const desktop = await browser.newPage({ viewport: { width: 1280, height: 960 } });
    const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    for (const [page, width] of [[desktop, 1280], [phone, 390]]) {
      await serveFixture(page, rows);
      await page.goto(prefix + '?view=search&edit_search=true');
      await page.locator(advanced).waitFor();
      await page.screenshot(capture('advanced-' + width, true));
      await page.goto(prefix + encodeUrl(scope));
    }
    const side = desktop.locator(filters);
    const include = side.locator('.filter-include');
    const exclude = side.locator('.filter-exclude');
    await toggle(include, 'Include Characters').click();
    await toggle(include, 'Include Additional Tags').click();
    await toggle(exclude, 'Exclude Archive Warnings').click();
    await toggle(exclude, 'Exclude Relationships').click();
    await include.getByText(/^Alex \(\d+\)$/).click();
    await include.getByText(/^Friendship \(\d+\)$/).click();
    await toggle(exclude, 'Exclude Archive Warnings').locator('..').getByText(/^Major Character Death \(\d+\)$/).click();
    await exclude.getByText(/^Alex\/Robin \(\d+\)$/).click();
    await desktop.evaluate(() => window.scrollTo(0, 0));
    await desktop.screenshot(capture('filters-1280'));
    await include.screenshot(capture('include-1280'));
    await exclude.screenshot(capture('exclude-1280'));
    await submit(side, 'Sort and Filter');
    await desktop.waitForURL(url => url.searchParams.getAll('exclude').length === 2);
    await desktop.locator('.work-blurb').first().waitFor();
    await desktop.screenshot(capture('filtered-1280'));
    const panel = phone.locator(filters);
    await phone.screenshot(capture('filters-closed-390'));
    await phone.getByRole('button', { name: 'Filters', exact: true }).tap();
    await panel.waitFor();
    await phone.screenshot(capture('filters-open-390'));
    const autocomplete = panel.getByRole('combobox', { name: 'Other tags to include' });
    await autocomplete.fill('AU');
    await panel.locator('#filter-other-include-suggestions').waitFor();
    await autocomplete.press('ArrowDown');
    await phone.screenshot(capture('autocomplete-390'));
  });
});
