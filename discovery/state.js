(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'));
  else root.RadioAppleDiscovery.state = factory(root.RadioAppleDiscovery.model);
})(globalThis, function (model) {
  'use strict';

  const { TAG_TYPES, DATES, RANGE_FIELDS, STAT_FIELDS, compareText, integer, isoDate, isRecord, tagKey } = model;
  const MODES = ['works', 'search', 'tag'];
  const TEXT = ['q', 'title', 'creator'];
  const BOUNDS = ['eq', 'min', 'max', 'gt', 'lt'];
  const SORT_FIELDS = Object.freeze(['relevance', 'revisedAt', ...DATES, 'title', 'creator', 'wordCount', ...STAT_FIELDS]);
  const SCALARS = ['view', 'tag', ...TEXT, 'language', 'completion', 'single', 'sort', 'dir', 'page'];
  const STATE_KEYS = ['mode', 'scope', ...TEXT, 'include', 'exclude', 'language', 'completion', 'singleChapter', 'ranges', 'sort', 'page'];
  const rangeKeys = new Map(RANGE_FIELDS.flatMap(field => BOUNDS.map(bound => [`${field}.${bound}`, [field, bound]])));

  function validateState(input = {}) {
    const errors = [];
    const warnings = [];
    const reject = (field, message, code = 'invalid-state') => errors.push({ field, code, message });
    if (!isRecord(input)) {
      reject('state', 'Expected a discovery state object.');
      input = {};
    }
    for (const field of Object.keys(input)) {
      if (!STATE_KEYS.includes(field)) reject(field, 'Unknown discovery field.', 'unknown-field');
    }

    const mode = input.mode ?? 'works';
    if (!MODES.includes(mode)) reject('mode', 'Choose works, search, or tag.');
    const state = { mode: MODES.includes(mode) ? mode : 'works', scope: null, q: '', title: '', creator: '',
      include: [], exclude: [], language: null, completion: null, singleChapter: false, ranges: {}, sort: null, page: 1 };

    function tag(value, field) {
      if (isRecord(value) && TAG_TYPES.includes(value.type) && typeof value.value === 'string'
          && value.value.trim() && value.value.length <= 300 && !/[\x00-\x1f]/.test(value.value)) {
        return { type: value.type, value: value.value.trim() };
      }
      reject(field, 'Use a supported tag type and a nonempty label.');
      return null;
    }
    if (input.scope != null) state.scope = tag(input.scope, 'scope');
    if (mode === 'tag' && !state.scope) reject('scope', 'Tag browsing requires a tag scope.');
    if (mode !== 'tag' && state.scope) reject('scope', 'A tag scope requires tag browsing.');

    for (const field of ['include', 'exclude']) {
      if (input[field] == null) continue;
      if (!Array.isArray(input[field]) || input[field].length > 100) {
        reject(field, 'Use a list of up to 100 typed tags.');
        continue;
      }
      const selected = new Map();
      for (const raw of input[field]) {
        const value = tag(raw, field);
        if (value) {
          const key = tagKey(value.type, value.value);
          const prior = selected.get(key);
          if (!prior || compareText(value.value, prior.value) < 0) selected.set(key, value);
        }
      }
      state[field] = [...selected].sort(([a], [b]) => compareText(a, b)).map(([, value]) => value);
    }

    for (const field of [...TEXT, 'language']) {
      const value = input[field];
      if (value == null) continue;
      if (typeof value !== 'string' || value.length > (field === 'language' ? 100 : 1024) || value.includes('\0')) {
        reject(field, 'Enter a valid text value.');
      } else if (value.trim()) state[field] = value.trim();
    }
    if (input.completion != null) {
      if (['complete', 'in-progress'].includes(input.completion)) state.completion = input.completion;
      else reject('completion', 'Choose complete or in-progress.');
    }
    if (input.singleChapter != null) {
      if (typeof input.singleChapter === 'boolean') state.singleChapter = input.singleChapter;
      else reject('singleChapter', 'Expected a single-chapter checkbox value.');
    }

    if (input.ranges != null) {
      if (!isRecord(input.ranges)) reject('ranges', 'Expected a set of typed ranges.');
      else for (const [field, range] of Object.entries(input.ranges)) {
        if (!RANGE_FIELDS.includes(field) || !isRecord(range)) {
          reject(field, 'Unknown range field or invalid range.');
          continue;
        }
        const dates = DATES.includes(field);
        const values = {};
        for (const [bound, raw] of Object.entries(range)) {
          const value = dates ? isoDate(raw) : integer(raw);
          if (value === null || !BOUNDS.includes(bound) || (dates && ['gt', 'lt'].includes(bound))) {
            reject(`${field}.${bound}`, dates ? 'Use an ISO date in YYYY-MM-DD format.' : 'Use a nonnegative integer and a supported bound.');
          } else values[bound] = value;
        }
        if (values.min != null && values.max != null && values.min > values.max) {
          reject(field, 'The minimum must not exceed the maximum.');
        }
        if (Object.keys(values).length) state.ranges[field] = values;
      }
    }

    if (mode === 'works' && (TEXT.some(field => state[field]) || state.include.length || state.exclude.length
        || state.language || state.completion || state.singleChapter || Object.keys(state.ranges).length)) {
      reject('mode', 'Search criteria require Work Search or a tag scope.');
    }
    if (input.sort != null) {
      if (isRecord(input.sort) && SORT_FIELDS.includes(input.sort.by)
          && ['asc', 'desc'].includes(input.sort.direction ?? 'desc')) {
        state.sort = { by: input.sort.by, direction: input.sort.direction ?? 'desc' };
      } else reject('sort', 'Choose a supported sort field and direction.');
    }
    if (input.page != null) {
      const page = integer(input.page);
      if (page) state.page = page;
      else warnings.push({ field: 'page', code: 'invalid-page', message: 'Showing page 1 because the requested page is invalid.' });
    }
    return { state, errors, warnings };
  }

  function readTag(value) {
    const separator = value.indexOf(':');
    return separator === -1 ? null : { type: value.slice(0, separator), value: value.slice(separator + 1) };
  }

  function decodeDiscovery(search) {
    const params = new URLSearchParams(search);
    const errors = [];
    try { decodeURIComponent(search); }
    catch (_) { errors.push({ code: 'invalid-encoding', message: 'The discovery URL has invalid percent encoding.' }); }
    const raw = { mode: params.get('view'), include: [], exclude: [], ranges: {} };
    const seen = new Set();
    for (const [key, value] of params) {
      if (key === 'include' || key === 'exclude') {
        raw[key].push(readTag(value));
        continue;
      }
      if (!SCALARS.includes(key) && !rangeKeys.has(key)) {
        errors.push({ field: key, code: 'unknown-parameter', message: 'Unknown discovery URL parameter.' });
      } else if (seen.has(key)) {
        errors.push({ field: key, code: 'repeated-parameter', message: 'Only Include and Exclude parameters may be repeated.' });
      } else {
        if (rangeKeys.has(key)) {
          const [field, bound] = rangeKeys.get(key);
          (raw.ranges[field] ??= {})[bound] = value;
        } else if (key === 'tag') {
          raw.scope = readTag(value);
          if (!raw.scope) errors.push({ field: 'tag', code: 'invalid-tag', message: 'Use type:label for a tag scope.' });
        } else if (key === 'single') {
          raw.singleChapter = value === '1' ? true : value;
        } else if (key !== 'view' && key !== 'sort' && key !== 'dir') raw[key] = value;
      }
      seen.add(key);
    }
    if (params.has('sort') || params.has('dir')) raw.sort = { by: params.get('sort'), direction: params.get('dir') };
    const validated = validateState(raw);
    return { ...validated, errors: [...errors, ...validated.errors] };
  }

  function encodeUrl(input) {
    const { state, errors } = validateState(input);
    if (errors.length) throw new TypeError(errors[0].message);
    const params = new URLSearchParams();
    const tag = ({ type, value }) => `${type}:${value}`;
    if (state.mode !== 'works') params.set('view', state.mode);
    if (state.scope) params.set('tag', tag(state.scope));
    for (const field of TEXT) if (state[field]) params.set(field, state[field]);
    for (const field of ['include', 'exclude']) {
      for (const value of state[field]) params.append(field, tag(value));
    }
    if (state.language) params.set('language', state.language);
    if (state.completion) params.set('completion', state.completion);
    if (state.singleChapter) params.set('single', '1');
    for (const field of RANGE_FIELDS) {
      for (const bound of BOUNDS) {
        const value = state.ranges[field]?.[bound];
        if (value != null) params.set(`${field}.${bound}`, value);
      }
    }
    if (state.sort && (state.sort.by !== defaultSort(state.mode) || state.sort.direction !== 'desc')) {
      params.set('sort', state.sort.by);
      if (state.sort.direction !== 'desc') params.set('dir', state.sort.direction);
    }
    if (state.page > 1) params.set('page', state.page);
    const query = params.toString();
    return query ? `?${query}` : '';
  }

  function decodeUrl(search = '') {
    const params = new URLSearchParams(search);
    if (!params.has('fic')) {
      const edits = params.getAll('edit_search');
      if (params.get('view') === 'search' && edits.length === 1 && edits[0] === 'true') {
        // Keep the original encoding for validation of the discovery criteria.
        const criteria = search.replace(/^\?/, '').split('&')
          .filter(part => !new URLSearchParams(part).has('edit_search')).join('&');
        return { route: 'discovery', editing: true, ...decodeDiscovery(criteria) };
      }
      return { route: 'discovery', ...decodeDiscovery(search) };
    }
    const from = params.get('from');
    let returnQuery = '';
    if (from?.startsWith('?') && !from.includes('#')) {
      const decoded = decodeDiscovery(from);
      if (!decoded.errors.length) returnQuery = encodeUrl(decoded.state);
    }
    return { route: 'reader', workId: params.get('fic'), returnQuery };
  }

  function defaultSort(mode) {
    return mode === 'search' ? 'relevance' : 'revisedAt';
  }

  function resetFilters(state) {
    return validateState({ mode: state.mode, scope: state.scope }).state;
  }

  function changeCriteria(state, changes) {
    return { ...state, ...changes, page: 1 };
  }

  return { SORT_FIELDS, validateState, decodeUrl, encodeUrl, defaultSort, resetFilters, changeCriteria };
});
