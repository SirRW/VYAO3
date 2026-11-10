(function (discovery) {
  'use strict';

  const number = new Intl.NumberFormat('en-US');
  const date = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'
  });
  const ratings = new Map([
    ['general audiences', ['general', 'G']], ['teen and up audiences', ['teen', 'T']],
    ['mature', ['mature', 'M']], ['explicit', ['explicit', 'E']], ['not rated', ['blank', '']]
  ]);
  const categories = new Map([
    ['gen', ['gen', '⊙']], ['m/m', ['slash', '♂']], ['f/f', ['femslash', '♀']],
    ['f/m', ['het', '⚥']], ['multi', ['multi', '']], ['other', ['other', '♅']]
  ]);
  const tagGroups = [
    ['warning', 'Warnings'], ['relationship', 'Relationships'],
    ['characters', 'Characters'], ['additionalTags', 'Additional tags']
  ];
  const noWarnings = 'no archive warnings apply';
  const optedOut = new Set(['creator chose not to use archive warnings', 'choose not to use archive warnings']);
  const normalize = discovery.model.normalizeText;

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.append(content);
    return node;
  }

  function link(href, label, className) {
    const anchor = element('a', className, label);
    anchor.href = href;
    return anchor;
  }

  function tagHref(type, value) {
    const input = { mode: 'tag', scope: { type, value } };
    if (discovery.state.validateState(input).errors.length) return null;
    return 'index.html' + discovery.state.encodeUrl(input);
  }

  function tagLink(type, value) {
    const href = tagHref(type, value);
    return href ? link(href, value, 'blurb-tag') : element('span', '', value);
  }

  function tagRun(type, values, target) {
    values.forEach((value, index) => {
      if (index) target.append(', ');
      target.append(tagLink(type, value));
    });
  }

  function warningSymbol(values) {
    if (!values?.length) return ['unknown', '–'];
    const names = values.map(normalize);
    if (names.every(name => name === noWarnings)) return ['blank', ''];
    if (names.every(name => name === noWarnings || optedOut.has(name))) return ['opt-out', '!?'];
    return ['warning', '!'];
  }

  function symbol(type, label, [style, glyph], href) {
    const text = element('span', 'browse-landmark', label);
    const mark = element('span', 'symbol-mark', glyph);
    mark.setAttribute('aria-hidden', 'true');
    const box = href ? link(href, text, 'blurb-symbol') : element('span', 'blurb-symbol', text);
    box.dataset.symbol = style;
    box.title = label;
    if (!href) {
      box.setAttribute('role', 'img');
      box.setAttribute('aria-label', label);
    }
    box.append(mark);
    return element('li', 'symbol-' + type, box);
  }

  function symbols(work) {
    const warning = work.warning ?? [];
    const category = work.category ?? [];
    const rating = work.rating ? ratings.get(normalize(work.rating)) : null;
    const categorySymbol = category.length > 1 ? categories.get('multi') : categories.get(normalize(category[0] ?? ''));
    const complete = work.completionStatus === 'complete';
    const list = element('ul', 'blurb-symbols');
    list.setAttribute('role', 'list');
    list.setAttribute('aria-label', 'Work metadata symbols');
    list.append(
      symbol('rating', 'Rating: ' + (work.rating ?? 'Unknown'), rating ?? ['unknown', '–'],
        work.rating && tagHref('rating', work.rating)),
      symbol('warning', 'Archive warnings: ' + (warning.join(', ') || 'Unknown'), warningSymbol(warning)),
      symbol('category', 'Category: ' + (category.join(', ') || 'Unknown'), categorySymbol ?? ['unknown', '–'],
        category.length === 1 && tagHref('category', category[0])),
      symbol('completion', complete ? 'Complete work' : work.completionStatus ? 'Work in progress' : 'Completion unknown',
        complete ? ['complete', '✓'] : work.completionStatus ? ['in-progress', '⊘'] : ['unknown', '–'])
    );
    return list;
  }

  function chapters(work, workUrl) {
    const { chaptersAvailable, chaptersPosted, chaptersTotal } = work;
    if (chaptersAvailable == null && chaptersPosted == null) return null;
    const display = document.createDocumentFragment();
    function localCount(count) {
      if (count === 1) return number.format(count);
      const latest = link(workUrl + '#chapter-' + count, number.format(count));
      latest.setAttribute('aria-label', 'Last available chapter, Chapter ' + count);
      return latest;
    }
    if (chaptersPosted != null) {
      display.append(chaptersPosted === chaptersAvailable ? localCount(chaptersPosted) : number.format(chaptersPosted),
        '/' + (chaptersTotal == null ? '?' : number.format(chaptersTotal)));
    }
    if (chaptersAvailable != null && chaptersAvailable !== chaptersPosted) {
      if (chaptersPosted != null) display.append(' (');
      display.append(localCount(chaptersAvailable), ' available');
      if (chaptersPosted != null) display.append(')');
    }
    return display;
  }

  function statistics(work, workUrl) {
    const stats = work.stats;
    const list = element('dl', 'blurb-stats');
    for (const [label, value] of [
      ['Language', work.language ?? work.languageCode], ['Words', work.wordCount], ['Chapters', chapters(work, workUrl)],
      ['Collections', work.collections?.length || null], ['Comments', stats?.comments || null],
      ['Kudos', stats?.kudos || null], ['Bookmarks', stats?.bookmarks || null], ['Hits', stats?.hits]
    ]) {
      if (value == null) continue;
      const item = element('div');
      const data = element('dd', '', typeof value === 'number' ? number.format(value) : value);
      if (label === 'Language' && work.languageCode) data.lang = work.languageCode;
      item.append(element('dt', '', label + ':'), data);
      list.append(item);
    }
    return list;
  }

  function renderWorkBlurb(work, returnQuery, headingLevel = 2) {
    const item = element('li', 'work-blurb');
    item.dataset.workId = work.id;
    const header = element('div', 'blurb-header');
    const params = new URLSearchParams({ fic: work.id });
    if (returnQuery) params.set('from', returnQuery);
    const workUrl = '?' + params;
    const title = element('h' + headingLevel, 'blurb-title', link(workUrl, work.title, 'blurb-work-link'));
    if (work.author) title.append(' by ', element('span', 'blurb-byline', work.author));
    header.append(title);
    if (work.fandom?.length) {
      const fandoms = element('p', 'blurb-fandoms', element('span', 'browse-landmark', 'Fandoms: '));
      tagRun('fandom', work.fandom, fandoms);
      header.append(fandoms);
    }
    if (work.category?.length > 1) {
      const group = element('p', 'blurb-categories', element('span', 'browse-landmark', 'Categories: '));
      tagRun('category', work.category, group);
      header.append(group);
    }
    header.append(symbols(work));
    const revised = work.updatedAt ?? work.completedAt ?? work.publishedAt;
    if (revised) {
      const time = element('time', 'blurb-date', date.format(new Date(revised + 'T00:00:00Z')));
      time.dateTime = revised;
      header.classList.add('has-date');
      header.append(time);
    }
    item.append(header);

    const tags = element('ul', 'blurb-tags');
    tags.setAttribute('role', 'list');
    tags.setAttribute('aria-label', 'Tags');
    for (const [type, label] of tagGroups) {
      for (const value of work[type] ?? []) {
        if (tags.childElementCount) tags.lastElementChild.append(', ');
        const tag = element('li', 'blurb-' + type, element('span', 'browse-landmark', label + ': '));
        const valueLink = tagLink(type, value);
        tag.append(type === 'warning' ? element('strong', '', valueLink) : valueLink);
        tags.append(tag);
      }
    }
    if (tags.childElementCount) item.append(tags);
    if (work.summary) {
      const summary = element('blockquote', 'blurb-summary');
      summary.setAttribute('aria-label', 'Summary');
      for (const paragraph of work.summary.split(/\r?\n(?:[ \t]*\r?\n)+/)) summary.append(element('p', '', paragraph));
      item.append(summary);
    }
    if (work.series?.length) {
      const series = element('ul', 'blurb-series');
      series.setAttribute('aria-label', 'Series');
      series.setAttribute('role', 'list');
      for (const { title, position } of work.series) {
        series.append(element('li', '', position ? 'Part ' + number.format(position) + ' of ' + title : title));
      }
      item.append(series);
    }
    const stats = statistics(work, workUrl);
    if (stats.childElementCount) item.append(stats);
    return item;
  }

  discovery.blurb = { element, link, tagLink, renderWorkBlurb };
})(window.RadioAppleDiscovery);
