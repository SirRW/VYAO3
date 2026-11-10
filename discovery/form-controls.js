(function (discovery) {
  'use strict';

  const { element, link } = discovery.blurb;
  const { encodeUrl, changeCriteria, validateState, defaultSort } = discovery.state;
  const { normalizeText, isoDate, integer } = discovery.model;
  const types = {
    rating: ['Rating', 'Ratings'], warning: ['Archive Warning', 'Archive Warnings'],
    category: ['Category', 'Categories'], fandom: ['Fandom', 'Fandoms'],
    characters: ['Character', 'Characters'], relationship: ['Relationship', 'Relationships'],
    additionalTags: ['Additional Tag', 'Additional Tags']
  };
  const sortNames = {
    relevance: 'Best Match', revisedAt: 'Date Updated', publishedAt: 'Date Posted',
    updatedAt: 'Recorded Update Date', completedAt: 'Date Completed', title: 'Title',
    creator: 'Author', wordCount: 'Word Count', hits: 'Hits', kudos: 'Kudos', comments: 'Comments', bookmarks: 'Bookmarks'
  };
  const completions = [
    ['', 'All works'], ['complete', 'Complete works only'], ['in-progress', 'Works in progress only']
  ];
  const textHelp = 'Use quotes for an exact phrase, AND or OR between terms, - to exclude, and * at the end of a word prefix.';
  const numberHelp = 'Enter a number, a range such as 1000–5000, or a comparison such as >1000.';
  const dateHelp = 'Use YYYY-MM-DD, a range with “to”, or a bound such as >=2024-01-01.';
  const bounds = { '=': 'eq', '>=': 'min', '<=': 'max', '>': 'gt', '<': 'lt' };
  const operators = Object.fromEntries(Object.entries(bounds).map(([operator, bound]) => [bound, operator]));
  const alphabet = new Intl.Collator('en', { sensitivity: 'base' });
  let nextId = 0;

  function labelFor(control, text) {
    control.id ||= 'discover-field-' + (++nextId);
    const label = element('label', '', text);
    label.htmlFor = control.id;
    return label;
  }

  function input(value = '', maxLength = 1024) {
    const control = element('input');
    control.type = 'text';
    control.value = value;
    control.maxLength = maxLength;
    control.autocomplete = 'off';
    return control;
  }

  function select(choices, selected) {
    const control = element('select');
    for (const [value, label] of choices) {
      const option = element('option', '', label);
      option.value = value;
      control.append(option);
    }
    control.value = selected;
    return control;
  }

  function choose(type, name, value, checked, text) {
    const control = element('input');
    Object.assign(control, { type, name, value, checked });
    const label = element('label', 'criteria-choice');
    const mark = element('span', 'criteria-indicator');
    mark.setAttribute('aria-hidden', 'true');
    label.append(control, mark, element('span', 'criteria-choice-text', text));
    return { control, label };
  }

  function choiceList(items) {
    const list = element('ul', 'criteria-choices');
    list.setAttribute('role', 'list');
    for (const { label } of items) list.append(element('li', '', label));
    return list;
  }

  function submitButton(label) {
    const button = element('button', 'ao3-button', label);
    button.type = 'submit';
    return button;
  }

  function help(text) {
    const details = element('details', 'criteria-help');
    const toggle = element('summary', '', '?');
    toggle.setAttribute('aria-label', 'Show field help');
    details.append(toggle, element('p', '', text));
    return details;
  }

  function languageChoices(engine, value) {
    const languages = [...engine.languages].sort((a, b) => alphabet.compare(a.label, b.label));
    const selected = value && languages.find(language => [language.key, normalizeText(language.label)].includes(normalizeText(value)));
    const choices = [['', ''], ...languages.map(language => [language.value, language.label])];
    if (value && !selected) choices.push([value, value]);
    return select(choices, selected?.value ?? value ?? '');
  }

  function sortControls(engine, state) {
    const fallback = defaultSort(state.mode);
    const sort = state.sort ?? { by: fallback, direction: 'desc' };
    const fields = new Set([...engine.availableSorts, fallback, sort.by]);
    const choices = Object.entries(sortNames).filter(([field]) => fields.has(field)).map(([field, label]) => {
      if (engine.availableSorts.includes(field)) return [field, label];
      return [field, field === fallback ? 'Default Order' : label + ' (Unavailable)'];
    });
    const by = select(choices, sort.by);
    for (const option of by.options) if (!engine.availableSorts.includes(option.value) && option.value !== fallback) option.disabled = true;
    const direction = select([['asc', 'Ascending'], ['desc', 'Descending']], sort.direction);
    return { by, direction, read: draft => { draft.sort = { by: by.value, direction: direction.value }; } };
  }

  function formatRange(range = {}, isDate) {
    const { eq, min, max, gt, lt } = range;
    const entries = Object.entries(range);
    if (entries.length === 1 && eq != null) return String(eq);
    if (entries.length === 2 && min != null && max != null) return min + (isDate ? ' to ' : '-') + max;
    if (!isDate && entries.length === 1 && (gt != null || lt != null)) return gt != null ? '>' + gt : '<' + lt;
    return entries.map(([bound, value]) => operators[bound] + value).join('; ');
  }

  function parseRange(raw, isDate) {
    const text = raw.trim();
    if (!text) return {};
    if (isDate) {
      if (isoDate(text)) return { eq: text };
      const interval = /^(\S+)\s+to\s+(\S+)$/i.exec(text);
      if (interval && isoDate(interval[1]) && isoDate(interval[2])) return { min: interval[1], max: interval[2] };
    } else {
      const parsed = discovery.query.parseNumberRange(text.replace(/–/g, '-'));
      if (!parsed.errors.length) return parsed.range;
    }
    const range = {};
    for (const clause of text.split(';')) {
      const pair = /^(>=|<=|=|>|<)\s*(\S+)$/.exec(clause.trim());
      const bound = bounds[pair?.[1]];
      const value = !pair ? null : isDate ? isoDate(pair[2]) : integer(pair[2]);
      if (value == null || bound in range || (isDate && ['gt', 'lt'].includes(bound))) return null;
      range[bound] = value;
    }
    return range;
  }

  function setRange(draft, field, range) {
    if (Object.keys(range).length) draft.ranges[field] = range;
    else delete draft.ranges[field];
  }

  function formSession(form, state) {
    const controls = new Map();
    const readers = [];
    const summary = element('p', 'criteria-error');
    summary.setAttribute('role', 'alert');
    summary.hidden = true;
    form.prepend(summary);
    form.noValidate = true;
    let invalid = [];
    const watch = (field, control) => controls.set(field, control);

    function read(field, control, reader) {
      watch(field, control);
      readers.push(reader);
    }

    function fieldError({ field, message, offset }) {
      const control = controls.get(field) ?? controls.get(field?.split('.')[0]);
      if (!control || invalid.some(item => item.control === control)) return;
      control.closest('details')?.setAttribute('open', '');
      const hint = element('p', 'criteria-error', message + (offset == null ? '' : ' Check character ' + (offset + 1) + '.'));
      hint.id = 'discover-error-' + (++nextId);
      const describedBy = control.getAttribute('aria-describedby');
      control.setAttribute('aria-invalid', 'true');
      control.setAttribute('aria-describedby', [describedBy, hint.id].filter(Boolean).join(' '));
      (control.closest('.tag-picker') ?? control).after(hint);
      invalid.push({ control, hint, describedBy });
    }

    function validate(draft) {
      const checked = validateState(draft);
      for (const field of ['q', 'title', 'creator']) {
        for (const error of discovery.query.parseQuery(checked.state[field]).errors) checked.errors.push({ ...error, field });
      }
      return checked;
    }

    form.addEventListener('submit', event => {
      event.preventDefault();
      for (const { control, hint, describedBy } of invalid) {
        control.removeAttribute('aria-invalid');
        if (describedBy) control.setAttribute('aria-describedby', describedBy);
        else control.removeAttribute('aria-describedby');
        hint.remove();
      }
      invalid = [];
      const draft = changeCriteria(state, { ranges: { ...state.ranges } });
      const errors = readers.map(reader => reader(draft)).flat().filter(Boolean);
      const checked = validate(draft);
      errors.push(...checked.errors);
      if (!errors.length) {
        form.dataset.submitted = '';
        location.assign('index.html' + encodeUrl(checked.state));
        return;
      }
      for (const error of errors) fieldError(error);
      summary.textContent = errors[0].message;
      summary.hidden = false;
      (invalid[0]?.control ?? summary).focus();
    });
    summary.tabIndex = -1;
    return { read, watch };
  }

  function editHref(state) {
    return 'index.html' + encodeUrl(changeCriteria(state, { mode: 'search', scope: null })) + '&edit_search=true';
  }

  discovery.forms = { element, link, types, completions, textHelp, numberHelp, dateHelp,
    labelFor, input, select, choose, choiceList, submitButton, help, languageChoices, sortControls,
    formSession, formatRange, parseRange, setRange, editHref };
})(window.RadioAppleDiscovery);
