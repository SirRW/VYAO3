(function () {
  'use strict';
  let story;
  const $ = (id) => document.getElementById(id);
  const storageKey = 'radioapple-reader:settings:v2';
  const chapterLinks = document.querySelectorAll('[data-chapter-step]');
  const settings = { fontSize: 16 };

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    const previous = saved ?? JSON.parse(localStorage.getItem('radioapple-reader:settings:v1'));
    settings.fontSize = previous?.fontSize;
  } catch (_) {}
  settings.fontSize = Math.min(23, Math.max(13, Number(settings.fontSize) || 16));
  function updateSettings() {
    document.documentElement.style.setProperty('--reader-font-size', `${settings.fontSize}px`);
    $('font-decrease').disabled = settings.fontSize <= 13;
    $('font-increase').disabled = settings.fontSize >= 23;
    try { localStorage.setItem(storageKey, JSON.stringify(settings)); } catch (_) {}
  }

  function text(id, value) {
    $(id).textContent = value;
  }

  function chapterTitle(chapter, index) {
    const label = `Chapter ${index + 1}`;
    return chapter.title && chapter.title !== label ? `${label}: ${chapter.title}` : label;
  }

  function parseChapters(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const proseTags = new Set(['P', 'BR', 'HR', 'EM', 'I', 'STRONG', 'B', 'DEL', 'S', 'U',
      'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'CODE', 'PRE', 'SUB', 'SUP']);
    for (const element of template.content.querySelectorAll('*')) {
      if (['SCRIPT', 'STYLE', 'TEMPLATE', 'SVG', 'MATH'].includes(element.nodeName)) {
        element.remove();
      } else if (proseTags.has(element.nodeName)) {
        for (const name of element.getAttributeNames()) element.removeAttribute(name);
      } else {
        element.replaceWith(...element.childNodes);
      }
    }

    const chapters = [];
    const parts = new Map([['notes', 'notes'], ['text', 'body'], ['end notes', 'endNotes']]);
    function newChapter(title = '') {
      return {
        title,
        body: document.createDocumentFragment(),
        notes: document.createDocumentFragment(),
        endNotes: document.createDocumentFragment()
      };
    }
    let chapter = newChapter();
    let part = 'body';
    for (const node of [...template.content.childNodes]) {
      const marker = node.nodeName === 'H2'
        && /^Chapter\s+\d+(?:\s*:\s*(.+))?$/i.exec(node.textContent.trim());
      if (marker) {
        if (chapter.body.textContent.trim()) chapters.push(chapter);
        chapter = newChapter(marker[1]);
        part = 'body';
      } else if (node.nodeName === 'H3' && parts.has(node.textContent.trim().toLowerCase())) {
        part = parts.get(node.textContent.trim().toLowerCase());
      } else {
        chapter[part].append(node);
      }
    }
    if (chapter.body.textContent.trim()) chapters.push(chapter);
    return chapters;
  }

  function populateMetadata() {
    text('work-title', story.title);
    text('work-author', story.author);
    $('work-author').hidden = !story.author;
    text('work-summary', story.summary);
    for (const field of ['rating', 'category', 'warning', 'fandom', 'relationship', 'characters', 'additionalTags', 'language']) {
      const value = story[field];
      const cell = $(field === 'additionalTags' ? 'meta-additional' : `meta-${field}`);
      cell.textContent = Array.isArray(value) ? value.join(', ') : value ?? '';
      cell.hidden = cell.previousElementSibling.hidden = !cell.textContent.trim();
    }
    text('meta-chapters', `${story.chapters.length}/?`);
    const words = story.chapters.reduce((total, chapter) => {
      return total + (chapter.body.textContent.match(/\S+/g)?.length ?? 0);
    }, 0);
    text('meta-words', words.toLocaleString('en-US'));

    const list = $('chapter-list');
    story.chapters.forEach((chapter, index) => {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = `#chapter-${index + 1}`;
      link.textContent = chapterTitle(chapter, index);
      li.appendChild(link);
      list.appendChild(li);
    });
  }

  function renderNotes(id, notes) {
    const section = $(id);
    const block = $(`${id}-content`);
    block.replaceChildren(notes.cloneNode(true));
    section.hidden = !block.textContent.trim();
  }

  function renderChapter(index) {
    const chapter = story.chapters[index];
    text('chapter-title', chapterTitle(chapter, index));
    renderNotes('chapter-notes', chapter.notes);
    renderNotes('chapter-end-notes', chapter.endNotes);
    $('chapter-body').replaceChildren(chapter.body.cloneNode(true));
  }

  function navigate() {
    const hash = location.hash.slice(1);
    const chapterMatch = /^chapter-(\d+)(-text)?$/.exec(hash);
    const chapterIndex = chapterMatch ? Number(chapterMatch[1]) - 1 : -1;
    const isChapter = chapterIndex >= 0 && chapterIndex < story.chapters.length;
    $('work-view').hidden = isChapter;
    $('chapter-view').hidden = !isChapter;
    $('chapter-actions').hidden = !isChapter;
    $('summary-section').hidden = !story.summary || (isChapter && chapterIndex > 0);
    $('settings-trigger').setAttribute('aria-expanded', 'false');
    $('reader-settings').hidden = true;

    chapterLinks.forEach(link => {
      const target = chapterIndex + Number(link.dataset.chapterStep);
      link.hidden = !isChapter || target < 0 || target >= story.chapters.length;
      if (!link.hidden) link.href = `#chapter-${target + 1}-text`;
    });

    if (isChapter) renderChapter(chapterIndex);
    document.title = isChapter
      ? `${story.title} - ${chapterTitle(story.chapters[chapterIndex], chapterIndex)} | Fanfiction Reader`
      : `${story.title} | Fanfiction Reader`;

    if (hash === 'chapters') {
      $('index-title').focus({ preventScroll: true });
      $('chapters').scrollIntoView();
    } else if (hash === 'about') {
      $('about').scrollIntoView();
    } else if (isChapter && chapterMatch[2]) {
      $('work-title').focus({ preventScroll: true });
      $('workskin').scrollIntoView();
    } else {
      if (hash && hash !== 'top') $('work-title').focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }

  $('settings-trigger').addEventListener('click', () => {
    const panel = $('reader-settings');
    panel.hidden = !panel.hidden;
    $('settings-trigger').setAttribute('aria-expanded', String(!panel.hidden));
  });
  $('font-decrease').addEventListener('click', () => {
    settings.fontSize = Math.max(13, settings.fontSize - 1);
    updateSettings();
  });
  $('font-increase').addEventListener('click', () => {
    settings.fontSize = Math.min(23, settings.fontSize + 1);
    updateSettings();
  });
  $('to-top').addEventListener('click', event => {
    event.preventDefault();
    document.querySelector('.brand').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  });

  function loadWork(id) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `fic-data/${id}/work.js`;
      script.onload = () => {
        const html = window.RADIOAPPLE_WORK;
        delete window.RADIOAPPLE_WORK;
        script.remove();
        resolve(html);
      };
      script.onerror = () => {
        script.remove();
        reject(new Error('Work data is unavailable'));
      };
      document.head.append(script);
    });
  }

  async function openReader() {
    updateSettings();
    const catalog = window.RADIOAPPLE_CATALOG;
    const version = window.RADIOAPPLE_CATALOG_VERSION ?? 1;
    const discovery = window.RadioAppleDiscovery;
    const browse = discovery.browse;
    if (!Array.isArray(catalog) || ![1, 2].includes(version)) {
      browse.show({ message: 'Open the built site to read the works.' });
      $('local-build-link').hidden = location.protocol !== 'file:';
      return;
    }
    const createEngine = () => discovery.engine.createDiscovery(catalog, { catalogVersion: version });
    if (browse.isFandomDirectory(location.search)) {
      browse.show({ engine: createEngine(), directory: true });
      return;
    }
    const route = discovery.state.decodeUrl(location.search);
    $('library-link').hidden = !catalog.length;
    if (route.route === 'discovery') {
      if (!location.search && /^#(?:work|chapters|chapter-\d+(?:-text)?)$/.test(location.hash)
          && catalog.some(work => work?.id === 'radioapple')) {
        location.replace(`?fic=radioapple${location.hash}`);
        return;
      }
      browse.show({ engine: createEngine(), route });
      return;
    }
    $('library-link').href = `index.html${route.returnQuery}`;
    const work = discovery.model.normalizeWork(catalog.find(entry => entry?.id === route.workId));
    const fallback = message => browse.show({
      engine: createEngine(), route: discovery.state.decodeUrl(route.returnQuery), message
    });
    if (!work) {
      fallback('This work is unavailable.');
      return;
    }
    try {
      const html = await loadWork(work.id);
      if (typeof html !== 'string') throw new Error('Invalid work data');
      const chapters = parseChapters(html);
      if (!chapters.length) throw new Error('No chapter text');
      story = { ...work, chapters };
    } catch (_) {
      fallback('This work could not be opened.');
      return;
    }

    populateMetadata();
    $('reader-header').hidden = false;
    $('reader').hidden = false;
    window.addEventListener('hashchange', navigate);
    navigate();
  }

  openReader();
})();
