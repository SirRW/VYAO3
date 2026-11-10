(function (discovery) {
  'use strict';

  const ui = discovery.forms;
  const { element, labelFor, input, select, choose, choiceList, help } = ui;
  const statLabels = { hits: 'Hits', kudos: 'Kudos', comments: 'Comments', bookmarks: 'Bookmarks' };
  const alpha = new Intl.Collator('en', { sensitivity: 'base' });

  function searchForm(engine, state) {
    const form = element('form', 'advanced-work-search');
    form.setAttribute('aria-label', 'Work Search');
    const session = ui.formSession(form, state);
    const catalog = engine.discover().facets;
    const tags = action => [...new Map(state[action].map(tag => {
      const resolved = engine.findTags(tag.value, tag.type)[0] ?? { ...tag, key: discovery.model.tagKey(tag.type, tag.value) };
      return [resolved.key, resolved];
    })).values()];
    const included = tags('include');
    const excluded = tags('exclude');
    const chosen = [];
    let rows;

    function section(title, submit = false) {
      const group = element('fieldset', 'criteria-fieldset');
      group.append(element('legend', '', title));
      if (submit) group.append(element('p', 'criteria-submit', ui.submitButton('Search')));
      rows = element('dl', 'advanced-rows');
      group.append(rows);
      form.append(group);
      return group;
    }

    function row(label, contents, hint) {
      const title = element('dt', '', label);
      if (hint) title.append(' ', help(hint));
      rows.append(title, element('dd', '', contents));
    }

    function field(name, label, hint) {
      const control = input(state[name]);
      row(labelFor(control, label), control, hint);
      session.read(name, control, draft => { draft[name] = control.value; });
    }

    function range(name, label, isDate = false) {
      const control = input(ui.formatRange(state.ranges[name], isDate), 200);
      row(labelFor(control, label), control, isDate ? ui.dateHelp : ui.numberHelp);
      session.read(name, control, draft => {
        const parsed = ui.parseRange(control.value, isDate);
        if (!parsed) return { field: name, message: label + '. ' + (isDate ? ui.dateHelp : ui.numberHelp) };
        ui.setRange(draft, name, parsed);
      });
    }

    function options(type) {
      const byKey = new Map(catalog[type].map(tag => [tag.key, tag]));
      for (const tag of included) if (tag.type === type) byKey.set(tag.key, tag);
      return [...byKey.values()].sort((a, b) => alpha.compare(a.value, b.value));
    }

    function checks(type, label) {
      const tags = options(type);
      if (!tags.length) return;
      const items = tags.map(tag => choose('checkbox', 'search-' + type, tag.value,
        included.some(item => item.key === tag.key), tag.value));
      const list = choiceList(items);
      list.setAttribute('aria-label', label);
      row(label, list);
      chosen.push(() => tags.filter((tag, index) => items[index].control.checked));
    }

    function picker(type, label, initial = included.filter(tag => tag.type === type)) {
      const component = discovery.tagInput(engine, { type, id: 'search-tags-' + (type ?? 'exclude'), initial });
      row(component.label(label), component.root);
      session.read(component.control.id, component.control, () => {
        const message = component.commit();
        if (message) return { field: component.control.id, message };
      });
      return component;
    }

    section('Work Info', true);
    field('q', 'Any Field', ui.textHelp);
    field('title', 'Title');
    field('creator', 'Creator');
    range('updatedAt', 'Date', true);
    range('publishedAt', 'Date Posted', true);
    if (state.ranges.completedAt) range('completedAt', 'Date Completed', true);
    const complete = ui.completions.map(([value, label]) => choose('radio', 'search-completion', value,
      value === (state.completion ?? ''), label));
    const completion = choiceList(complete);
    completion.setAttribute('aria-label', 'Completion status');
    row('Completion status', completion);
    session.read('completion', complete[0].control, draft => { draft.completion = complete.find(item => item.control.checked).control.value || null; });
    const single = element('input');
    single.type = 'checkbox';
    single.checked = state.singleChapter;
    row(labelFor(single, 'Single Chapter'), single);
    session.read('singleChapter', single, draft => { draft.singleChapter = single.checked; });
    range('wordCount', 'Word Count');
    const language = ui.languageChoices(engine, state.language);
    row(labelFor(language, 'Language'), language);
    session.read('language', language, draft => { draft.language = language.value || null; });

    section('Work Tags');
    chosen.push(picker('fandom', 'Fandoms').values);
    const ratings = options('rating');
    if (ratings.length) {
      const rating = select([['', ''], ...ratings.map(tag => [tag.key, tag.value])],
        included.find(tag => tag.type === 'rating')?.key ?? '');
      row(labelFor(rating, 'Rating'), rating);
      chosen.push(() => ratings.filter(tag => tag.key === rating.value));
    }
    checks('warning', 'Warnings');
    checks('category', 'Categories');
    chosen.push(picker('characters', 'Characters').values);
    chosen.push(picker('relationship', 'Relationships').values);
    const additional = picker('additionalTags', 'Additional Tags');
    chosen.push(additional.values);
    const exclude = excluded.length ? picker(undefined, 'Excluded Tags', excluded) : null;
    session.read('include', additional.control, draft => {
      draft.include = chosen.flatMap(read => read());
      draft.exclude = exclude?.values() ?? [];
    });

    const stats = Object.entries(statLabels).filter(([name]) => engine.availableSorts.includes(name) || state.ranges[name]);
    if (stats.length) {
      section('Work Stats');
      for (const [name, label] of stats) range(name, label);
    }
    const ordering = section('Search');
    const sort = ui.sortControls(engine, state);
    row(labelFor(sort.by, 'Sort by'), sort.by);
    row(labelFor(sort.direction, 'Sort direction'), sort.direction);
    session.read('sort', sort.by, sort.read);
    ordering.append(element('p', 'criteria-submit', ui.submitButton('Search')));
    return form;
  }

  discovery.searchForm = searchForm;
})(window.RadioAppleDiscovery);
