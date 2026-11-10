(function (discovery) {
  'use strict';

  const ui = discovery.forms;
  const { element, labelFor, input, choose, help, types } = ui;
  const narrow = '(max-width: 42em)';
  const count = new Intl.NumberFormat('en-US');

  function accordion(label, open = false) {
    const details = element('details', 'filter-accordion');
    const content = element('div', 'filter-options');
    details.open = open;
    details.append(element('summary', '', label), content);
    return { details, content };
  }

  function mobilePanel(panel, trigger, closeButton) {
    const media = matchMedia(narrow);
    const abort = new AbortController();
    const options = { signal: abort.signal };
    const shell = document.getElementById('top');
    const root = document.documentElement;
    const backdrop = element('button', 'filter-backdrop');
    backdrop.type = 'button';
    backdrop.tabIndex = -1;
    backdrop.setAttribute('aria-hidden', 'true');
    panel.prepend(backdrop);
    const outside = [];

    function close(restore = true) {
      if (!root.hasAttribute('data-filters-open')) return;
      root.removeAttribute('data-filters-open');
      panel.removeAttribute('role');
      panel.removeAttribute('aria-modal');
      trigger.setAttribute('aria-expanded', 'false');
      for (const node of outside.splice(0)) node.inert = false;
      if (restore && media.matches) trigger.focus({ preventScroll: true });
    }

    trigger.addEventListener('click', () => {
      if (!media.matches) return;
      for (let node = panel; node !== shell; node = node.parentElement) {
        for (const sibling of node.parentElement.children) {
          if (sibling === node || sibling.inert) continue;
          sibling.inert = true;
          outside.push(sibling);
        }
      }
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      root.setAttribute('data-filters-open', '');
      trigger.setAttribute('aria-expanded', 'true');
      panel.querySelector('form').scrollTop = 0;
      panel.querySelector('button[type="submit"]').focus({ preventScroll: true });
    }, options);
    panel.addEventListener('keydown', event => {
      if (event.defaultPrevented || !root.hasAttribute('data-filters-open')) return;
      if (event.key === 'Escape') {
        close();
        event.preventDefault();
      }
      if (event.key !== 'Tab') return;
      const focusable = [...panel.querySelectorAll('a[href], button, input, select, summary')]
        .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length
          && !node.closest('details:not([open]) > :not(summary)'));
      const edge = event.shiftKey ? focusable[0] : focusable.at(-1);
      if (document.activeElement === edge) {
        event.preventDefault();
        (event.shiftKey ? focusable.at(-1) : focusable[0]).focus();
      }
    }, options);
    closeButton.addEventListener('click', () => close(), options);
    backdrop.addEventListener('click', () => close(), options);
    media.addEventListener('change', () => close(false), options);
    window.addEventListener('pagehide', () => close(false), options);
    return () => {
      close(false);
      abort.abort();
    };
  }

  function filterForm(engine, result, mount) {
    const state = result.state;
    const form = element('form', 'tag-filter-form');
    form.setAttribute('aria-label', 'Sort and Filter');
    const session = ui.formSession(form, state);
    const group = element('fieldset', 'criteria-fieldset filter-fieldset');
    group.append(element('legend', '', 'Filter results:'));
    const closeButton = element('button', 'ao3-button filter-close', 'Close Filters');
    closeButton.type = 'button';
    form.append(closeButton, group);
    group.append(element('p', 'criteria-submit', ui.submitButton('Sort and Filter')));

    function field(parent, control, title, hint) {
      const row = element('div', 'filter-field', labelFor(control, title));
      if (hint) row.append(' ', help(hint));
      row.append(control);
      parent.append(row);
    }

    const sort = ui.sortControls(engine, state);
    field(group, sort.by, 'Sort by');
    field(group, sort.direction, 'Sort direction');
    session.read('sort', sort.by, sort.read);

    for (const action of ['include', 'exclude']) {
      const title = action === 'include' ? 'Include' : 'Exclude';
      const section = element('section', 'filter-section filter-' + action);
      const heading = element('h3', '', title);
      heading.append(' ', help(action === 'include' ? 'A work must match every included tag. Choose up to one rating.'
        : 'A work is removed if it matches any excluded tag.'));
      section.append(heading);
      const checkedKey = action === 'include' ? 'included' : 'excluded';
      const choices = new Map();
      const groups = new Map();
      for (const [type, [, plural]] of Object.entries(types)) {
        const facets = result.facets[type];
        const popular = facets.filter(tag => tag.count > 0 && !tag.inScope && (action !== 'include' || !tag.excluded)).slice(0, 10);
        const visible = new Map([...popular, ...facets.filter(tag => tag[checkedKey])].map(tag => [tag.key, tag]));
        const label = document.createDocumentFragment();
        label.append(element('span', 'browse-landmark', title + ' '), plural);
        const entry = accordion(label, [...visible.values()].some(tag => tag[checkedKey]));
        const list = element('ul', 'criteria-choices');
        list.setAttribute('role', 'list');
        const empty = element('p', 'filter-empty', 'No matching tags.');
        const radio = type === 'rating' && action === 'include';
        if (radio) {
          const any = choose('radio', 'include-rating', '', !state.include.some(tag => tag.type === 'rating'), 'Any rating');
          list.append(element('li', '', any.label));
        }

        function add(tag, selected, directCount) {
          const item = choose(radio ? 'radio' : 'checkbox', action + '-' + type, tag.value, selected,
            tag.value + (directCount == null ? '' : ' (' + count.format(directCount) + ')'));
          list.append(element('li', '', item.label));
          choices.set(tag.key, { tag, control: item.control, details: entry.details });
          empty.hidden = true;
          list.hidden = false;
        }

        for (const tag of visible.values()) add(tag, tag[checkedKey], tag.count);
        empty.hidden = visible.size > 0;
        list.hidden = !visible.size;
        entry.content.append(empty, list);
        groups.set(type, { add, details: entry.details });
        section.append(entry.details);
      }

      const picker = discovery.tagInput(engine, {
        id: 'filter-other-' + action,
        onSelect(tag) {
          const existing = choices.get(tag.key);
          if (existing) {
            existing.control.checked = true;
            existing.details.open = true;
            return true;
          }
          if (action === 'include' && tag.type === 'rating') {
            const group = groups.get('rating');
            group.add(tag, true, result.facets.rating.find(facet => facet.key === tag.key)?.count ?? 0);
            group.details.open = true;
            return true;
          }
          return false;
        }
      });
      const fieldName = 'Other tags to ' + action;
      section.append(element('p', 'filter-other-label', picker.label(fieldName)), picker.root);
      group.append(section);
      session.read(action, picker.control, draft => {
        const message = picker.commit();
        if (message) return { field: action, message };
        draft[action] = [...choices.values()].filter(item => item.control.checked).map(item => item.tag).concat(picker.values());
      });
    }

    const more = element('section', 'filter-section');
    more.append(element('h3', '', 'More Options'));
    const completion = accordion('Completion Status', Boolean(state.completion));
    const complete = ui.completions.map(([value, label]) => choose('radio', 'filter-completion', value,
      value === (state.completion ?? ''), label));
    completion.content.append(ui.choiceList(complete));
    more.append(completion.details);
    session.read('completion', complete[0].control, draft => {
      draft.completion = complete.find(item => item.control.checked).control.value || null;
    });

    function interval(name, title, date = false) {
      const stored = state.ranges[name] ?? {};
      const entry = accordion(title, Object.keys(stored).length > 0);
      const lower = input(stored.min ?? stored.eq ?? (stored.gt == null ? '' : '>' + stored.gt), 32);
      const upper = input(stored.max ?? stored.eq ?? (stored.lt == null ? '' : '<' + stored.lt), 32);
      const starting = [lower.value, upper.value];
      lower.setAttribute('aria-label', title + ' From');
      upper.setAttribute('aria-label', title + ' To');
      if (date) {
        lower.placeholder = upper.placeholder = 'YYYY-MM-DD';
      }
      field(entry.content, lower, 'From');
      field(entry.content, upper, 'To');
      more.append(entry.details);
      session.watch(name + '.max', upper);
      session.watch(name + '.lt', upper);
      session.read(name, lower, draft => {
        if (starting[0] === lower.value && starting[1] === upper.value) return;
        const range = {};
        for (const [index, control] of [lower, upper].entries()) {
          const raw = control.value.trim();
          if (!raw) continue;
          const inclusive = index ? 'max' : 'min';
          const exclusive = index ? 'lt' : 'gt';
          const parsed = ui.parseRange(raw, date);
          if (parsed?.eq != null) range[inclusive] = parsed.eq;
          else if (!date && parsed?.[exclusive] != null && Object.keys(parsed).length === 1) range[exclusive] = parsed[exclusive];
          else return { field: name + '.' + inclusive, message: title + (date ? ' requires dates in YYYY-MM-DD format.'
            : ' requires a nonnegative whole number for each bound.') };
        }
        ui.setRange(draft, name, range);
      });
    }
    interval('wordCount', 'Word Count');
    interval('updatedAt', 'Date Updated', true);
    const query = input(state.q);
    field(more, query, 'Search within results', ui.textHelp);
    session.read('q', query, draft => { draft.q = query.value; });
    const language = ui.languageChoices(engine, state.language);
    field(more, language, 'Language');
    session.read('language', language, draft => { draft.language = language.value || null; });
    group.append(more, element('p', 'criteria-submit', ui.submitButton('Sort and Filter')));
    const clear = ui.link('index.html' + discovery.state.encodeUrl(discovery.state.resetFilters(state)), 'Clear Filters');
    group.append(element('p', 'filter-clear', clear));

    const trigger = element('button', 'ao3-button filter-trigger', 'Filters');
    trigger.type = 'button';
    trigger.setAttribute('aria-controls', mount.id);
    trigger.setAttribute('aria-expanded', 'false');
    mount.setAttribute('aria-label', 'Sort and Filter');
    mount.replaceChildren(form);
    mount.hidden = false;
    return { trigger, dispose: mobilePanel(mount, trigger, closeButton) };
  }

  discovery.filterForm = filterForm;
})(window.RadioAppleDiscovery);
