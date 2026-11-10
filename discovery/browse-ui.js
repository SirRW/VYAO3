(function (discovery) {
  'use strict';

  const { element, link, tagLink, renderWorkBlurb } = discovery.blurb;
  const { encodeUrl, validateState } = discovery.state;
  const $ = id => document.getElementById(id);
  const number = new Intl.NumberFormat('en-US');
  const alphabet = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  const tagType = {
    rating: 'Rating', warning: 'Archive warning', category: 'Category', fandom: 'Fandom',
    relationship: 'Relationship', characters: 'Character', additionalTags: 'Additional tag'
  };
  const rangeField = {
    wordCount: 'Words', hits: 'Hits', kudos: 'Kudos', bookmarks: 'Bookmarks', comments: 'Comments',
    publishedAt: 'Date posted', updatedAt: 'Date updated', completedAt: 'Date completed'
  };
  const bounds = { eq: '=', min: '≥', max: '≤', gt: '>', lt: '<' };
  const header = $('browse-header');
  const menus = [...header.querySelectorAll('details')];
  let activeBrowse;
  let disposeFilters;
  window.addEventListener('pageshow', event => {
    if (event.persisted && activeBrowse && $('library').querySelector('form[data-submitted]')) show(activeBrowse);
  });

  for (const menu of menus) {
    menu.addEventListener('toggle', () => {
      if (menu.open) menus.filter(other => other !== menu).forEach(other => { other.open = false; });
    });
  }
  document.addEventListener('click', event => {
    for (const menu of menus) if (!menu.contains(event.target)) menu.open = false;
  });
  header.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const menu = menus.find(menu => menu.open);
    if (!menu) return;
    menu.open = false;
    menu.querySelector('summary').focus();
    event.preventDefault();
  });

  function listingHref(state) {
    return 'index.html' + encodeUrl(state);
  }

  function write(id, value) {
    const node = $(id);
    node.replaceChildren(value || '');
    node.hidden = !value;
  }

  function pageNumbers(current, total) {
    const visible = new Set([1, 2, total - 1, total]);
    for (let page = current - 2; page <= current + 2; page++) visible.add(page);
    return [...visible].filter(page => page >= 1 && page <= total).sort((a, b) => a - b);
  }

  function pagination(result) {
    const { page, previousPage, nextPage, totalPages } = result.pagination;
    if (totalPages < 2) return null;
    const list = element('ol', 'browse-pages');
    list.setAttribute('role', 'list');
    function add(target, label, rel) {
      const control = target && target !== page
        ? link(listingHref({ ...result.state, page: target }), label, 'ao3-button')
        : element('span', target ? 'ao3-button current' : 'ao3-button unavailable', label);
      if (target === page) control.setAttribute('aria-current', 'page');
      if (rel && target) control.rel = rel;
      if (!target) control.setAttribute('aria-disabled', 'true');
      list.append(element('li', '', control));
    }
    add(previousPage, '← Previous', 'prev');
    let last = 0;
    for (const target of pageNumbers(page, totalPages)) {
      if (target - last === 2) add(last + 1, number.format(last + 1));
      if (target - last > 2) list.append(element('li', 'browse-pages-gap', '…'));
      add(target, number.format(target));
      last = target;
    }
    add(nextPage, 'Next →', 'next');
    return list;
  }

  function searchDescription(state) {
    const terms = [];
    if (state.q) terms.push(state.q);
    if (state.title) terms.push('Title: ' + state.title);
    if (state.creator) terms.push('Creator: ' + state.creator);
    for (const { type, value } of state.include) terms.push(tagType[type] + ': ' + value);
    for (const { type, value } of state.exclude) terms.push('Exclude ' + tagType[type].toLowerCase() + ': ' + value);
    if (state.language) terms.push('Language: ' + state.language);
    if (state.completion) terms.push(state.completion === 'complete' ? 'Complete works' : 'Works in progress');
    if (state.singleChapter) terms.push('Single chapter');
    for (const [field, range] of Object.entries(state.ranges)) {
      for (const [bound, value] of Object.entries(range)) terms.push(rangeField[field] + ' ' + bounds[bound] + ' ' + value);
    }
    return 'You searched for: ' + (terms.join('; ') || 'All works');
  }

  function resultsHeading(result, scope) {
    const { page, pageSize } = result.pagination;
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, result.total);
    const count = number.format(result.total);
    const label = (result.total > pageSize ? number.format(start) + ' - ' + number.format(end) + ' of ' : '')
      + count + (result.total === 1 ? ' Work' : ' Works');
    return scope ? label + (result.state.q ? ' found in ' : ' in ') + scope : label;
  }

  function fandomDirectory(engine) {
    const sortName = value => value.trim().replace(/^(?:an?|the)\s+/i, '');
    const fandoms = engine.discover().facets.fandom
      .filter(tag => tag.count > 0)
      .sort((a, b) => alphabet.compare(sortName(a.value), sortName(b.value)) || discovery.model.compareText(a.key, b.key));
    if (!fandoms.length) return element('p', '', 'No fandoms are available.');
    const sections = new Map();
    for (const tag of fandoms) {
      const [first] = sortName(tag.value).normalize('NFD');
      const letter = first.toLocaleUpperCase('en');
      const initial = /\p{L}/u.test(letter) ? letter : '#';
      if (!sections.has(initial)) {
        const list = element('ul', 'browse-fandom-list');
        list.setAttribute('role', 'list');
        sections.set(initial, list);
      }
      const item = element('li', '', tagLink('fandom', tag.value));
      item.append(' (' + number.format(tag.matchingCount) + ')');
      sections.get(initial).append(item);
    }
    const directory = document.createDocumentFragment();
    for (const [initial, list] of sections) {
      const group = element('section', 'browse-fandom-group');
      group.append(element('h2', '', initial), list);
      directory.append(group);
    }
    return directory;
  }

  function isFandomDirectory(search) {
    return search === '?view=fandoms';
  }

  function show(options = {}) {
    const { engine, route, message = '', directory = false } = options;
    activeBrowse = options;
    disposeFilters?.();
    disposeFilters = null;
    header.hidden = false;
    const editing = Boolean(engine && route?.editing);
    const result = engine && !directory && !editing && !route.errors.length ? engine.discover(route.state) : null;
    const state = result?.state ?? route?.state ?? validateState().state;
    const mode = directory ? 'fandoms' : state.mode;
    const scope = result?.applied.scope?.value ?? state.scope?.value;
    const error = route?.errors[0]?.message ?? result?.errors[0]?.message;
    const search = mode === 'search';
    const heading = mode === 'fandoms' ? 'Fandoms' : editing ? 'Work Search' : search ? 'Search Results'
      : result && !error ? resultsHeading(result, scope) : scope ?? 'Works';
    document.title = (scope ? 'Works in ' + scope : search || directory ? heading : 'Works') + ' | RadioApple Reader';
    $('library').dataset.mode = mode;
    write('library-heading', heading);
    write('library-search-context', search && !editing ? searchDescription(state) : null);
    write('library-result-count', search && !error && result?.total
      ? number.format(result.total) + ' Found' : null);
    const currentWorks = mode === 'tag' ? element('span', 'ao3-button current', 'Works') : null;
    currentWorks?.setAttribute('aria-current', 'page');
    const actions = document.createDocumentFragment();
    const filters = $('library-filters');
    const filtered = mode === 'tag' && result?.applied.scope;
    filters.hidden = !filtered;
    if (filtered) {
      const panel = discovery.filterForm(engine, result, filters);
      disposeFilters = panel.dispose;
      actions.append(currentWorks, panel.trigger);
    } else {
      filters.replaceChildren();
      if (search && !editing) actions.append(link(discovery.forms.editHref(state), 'Edit Your Search', 'ao3-button'));
    }
    write('library-context-actions', actions.childElementCount ? actions : null);
    write('library-status', message || error || route?.warnings[0]?.message || (result && !result.total ? 'No results found.' : ''));
    $('browse-query').value = search ? state.q : '';
    for (const destination of header.querySelectorAll('[data-browse-destination]')) {
      if (destination.dataset.browseDestination === mode) destination.setAttribute('aria-current', 'page');
      else destination.removeAttribute('aria-current');
    }
    $('library-results').hidden = directory || editing;
    $('library-results').classList.toggle('has-tag-filters', Boolean(filtered));
    write('library-search-form', editing ? discovery.searchForm(engine, { ...state, scope: null }) : null);
    write('library-fandoms', directory ? fandomDirectory(engine) : null);
    const returnQuery = result && !error ? encodeUrl({ ...result.state, page: result.pagination.page }) : '';
    const fragment = document.createDocumentFragment();
    for (const work of result?.works ?? []) fragment.append(renderWorkBlurb(work, returnQuery, search ? 3 : 2));
    $('library-list').replaceChildren(fragment);
    write('library-pagination-top', result && !search ? pagination(result) : null);
    write('library-pagination', result ? pagination(result) : null);
    $('library').hidden = false;
    return result;
  }

  discovery.browse = { show, isFandomDirectory };
})(window.RadioAppleDiscovery);
