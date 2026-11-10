(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js'));
  else root.RadioAppleDiscovery.tags = factory(root.RadioAppleDiscovery.model);
})(globalThis, function (model) {
  'use strict';

  const { TAG_TYPES, normalizeText, compareText, tagKey } = model;
  function createTagGraph(entries = []) {
    const tags = new Map();
    const aliases = new Map();
    const parentKeys = new Map();
    const ancestors = new Map();

    function register(type, value) {
      const key = tagKey(type, value);
      if (!tags.has(key)) tags.set(key, { key, type, value, aliases: [] });
      return tags.get(key);
    }

    function checkedKey(type, value) {
      if (!TAG_TYPES.includes(type) || typeof value !== 'string' || !normalizeText(value)) {
        throw new TypeError('Tag relationships require a supported type and a nonempty label.');
      }
      return tagKey(type, value);
    }

    for (const { type, canonical, aliases: names = [], parents = [] } of entries) {
      const key = checkedKey(type, canonical);
      if (tags.has(key)) throw new TypeError(`Repeated canonical tag ${key}`);
      const tag = register(type, canonical);
      for (const name of names) {
        const alias = checkedKey(type, name);
        if (alias === key) continue;
        if (aliases.has(alias)) throw new TypeError(`Repeated tag alias ${alias}`);
        aliases.set(alias, key);
        tag.aliases.push(name);
      }
      parentKeys.set(key, parents.map(parent => checkedKey(type, parent)));
    }
    for (const alias of aliases.keys()) {
      if (tags.has(alias)) throw new TypeError(`Alias is also a canonical tag ${alias}`);
    }

    function lineage(key, visiting = new Set()) {
      if (ancestors.has(key)) return ancestors.get(key);
      if (visiting.has(key)) throw new TypeError(`Tag hierarchy contains a cycle at ${key}`);
      if (!tags.has(key)) throw new TypeError(`Unregistered parent tag ${key}`);
      visiting.add(key);
      const parents = new Set();
      for (const parent of parentKeys.get(key)) {
        parents.add(parent);
        for (const ancestor of lineage(parent, visiting)) parents.add(ancestor);
      }
      visiting.delete(key);
      ancestors.set(key, parents);
      return parents;
    }
    for (const key of parentKeys.keys()) lineage(key);

    function resolve({ type, value }) {
      const original = tagKey(type, value);
      const key = aliases.get(original) ?? original;
      return tags.get(key) ?? { key, type, value, aliases: [] };
    }

    function index(work) {
      const direct = new Set();
      const matching = new Set();
      for (const type of TAG_TYPES) {
        const values = type === 'rating' ? (work.rating ? [work.rating] : []) : (work[type] ?? []);
        for (const value of values) {
          const tag = resolve({ type, value });
          register(tag.type, tag.value);
          direct.add(tag.key);
          matching.add(tag.key);
          for (const parent of ancestors.get(tag.key) ?? []) matching.add(parent);
        }
      }
      return { direct, matching };
    }

    function suggest(input, { type, limit = 10 } = {}) {
      const query = normalizeText(input);
      const results = [];
      for (const tag of tags.values()) {
        if (type && tag.type !== type) continue;
        let best = null;
        for (const name of [tag.value, ...tag.aliases]) {
          const value = normalizeText(name);
          if (!value.includes(query)) continue;
          const rank = value === query ? 0 : value.startsWith(query) ? 1 : 2;
          if (!best || rank < best.rank) best = { rank, matchedValue: name };
        }
        if (best) results.push({ ...tag, aliases: [...tag.aliases], ...best });
      }
      results.sort((a, b) => a.rank - b.rank || compareText(a.key, b.key));
      return results.slice(0, limit).map(({ rank, ...tag }) => tag);
    }

    return { resolve, index, suggest, get: key => tags.get(key) };
  }

  return { createTagGraph };
});
