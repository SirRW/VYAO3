# RadioApple Reader — Phase 2 PDF importer

The Windows importer discovers AO3 PDF exports, stages UTF-8 Markdown, and writes text and JSON reports. A separate promotion option takes a list of approved source hashes and checks the conversion result before copying anything into `_fics/`. The pilot was staged locally. The public library still contains its two original Markdown works.

## Running it

Follow the [Windows setup and promotion instructions](../README.md#import-ao3-pdfs-on-windows). From PowerShell in the repository, use `& '.\Importar PDFs.cmd' --dry-run 'Arcane_'` to check a subfolder, or omit `--dry-run` to stage it. Pass multiple PDF or directory paths for a selected batch. Double-click the launcher to stage the default archive recursively. Once the publication list has been checked, `--promote .radioapple-import/approvals.txt` can stage and promote an approved batch in the same invocation.

The `.radioapple-import/` directory contains `works/`, `reports/` and `manifest.json`. Review the text report first. The JSON report includes source hashes, the parsed and declared chapter and word counts, validation severity, and one-based page references. An unchanged input with intact staging is served from the manifest. Byte-identical files share one staging entry. Differing conversions with the same AO3 ID are staged separately and held for review. Promotion uses a pinned work ID and input hash, checks the staged bytes, and preserves existing destination files. A manually edited staged file is also preserved and held.

## Extraction and safety

- [`layout.py`](../tools/radioapple_import/layout.py) uses `pdfplumber` to group glyphs by baseline, recover paragraph spacing and line joins, and identify fonts, annotations, images and rules. [`converter.py`](../tools/radioapple_import/converter.py) recognizes the sampled Qt 4.8.7 and Skia AO3 print layouts from the PDF producer and cover structure. It uses `pypdf` outline destinations as supporting evidence for Skia chapter headings. It writes schema v2 front matter and the reader's chapter and note markers. [pdfplumber](https://github.com/jsvine/pdfplumber) · [pypdf](https://pypdf.readthedocs.io/en/stable/).
- [`__main__.py`](../tools/radioapple_import/__main__.py), [`Importar PDFs.cmd`](../Importar%20PDFs.cmd), and [`requirements-import.txt`](../requirements-import.txt) provide the local CLI, Windows launcher and pinned dependencies. The CLI separates technical readiness from permission to redistribute, and recognized repost restrictions block promotion even when a hash is listed.
- [`.gitignore`](../.gitignore) keeps the archive, import state and Python environment files out of Git. [`_config.yml`](../_config.yml) excludes those files and local tools, tests and docs independently from Jekyll. The only reader change formats typed fandom arrays in the existing Works list. [Reader](../app.js).

## Pilot results

The workspace held 161 PDFs at the time of this run. Several suggested Phase 1 fixtures were absent, so the pilot conversion was limited to these eight available sources.

| PDF | Profile | Chapters extracted / declared | Result |
| --- | --- | --- | --- |
| `Arcane_/a_quiet_kind_of_ache.pdf` | Skia | 1/1 | Ready with missing metadata. The export has no category row. |
| `Arcane_/A_Soft_but_True_Light.pdf` | Skia | 1/1 | Ready with missing metadata. Opening work notes retained. |
| `Shameless_/Do you care at all.pdf` | Qt | 1/1 | Ready with missing metadata. Two fandom tags retained. |
| `Shameless_/Every Love and Every.pdf` | Qt | 1/1 | Ready with missing metadata. Wrapped relationship tag reconstructed. |
| `Shameless_/Are You There God Its.pdf` | Qt | 3/3 | Ready with missing metadata. Roman-numeral titles and final chapter notes retained. |
| `Supernatural_/The_Broken_Archangel.pdf` | Skia | 2/2 | Ready with missing metadata. Numbered chapters and inline italics retained. |
| `Atla __ LoK/Zukka/swords of fate pride of.pdf` | Qt | 3/3 | Held for review. Some glyphs lack a usable mapping, and notes contain links. |
| `Good Omens_/Marked For Later_/Good Endings.pdf` | Qt | 18/18 | Held for review. Embedded artwork, links and empty interior pages. Page 4 visibly contains a full-page illustration. |

The dry run and staging run classified six works as technically ready with missing metadata and two as needing review. The repeat run reused all eight staged records without rewriting Markdown. The pilot reports remain in `.radioapple-import/reports/`. Real PDFs were rendered with Poppler for visual spot checks of opening paragraphs, chapter transitions, emphasis, endings and notes. The imported works stayed in staging and temporary QA directories. Candidate scouting also checked chapter extraction from `Just_to_feel_you_breathe.pdf` (Skia, 4/4) and `Break A Leg.pdf` (Qt, 5/5).

## Verification and limits

Run `.\.venv\Scripts\python.exe -m unittest discover -s tests -v`. All 13 [tests](../tests/test_radioapple_import.py) passed, covering both profiles, wrapped tags, a cover and byline spanning multiple pages, Markdown structure and emphasis, work and chapter notes, duplicate and conflicting inputs, missing chapters, images, failed extraction and promotion checks. Synthetic fixtures are generated in temporary directories. Two optional real-export cases run when those PDFs are available locally.

The Jekyll 3.10.0 and Kramdown 2.4.0 checks used temporary build directories and an in-process workaround for Ruby globbing in the audit shell. The real repository build used its configured exclusions and emitted only the two existing works. The isolated build included the six ready imports and one synthetic two-chapter case alongside the existing works. A 390-pixel Chromium run checked typed fandoms in Works, Qt and Skia prose and chapter transitions, notes, italics, bold, line breaks, a scene rule and both existing works' chapter links.

PDFs do not encode every authorial paragraph or line break explicitly. The importer uses spacing and layout and holds clear ambiguity, unreadable glyphs and media-dependent content for review. Review partial Markdown alongside the cited PDF pages. Vector art and repost detection are heuristic, and the promotion list still requires source-permission review. Missing titles are staged for verification. Unsupported layouts, overlapping text and right-to-left text require review. Both snapshots stay staged when their converted content conflicts, and the CLI holds that work ID while the conflict remains in the manifest.

## Phase 3 handoff

Extend the catalog from v2 front matter while keeping legacy string fields readable. Use source word and chapter counts when available, preserve unknown warning and completion values, and leave prose in the per-work payloads. Keep the approval gate separate from discovery and keep archived PDFs and diagnostic files outside the public build.
