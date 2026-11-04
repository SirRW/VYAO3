# RadioApple Reader

An unofficial, noncommercial fanfiction reader. The work and chapter views follow the layout of Archive of Our Own. RadioApple Reader is independent of the Organization for Transformative Works.

## Open locally

On Windows, double-click `Atualizar biblioteca.cmd` after adding or editing a fic. It rebuilds the catalogue and opens the local library. The launcher uses the portable Jekyll in `%LOCALAPPDATA%\RadioAppleReader\jekyll` when available, or a Jekyll installation on `PATH`.

Open `_site/index.html` to revisit the last build. The `_site/` folder is generated output. On other systems with Jekyll installed, run `jekyll build` to refresh it.

Jekyll generates the work catalogue and one data file per fic. The browser uses the same HTML, CSS and JavaScript for all works. The original RadioApple preview is in [`_fics/radioapple.md`](_fics/radioapple.md). [`The Lighthouse Ledger`](_fics/the-lighthouse-ledger.md) is a separate test work with two chapters.

## Add a fic

1. Copy [fic-template.md](fic-template.md) to `_fics/` as `work-title.md`. Use a unique lowercase name with letters, numbers and hyphens. The name determines the work's link, so keep it when updating a fic.
2. Fill in `title` and any known metadata in the YAML header. Leave unknown fields blank. Put the complete work below the header, keeping one blank line between paragraphs. Markdown supports emphasis, strong emphasis and horizontal rules for scene breaks.
3. For multiple chapters, use `## Chapter 1`, `## Chapter 2: Optional Title`, and so on, in reading order. A work without those headings is treated as one chapter. For notes at the start, write `### Notes`, the note, then `### Text` before the prose. For notes at the end, use `### End Notes` after the prose.
4. On GitHub, open `_fics/`, choose **Add file → Upload files**, drop the `.md` file and commit it to the publishing branch. The fic appears in **Works** after Pages finishes building.

The GitHub Pages source can be **Deploy from a branch → main → /(root)**. Include `_config.yml`, `_layouts/`, `_fics/` and `fic-catalog.js` with the reader source files. Pages runs its built-in Jekyll build when `.nojekyll` is absent. [GitHub Pages publishing sources](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## Converter uma fic no ChatGPT do navegador

Anexe o PDF ou Markdown original e o arquivo [fic-template.md](fic-template.md). Cole este prompt.

```text
Converta a fic anexada em um único arquivo Markdown UTF-8 para o RadioApple Reader, seguindo o fic-template.md anexado. Entregue o .md completo para download, com nome em letras minúsculas, números e hífens, sem espaços.

Preencha o cabeçalho YAML com os metadados disponíveis na fonte. O título é obrigatório. Se o título não estiver disponível, pergunte. Deixe os demais campos desconhecidos vazios. Preserve a classificação e os avisos quando estiverem na fonte.

Copie o texto integral no idioma original. Não traduza, corrija, resuma nem complete a narrativa. Preserve parágrafos, itálicos, negritos, quebras de cena e notas. Em PDF, remova apenas quebras de linha da diagramação, números de página e cabeçalhos ou rodapés repetidos. Se um trecho estiver ilegível ou incompleto, indique as páginas no chat e peça uma fonte legível antes de entregar o arquivo final.

Use Markdown, sem HTML. Separe parágrafos com uma linha em branco. Para vários capítulos, use ## Chapter 1, ## Chapter 2: Título e assim por diante, seguindo a ordem original. Para nota inicial, use ### Notes e depois ### Text antes da narrativa. Para nota final, use ### End Notes depois da narrativa. Preserve uma chave literal que inicie {{ ou {% como &#123; para evitar que o GitHub Pages a interprete como template.

O arquivo final deve começar diretamente com a linha --- do cabeçalho YAML, sem cercas de código, instruções ou comentários da conversão.
```

The reader opens in dark mode by default. Use Reading Settings to change the chapter text size or switch to light mode. The browser stores both preferences locally. The update to dark mode preserves the text size from earlier versions.

## Visual references and scope

- The [official default stylesheets](https://github.com/otwcode/otwarchive/tree/master/public/stylesheets/site/2.0) inform the narrow layout, typography, metadata and buttons. The [official work template](https://github.com/otwcode/otwarchive/blob/master/app/views/works/show.html.erb) and [chapter template](https://github.com/otwcode/otwarchive/blob/master/app/views/chapters/_chapter.html.erb) inform the order of the reading sections.
- The [AO3 logo](https://github.com/otwcode/otwarchive/blob/master/public/images/ao3_logos/logo_42.png) and [red tile](https://github.com/otwcode/otwarchive/blob/master/public/images/skins/textures/tiles/red-ao3.png) are local copies of assets from the OTW repository.
- The reader uses a dedicated work overview with a chapter list, static tags, a works catalogue and a custom dark theme. It keeps the prototype's 16 px default chapter text and slightly taller touch controls.
- Chrome was checked at 320, 360, 375, 390, 768 and 1440 px. The visual review used reader screenshots at 390 and 1440 px. The AO3 comparison was based on official code and indexed work pages because a live or Wayback mobile capture was unavailable for direct comparison.
