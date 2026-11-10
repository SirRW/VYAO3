(function (discovery) {
  'use strict';

  const { element, input, labelFor, types } = discovery.forms;
  const limit = 10;

  function tagInput(engine, { type, id, initial = [], onSelect } = {}) {
    const root = element('div', 'tag-picker');
    const box = element('div', 'tag-picker-box');
    const tokens = element('ul', 'tag-tokens');
    tokens.setAttribute('role', 'list');
    tokens.setAttribute('aria-label', 'Selected tags');
    const control = input('', 300);
    control.id = id;
    control.spellcheck = false;
    control.setAttribute('role', 'combobox');
    control.setAttribute('aria-autocomplete', 'list');
    control.setAttribute('aria-expanded', 'false');
    const list = element('ul', 'tag-suggestions');
    list.id = id + '-suggestions';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Matching tags');
    control.setAttribute('aria-controls', list.id);
    const note = element('p', 'tag-feedback');
    note.setAttribute('role', 'status');
    note.id = id + '-feedback';
    control.setAttribute('aria-describedby', note.id);
    box.append(tokens, control);
    root.append(box, list, note);
    const selected = new Map();
    let suggestions = [];
    let active = -1;
    let timer;

    function describe(tag) {
      return tag.value + (type ? '' : ' (' + types[tag.type][0] + ')');
    }

    function close() {
      clearTimeout(timer);
      list.hidden = true;
      control.setAttribute('aria-expanded', 'false');
      control.removeAttribute('aria-activedescendant');
      active = -1;
    }

    function drawTokens() {
      tokens.replaceChildren();
      for (const [key, tag] of selected) {
        const remove = element('button', 'tag-remove', '×');
        remove.type = 'button';
        remove.setAttribute('aria-label', 'Remove ' + describe(tag));
        remove.addEventListener('click', () => {
          selected.delete(key);
          drawTokens();
          control.focus();
        });
        const token = element('li', 'tag-token', element('span', '', describe(tag)));
        token.append(remove);
        tokens.append(token);
      }
      tokens.hidden = !selected.size;
    }

    function add(tag) {
      if (!onSelect?.(tag)) selected.set(tag.key, tag);
      drawTokens();
      control.value = '';
      note.textContent = '';
      close();
    }

    function commit() {
      const value = control.value.trim();
      if (!value) return null;
      const exact = engine.findTags(value, type);
      if (exact.length !== 1) {
        return exact.length ? 'That name is used for several tag types. Choose the intended suggestion.'
          : 'No exact local tag matches. Choose a suggestion or remove this entry.';
      }
      add(exact[0]);
      return null;
    }

    function refresh() {
      const text = control.value.trim();
      if (!text) {
        close();
        return;
      }
      suggestions = engine.suggestTags(text, { type, limit }).filter(tag => !selected.has(tag.key));
      list.replaceChildren();
      for (const [index, tag] of suggestions.entries()) {
        const option = element('li', '', describe(tag));
        option.id = list.id + '-' + index;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        if (tag.matchedValue !== tag.value) option.append(element('small', '', ' — alias: ' + tag.matchedValue));
        option.addEventListener('mousedown', event => event.preventDefault());
        option.addEventListener('click', () => {
          add(tag);
          control.focus();
        });
        list.append(option);
      }
      if (!suggestions.length) {
        close();
        note.textContent = 'No further matching local tags.';
        return;
      }
      note.textContent = suggestions.length + (suggestions.length === 1 ? ' suggestion' : ' suggestions');
      list.hidden = false;
      control.setAttribute('aria-expanded', 'true');
    }

    control.addEventListener('input', event => {
      close();
      note.textContent = '';
      if (!event.isComposing) timer = setTimeout(refresh, 90);
    });
    control.addEventListener('compositionend', () => {
      close();
      timer = setTimeout(refresh, 90);
    });
    root.addEventListener('focusout', event => {
      if (!root.contains(event.relatedTarget)) close();
    });
    control.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'Escape' && !list.hidden) {
        close();
        note.textContent = '';
        event.preventDefault();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (list.hidden) refresh();
        if (list.hidden) return;
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        if (active >= 0) list.children[active].setAttribute('aria-selected', 'false');
        active = active < 0 ? (direction > 0 ? 0 : suggestions.length - 1)
          : (active + direction + suggestions.length) % suggestions.length;
        const option = list.children[active];
        option.setAttribute('aria-selected', 'true');
        control.setAttribute('aria-activedescendant', option.id);
        option.scrollIntoView({ block: 'nearest' });
        event.preventDefault();
      } else if (event.key === 'Enter' && control.value.trim()) {
        if (active >= 0) add(suggestions[active]);
        else note.textContent = commit() ?? '';
        event.preventDefault();
      }
    });

    for (const tag of initial) selected.set(tag.key, tag);
    drawTokens();
    close();
    return { root, control, label: text => labelFor(control, text), commit, values: () => [...selected.values()] };
  }

  discovery.tagInput = tagInput;
})(window.RadioAppleDiscovery);
