import contextlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

from tools.radioapple_import.__main__ import DEFAULT_SOURCE, PUBLISH_INBOX, STATE_DIR, run
from tools.radioapple_import.books import WORD, docx, epub
from tools.radioapple_import.converter import markdown, plain_text


def epub_fixture(path, work_id=1001, restriction=False):
    with ZipFile(path, "w") as book:
        book.writestr("META-INF/container.xml", '<container><rootfiles><rootfile full-path="EPUB/book.opf"/>'
                      '</rootfiles></container>')
        book.writestr("EPUB/book.opf", """<package><metadata><title>Paper planet</title>
          <creator>Test Writer</creator><language>en</language></metadata><manifest>
          <item id="second" href="a.xhtml" media-type="application/xhtml+xml"/>
          <item id="first" href="b.xhtml" media-type="application/xhtml+xml"/>
          <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
          </manifest><spine><itemref idref="cover"/><itemref idref="first"/><itemref idref="second"/>
          </spine></package>""")
        book.writestr("EPUB/cover.xhtml", f"""<html><body><div id="preface">
          <p>Posted originally on the Archive of Our Own at https://archiveofourown.org/works/{work_id}.</p>
          <dl><dt>Additional Tags:</dt><dd><a>Space, actually</a>, <a>AU</a></dd>
          <dt>Stats:</dt><dd>Chapters: 2/2</dd></dl>
          <p>Summary</p><blockquote>On a paper planet.</blockquote>
          <p>Notes</p><blockquote>{"Please do not repost." if restriction else "Hello!"}</blockquote>
          </div></body></html>""")
        book.writestr("EPUB/b.xhtml", """<html><body><div id="chapters"><div id="chapter-1">
          <div class="meta"><h2>Chapter 1: Lift-off</h2><p>Chapter Notes</p><blockquote>A note.</blockquote></div>
          <div class="userstuff story"><p>First <em>paragraph</em>.</p><hr/><p>A new scene.</p></div>
          <div id="endnotes1"><blockquote>A closing note.</blockquote></div>
          </div></div></body></html>""")
        book.writestr("EPUB/a.xhtml", """<html><body><div id="chapters"><div><h2>Chapter 2</h2></div>
          <div class="userstuff2"><p>Second chapter.</p></div></div></body></html>""")


def docx_fixture(path):
    def para(value, style=""):
        return f'<w:p>{style}<w:r><w:t>{value}</w:t></w:r></w:p>'

    heading = '<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>'
    body = (para("Preface", heading) + para("Paper moon")
            + para("Posted originally on the Archive of Our Own at https://archiveofourown.org/works/1002.")
            + '<w:p><w:r><w:t>Rating: Teen Additional Tags: </w:t></w:r>'
              '<w:hyperlink><w:r><w:t>Space, actually</w:t></w:r></w:hyperlink>'
              '<w:r><w:t> Stats: Chapters: 2/2</w:t></w:r></w:p>'
            + para("Paper moon") + para("by Test Writer") + para("Summary") + para("A paper moon.")
            + para("Chapter 1: Landing") + para("The ship lands.")
            + '<w:p><w:r><w:pict><v:rect o:hr="t"/></w:pict></w:r></w:p>'
            + '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>The crew disembarks.</w:t></w:r></w:p>'
            + para("Chapter 2") + para("The moon rises.") + para("Afterword", heading)
            + para("This archive footer does not belong to the story."))
    with ZipFile(path, "w") as book:
        book.writestr("_rels/.rels", '<Relationships><Relationship Type="example/officeDocument"'
                      ' Target="content/story.xml"/></Relationships>')
        book.writestr("content/story.xml", f'<w:document xmlns:w="{WORD[1:-1]}" xmlns:v="urn:schemas-microsoft-com:vml"'
                      f' xmlns:o="urn:schemas-microsoft-com:office:office"><w:body>{body}</w:body></w:document>')


class BookTests(unittest.TestCase):
    def test_epub_uses_spine_order_and_preserves_tag_identity_and_notes(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "test.epub"
            epub_fixture(path)
            result = epub(path)
        self.assertEqual(result.status, "ready_with_missing_metadata")
        self.assertEqual(result.metadata["source"]["workId"], "1001")
        self.assertEqual(result.metadata["additionalTags"], ["Space, actually", "AU"])
        self.assertEqual(result.metadata["summary"], "On a paper planet.")
        self.assertEqual(plain_text(result.chapters[0].notes), "A note.")
        self.assertEqual(plain_text(result.chapters[0].end_notes), "A closing note.")
        self.assertEqual(plain_text(result.chapters[1].body), "Second chapter.")
        self.assertIn("First *paragraph*.\n\n---\n\nA new scene.", markdown(result))

    def test_docx_uses_package_relationship_and_retains_chapters_and_dividers(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "test.docx"
            docx_fixture(path)
            result = docx(path)
        self.assertEqual(result.status, "ready_with_missing_metadata")
        self.assertEqual(result.metadata["author"], "Test Writer")
        self.assertEqual(result.metadata["source"]["workId"], "1002")
        self.assertEqual(result.metadata["additionalTags"], ["Space, actually"])
        self.assertEqual(result.metadata["chaptersAvailable"], 2)
        data = markdown(result)
        self.assertIn("The ship lands.\n\n---\n\n**The crew disembarks.**", data)
        self.assertNotIn("archive footer", data)

    def test_one_command_keeps_unmarked_sources_private_and_blocks_repost_restrictions(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / DEFAULT_SOURCE
            inbox = source / PUBLISH_INBOX
            inbox.mkdir(parents=True)
            fics = root / "_fics"
            fics.mkdir()
            epub_fixture(inbox / "public.EPUB")
            epub_fixture(inbox / "restricted.epub", work_id=1003, restriction=True)
            docx_fixture(source / "private.docx")
            (source / "broken.epub").write_bytes(b"Not a valid EPUB")
            with patch("tools.radioapple_import.__main__.build_library") as build:
                with contextlib.redirect_stdout(io.StringIO()):
                    counts, _ = run(root, source, [], library=True)
            self.assertEqual([call.args[1] for call in build.call_args_list], ["--preview", "--pages"])
            self.assertEqual(counts["promoted"], 1)
            self.assertEqual(counts["promotion_held"], 1)
            self.assertEqual(counts["failed"], 1)
            self.assertEqual([path.name for path in fics.iterdir()], ["ao3-1001.md"])
            self.assertEqual(len(list((root / STATE_DIR / "works").glob("*.md"))), 3)

    def test_publication_inbox_validates_and_reuses_existing_markdown_snapshots(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / DEFAULT_SOURCE
            inbox = source / PUBLISH_INBOX / "works"
            inbox.mkdir(parents=True)
            fics = root / "_fics"
            fics.mkdir()
            with tempfile.TemporaryDirectory() as fixture_folder:
                fixture = Path(fixture_folder) / "test.epub"
                for work_id in (1001, 1002, 1003, 1004, 1005):
                    epub_fixture(fixture, work_id, restriction=work_id == 1003)
                    result = epub(fixture)
                    result.metadata["creators"][0]["url"] = "https://archiveofourown.org/users/Test"
                    if work_id == 1002:
                        result.chapters[-1].body.clear()
                    data = markdown(result)
                    if work_id == 1004:
                        data = data.replace("Hello!", "Hello\ufffd!")
                    if work_id == 1005:
                        data = data.replace("Second chapter.", "Second ch\ufffdpter.")
                    (inbox / f"ao3-{work_id}--{'a' * 64}.md").write_text(data, encoding="utf-8")

            with patch("tools.radioapple_import.__main__.build_library"), contextlib.redirect_stdout(io.StringIO()):
                counts, _ = run(root, source, [], library=True)
                repeated, _ = run(root, source, [], library=True)
            self.assertEqual(counts["scanned"], 5)
            self.assertEqual(counts["promoted"], 2)
            self.assertEqual(counts["promotion_held"], 3)
            self.assertEqual(repeated["promoted"], 0)
            self.assertEqual(sorted(path.name for path in fics.iterdir()), ["ao3-1001.md", "ao3-1004.md"])
            self.assertEqual((fics / "ao3-1001.md").read_bytes(),
                             (inbox / f"ao3-1001--{'a' * 64}.md").read_bytes())
