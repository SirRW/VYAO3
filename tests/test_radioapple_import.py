import contextlib
import io
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from pypdf import PdfWriter
from pypdf.annotations import Link
from pypdf.generic import (DecodedStreamObject, DictionaryObject, NameObject, NumberObject)

from tools.radioapple_import.__main__ import (DEFAULT_SOURCE, ImportProblem, STATE_DIR, approvals_from, file_hash, run)
from tools.radioapple_import.converter import Chapter, Conversion, convert, front_matter, markdown, validate
from tools.radioapple_import.layout import Line


REPO = Path(__file__).resolve().parents[1]


def draw(text, left, top, size=12, font="F1"):
    literal = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return f"BT /{font} {size} Tf {left} {842 - top} Td ({literal}) Tj ET"


def center(text, top, size=12, font="F1"):
    return draw(text, (595 - len(text) * size * 0.51) / 2, top, size, font)


def pdf_fixture(path, *, profile="qt", work_id=1001, chapters=1, declared=None,
                ending="The narrator turns the page.", chapter_two="Epilogue", restriction=False,
                image=False, link=False, title=True, empty_middle=False, split_preface=False):
    writer = PdfWriter()
    writer.add_metadata({"/Producer": "Qt 4.8.7" if profile == "qt" else "Skia/PDF m102"})
    path.parent.mkdir(parents=True, exist_ok=True)
    body_left = 58 if profile == "qt" else 65
    notes_left = 77 if profile == "qt" else 79
    origin = f"https://archiveofourown.org/works/{work_id}"

    def add_page(commands):
        page = writer.add_blank_page(595, 842)
        fonts = DictionaryObject()
        for key, name in enumerate(("Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"), 1):
            fonts[NameObject(f"/F{key}")] = DictionaryObject({
                NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/" + name), NameObject("/Encoding"): NameObject("/WinAnsiEncoding"),
            })
        resources = DictionaryObject({NameObject("/Font"): fonts})
        if any("/Pic Do" in command for command in commands):
            picture = DecodedStreamObject()
            picture.set_data(b"\x00\x80\xff")
            picture.update({NameObject("/Type"): NameObject("/XObject"), NameObject("/Subtype"): NameObject("/Image"),
                            NameObject("/ColorSpace"): NameObject("/DeviceRGB"), NameObject("/Width"): NumberObject(1),
                            NameObject("/Height"): NumberObject(1), NameObject("/BitsPerComponent"): NumberObject(8)})
            resources[NameObject("/XObject")] = DictionaryObject({NameObject("/Pic"): writer._add_object(picture)})
        page[NameObject("/Resources")] = resources
        stream = DecodedStreamObject()
        stream.set_data("\n".join(commands).encode("cp1252"))
        page[NameObject("/Contents")] = writer._add_object(stream)

    cover = [center("A paper planet", 39, font="F2")] if title else []
    cover += [draw("Posted originally on the Archive of Our Own at " + origin, 40, 56, 10),
              draw("Rating: Teen And Up Audiences", 47, 94), draw("Fandom: Test Fandom, Second Fandom", 47, 111),
              draw("Relationship: Planet/Moon, Planet &", 47, 128), draw("Comet", 167, 143),
              draw("Language: English", 47, 160),
              draw("Stats: Published: 2024-01-02 Updated: 2024-03-01 Chapters: "
                   f"{declared or chapters}/{declared or chapters}", 47, 177)]
    if split_preface:
        add_page(cover[:-3])
        cover = cover[-3:]
    elif profile == "skia":
        add_page(cover)
        cover = []
    if title:
        cover.append(center("A paper planet", 229, 18, "F2"))
    if split_preface:
        add_page([*cover, center("by Test", 259)])
        cover = [center("Author", 40)]
    else:
        cover.append(center("by Test Author", 259))
    cover += [draw("Summary", 40, 286),
              draw("A \"summary\" with a colon: and brackets [like these].", notes_left, 336), draw("Notes", 40, 370),
              draw("Please do not repost this story." if restriction else "Opening work note.", notes_left, 405),
              center("Chapter 1: Liftoff", 460, 15, "F2"), draw("Chapter Notes", 43, 486),
              draw("Opening chapter note.", 89, 516),
              f"BT /F1 12 Tf {body_left} 286 Td (This is ) Tj /F3 12 Tf (italic) Tj /F1 12 Tf ( and ) Tj "
              "/F2 12 Tf (bold) Tj /F1 12 Tf (.) Tj ET",
              draw("An intentional line break.", body_left, 571), draw("The next line.", body_left, 586),
              "60 223 m 530 223 l S", draw("# Chapter 99 stays literal.", body_left, 651),
              draw("Chapter End Notes", 43, 700), draw("Closing chapter note.", 89, 742)]
    if chapters == 1:
        cover.extend([draw("End Notes", 40, 778), draw("Closing work note.", notes_left, 812)])
    add_page(cover)
    if split_preface:
        writer.add_annotation(len(writer.pages) - 1, Link(rect=(271, 798, 323, 815),
                                                            url="https://archiveofourown.org/users/Test_Author"))
    if link:
        writer.add_annotation(len(writer.pages) - 1, Link(rect=(body_left, 276, body_left + 85, 290),
                                                            url="https://example.invalid/story-note"))
    if empty_middle:
        add_page([])
    if image:
        add_page([" q 300 0 0 400 45 200 cm /Pic Do Q "])
    tail = []
    if chapters > 1:
        tail.extend([center(chapter_two, 40, 15, "F2"), draw(ending, body_left, 92),
                     draw("End Notes", 40, 150), draw("Closing work note.", notes_left, 185)])
    tail.append(draw("Please drop by the Archive and comment to let the creator know if you enjoyed their work!",
                     60, 252, 10))
    add_page(tail)
    writer.write(path)


class ExtractTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.pdf = self.root / "sample.pdf"

    def test_qt_one_shot_metadata_and_prose(self):
        pdf_fixture(self.pdf)
        result = convert(self.pdf)
        self.assertEqual(result.status, "ready_with_missing_metadata", result.issues)
        self.assertEqual(result.profile, "qt")
        self.assertEqual(result.metadata["relationship"], ["Planet/Moon", "Planet & Comet"])
        self.assertEqual(result.metadata["updatedAt"], "2024-03-01")
        self.assertEqual(result.metadata["source"]["workId"], "1001")
        self.assertEqual(result.metadata["warning"], [])
        self.assertIn("warning", result.missing)
        output = markdown(result)
        self.assertIn('fandom: ["Test Fandom", "Second Fandom"]', output)
        self.assertIn('summary: "A \\"summary\\" with a colon: and brackets [like these]."', output)
        self.assertIn("This is *italic* and **bold**.", output)
        self.assertIn("An intentional line break.  \nThe next line.\n\n---", output)
        self.assertIn("&#35; Chapter 99 stays literal.", output)
        self.assertIn("#### Work Notes\n\nOpening work note.", output)
        self.assertIn("#### Chapter Notes\n\nOpening chapter note.", output)
        self.assertIn("#### Chapter End Notes\n\nClosing chapter note.", output)
        self.assertIn("#### Work End Notes\n\nClosing work note.", output)
        self.assertNotIn("Please drop by", output)

    def test_skia_two_chapters_and_unnumbered_title(self):
        pdf_fixture(self.pdf, profile="skia", chapters=2)
        result = convert(self.pdf)
        self.assertEqual(result.status, "ready_with_missing_metadata", result.issues)
        self.assertEqual(result.profile, "skia")
        self.assertEqual(result.metadata["chaptersAvailable"], 2)
        self.assertEqual([chapter.title for chapter in result.chapters], ["Liftoff", "Epilogue"])
        self.assertIn("## Chapter 2: Epilogue\n\nThe narrator turns the page.", markdown(result))

    def test_cover_rows_and_byline_continue_across_pages(self):
        pdf_fixture(self.pdf, profile="skia", split_preface=True)
        result = convert(self.pdf)
        self.assertEqual(result.status, "ready_with_missing_metadata", result.issues)
        self.assertEqual(result.metadata["relationship"], ["Planet/Moon", "Planet & Comet"])
        self.assertEqual(result.metadata["author"], "Test Author")
        self.assertEqual(result.metadata["creators"], [{"name": "Test Author",
                         "url": "https://archiveofourown.org/users/Test_Author"}])

    def test_image_links_and_missing_title_hold_staged_text(self):
        pdf_fixture(self.pdf, chapters=2, image=True, link=True, title=False)
        result = convert(self.pdf)
        self.assertEqual(result.status, "needs_review")
        self.assertEqual(result.metadata["title"], "")
        for issue in ("missing_title", "embedded_image", "meaningful_link"):
            self.assertTrue(result.issues[issue, "review"], result.issues)
        self.assertIn("The narrator turns the page.", markdown(result))

    def test_chapter_number_gap_and_missing_chapter(self):
        pdf_fixture(self.pdf, chapters=2, declared=3, chapter_two="Chapter 3: Landing")
        result = convert(self.pdf)
        self.assertEqual(result.status, "needs_review")
        self.assertIn(("chapter_count_mismatch", "review"), result.issues)
        self.assertIn(("chapter_number_out_of_sequence", "review"), result.issues)

    def test_blank_interior_page(self):
        pdf_fixture(self.pdf, chapters=2, empty_middle=True)
        result = convert(self.pdf)
        self.assertEqual(result.issues["unexpected_empty_page", "review"], {2})

    def test_duplicate_bodies_and_word_discrepancy(self):
        result = Conversion(metadata=front_matter({"stats": "Words: 200 Chapters: 2/2"}, "Test", "", [], ""))
        result.chapters = [Chapter(body=[Line(page, 40, 58, 120, 595, 842, 12, "Times-Roman", (("Identical prose.", ""),))])
                           for page in (2, 3)]
        validate(result, set(), set())
        self.assertEqual(result.issues["duplicate_chapter_body", "review"], {2, 3})
        self.assertIn(("word_count_discrepancy", "review"), result.issues)

    def test_real_exports_when_available(self):
        samples = (("Shameless_/Every Love and Every.pdf", "qt", 1),
                   ("Arcane_/A_Soft_but_True_Light.pdf", "skia", 1))
        for relative, profile, chapters in samples:
            with self.subTest(relative=relative):
                path = REPO / "Archive of MY own" / relative
                if not path.is_file():
                    self.skipTest("Local archive fixture is absent")
                result = convert(path)
                self.assertEqual(result.status, "ready_with_missing_metadata", result.issues)
                self.assertEqual(result.profile, profile)
                self.assertEqual(result.metadata["chaptersAvailable"], chapters)
                self.assertLessEqual(abs(result.metadata["wordCount"] - result.words), 5)


class BatchTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.source = self.root / DEFAULT_SOURCE
        self.source.mkdir()
        self.state = self.root / STATE_DIR
        self.fics = self.root / "_fics"
        self.fics.mkdir()
        self.one = self.source / "a" / "sample.pdf"
        pdf_fixture(self.one)

    def batch(self, paths=(), dry_run=False, approvals=None):
        with contextlib.redirect_stdout(io.StringIO()):
            _, report = run(self.root, self.source, paths, dry_run, approvals)
        return json.loads(report.read_text(encoding="utf-8"))

    def test_dry_run_duplicate_and_repeat_preserve_staged_bytes(self):
        clone = self.source / "nested" / "same basename.pdf"
        clone.parent.mkdir()
        shutil.copyfile(self.one, clone)
        dry = self.batch(dry_run=True)
        self.assertEqual(dry["summary"]["duplicate"], 1)
        self.assertFalse((self.state / "manifest.json").exists())
        self.assertFalse((self.state / "works").exists())
        first = self.batch()
        stage = self.state / first["results"][0]["stagedPath"]
        timestamp = stage.stat().st_mtime_ns
        manifest = self.state / "manifest.json"
        manifest_timestamp = manifest.stat().st_mtime_ns
        second = self.batch()
        self.assertTrue(second["results"][0]["unchanged"])
        self.assertEqual(stage.stat().st_mtime_ns, timestamp)
        self.assertEqual(manifest.stat().st_mtime_ns, manifest_timestamp)
        self.assertEqual(len(list((self.state / "works").glob("*.md"))), 1)
        self.assertEqual(list(self.fics.iterdir()), [])

    def test_snapshot_conflict_and_unreadable_pdf_do_not_stop_batch(self):
        self.assertEqual(self.batch(paths=(self.one,))["summary"]["converted"], 1)
        second = self.source / "b" / "sample.pdf"
        pdf_fixture(second, chapters=2)
        (self.source / "invalid.pdf").write_bytes(b"This is not a PDF")
        report = self.batch(approvals={"ao3-1001": file_hash(self.one)})
        self.assertEqual(report["summary"]["needs_review"], 2)
        self.assertEqual(report["summary"]["failed"], 1)
        self.assertEqual(report["promotion"][0]["status"], "held")
        self.assertEqual(len(list((self.state / "works").glob("*.md"))), 2)
        retry = self.batch(paths=(self.one,), approvals={"ao3-1001": file_hash(self.one)})
        self.assertEqual(retry["summary"]["needs_review"], 1)
        self.assertEqual(retry["promotion"][0]["reason"], "needs_review")

    def test_allowlist_pins_bytes_and_preserves_manual_edits(self):
        digest = file_hash(self.one)
        with_wrong_hash = self.batch(approvals={"ao3-1001": "0" * 64})
        self.assertEqual(with_wrong_hash["promotion"][0]["reason"], "approved_source_not_selected")
        approved = self.batch(approvals={"ao3-1001": digest})
        self.assertEqual(approved["promotion"][0]["status"], "promoted")
        repeated = self.batch(approvals={"ao3-1001": digest})
        self.assertEqual(repeated["promotion"][0]["status"], "already_present")
        live = self.fics / "ao3-1001.md"
        live.write_text("manual public edit", encoding="utf-8")
        blocked = self.batch(approvals={"ao3-1001": digest})
        self.assertEqual(blocked["promotion"][0]["reason"], "existing_work_preserved")
        self.assertEqual(live.read_text(encoding="utf-8"), "manual public edit")
        staged = self.state / approved["results"][0]["stagedPath"]
        staged.write_text("manual local edit", encoding="utf-8")
        flagged = self.batch(approvals={"ao3-1001": digest})
        self.assertEqual(flagged["summary"]["needs_review"], 1)
        self.assertEqual(staged.read_text(encoding="utf-8"), "manual local edit")

    def test_restriction_and_guide(self):
        restricted = self.source / "restricted.pdf"
        pdf_fixture(restricted, work_id=1002, restriction=True)
        guide = self.source / "1 Before using read this" / "DISCLAIMERS BEFORE USING THIS DRIVE.pdf"
        guide.parent.mkdir()
        guide.write_bytes(b"The archive guide is skipped by its known path.")
        report = self.batch(approvals={"ao3-1002": file_hash(restricted)})
        self.assertEqual(report["summary"]["non_work"], 1)
        self.assertEqual(report["promotion"][0]["reason"], "repost_restricted")
        self.assertFalse((self.fics / "ao3-1002.md").exists())

    def test_approval_file_requires_full_source_hash(self):
        approvals = self.state / "approvals.txt"
        approvals.parent.mkdir()
        approvals.write_text("ao3-1001\n", encoding="utf-8")
        with self.assertRaises(ImportProblem):
            approvals_from(approvals)
        digest = file_hash(self.one)
        approvals.write_text(f"# approved snapshot\nao3-1001 {digest}\n", encoding="utf-8")
        self.assertEqual(approvals_from(approvals), {"ao3-1001": digest})
