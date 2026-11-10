(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./model.js'), require('./query.js'), require('./tags.js'),
      require('./state.js'), require('./tag-relationships.js'));
  } else {
    const discovery = root.RadioAppleDiscovery;
    discovery.engine = factory(discovery.model, discovery.query, discovery.tags, discovery.state, discovery.tagRelationships);
  }
})(globalThis, function (model, query, tags, url, seed) {
  'use strict';

  const { TAG_TYPES, STAT_FIELDS, normalizeCatalog, normalizeText, compareText } = model;
  const PAGE_SIZE = 20;

  function knownValue(work, field) {
    return (STAT_FIELDS.includes(field) ? work.stats?.[field] : work[field]) ?? null;
  }

  function sortValue({ work, score }, field) {
    if (field === 'relevance') return score;
    if (field === 'revisedAt') return work.updatedAt ?? work.completedAt ?? work.publishedAt;
    if (field === 'title') {
      const title = normalizeText(work.title).replace(/^["'.\/]/, '').replace(/^(a|an|the) (.+)$/, '$2, $1');
      return /^\d/.test(title) ? title.padStart(5, '0') : title;
    }
    if (field === 'creator') {
      if (!work.author && !work.creators?.length) return null;
      const names = work.creators?.length ? work.creators.map(creator => normalizeText(creator.name)).sort(compareText) : [normalizeText(work.author)];
      return names.join(',  ').replace(/^[+\-=_?!'".\/]/, '');
    }
    return knownValue(work, field);
  }

  function sortMatches(matches, { by, direction }) {
    const order = direction === 'asc' ? 1 : -1;
    return matches.map(match => ({ match, value: sortValue(match, by) })).sort((a, b) => {
      if (a.value === null && b.value !== null) return 1;
      if (a.value !== null && b.value === null) return -1;
      return order * (compareText(a.value, b.value) || compareText(a.match.work.id, b.match.work.id));
    }).map(({ match }) => match);
  }

  function paginate(matches, requestedPage) {
    const total = matches.length;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const page = Math.min(Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1, totalPages || 1);
    const start = (page - 1) * PAGE_SIZE;
    return { total, totalPages, page, pageSize: PAGE_SIZE, hasPrevious: page > 1, hasNext: page < totalPages,
      previousPage: page > 1 ? page - 1 : null, nextPage: page < totalPages ? page + 1 : null,
      items: matches.slice(start, start + PAGE_SIZE) };
  }

  function compileRanges(ranges) {
    const constraints = Object.entries(ranges);
    return work => constraints.every(([field, { eq, min, max, gt, lt }]) => {
      const value = knownValue(work, field);
      return value !== null && (eq === undefined || value === eq) && (min === undefined || value >= min)
        && (max === undefined || value <= max) && (gt === undefined || value > gt) && (lt === undefined || value < lt);
    });
  }

  function resolveSelections(values, graph) {
    const resolved = new Map();
    for (const value of values) {
      const tag = graph.resolve(value);
      resolved.set(tag.key, tag);
    }
    return resolved;
  }

  function languageFor(work) {
    if (!work.languageCode && !work.language) return null;
    return { key: work.languageCode ?? normalizeText(work.language), value: work.languageCode ?? work.language,
      label: work.language ?? work.languageCode };
  }

  function matchesLanguage(language, selection) {
    return language && (language.key === selection || normalizeText(language.label) === selection);
  }

  function increment(map, key) {
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  function collectFacets(matches, applied, graph, languages, state) {
    const counts = new Map();
    const matchingCounts = new Map();
    const languageCounts = new Map();
    const completionCounts = new Map();
    for (const entry of matches) {
      for (const key of entry.tags.direct) increment(counts, key);
      for (const key of entry.tags.matching) increment(matchingCounts, key);
      if (entry.language) increment(languageCounts, entry.language.key);
      if (entry.work.completionStatus) increment(completionCounts, entry.work.completionStatus);
    }
    const facets = Object.fromEntries(TAG_TYPES.map(type => [type, []]));
    const available = new Map([...applied.include, ...applied.exclude]);
    if (applied.scope) available.set(applied.scope.key, applied.scope);
    for (const key of counts.keys()) available.set(key, graph.get(key));
    for (const [key, tag] of available) {
      facets[tag.type].push({ ...tag, aliases: [...tag.aliases], count: counts.get(key) ?? 0,
        matchingCount: matchingCounts.get(key) ?? 0,
        included: applied.include.has(key), excluded: applied.exclude.has(key), inScope: applied.scope?.key === key });
    }
    for (const group of Object.values(facets)) {
      group.sort((a, b) => b.count - a.count || compareText(a.key, b.key));
    }

    const selection = state.language ? normalizeText(state.language) : null;
    const languageOptions = new Map([...languageCounts.keys()].map(key => [key, languages.get(key)]));
    if (selection) {
      const selected = [...languages.values()].filter(language => matchesLanguage(language, selection));
      if (selected.length) selected.forEach(language => languageOptions.set(language.key, language));
      else languageOptions.set(selection, { key: selection, value: state.language, label: state.language });
    }
    facets.language = [...languageOptions.values()].map(language => ({ ...language,
      count: languageCounts.get(language.key) ?? 0, selected: matchesLanguage(language, selection) }))
      .sort((a, b) => b.count - a.count || compareText(a.key, b.key));
    const statuses = new Set(completionCounts.keys());
    if (state.completion) statuses.add(state.completion);
    facets.completion = [...statuses].sort(compareText).map(value => ({ value,
      count: completionCounts.get(value) ?? 0, selected: value === state.completion }));
    return facets;
  }

  function createDiscovery(rows, { relationships = seed, catalogVersion = 2 } = {}) {
    if (!Array.isArray(rows) || ![1, 2].includes(catalogVersion)) throw new TypeError('Unsupported discovery catalog.');
    const { works, issues } = normalizeCatalog(rows);
    const graph = tags.createTagGraph(relationships);
    const languages = new Map();
    const globalCounts = new Map();
    const records = works.map(work => {
      const language = languageFor(work);
      if (language && !languages.has(language.key)) languages.set(language.key, language);
      const keys = graph.index(work);
      for (const key of keys.matching) increment(globalCounts, key);
      return { work, tags: keys, language, text: null };
    });
    const byId = new Map(works.map(work => [work.id, work]));
    const availableSorts = url.SORT_FIELDS.filter(field => field === 'relevance' || works.some(work => sortValue({ work }, field) !== null));
    const copyTag = tag => ({ ...tag, aliases: [...tag.aliases] });

    function discover(input) {
      const { state, errors, warnings } = url.validateState(input);
      const applied = { scope: state.scope ? graph.resolve(state.scope) : null,
        include: resolveSelections(state.include, graph), exclude: resolveSelections(state.exclude, graph) };
      if ([...applied.include.values()].filter(tag => tag.type === 'rating').length > 1) {
        errors.push({ field: 'include', code: 'multiple-ratings', message: 'Include allows one rating. Exclude allows multiple ratings.' });
      }
      const predicates = [];
      for (const field of ['q', 'title', 'creator']) {
        if (!state[field]) continue;
        const parsed = query.parseQuery(state[field]);
        for (const error of parsed.errors) errors.push({ ...error, field });
        predicates.push(query.compileQuery(parsed.ast, field === 'q' ? undefined : field));
      }

      const scope = applied.scope?.key;
      const required = [...applied.include.keys()];
      const excluded = [...applied.exclude.keys()];
      const rangeMatches = compileRanges(state.ranges);
      const language = state.language ? normalizeText(state.language) : null;
      const matches = [];
      if (!errors.length) for (const entry of records) {
        const { work, tags } = entry;
        if ((scope && !tags.matching.has(scope)) || !required.every(key => tags.matching.has(key))
            || excluded.some(key => tags.matching.has(key))) continue;
        if ((language && !matchesLanguage(entry.language, language)) || (state.completion && work.completionStatus !== state.completion)
            || (state.singleChapter && work.chaptersTotal !== 1) || !rangeMatches(work)) continue;
        if (predicates.length && !entry.text) {
          entry.text = query.indexText(work, [...tags.matching].map(key => graph.get(key).value));
        }
        let score = 0;
        for (const predicate of predicates) {
          const value = predicate(entry.text);
          if (value === null) {
            score = null;
            break;
          }
          score += value;
        }
        if (score !== null) matches.push({ ...entry, score });
      }

      const sort = state.sort ?? { by: url.defaultSort(state.mode), direction: 'desc' };
      const ordered = sortMatches(matches, sort);
      const { items, ...pagination } = paginate(ordered, state.page);
      return { state: { ...state, page: pagination.page }, errors, warnings, sort, pagination,
        total: pagination.total, matchingIds: ordered.map(({ work }) => work.id), works: items.map(({ work }) => work),
        applied: { scope: applied.scope && copyTag(applied.scope), include: [...applied.include.values()].map(copyTag),
          exclude: [...applied.exclude.values()].map(copyTag) },
        facets: collectFacets(matches, applied, graph, languages, state) };
    }

    return { discover, catalogIssues: issues, availableSorts, languages: [...languages.values()],
      getWork: id => byId.get(id) ?? null,
      findTags: (value, type) => (type ? [type] : TAG_TYPES)
        .map(type => graph.resolve({ type, value })).filter(tag => graph.get(tag.key)).map(copyTag),
      suggestTags: (input, options) => graph.suggest(input, options).map(tag => ({ ...tag, count: globalCounts.get(tag.key) ?? 0 })) };
  }

  return { createDiscovery, PAGE_SIZE, sortMatches, paginate };
});
