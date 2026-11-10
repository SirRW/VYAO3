# RadioApple Reader — Phase 5 search and filters

Search → Works opens the advanced Work Search form. The header search still goes directly to Search Results. Edit Your Search reopens the advanced form with the result URL's criteria. Tag listings have their own Sort and Filter controls and keep the original scope through filtering, pagination, and a visit to a work.

## AO3 reference and visual comparison

| Reference | Verified behavior used here |
| --- | --- |
| [Advanced Work Search template](https://github.com/otwcode/otwarchive/blob/master/app/views/works/_search_form.html.erb) and [search results template](https://github.com/otwcode/otwarchive/blob/master/app/views/works/search_results.html.erb) | Work Info, Work Tags, Work Stats and Search fieldsets. Search submits at the top and bottom. The results view describes the search and offers Edit Your Search above the works. |
| [Works index](https://github.com/otwcode/otwarchive/blob/master/app/views/works/index.html.erb), [filter template](https://github.com/otwcode/otwarchive/blob/master/app/views/works/_filters.html.erb) and [Search and Browse FAQ](https://archive.transformativeworks.org/faq/search-and-browse?language_id=en) | Scoped Works and narrow-screen Filters actions. Sort by, Include, Exclude and More Options. Separate quick tag choices and Other tags fields. Applied inclusion is conjunctive. Matching any excluded tag removes a work. Clear Filters returns to the scoped listing. |
| [Filter JavaScript](https://github.com/otwcode/otwarchive/blob/master/public/javascripts/filters.js), [browse skin](https://github.com/otwcode/otwarchive/blob/master/public/stylesheets/site/2.0/18-zone-searchbrowse.css) and [narrow skin](https://github.com/otwcode/otwarchive/blob/master/public/stylesheets/site/2.0/26-media-narrow.css) | Unused groups start collapsed. Selected groups and nonempty ranges reopen after applying. The wide layout uses 75% results and 23% filters. The narrow layout shifts the results left to reveal a right-hand panel, focuses its first control and restores focus on close. |
| [Form skin](https://github.com/otwcode/otwarchive/blob/master/public/stylesheets/site/2.0/07-interactions.css) and [autocomplete source](https://github.com/otwcode/otwarchive/blob/master/public/javascripts/jquery.tokeninput.js) | Gray inset fieldsets, white legends, stacked narrow fields, tokenized tags, a suggestion list with red highlight, keyboard selection and duplicate prevention. |

Local screenshots were inspected at desktop and phone widths against the upstream layout, interaction code, and default-skin rules. Indexed historical captures also corroborated the stacked search fields and filter grouping. Live AO3 had been unavailable during Phase 4 verification, so this comparison does not establish pixel parity against a live session. [Published mobile search reference](https://notfun3.top/posts/ao3-advanced-search-guide/) · [Published filter walkthrough](https://twtext.com/article/1294009233105653761) · [Phase 4 reference notes](phase-4-ao3-browsing-ui.md).

## Implementation

| File | Change |
| --- | --- |
| [index.html](../index.html), [browse-ui.js](../discovery/browse-ui.js) | Connect the new form, result action, tag sidebar and mobile trigger to the existing discovery views. The blurb renderer and chapter reader keep their previous entry points. |
| [search-form.js](../discovery/search-form.js), [filters.js](../discovery/filters.js) | Separate advanced search and tag-filter workflows. Filter disclosures and the mobile panel keep drafts separate from applied results. |
| [form-controls.js](../discovery/form-controls.js), [tag-input.js](../discovery/tag-input.js), [forms.css](../discovery/forms.css) | Shared validation, ranges, selections, local autocomplete, keyboard interactions and form skin. |
| [engine.js](../discovery/engine.js), [state.js](../discovery/state.js) | Expose known languages and exact typed tag lookup from the current engine. Recognize the search edit presentation flag around the existing URL codec. Existing matching and ranking rules are unchanged. |
| [discovery-forms.test.cjs](../tests/discovery-forms.test.cjs), [discovery-build.test.cjs](../tests/discovery-build.test.cjs) | Form, mobile, URL, build and browser regression checks and reproducible synthetic-only screenshots. |

### Advanced search

Work Info provides Any Field, Title, Creator, Date, Date Posted, completion, Single Chapter, Word Count and Language. Date queries use the known update date. Date Posted uses publication metadata. A previously applied completion-date constraint can also be edited. Text uses the Phase 3 parser. Word Count and available Hits, Kudos, Comments and Bookmarks accept exact numbers, inclusive ranges and comparisons. Date inputs accept ISO calendar dates, inclusive intervals with “to”, and inclusive one-sided bounds. The form can round-trip compound bounds already present in a URL. Ranges require known metadata.

Work Tags offers separate token fields for fandoms, characters, relationships and additional tags, a single rating, and warning and category checkboxes. A search URL can also carry exclusions from the Phase 3 codec. When present they can be edited in a separate token field. Work Stats appears when the catalog supplies a supported statistic or the edited URL already constrains one. Sort choices use the engine's available fields.

`?view=search&edit_search=true` opens the form. Edit Your Search adds that flag to the existing criteria without the current page number. A submission uses the same discovery codec as quick search and removes the flag. Valid submissions start at page 1. Invalid syntax or ranges keep the active URL and draft, mark the affected controls, and focus the first reported field. The reader's `from` parameter accepts result URLs only.

### Tag filtering and autocomplete

Each group shows up to ten direct facet values in the engine's count and key order, plus its applied values. Counts are from the entire current result set before pagination and count each direct canonical identity once per work. A parent can match descendant works even when its direct facet count is zero. Excluded and conflicting selections can appear at zero and stay editable. Draft changes take effect on Sort and Filter. Clear Filters clears criteria and sort while preserving the URL's original tag scope. An All works completion choice and Any rating allow individual controls to be cleared.

Other tags fields search across the local catalog and show a type beside each result. The advanced form's tag inputs restrict results by type. Reviewed aliases suggest the canonical label with the matching alias shown alongside it. Selections use typed canonical keys, so entering AU and Alternate Universe cannot create duplicate predicates. Unknown spellings and ambiguous exact names produce feedback. A known tag absent from the current scoped results can still be selected. The local lookup does not infer a synonym or collapse parent and child tags.

### Mobile and accessibility

At 42em and below, Filters opens the panel on the right and shifts the existing results left by the exact panel width. The visible results act as a click-to-close area. The panel scrolls independently, moves focus to the first Sort and Filter button, makes outside content inert, and wraps Tab at the panel boundary. Escape closes an active autocomplete list before it closes the panel. Close Filters and Escape restore focus to the trigger. Closing the panel leaves its unsent draft available on that page. A submitted or revisited result renders from its applied URL.

Native fieldsets, labeled controls and disclosures supply grouping and keyboard behavior. The autocomplete exposes a listbox, active descendant, suggestion status and labeled remove controls. Its suggestions support touch and keyboard selection. Invalid entries have inline descriptions linked to their controls and a summary alert. Filter controls preserve visible focus and use larger text inputs on narrow screens.

## Verification

All 29 Node tests passed, covering 17 discovery regressions, five Phase 4 build and browser checks, and seven Phase 5 checks including the synthetic screenshot run. Playwright exercised search, editing, numeric and date validation, sorting, retained selections, conflicts, alias and typed suggestions, scope preservation, Back and Forward, reader return links and chapter preferences. The test viewport widths were 320, 390, 430, 768 and 1280 CSS pixels. The panel geometry and horizontal overflow checks ran at all applicable widths. Chromium tested the actual local file build and a simulated HTTPS `/VYAO3/` deployment. The 1,300-work scenario returned 20 blurbs per page and made zero story requests while filtering. Importer regression ran 13 tests with one optional real-PDF subcase skipped because the file was absent.

Autocomplete uses the current engine and caps the list at ten suggestions with a 90 ms typing debounce. Disclosures and drafts leave the index and result nodes in place. A new navigation initializes one engine for that document. In the final 1,300-work run, navigation to the open panel took 477 ms and input to visible suggestions took 106 ms, including the debounce. Those are desktop Chromium timings with local asset delivery and emulated phone settings.

The fresh safe Jekyll 3.10.0 and Kramdown 2.4.0 source build emitted only the two original work payloads. The isolated fixture build contained the two originals, 41 synthetic works and one staged schema-v2 copy. It verified nested metadata without publishing the copy. The published-source build excluded PDFs, the raw archive, staging state, reports and hash-named snapshots. The Ruby 3.3.4 process used the same portable workaround as Phase 4. It selected the portable gem directory, pinned Kramdown and substituted sorted `Dir.children` for the installed Jekyll `Dir[]` Ruby-file lookups and blockless `Dir.glob` on `/_fics/*.md`. No launcher, gem, or publication settings changed. [Phase 4 build procedure](phase-4-ao3-browsing-ui.md#verification).

Set `RADIOAPPLE_BUILT_SITE`, `RADIOAPPLE_FIXTURE_SITE`, `RADIOAPPLE_PLAYWRIGHT`, and `RADIOAPPLE_CHROMIUM` as in Phase 4. Run these checks.

```text
node --test tests/discovery.test.cjs tests/discovery-build.test.cjs tests/discovery-forms.test.cjs
python -m unittest discover -s tests -v
```

Set `RADIOAPPLE_PHASE5_SCREENSHOTS` to enable the screenshot check. It loads only synthetic catalog rows for capture.

### Screenshots

- Advanced Work Search, full form. [390 px](screenshots/phase-5/advanced-390.png) · [1280 px](screenshots/phase-5/advanced-1280.png).
- Desktop tag listing and populated options. [Sidebar](screenshots/phase-5/filters-1280.png) · [Include](screenshots/phase-5/include-1280.png) · [Exclude](screenshots/phase-5/exclude-1280.png).
- Mobile tag listing. [Panel closed](screenshots/phase-5/filters-closed-390.png) · [Panel open](screenshots/phase-5/filters-open-390.png) · [Alias suggestions](screenshots/phase-5/autocomplete-390.png).
- Scoped result with multiple included and excluded tags. [Filtered listing](screenshots/phase-5/filtered-1280.png).

## Remaining AO3 differences

- The local catalog lacks verified crossover groups, a complete tag-wrangling database, and AO3's backend query grammar. Crossover controls and relative dates are omitted. Unknown tag text has no analyzed fallback in typed fields. The Any Field parser remains the documented Phase 3 subset.
- The work search form adds Date Posted. The tag sidebar adds explicit sort direction and a rating reset. ISO date text replaces AO3's datepicker. Inline help uses small disclosures. The mobile panel has a visible Close Filters button as well as the outside close area.
- Tag buckets use direct Phase 3 counts and catalog-wide suggestions. AO3 can draw on its full Elasticsearch facets and popularity data. The local interface only exposes statistics supported by its metadata.
- The visual comparison used Chromium emulation. Physical-device browser chrome, the on-screen keyboard and screen reader output remain unverified.

## Phase 6 handoff

- Run the current browsing and filter flows on physical iOS and Android devices. Include the keyboard, zoom, screen reader focus, Back from a work and long selected-tag lists.
- Compare both desktop and narrow layouts with a live default-skin reference if accessible. Recheck form density and dropdown placement against those screenshots.
- Profile first load and autocomplete on a phone using the approved catalog. Verify the final production build's file list against its publication allowlist and keep release verification separate from staged importer fixtures.
