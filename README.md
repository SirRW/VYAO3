# RadioApple Reader

An unofficial, noncommercial reader for one fanfic. The work and chapter views use the familiar layout of the default Archive of Our Own skin. RadioApple Reader is independent of the Organization for Transformative Works.

## Open locally

Open `index.html` in a browser. To test through a local HTTP server, run `python -m http.server 8000 --bind 127.0.0.1` from this folder and open `http://127.0.0.1:8000/`.

The runtime files are `index.html`, `styles.css`, `app.js`, `story.js`, `ao3-logo.png` and `ao3-red-tile.png`. Keep them together. The reader uses plain HTML, CSS and JavaScript.

## Edit the work

All story data lives in `story.js`. The current title, byline, metadata, summary and excerpt are provisional.

- Update the work fields at the top of the file.
- Replace the preview with the approved text when it is ready. Put each paragraph in its own string in the chapter's `paragraphs` array. The reader renders those strings as text.
- Append chapter objects to `chapters` in reading order. Set `title` to the chapter's title, or leave it empty to display only its number. Use the optional `notes` and `endNotes` strings for notes before and after the text.
- The chapter list, word count and previous/next links update automatically. Chapter URLs use the chapter's position in the list. An existing `#chapter-1` link opens the first chapter, and previous/next links jump past the repeated metadata.

The reader opens in dark mode by default. Use Reading Settings to change the chapter text size or switch to light mode. The browser stores both preferences locally. The update to dark mode preserves the text size from earlier versions.

## Visual references and scope

- The [official default stylesheets](https://github.com/otwcode/otwarchive/tree/master/public/stylesheets/site/2.0) inform the narrow layout, typography, metadata and buttons. The [official work template](https://github.com/otwcode/otwarchive/blob/master/app/views/works/show.html.erb) and [chapter template](https://github.com/otwcode/otwarchive/blob/master/app/views/chapters/_chapter.html.erb) inform the order of the reading sections.
- The [AO3 logo](https://github.com/otwcode/otwarchive/blob/master/public/images/ao3_logos/logo_42.png) and [red tile](https://github.com/otwcode/otwarchive/blob/master/public/images/skins/textures/tiles/red-ao3.png) are local copies of assets from the OTW repository.
- The reader uses a dedicated work overview with a chapter list, static tags, a single-work menu and a custom dark theme. It keeps the prototype's 16 px default chapter text and slightly taller touch controls.
- Chrome was checked at 320, 360, 375, 390, 768 and 1440 px. The visual review used reader screenshots at 390 and 1440 px. The AO3 comparison was based on official code and indexed work pages because a live or Wayback mobile capture was unavailable for direct comparison.
