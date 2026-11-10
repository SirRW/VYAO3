# RadioApple Reader — Phase 4 browsing interface

Works, tag listings, and Work Search render the same compact blurb from the Phase 3 catalog. The browsing pages use a light default skin at every width. The chapter reader keeps its own theme, font size, navigation and work-loading behavior.

## Reference evidence

| Evidence | What it established |
| --- | --- |
| Upstream work and tag templates | The work blurb starts with the title, byline, fandom links, required-tag symbols and revision date. The inline tags follow in warning, relationship, character and additional-tag order. Summary, series and statistics follow in that order. Warnings are bold. The source chapter numerator links to the last posted chapter when there is more than one. [Work module](https://github.com/otwcode/otwarchive/blob/master/app/views/works/_work_module.html.erb) · [Tag helpers](https://github.com/otwcode/otwarchive/blob/master/app/helpers/tags_helper.rb) · [Chapter helper](https://github.com/otwcode/otwarchive/blob/master/app/helpers/works_helper.rb) |
| Upstream listing and search templates | Works and tag listings have a count or page range in their heading and pagination above and below the works. Search uses a separate heading, query description, result count and bottom pagination. [Works index](https://github.com/otwcode/otwarchive/blob/master/app/views/works/index.html.erb) · [Search results](https://github.com/otwcode/otwarchive/blob/master/app/views/works/search_results.html.erb) · [Search helpers](https://github.com/otwcode/otwarchive/blob/master/app/helpers/search_helper.rb) |
| Upstream default skin and rendered symbol asset | The red navigation band, Georgia headings, compact gutters, dotted tag underlines, right-aligned stats and 25-pixel symbol cells come from the default skin. The original PNG sprite was inspected directly for colors and glyphs. The source narrows the logo, reduces the main font size and makes dropdown panels full width at 42em. The main gutters change at 62em. [Header CSS](https://github.com/otwcode/otwarchive/blob/master/public/stylesheets/site/2.0/03-region-header.css) · [Blurb CSS](https://github.com/otwcode/otwarchive/blob/master/public/stylesheets/site/2.0/13-group-blurb.css) · [Actions CSS](https://github.com/otwcode/otwarchive/blob/master/public/stylesheets/site/2.0/08-actions.css) · [Symbol sprite](https://github.com/otwcode/otwarchive/blob/master/public/images/imageset.png) · [Narrow CSS](https://github.com/otwcode/otwarchive/blob/master/public/stylesheets/site/2.0/26-media-narrow.css) · [Mid-width CSS](https://github.com/otwcode/otwarchive/blob/master/public/stylesheets/site/2.0/25-media-midsize.css) |
| Historical captures and official documentation | The published 2019 search capture and 2022 work-blurb figure corroborate the information order and compact rows through their captions and indexed descriptions. The official FAQ confirms the fandom-to-Works path, alphabetical fandom lists, and mobile filter placement. [2019 search capture, figure 2](https://journal.transformativeworks.org/index.php/twc/article/download/1725/2493?inline=1) · [2022 blurb capture, figure 16](https://bdm.unb.br/bitstream/10483/32811/1/2022_JuliaGarciaBarbosaAndrade_tcc.pdf#page=57) · [Accessing Fanworks FAQ](https://archive.transformativeworks.org/faq/accessing-fanworks?language_id=en) |

The browser safety policy blocked live AO3. The archived full-page image requests also failed, so the desktop and phone screenshots were compared visually with the upstream templates, default-skin rules and rendered symbol asset. Current full-page AO3 appearance, browser-specific spacing, and hover behavior were not verified through a live page.

## Implementation

| File | Responsibility |
| --- | --- |
| [index.html](../index.html) | Discovery masthead, quick search, page heading, results, paginator regions and the reserved filter mount. The reader uses its existing masthead and chapter elements. |
| [browse.css](../browse.css) | Default browsing skin, symbols, blurb layout, alphabetical listboxes and responsive navigation. The older listing-specific rules were removed from [styles.css](../styles.css). |
| [discovery/work-blurb.js](../discovery/work-blurb.js) | Shared DOM renderer. It takes a normalized work and a validated return query. The renderer inserts metadata as text and creates local links through the existing URL codec. |
| [discovery/browse-ui.js](../discovery/browse-ui.js) | Renders the context and current page from the engine result. Builds the directory from the fandom facets. The browsing controller returns the same result object for downstream controls. |
| [app.js](../app.js) | Dispatches between the directory, discovery and reader. It uses the existing validated reader return route and lazy payload loader. |
| [tests/discovery-build.test.cjs](../tests/discovery-build.test.cjs) and [tests/discovery-fixture.cjs](../tests/discovery-fixture.cjs) | Build assertions, browser integration, dense and sparse synthetic works, and optional screenshot capture. |

### Blurb and metadata

The title opens the reader and the creator byline is text. Fandoms, warning tags, relationships, characters, additional tags, ratings and categories lead to typed local work listings. The renderer retains the work's display spelling, including punctuation and accents. For instance, an `AU` link keeps that label while the engine resolves its destination to Alternate Universe and includes eligible descendant works. The directory lists only directly represented fandom identities, sorted by display name with a local English leading-article rule. Its counts reflect the linked scope. It has no media taxonomy.

The symbols read left to right as rating and category, then archive warning and completion. Known states carry the same distinction as the source helpers. Not Rated and No Archive Warnings Apply use labeled blank cells. Missing information uses a dashed neutral cell with an explicit accessible label. The opt-out symbol is distinct from both the red warning mark and the blank warning cell. A multi-category symbol has individual category links under the fandoms. Rating and single-category cells link to their typed listings. Warning and completion cells have text alternatives and tooltips. The actual warning tags are links in the tag block.

The date prefers a known update, then completion, then publication. Summary paragraphs and series titles come from metadata. Language, words, chapters and statistics are rendered only when available. Known zero hits display as zero. The AO3 template suppresses zero comments, kudos and bookmarks, and the local blurb follows that convention. The source chapter fraction is shown when the posted count is known. A separate local count appears if availability differs or if the posted count is missing. The last available chapter links directly into the reader when at least two local chapters are known.

The renderer uses the upstream sprite as a reference for locally drawn CSS symbols. Exact glyph rendering and gradients differ. AO3 opens a shared symbol-key dialog, while local symbols expose their meanings directly and link to implemented tag destinations where applicable. Byline, series, collection counts and engagement stats remain text where corresponding local pages do not exist. Summaries are plain text, with line and paragraph breaks, so archive HTML formatting is unavailable. A catalog label outside the existing codec's tag limits still displays as text. The page uses the independent project name and notice and shows only supported destinations.

### Views and navigation

- General Works uses `index.html`. The page heading uses a count for one page and a range for multiple pages.
- Tag browsing uses the Phase 3 `?view=tag&tag=<type>:<label>` state. It displays the resolved scope, a current Works marker and pagination above and below the list. The Phase 3 codec preserves includes, excludes, ranges, search-within and sorting on page links.
- The local fandom directory uses the presentation route `index.html?view=fandoms`. From there, fandom links use the normal typed tag route.
- The quick search submits `?view=search&q=<query>`. Work Search shows its query or structured criteria and matching count above the same blurb renderer, with pagination below. Empty results use a short message. The separate advanced form and Edit Your Search controls belong to Phase 5.
- Numbered pagination uses the engine's 20-work page and marks the current page with `aria-current`. Native links preserve browser Back and Forward. Work links use `?fic=<id>` and the existing validated `from` parameter, with the displayed page number. A last-chapter link adds the existing `#chapter-<n>` hash.

The primary menu uses native disclosures with full-width dropdowns on phones, a visible keyboard focus state, and Escape to close and return focus. Work links and tags wrap within the listing. Date spacing leaves a gap from long titles on narrow screens. The browser tests check the navigation and pagination touch targets while preserving the compact inline tag treatment.

## Verification

All 22 Node tests passed, including the 17 Phase 3 engine regressions and five build and browser integration checks. The browser tests covered mobile touch and keyboard menus, metadata and warning distinctions, Unicode and punctuation, alias and descendant resolution, fandom links, the distinct search and tag views, empty results, filter and sort preservation, chapter hashes, saved reader preferences, and return to the same page. Chromium loaded the fresh site through `file:` and through an intercepted HTTPS `/VYAO3/` prefix. The 1,300-work stress catalog rendered 20 blurbs on each tested page and issued zero work payload requests in discovery. The viewport matrix was 320, 390, 430, 768 and 1280 CSS pixels, with no horizontal overflow.

Fresh safe builds used Jekyll 3.10.0 and Kramdown 2.4.0. The real source emitted exactly the two original works, with the raw archive, staging state, importer reports, PDFs and hash-named snapshots excluded. A disposable source produced 44 works from the two originals, 41 synthetic works and one schema-v2 snapshot copied from Phase 2. The fixture verified nested metadata and the private-field allowlist. The copy and its output stayed outside the repository's publication tree. The pre-existing workspace `_site` was not used for verification.

The portable Ruby 3.3.4 shell used the same process-local workaround as Phase 3. The verifier set `GEM_HOME` to the portable Jekyll gems folder, passed the Jekyll 3.10.0 `lib` folder with `ruby -I`, and pinned Kramdown 2.4.0 before loading Jekyll. Before `require 'jekyll'`, it replaced `Dir[]` for installed Jekyll paths ending in `/*.rb` with sorted `Dir.children` filtered to Ruby files. This avoided the missing `Jekyll::Filters::URLFilters` error. It also replaced blockless `Dir.glob` for paths ending in `/_fics/*.md` with sorted `Dir.children` filtered to Markdown. The build used the checkout's existing Jekyll exclusions with no launcher or gem edits.

Run the engine checks with `node --test tests/discovery.test.cjs`. For the integration checks, use `node tests/discovery-fixture.cjs NEW_TEMP_DIRECTORY STAGED_MARKDOWN` to prepare an isolated source and build both sources with Jekyll. Set `RADIOAPPLE_BUILT_SITE` and `RADIOAPPLE_FIXTURE_SITE` to their output directories, `RADIOAPPLE_PLAYWRIGHT` to the Playwright package path and `RADIOAPPLE_CHROMIUM` to the Chromium executable if needed. Then run `node --test tests/discovery-build.test.cjs`. Set `RADIOAPPLE_SCREENSHOTS` to an output directory to capture the fixture screenshots.

### Browser captures

- [390 px tag listing](screenshots/phase-4/tag-390.png) shows the masthead, two-line count heading, page links, symbol grid and dense tag wrapping.
- [390 px tag listing, scrolled](screenshots/phase-4/tag-390-scrolled.png) shows the summary, compact stats and the opt-out and missing-metadata cases.
- [390 px Work Search](screenshots/phase-4/search-390.png) shows the separate search description and count.
- [1280 px tag listing](screenshots/phase-4/tag-1280.png) shows the wide blurb layout, right-aligned dates and statistics, and three metadata densities.

The screenshots show synthetic blurbs from the fixture build. The reviews checked blurb hierarchy, metadata density, typography, red navigation, tag wrapping and date alignment. The desktop listing uses the available width until the filter panel is present.

## Phase 5 handoff

Mount the Sort and Filter form in `#library-filters` beside `#library-list`. On wide filtered views, use the source proportions of approximately 75% for results and 23% for filters. At 42em and below, preserve full-width results and use the source's right-side mobile panel behavior. Add the mobile Filters action in `#library-context-actions` with the appropriate focus and close behavior. [Search and browse CSS](https://github.com/otwcode/otwarchive/blob/master/public/stylesheets/site/2.0/18-zone-searchbrowse.css) · [Narrow CSS](https://github.com/otwcode/otwarchive/blob/master/public/stylesheets/site/2.0/26-media-narrow.css).

Use the engine's `facets`, `applied`, `availableSorts` and typed tag suggestions to populate controls. Use `state.changeCriteria` to reset the page, `state.resetFilters` to preserve the tag scope, and the same URL codec for applying or editing a search. Preserve the result list renderer and the existing work return link. [Phase 3 discovery API](phase-3-catalog-search.md).
