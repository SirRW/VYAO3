(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.RadioAppleDiscovery ||= {}).model = factory();
})(globalThis, function () {
  'use strict';

  const TAG_TYPES = Object.freeze(['rating', 'warning', 'category', 'fandom', 'characters', 'relationship', 'additionalTags']);
  const STAT_FIELDS = Object.freeze(['hits', 'kudos', 'comments', 'bookmarks']);
  const DATES = Object.freeze(['publishedAt', 'updatedAt', 'completedAt']);
  const RANGE_FIELDS = Object.freeze(['wordCount', ...STAT_FIELDS, ...DATES]);
  const LANGUAGES = new Map(Object.entries({
    english: 'en', español: 'es', français: 'fr', deutsch: 'de', italiano: 'it',
    'português brasileiro': 'pt-br', русский: 'ru', '中文-普通话 國語': 'zh', 日本語: 'ja'
  }));
  const SOURCE_URL = /^https?:\/\/(?:www\.)?(?:archiveofourown\.org|ao3\.org)\/works\/([1-9][0-9]*)$|^https?:\/\/(?:secure\.ao3\.org|archive\.transformativeworks\.org)\/works\/([1-9][0-9]*)$/;

  function normalizeText(value) {
    return value.normalize('NFC').toLowerCase().normalize('NFC').trim().replace(/\s+/gu, ' ');
  }

  function compareText(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function display(value) {
    return typeof value === 'string' && value.trim() ? value : null;
  }

  function integer(value) {
    if (typeof value === 'string' && /^[0-9]+$/.test(value)) value = Number(value);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function isoDate(value) {
    if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : null;
  }

  function workId(value) {
    return typeof value === 'string' && /^[a-z0-9-]+$/.test(value)
      && !/^(?:ao3-[0-9]+|local-[a-f0-9]{20})--?[a-f0-9]{64}$/.test(value);
  }

  function tagKey(type, value) {
    return `${type}:${normalizeText(value)}`;
  }

  function list(value, legacy = false) {
    if (Array.isArray(value)) return value.filter(item => display(item) !== null);
    if (legacy && display(value)) return value.split(/,\s+/u).map(item => item.trim()).filter(Boolean);
    return null;
  }

  function records(value, field) {
    return Array.isArray(value) ? value.filter(item => isRecord(item) && display(item[field])) : null;
  }

  function positive(value) {
    return integer(value) || null;
  }

  function sourceInfo(source) {
    if (!isRecord(source) || source.archive !== 'ao3' || typeof source.url !== 'string') return null;
    const match = SOURCE_URL.exec(source.url);
    if (!match || (match[1] || match[2]) !== String(source.workId)) return null;
    return { archive: 'ao3', workId: String(source.workId), url: source.url };
  }

  function normalizeWork(raw) {
    if (!isRecord(raw) || !workId(raw.id) || !display(raw.title)) return null;
    const version = raw.schemaVersion ?? 1;
    if (version !== 1 && version !== 2) return null;

    const creators = records(raw.creators, 'name')?.map(({ name }) => ({ name })) ?? null;
    const series = records(raw.series, 'title')?.map(({ title, position }) => ({ title, position: positive(position) })) ?? null;
    const language = display(raw.language);
    const code = display(raw.languageCode);
    const languageCode = code && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(code)
      ? code.toLowerCase() : LANGUAGES.get(normalizeText(language ?? '')) ?? null;
    const chaptersPosted = positive(raw.chaptersPosted);
    const chaptersTotal = positive(raw.chaptersTotal);
    let completionStatus = ['complete', 'in-progress'].includes(raw.completionStatus) ? raw.completionStatus : null;
    if (!completionStatus && chaptersPosted !== null) {
      if (chaptersPosted === chaptersTotal) completionStatus = 'complete';
      else if ((chaptersTotal !== null && chaptersPosted < chaptersTotal) || raw.chaptersTotal === '?') completionStatus = 'in-progress';
    }
    const wordCount = integer(raw.wordCount);
    const stats = isRecord(raw.stats) ? Object.fromEntries(STAT_FIELDS.map(field => [field, integer(raw.stats[field])])) : null;
    if (stats) stats.asOf = isoDate(raw.stats.asOf);

    return {
      id: raw.id, schemaVersion: version, title: raw.title,
      author: display(raw.author) ?? creators?.map(creator => creator.name).join(', ') ?? '',
      summary: display(raw.summary) ?? '', creators, series, rating: display(raw.rating),
      ...Object.fromEntries(TAG_TYPES.slice(1).map(type => [type, list(raw[type], version === 1)])),
      collections: list(raw.collections, version === 1), language, languageCode,
      wordCount, wordCountSource: wordCount !== null && ['archive', 'derived'].includes(raw.wordCountSource) ? raw.wordCountSource : null,
      chaptersAvailable: positive(raw.chaptersAvailable), chaptersPosted, chaptersTotal, completionStatus,
      ...Object.fromEntries(DATES.map(field => [field, isoDate(raw[field])])),
      stats, source: sourceInfo(raw.source)
    };
  }

  function normalizeCatalog(rows) {
    const works = [];
    const issues = [];
    const ids = new Set();
    rows.forEach((raw, index) => {
      const work = normalizeWork(raw);
      if (!work) issues.push({ code: 'invalid-work', index });
      else if (ids.has(work.id)) issues.push({ code: 'duplicate-work-id', index });
      else {
        ids.add(work.id);
        works.push(work);
      }
    });
    return { works, issues };
  }

  return { TAG_TYPES, STAT_FIELDS, DATES, RANGE_FIELDS, normalizeText, compareText, isRecord,
    integer, isoDate, workId, tagKey, normalizeWork, normalizeCatalog };
});
