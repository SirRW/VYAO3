# RadioApple Reader — Phase 3 catalog and discovery

The browser uses a versioned Jekyll metadata catalog and a DOM-independent discovery engine. The existing Works view reads discovery state from the URL, renders at most 20 rows, and links to individual work payloads on demand. Classic deferred scripts support both GitHub Pages project paths and the local `file:` entry point.

## Catalog and files

[`fic-catalog.js`](../fic-catalog.js) emits `window.RADIOAPPLE_CATALOG_VERSION = 2` alongside the existing `window.RADIOAPPLE_CATALOG` array. The transport version and each work's front matter `schemaVersion` are separate. The catalog retains the existing route ID and metadata keys and adds the Phase 2 fields for creators, language code, word count and provenance, local and source chapter counts, completion, dates, statistics, series, collections and original AO3 work information. Nested Liquid projections allow only creator names, series titles and positions, known statistics and their snapshot date, and a verified AO3 work URL and ID. Creator and series URLs are optional fields and are omitted from this transport until those routes have their own validation. Chapter text, local PDF paths, hashes, logs and approvals are outside the projection. [Catalog includes](../_includes/catalog-value.html) · [Structured entries](../_includes/catalog-records.html) · [Verified source URLs](../_includes/catalog-source.html).

The workspace contained 110 hash-named staging copies inside `_fics/` when Phase 3 started. The Git and Jekyll rules now exclude the importer snapshot filename patterns there, in addition to the existing archive and staging directories. The files were left in place. A fresh build of this checkout produced only `radioapple` and `just-business`. A prior local `_site` build was already present and should be rebuilt from the new rules before using it as deployment output. [Git exclusions](../.gitignore) · [Jekyll exclusions](../_config.yml).

| File | Responsibility |
| --- | --- |
| [`discovery/model.js`](../discovery/model.js) | Normalize legacy and v2 metadata and reject malformed or duplicate records. |
| [`discovery/tags.js`](../discovery/tags.js), [`tag-relationships.js`](../discovery/tag-relationships.js) | Resolve typed aliases, index direct and inherited identities, and suggest tags from the curated graph and catalog. |
| [`discovery/query.js`](../discovery/query.js) | Parse and evaluate text expressions and parse the supported numeric entry syntax. |
| [`discovery/state.js`](../discovery/state.js) | Validate structured criteria and encode or decode discovery and reader routes. |
| [`discovery/engine.js`](../discovery/engine.js) | Apply predicates, sort, count facets and return a page. |
| [`app.js`](../app.js), [`index.html`](../index.html) | Connect the existing Works view to the engine and retain reader navigation. |
| [`tests/discovery.test.cjs`](../tests/discovery.test.cjs), [`discovery-build.test.cjs`](../tests/discovery-build.test.cjs) | Engine, catalog projection and browser verification. |
| [`tests/discovery-fixture.cjs`](../tests/discovery-fixture.cjs), [`discovery-benchmark.cjs`](../tests/discovery-benchmark.cjs) | Synthetic catalog generator and repeatable measurements. |

Legacy works can omit `schemaVersion`. Only known legacy tag lists are split, at the comma-space separators used by the original Markdown. A comma-space embedded inside a legacy tag is ambiguous. Schema v2 arrays preserve the spelling, punctuation and order of every tag. Display bylines retain their original punctuation. A legacy byline supports text search without assuming individual creator identities. Comparison uses Unicode NFC, lowercase and whitespace normalization. Accents and relationship separators remain significant. Blank or absent list fields become `null`. Explicit arrays can be empty, and an empty warning array makes no claim about warnings. Numeric zero remains distinct from missing data.

## Discovery API

In the browser use `RadioAppleDiscovery.engine`, `.model`, `.query` and `.state`. Tests and local scripts can `require` the corresponding files directly. Create one engine per loaded catalog and reuse it as criteria change. The returned work records are intended for read-only rendering.

```js
const { engine, state } = window.RadioAppleDiscovery;
const discovery = engine.createDiscovery(window.RADIOAPPLE_CATALOG, {
  catalogVersion: window.RADIOAPPLE_CATALOG_VERSION
});
const results = discovery.discover({
  mode: 'tag',
  scope: { type: 'additionalTags', value: 'AU' },
  include: [{ type: 'rating', value: 'Mature' }],
  exclude: [{ type: 'warning', value: 'Major Character Death' }],
  q: '"quiet rain" OR lantern*',
  ranges: { wordCount: { min: 1000, max: 10000 } },
  page: 1
});
const queryString = state.encodeUrl(results.state);
```

- `discover(input)` returns `works` for the page, all `matchingIds` in display order, `total`, `pagination`, effective `sort`, validated `state`, canonical `applied` selections, `facets`, and `errors` and `warnings`. `pagination` contains `page`, `pageSize`, `totalPages`, `total`, `hasPrevious`, `hasNext`, `previousPage`, and `nextPage`.
- `getWork(id)` returns a normalized record or `null`. `catalogIssues` identifies invalid rows and duplicate route IDs. `availableSorts` lists sorts supported by values somewhere in the loaded collection, so a UI can omit unavailable popularity sorts.
- `suggestTags(text, { type, limit })` returns typed canonical or exact local suggestions with `matchedValue`, reviewed `aliases`, and the number of matches across the catalog. Pass a `relationships` array to `createDiscovery` to use a different reviewed graph.
- `model.normalizeWork(raw)` and `model.normalizeCatalog(rows)` are independently testable. `query.parseQuery(text)` returns `{ ast, errors }` and `query.parseNumberRange(text)` returns `{ range, errors }` for an advanced numeric field. `state.resetFilters(state)` clears criteria and sort while preserving the tag scope. `state.changeCriteria(state, patch)` applies edits and resets the page to 1.

`works` is the whole-catalog mode with sort and page. `search` accepts `q` (Any Field), `title`, `creator`, typed `include` and `exclude`, `language`, `completion`, `singleChapter`, and `ranges`. `tag` requires `scope` and uses `q` as Search within results. Supported tag types are `rating`, `warning`, `category`, `fandom`, `characters`, `relationship`, and `additionalTags`. Work Search exposes typed inclusion for advanced tag fields. The reusable engine also accepts typed exclusions in search mode, though AO3's advanced form has no equivalent sidebar.

## AO3 matching and local differences

- All included typed tags must match. Matching any excluded tag removes a work. Include accepts one rating, while Exclude can accept several. An unknown warning cannot match a requested warning and cannot be substituted for an explicit no-warning declaration. Known local tags work without a graph entry. A typed label absent from both the catalog and the reviewed graph has no exact match. AO3 can fall back to analyzed tag text for nonexistent names, which this typed interface leaves to free text or a future form-level fallback. [Include help](https://secure.ao3.org/help/work-filters-include-tags.html) · [Exclude help](https://secure.ao3.org/help/work-filters-exclude-tags.html) · [Advanced tag fields](https://secure.ao3.org/help/work-search-tags-help.html) · [Filter controls](https://github.com/otwcode/otwarchive/blob/master/app/views/works/_filters.html.erb).
- Edit [`tag-relationships.js`](../discovery/tag-relationships.js) to add `{ type, canonical, aliases?, parents? }`. Parent entries must be explicitly declared in the same type. The graph rejects duplicate identities, ambiguous aliases and cycles. `AU` is the explicitly requested local alias for `Alternate Universe`. The Canon chain and the two Canon Divergence aliases come from AO3's tag page. Either spelling of a reviewed alias resolves to the same canonical identity in structured filters, tag scope and suggestions. This local symmetry applies even where AO3 might treat an entered noncanonical spelling as exact. A parent matches descendant tags transitively. A child does not match works tagged only with its parent. [AO3 Canon Divergence tag](https://secure.ao3.org/tags/Alternate%20Universe%20-%20Canon%20Divergence) · [OTW on tag wrangling](https://secure.ao3.org/admin_posts?page=2&tag=10).
- Facets use the full current filtered result set before pagination. `count` counts direct canonical or exact local tags, once per work. AO3 uses direct filter tags for these buckets. `matchingCount` separately counts works eligible for that typed tag under the hierarchy, including descendant-only matches. Unknown local tags with observed spellings can appear in local facets. Applied Include, Exclude and scope selections stay available even with zero results. Options are ordered by descending direct count and then typed key. Phase 4 or 5 can display the top ten using that ordering without dropping selections. [AO3 filter indexing](https://github.com/otwcode/otwarchive/blob/master/app/models/concerns/filterable.rb) · [AO3 facet aggregation](https://github.com/otwcode/otwarchive/blob/master/app/models/search/work_query.rb).
- Free text indexes title, creator, summary, tag names and series titles. The tag text contains the original labels plus canonical and inherited filter names, following AO3's index. It does not inject every synonym of a canonical tag. Work-level notes, which AO3 also indexes, are outside this catalog projection. Search relevance uses AO3's relative title and creator weights of 7 and 5, with weight 1 for the other fields. Local term scoring and tokenization are deterministic approximations of Elasticsearch, whose corpus statistics and analyzer are unavailable locally. [AO3 WorkQuery](https://github.com/otwcode/otwarchive/blob/master/app/models/search/work_query.rb) · [AO3 work index fields](https://github.com/otwcode/otwarchive/blob/master/app/models/search/work_indexer.rb).

### Text and typed predicates

Whitespace between bare terms requires those terms in the same indexed field. Uppercase `AND` can combine matches across fields, and uppercase `OR` or `||` permits either branch. Double quotes match consecutive tokens within a value. Parentheses group expressions. A leading `-` or uppercase `NOT` excludes its operand at that parenthesis level, including after an OR expression. Within the positive expression, whitespace binds first, then explicit `AND`, then `OR`. This covers the cited help examples. The precedence rules are a local subset. A single trailing `*` on a word prefix is supported. The analyzer preserves `/` and `&` in text phrases. Leading or infix wildcards, field operators such as `words:`, fuzzy queries, boosts and regular expressions are unsupported. Invalid syntax returns a message and character offset with an empty result set. [AO3 Any Field help](https://secure.ao3.org/help/work-search-text-help.html).

Numeric range fields are `wordCount`, `hits`, `kudos`, `comments` and `bookmarks`. They accept `eq`, inclusive `min` and `max`, and strict `gt` and `lt`. The numeric entry parser also accepts AO3-style `1000`, `1000-5000`, `<1000` and `>1000` with comma or period digit separators. `publishedAt`, `updatedAt` and `completedAt` accept exact or inclusive ISO calendar dates. AO3's relative date grammar is outside this subset. Missing values never satisfy a bound. Source completion comes from an explicit status or a posted/total fraction with enough evidence. A literal `?` with a posted count represents an in-progress fraction. A missing total alone is insufficient. Single chapter matches a known source total of one, following AO3's expected chapter count. Multiple locally available chapters and multiple fandom labels do not supply completion or crossover evidence. Crossover filtering awaits verified fandom-group data. [AO3 number help](https://secure.ao3.org/help/work-search-numerical-help.html) · [Date help](https://secure.ao3.org/help/work-search-date-help.html) · [Crossover help](https://secure.ao3.org/help/work-search-crossover-help.html).

Work Search defaults to descending relevance. General Works and tag browsing default to descending `revisedAt`, using `updatedAt`, then `completedAt`, then `publishedAt` as available source evidence. Explicit `updatedAt` sorting and filtering use only that field. `publishedAt` corresponds to the source's publication date. `title` follows AO3's leading punctuation, English article and short numeric title adjustments. `creator` uses normalized creator names or the legacy display byline. `wordCount`, `completedAt`, and known stats can also sort either way. Missing values sort last in either direction. Stable local work IDs break ties in the requested direction. [AO3 sort defaults and tie handling](https://github.com/otwcode/otwarchive/blob/master/app/models/search/work_query.rb) · [AO3 title and creator sort keys](https://github.com/otwcode/otwarchive/blob/master/app/models/work.rb).

## URLs

Discovery uses relative query strings. `state.decodeUrl(location.search)` returns the route and parsed state, with errors and warnings for discovery. `state.encodeUrl(state)` returns an empty string or a canonical query with a leading `?`. It omits defaults, orders repeated tags deterministically, and validates the structure and typed bounds. The discovery engine separately validates text syntax. Navigation uses real links so reload and browser history work without a separate router.

| Parameter | Meaning |
| --- | --- |
| `view` | `search`, `tag`, or default `works`. |
| `tag` | Required in tag mode. `type:label`, such as `relationship:Alex/Robin`. |
| `include`, `exclude` | Repeat for multiple typed tags. Only the first colon separates type from label. |
| `q`, `title`, `creator` | Text queries. |
| `language`, `completion`, `single` | Language code or label, `complete` or `in-progress`, and `1` for a single chapter. |
| `<field>.<bound>` | Typed range, such as `wordCount.min=1000` or `updatedAt.max=2025-06-30`. |
| `sort`, `dir`, `page` | Sort field, direction, and 1-based page. Invalid pages reset to 1. Pages past the end clamp to the last result page. |
| `fic`, `from` | Reserved reader route and optional encoded discovery query. `from` accepts only validated discovery state and restores the Works link. Existing chapter hashes are handled by the reader. |

For example, `?view=tag&tag=additionalTags%3AAU&include=rating%3AMature&wordCount.min=1000&page=2`. Unknown parameters, invalid percent encoding, and repeated scalar parameters produce validation errors. No results return page 1 with zero total pages.

## Verification and measurements

Run `node --test tests/discovery.test.cjs` for the 17 discovery tests. The existing importer suite ran 13 tests with one optional real Skia PDF case skipped because the source was absent. The two existing works and one copied v2 work were checked in isolated build outputs. To create that source, run `node tests/discovery-fixture.cjs NEW_TEMP_DIRECTORY STAGED_MARKDOWN` with the Phase 2 Markdown snapshot for AO3 work `36640207`. The script requires a new directory outside the repository and adds 41 synthetic works and privacy sentinels. Build both the actual checkout and the fixture source into temporary destinations. With the resulting paths in `RADIOAPPLE_BUILT_SITE` and `RADIOAPPLE_FIXTURE_SITE`, run `node --test tests/discovery-build.test.cjs`. Set `RADIOAPPLE_PLAYWRIGHT` to the installed Playwright module path and optionally `RADIOAPPLE_CHROMIUM` to the browser binary to run the browser case.

The three build and browser checks passed with Jekyll 3.10.0, Kramdown 2.4.0 and a 390-pixel Chromium viewport. They verified the source exclusions and nested metadata projection, zero body requests for Works, 20-row pagination, return to the same filtered page, existing reader links and chapter hashes, and reading preferences after reload. The `/VYAO3/` path was tested with a locally fulfilled HTTPS route. In the audit shell, an unmodified `require 'jekyll'` failed with `Jekyll::Filters::URLFilters` missing. The verification process replaced the portable gem's `Dir[]` lookup for installed `jekyll/**/*.rb` patterns and the `Dir.glob` lookup for the `_fics/*.md` front matter scope with `Dir.children` plus filename filtering. Both changes were confined to the Ruby process running the checks.

Run `node --expose-gc tests/discovery-benchmark.cjs` for the synthetic catalog benchmarks. Each work carries varied summary paragraphs and 16–38 additional tags. The engine builds typed lookup data at creation and caches analyzed text on first use, after applying structured predicates. Timings for search and tag filtering include their result sorting, pagination and facets. The standalone sort measures all rows, and page slicing is timed separately. Heap deltas are approximate and exclude the already allocated input catalog. Synthetic gzip sizes benefit from repeated text and are directional rather than a production estimate.

Medians from Node 25.2.1 on Windows x64, after warmup. Cold search creates a fresh engine before running the first text query. The browser check verified layout and navigation at a phone viewport. These timings do not measure a physical phone or network startup.

| Works | Catalog bytes | Gzip bytes | Normalize ms | Engine setup ms | Cold search ms | Warm search ms | Tag filters ms | Sort ms | Page slice µs | Heap after search MiB |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 24 | 54,029 | 5,205 | 0.129 | 1.053 | 3.038 | 0.356 | 0.011 | 0.003 | 0.025 | 0.65 |
| 300 | 683,305 | 48,038 | 1.469 | 15.164 | 32.177 | 3.540 | 0.402 | 0.045 | 0.065 | 3.68 |
| 1,300 | 2,961,587 | 201,277 | 5.570 | 77.210 | 144.226 | 8.032 | 1.136 | 0.124 | 0.044 | 9.24 |
| 5,000 | 11,403,222 | 769,200 | 25.387 | 273.094 | 522.810 | 25.001 | 3.195 | 0.576 | 0.054 | 30.37 |

At 1,300 works the warm query and tag filter are comfortably within the Phase 1 interaction budget on this host. Startup and first text indexing are the costs to profile on a real phone. The 5,000-work fixture shows where a worker or a prebuilt compact index could become useful. Keep the current linear scan for the measured target collection.

## Phase 4 handoff

Render AO3-style blurbs from `results.works` and build linked tag scopes from the original label plus its type. Use `matchingIds` and the pagination model for navigation and preserve encoded state in result links. Use `facets` to render counts and keep selected values available at zero. Keep the Work Search route distinct from tag browsing. Date and popularity labels should reflect known source metadata, and the tag graph can grow through reviewed entries without editing works.
