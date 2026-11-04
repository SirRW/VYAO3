(function () {
  'use strict';
  const story = window.RADIOAPPLE_STORY;
  const $ = (id) => document.getElementById(id);
  const storageKey = 'radioapple-reader:settings:v2';
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const chapterLinks = document.querySelectorAll('[data-chapter-step]');
  const settings = { fontSize: 16, theme: 'dark' };

  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved) {
      Object.assign(settings, saved);
    } else {
      const previous = JSON.parse(localStorage.getItem('radioapple-reader:settings:v1'));
      settings.fontSize = previous?.fontSize;
    }
  } catch (_) {}
  settings.fontSize = Math.min(23, Math.max(13, Number(settings.fontSize) || 16));
  settings.theme = settings.theme === 'light' ? 'light' : 'dark';

  function updateSettings() {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.style.setProperty('--reader-font-size', `${settings.fontSize}px`);
    themeColor.content = settings.theme === 'dark' ? '#540b0b' : '#990000';
    $('theme-toggle').textContent = settings.theme === 'light' ? 'Dark mode' : 'Light mode';
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

  function populateMetadata() {
    text('work-title', story.title);
    text('work-author', story.author);
    text('work-summary', story.summary);
    text('meta-rating', story.rating);
    text('meta-category', story.category);
    text('meta-warning', story.warning);
    text('meta-fandom', story.fandom);
    text('meta-relationship', story.relationship);
    text('meta-characters', story.characters);
    text('meta-additional', story.additionalTags);
    text('meta-language', story.language);
    text('meta-chapters', `${story.chapters.length}/?`);
    const words = story.chapters.reduce((total, chapter) => {
      return total + (chapter.paragraphs.join(' ').match(/\S+/g)?.length ?? 0);
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
    $('start-reading').hidden = story.chapters.length === 0;
  }

  function renderChapter(index) {
    const chapter = story.chapters[index];
    text('chapter-title', chapterTitle(chapter, index));
    $('chapter-notes').hidden = !chapter.notes;
    text('chapter-notes-content', chapter.notes || '');
    $('chapter-end-notes').hidden = !chapter.endNotes;
    text('chapter-end-notes-content', chapter.endNotes || '');
    $('chapter-body').replaceChildren(...chapter.paragraphs.map(paragraph => {
      const p = document.createElement('p');
      p.textContent = paragraph;
      if (paragraph.startsWith('[End of preview.')) p.className = 'preview-note';
      return p;
    }));
    try { localStorage.setItem('radioapple-reader:last-chapter', String(index + 1)); } catch (_) {}
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
  $('theme-toggle').addEventListener('click', () => {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    updateSettings();
  });
  $('to-top').addEventListener('click', event => {
    event.preventDefault();
    document.querySelector('.brand').focus({ preventScroll: true });
    window.scrollTo(0, 0);
  });

  window.addEventListener('hashchange', navigate);
  updateSettings();
  populateMetadata();
  navigate();
})();
