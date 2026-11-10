# RadioApple Reader

An unofficial, noncommercial fanfiction reader. The work and chapter views follow the layout of Archive of Our Own. RadioApple Reader is independent of the Organization for Transformative Works.

## Open locally

On Windows, double-click `Atualizar biblioteca.cmd` after adding or editing a fic. It rebuilds the catalogue and opens the local library. The launcher uses the portable Jekyll in `%LOCALAPPDATA%\RadioAppleReader\jekyll` when available, or a Jekyll installation on `PATH`.

Open `_site/index.html` to revisit the last local build of the public catalog. On other systems with Jekyll installed, run `jekyll build` to refresh it. The site uses dark mode. Reading Settings saves the chapter text size in the browser.

For imported works, double-click `Importar fanfics.cmd`. This imports new files, rebuilds the private library, and opens it in your browser. Reopen `.radioapple-import/preview/index.html` any time. To rebuild the preview without scanning the archive, use `& '.\Atualizar biblioteca.cmd' --preview`.

The private library combines regular works with importer snapshots in `_fics/` and `.radioapple-import/works/`. Regular Markdown takes precedence. When the same work has multiple private copies, the preview prefers EPUB, then DOCX, then PDF or an older snapshot. Conflicting copies at the same priority are reported and skipped. The preview and its sources are excluded from the public build.

Jekyll generates the work catalogue and one data file per fic. The browser uses the same HTML, CSS and JavaScript for all works. The original RadioApple preview is in [`_fics/radioapple.md`](_fics/radioapple.md).

## Import a fic on Windows

1. Put the `.pdf`, `.epub`, `.docx`, or RadioApple Markdown snapshot in `Archive of MY own/` or one of its subfolders.
2. Double-click `Importar fanfics.cmd`. When it finishes, your updated private library opens automatically.

For works you have permission to share, put the source in `Archive of MY own/Para publicar/` before running the same script. The script adds eligible works to `_fics/` and refreshes the static Pages package in `_pages/` in that run. Files elsewhere in the archive stay private. To deploy the package, follow the Pages release steps below.

The importer supports AO3 PDF exports, unencrypted EPUBs (including AO3 exports), and DOCX documents with readable text. It keeps chapter divisions, prose, basic emphasis, and scene breaks. Embedded media, some links, and complex layouts may require review. The script reports those cases and can still open any readable local copy. Conflicting exports and repost restrictions block promotion. The report stays in `.radioapple-import/reports/`.

Markdown snapshots from earlier imports can go directly into `Para publicar/`, including files named `ao3-…--<hash>.md`. The script checks the chapter structure and known import warnings, then copies eligible files into `_fics/` with their stable work IDs. Handwritten Markdown still uses the template below.

To remove a promoted work, take its source out of `Para publicar/`, move its Markdown out of `_fics/`, and rebuild `_pages/`. If you used an explicit approval list, also remove its entry there. To remove an imported work from the private library, move the source out of the scanned archive and remove its matching private snapshots from `.radioapple-import/works/` and, if present, `_fics/`. Run the import script again to refresh the preview.

## Add or edit a fic in Markdown

1. Copy [fic-template.md](fic-template.md) to `_fics/` as `work-title.md`. Use a unique lowercase name with letters, numbers and hyphens. The name determines the work's link, so keep it when updating a fic.
2. Fill in `title` and any known metadata in the YAML header. Leave unknown fields blank. Put the complete work below the header, keeping one blank line between paragraphs. Markdown supports emphasis, strong emphasis and horizontal rules for scene breaks.
3. For multiple chapters, use `## Chapter 1`, `## Chapter 2: Optional Title`, and so on, in reading order. A work without those headings is treated as one chapter. For notes at the start, write `### Notes`, the note, then `### Text` before the prose. For notes at the end, use `### End Notes` after the prose.
4. Run `Atualizar biblioteca.cmd` and open **Works**. A file named `ao3-…--<hash>.md` or `local-…--<hash>.md` is a private review snapshot. Use the private preview to read it.

To update an existing work, edit its source Markdown in `_fics/` and keep the filename to preserve the link. To remove a work from the public library, move its Markdown outside `_fics/` and rebuild. The build recreates both `fic-data/catalog.js` and the per-work `work.js` files.

## Publish a prebuilt site to GitHub Pages

Build on your computer with PowerShell from the repository folder.

```powershell
& '.\Atualizar biblioteca.cmd' --pages
```

This creates `_pages/` with the compiled catalog, one reader payload per work, and the static interface. It includes a root `.nojekyll` file. The exporter reads the public Markdown in `_fics/` and excludes importer snapshots. PDFs, the private preview, and import reports are outside its build source. Rebuilding replaces the previous export, including payloads for removed works.

1. In a separate working folder for the `gh-pages` branch, commit the **contents** of `_pages/` at the branch root, including the hidden `.nojekyll` file. On subsequent releases, remove generated files that disappeared from the export.
2. On GitHub, set **Settings → Pages → Deploy from a branch → gh-pages → /(root)** once. Keep the editable project on `main`.
3. For each update, rerun the command, commit the exported files on `gh-pages`, and push that branch.

For the first publication, this PowerShell example creates a new publishing checkout beside the project. The path `..\VYAO3-pages` must be available.

```powershell
$export = (Resolve-Path -LiteralPath '.\_pages').Path
$publish = (New-Item -ItemType Directory -Path '..\VYAO3-pages' -ErrorAction Stop).FullName
git -C $publish init -b gh-pages
git -C $publish remote add origin https://github.com/SirRW/VYAO3.git
Get-ChildItem -LiteralPath $export -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $publish -Recurse -Force
}
git -C $publish add -A
git -C $publish diff --cached --name-status
git -C $publish commit -m "Publish static reader"
git -C $publish push -u origin gh-pages
```

For later releases, reuse that checkout. Replace its generated `fic-data/` directory with the fresh one from `_pages/`, copy the other exported files, and review the staged deletions before pushing. The source repository ignores `_pages/`, `_site/`, the PDF archive, and import state.

For the editable project on `main`, stage the source and any approved Markdown. The local audit documents and PDF regression fixtures include sample filenames. Review those separately if you want to include them in the public repository.

Pages deploys the static output with no Jekyll build step. The existing deploy timeout and published-site size limit still apply. The export can also be served by other static hosts. The import script handles Markdown conversion and compilation locally. [GitHub Pages publishing sources](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) · [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)

## Import setup and advanced options

Install Python 3.11 or later. Run these commands once from the repository folder in PowerShell.

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-import.txt
```

If `py` is unavailable, use `python -m venv .venv` for the first command.

To import a selection, pass file or directory paths relative to `Archive of MY own/`. Use `--build-only` to refresh the library without opening the browser.

```powershell
& '.\Importar fanfics.cmd' 'Fandom/minha-fic.epub'
& '.\Importar fanfics.cmd' --build-only 'Fandom'
& '.\Importar PDFs.cmd' --dry-run 'Fandom/minha-fic.pdf'
```

The equivalent command for the full import and library update is `.\.venv\Scripts\python.exe -m tools.radioapple_import --library`. An alternate `--source` can point to a folder outside the repository or a subfolder of `Archive of MY own/`. The legacy `Importar PDFs.cmd` name still works with the same formats.

The command prints paths to a text report and a JSON report in `.radioapple-import/reports/`. Dry runs write reports only. Normal imports also write Markdown in `.radioapple-import/works/` and update `.radioapple-import/manifest.json`. Keep this directory for deduplication and review. `ready_with_missing_metadata` is eligible when the report lists only missing optional information. `needs_review` entries include page numbers where possible. The process returns `1` for an extraction failure or held promotion and `2` for a command or setup error. Review-only results are listed in the report.

### Promote snapshots with an explicit approval list

Once you have confirmed which works can be redistributed, put their work IDs and full source SHA-256 values from the report in `.radioapple-import/approvals.txt`. Use one pair per line, separated by a space. Lines starting with `#` are comments. A single file can approve an entire reviewed batch.

```text
# Format for each approved snapshot
# ao3-WORK_ID FULL_SOURCE_SHA256
```

```powershell
& '.\Importar PDFs.cmd' --promote '.radioapple-import/approvals.txt'
```

The command scans the archive and copies eligible works from the list into `_fics/` under their stable filenames. You can include the same file or directory selection used for staging. Promotion requires the matching source file. A changed source needs a new approval hash. A repost restriction, unresolved extraction issue, or conflicting snapshot holds the work in staging. Existing works take precedence at the destination. Run `Atualizar biblioteca.cmd --pages` to rebuild the publishing package after this advanced command. Keep approvals, source files and reports local.

See the [Phase 2 technical report](docs/phase-2-pdf-importer.md) for the pilot results, tests, and supported formats.

## Converter uma fic no ChatGPT do navegador

Anexe o PDF ou Markdown original e o arquivo [fic-template.md](fic-template.md). Cole este prompt.

```text
Converta a fic anexada em um único arquivo Markdown UTF-8 para o RadioApple Reader, seguindo o fic-template.md anexado. Entregue o .md completo para download, com nome em letras minúsculas, números e hífens, sem espaços.

Preencha o cabeçalho YAML com os metadados disponíveis na fonte. O título é obrigatório. Se o título não estiver disponível, pergunte. Deixe os demais campos desconhecidos vazios. Preserve a classificação e os avisos quando estiverem na fonte.

Copie o texto integral no idioma original. Não traduza, corrija, resuma nem complete a narrativa. Preserve parágrafos, itálicos, negritos, quebras de cena e notas. Em PDF, remova apenas quebras de linha da diagramação, números de página e cabeçalhos ou rodapés repetidos. Se um trecho estiver ilegível ou incompleto, indique as páginas no chat e peça uma fonte legível antes de entregar o arquivo final.

Use Markdown, sem HTML. Separe parágrafos com uma linha em branco. Para vários capítulos, use ## Chapter 1, ## Chapter 2: Título e assim por diante, seguindo a ordem original. Para nota inicial, use ### Notes e depois ### Text antes da narrativa. Para nota final, use ### End Notes depois da narrativa. Preserve uma chave literal que inicie {{ ou {% como &#123; para evitar que o GitHub Pages a interprete como template.

O arquivo final deve começar diretamente com a linha --- do cabeçalho YAML, sem cercas de código, instruções ou comentários da conversão.
```

## Visual references and scope

- The [official default stylesheets](https://github.com/otwcode/otwarchive/tree/master/public/stylesheets/site/2.0) inform the narrow layout, typography, metadata and buttons. The [official work template](https://github.com/otwcode/otwarchive/blob/master/app/views/works/show.html.erb) and [chapter template](https://github.com/otwcode/otwarchive/blob/master/app/views/chapters/_chapter.html.erb) inform the order of the reading sections.
- The [AO3 logo](https://github.com/otwcode/otwarchive/blob/master/public/images/ao3_logos/logo_42.png) is a local copy from the OTW repository.
- The reader uses a dedicated work overview with a chapter list, static tags, a works catalogue and a custom dark theme. It keeps the prototype's 16 px default chapter text and slightly taller touch controls.
- Chrome was checked at 320, 360, 375, 390, 768 and 1440 px. The visual review used reader screenshots at 390 and 1440 px. The AO3 comparison was based on official code and indexed work pages because a live or Wayback mobile capture was unavailable for direct comparison.
