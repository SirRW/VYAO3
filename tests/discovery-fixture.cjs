const genres = ['Café Encounters', 'Quiet Spaces', 'Lost Maps', 'After the Rain', 'The Observatory', 'Midnight Letters'];
const descriptions = [
  'When the night train stops outside the observatory, an unexpected visitor brings a torn map and three questions.',
  'The library has been closed since the storm. The archivist opens it for one afternoon and finds the shelves rearranged.',
  'A promise made years ago brings two old friends back to the station, where every clock is running at a different speed.',
  'Letters cross the river every winter. This year one comes back unopened with a message written across the envelope.',
  'A misplaced key opens the wrong door, leading to a garden that looks familiar only from the far side of the glass.',
  'The city is preparing for a festival, and the people who know how to light its lanterns are working through the night.'
];

function makeCatalog(size) {
  return Array.from({ length: size }, (_, index) => {
    const title = genres[index % genres.length];
    const paragraphs = Array.from({ length: 4 + index % 5 }, (_, n) => descriptions[(index + n * 5) % descriptions.length]);
    const tags = Array.from({ length: 14 + index % 23 }, (_, n) => `${genres[n % genres.length]} - ${['Friendship', 'Mystery', 'Slow Build', 'Adventure', 'Found Family'][n % 5]} ${1 + (index * 17 + n * 23) % 173}`);
    const posted = index % 4 === 0 ? 1 : 3;
    return {
      id: `sample-${String(index).padStart(5, '0')}`, schemaVersion: 2, title: `${title} ${index + 1}`,
      author: `Élodie ${index % 127}`, creators: [{ name: `Élodie ${index % 127}` }], summary: paragraphs.join('\n\n'),
      rating: ['General Audiences', 'Teen And Up Audiences', 'Mature'][index % 3],
      warning: index % 5 ? ['No Archive Warnings Apply'] : [], category: ['Gen'],
      fandom: [`Fandom ${index % 19}`, `Collection Fandom ${index % 8}`],
      relationship: [index % 2 ? 'Alex/Robin' : 'Alex & Robin', `Alex & Morgan ${index % 43}`],
      characters: ['Alex', 'Robin', `Morgan ${index % 43}`, `Avery ${index % 37}`],
      additionalTags: [...tags, ['AU', 'Alternate Universe', 'Canon Divergence'][index % 3], index % 7 ? 'Friendship' : 'Major Character Death'],
      language: index % 8 ? 'English' : 'Français', languageCode: index % 8 ? 'en' : 'fr',
      wordCount: index % 11 ? 250 + index * 71 % 46000 : null, wordCountSource: index % 11 ? 'archive' : null,
      chaptersAvailable: posted, chaptersPosted: posted, chaptersTotal: index % 6 ? posted : null,
      completionStatus: index % 6 ? 'complete' : 'in-progress',
      publishedAt: `202${index % 6}-01-01`, updatedAt: index % 4 ? `202${index % 6}-02-01` : null, completedAt: null,
      stats: index % 3 ? { hits: index * 7, kudos: index % 600, comments: null, bookmarks: index % 300 } : null,
      series: index % 4 ? [] : [{ title: 'Letters from the Station', position: index % 5 + 1 }], collections: []
    };
  });
}

module.exports = { makeCatalog };

// Create a disposable Jekyll source for the integration tests. The second
// argument is a local copy of the Phase 2 schema v2 fixture for AO3 work 36640207.
if (require.main === module) {
  const fs = require('node:fs');
  const path = require('node:path');
  const [destination, stagedWork] = process.argv.slice(2);
  if (!destination || !stagedWork) throw new Error('Usage: node tests/discovery-fixture.cjs NEW_TEMP_DIRECTORY STAGED_MARKDOWN');
  const repo = path.resolve(__dirname, '..');
  const target = path.resolve(destination);
  const parent = fs.realpathSync(path.dirname(target));
  const relative = path.relative(fs.realpathSync(repo), parent);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('Keep the fixture source outside the repository.');
  }
  fs.mkdirSync(target);
  for (const file of ['_config.yml', '_layouts', '_includes', 'discovery', 'fic-catalog.js', 'app.js', 'index.html', 'styles.css', 'browse.css', 'ao3-logo.png']) {
    fs.cpSync(path.join(repo, file), path.join(target, file), { recursive: true });
  }
  const works = path.join(target, '_fics');
  fs.mkdirSync(works);
  for (const file of ['radioapple.md', 'just-business.md']) fs.copyFileSync(path.join(repo, '_fics', file), path.join(works, file));
  fs.copyFileSync(stagedWork, path.join(works, 'ao3-36640207.md'));

  const rows = makeCatalog(41);
  const sentinel = rows[0];
  sentinel.creators = [{ name: sentinel.author, path: 'PRIVATE_SENTINEL', url: 'file:///PRIVATE_SENTINEL.pdf' }];
  sentinel.series[0].path = 'PRIVATE_SENTINEL';
  sentinel.stats = { hits: 0, kudos: 8, comments: { path: 'PRIVATE_SENTINEL' }, log: 'PRIVATE_SENTINEL' };
  sentinel.source = { archive: 'ao3', workId: '123', url: 'https://archiveofourown.org/works/123?path=PRIVATE_SENTINEL' };
  sentinel.additionalTags.push({ private: 'PRIVATE_SENTINEL' });
  sentinel.importReport = 'PRIVATE_SENTINEL';
  Object.assign(rows[40], {
    title: 'À la lumière des étoiles, or the long way home through all the stations we never meant to visit',
    fandom: ['The Observatory Chronicles', 'Échos de la nuit'],
    relationship: ['Alexandra de la Fontaine-Rosetti/Robin St. Clair of the Northern Observatory'],
    warning: ['Major Character Death'],
    category: ['F/F', 'Gen'],
    rating: 'Mature',
    additionalTags: [...rows[40].additionalTags, 'AU', 'Letters, Never Sent', 'Night-Train-' + 'Étincelle'.repeat(15)],
    chaptersAvailable: 2, chaptersPosted: 3, chaptersTotal: 5, completionStatus: 'in-progress',
    updatedAt: '2026-06-04',
    summary: 'When an overnight train stops at a station omitted from every map, Élodie has until dawn to discover who has been leaving letters in the empty ticket booth.\n\nThe clocks disagree, the lamps keep going out, and the person who could explain it all left on the last train twenty years ago.\n\n“I thought you said this was the long way home.”'
  });
  Object.assign(rows[39], {
    title: 'A single lantern', rating: 'Not Rated', warning: ['Creator Chose Not To Use Archive Warnings'],
    fandom: ['Échos de la nuit'], category: ['Gen'], relationship: [], characters: [], additionalTags: ['AU'],
    summary: 'A light stays on above the ticket booth.', stats: null, updatedAt: '2026-06-03'
  });
  Object.assign(rows[38], {
    title: 'The station after midnight', rating: null, warning: null, category: null, fandom: ['Échos de la nuit'],
    relationship: [], characters: [], additionalTags: ['AU'], stats: null, wordCount: null, summary: '',
    completionStatus: null, chaptersAvailable: 1, chaptersPosted: null, chaptersTotal: null, updatedAt: '2026-06-02'
  });
  rows.push({ id: `local-${'a'.repeat(20)}--${'b'.repeat(64)}`, title: 'PRIVATE_SENTINEL' });
  for (const { id, ...fields } of rows) {
    const yaml = Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
    const bodies = ['## Chapter 1\n\nBODY_ONLY_SENTINEL\n'];
    if (fields.chaptersAvailable >= 2) bodies.push('## Chapter 2\n\nSecond fixture chapter.\n');
    if (fields.chaptersAvailable >= 3) bodies.push('## Chapter 3\n\nThird fixture chapter.\n');
    fs.writeFileSync(path.join(works, `${id}.md`), `---\n${yaml}\n---\n\n${bodies.join('\n')}`);
  }
}
