"""Parse the cover, preface, chapters and afterword of an AO3 PDF export."""

import json
import logging
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date
from unicodedata import bidirectional
from urllib.parse import unquote, urlsplit

import pdfplumber
from pypdf import PdfReader

from .layout import Line, font_style, join_lines, read_lines


TAG_FIELDS = {
    "archive warning": "warning", "archive warnings": "warning", "category": "category",
    "categories": "category", "fandom": "fandom", "fandoms": "fandom",
    "relationship": "relationship", "relationships": "relationship",
    "character": "characters", "characters": "characters", "additional tags": "additionalTags",
}
FIELDS = {**TAG_FIELDS, "rating": "rating", "language": "language", "stats": "stats",
          "series": "series", "collections": "collections"}
AO3_HOSTS = {"archiveofourown.org", "www.archiveofourown.org", "ao3.org", "www.ao3.org",
             "secure.ao3.org", "archive.transformativeworks.org"}
LANGUAGE_CODES = {"English": "en", "Español": "es", "Français": "fr", "Deutsch": "de",
                  "Italiano": "it", "Português brasileiro": "pt-BR", "Русский": "ru",
                  "中文-普通话 國語": "zh", "日本語": "ja"}
COVER = re.compile(r"^Posted originally on the Archive of Our Own\b", re.I)
WORK_URL = re.compile(r"https?://[^\s]+/works/[1-9]\d*", re.I)
NUMBERED = re.compile(r"^Chapter\s+(\d+)(?:\s*[:–—-]\s*(.+))?$", re.I)
FOOTER = re.compile(r"Please drop by the archive and comment to let the (?:author|creator) know if you enjoyed their work[!.]?", re.I)
NOTE_JUMP = re.compile(r"See the end of the (?:chapter|work) for (?:more )?notes[.!]?", re.I)
VISIBLE_URL = re.compile(r"\bhttps?://[^\s<>]+", re.I)
REPOST = re.compile(
    r"\b(?:do not|don['’]t|never|please no|no)\s+(?:re[- ]?(?:post|upload|publish)(?:ing)?|"
    r"(?:copy|post|upload|publish)(?:\s+(?:it|(?:this|my|the)(?: (?:work|fic|story))?))?\s+"
    r"(?:anywhere else|elsewhere|(?:to|on) (?:another|other|any other) (?:site|platform)s?))\b"
    r"|\b(?:only (?:on|available on) ao3|(?:stay|exist) (?:on|here on) ao3 only|"
    r"(?:keep|leave) (?:it|this(?: work| story| fic)?) on ao3|reposting (?:is )?(?:forbidden|prohibited))\b", re.I
)
BAD_GLYPH = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\ufffd]|\(cid:\d+\)")
BY = re.compile(r"^by(?:\s+|$)", re.I)


@dataclass
class Chapter:
    title: str = ""
    number: int | None = None
    heading_page: int | None = None
    body: list[Line] = field(default_factory=list)
    summary: list[Line] = field(default_factory=list)
    notes: list[Line] = field(default_factory=list)
    end_notes: list[Line] = field(default_factory=list)


@dataclass
class Conversion:
    profile: str | None = None
    metadata: dict = field(default_factory=dict)
    chapters: list[Chapter] = field(default_factory=list)
    work_notes: list[Line] = field(default_factory=list)
    work_end_notes: list[Line] = field(default_factory=list)
    issues: dict = field(default_factory=lambda: defaultdict(set))
    pages: int = 0
    words: int = 0
    repost: bool = False

    def issue(self, code, severity, *pages):
        self.issues[code, severity].update(p for p in pages if p is not None)

    @property
    def missing(self):
        return [name for name, value in self.metadata.items()
                if name != "schemaVersion" and (value is None or value == "" or value == [])]

    @property
    def status(self):
        if any(severity == "error" for _, severity in self.issues):
            return "failed"
        if any(severity == "review" for _, severity in self.issues):
            return "needs_review"
        return "ready_with_missing_metadata" if self.missing else "ready"


def ao3_path(uri):
    try:
        parsed = urlsplit(uri)
        if parsed.scheme in {"http", "https"} and parsed.netloc.lower() in AO3_HOSTS:
            return parsed.path
    except ValueError:
        pass
    return ""


def visible_join(lines):
    text = ""
    for line in lines:
        if not text:
            text = line
        elif re.search(r"\w[-\u00ad]$", text) and line[:1].isalnum():
            text = text.removesuffix("\u00ad") + line
        else:
            text += " " + line
    return text


def front_matter(rows, title, author, creators, url):
    stats = rows.get("stats", "")

    def read_date(label):
        match = re.search(rf"\b(?:{label}):\s*(\d{{4}}-\d{{2}}-\d{{2}})\b", stats, re.I)
        if match:
            try:
                return date.fromisoformat(match[1]).isoformat()
            except ValueError:
                pass
        return None

    def count(label):
        match = re.search(rf"\b{label}:\s*([0-9][0-9,]*)", stats, re.I)
        return int(match[1].replace(",", "")) if match else None

    fraction = re.search(r"\bChapters:\s*([1-9]\d*)\s*/\s*([1-9]\d*|\?)", stats, re.I)
    posted = int(fraction[1]) if fraction else None
    total = int(fraction[2]) if fraction and fraction[2] != "?" else None
    words = count("Words")
    language = rows.get("language", "")
    work_id = ao3_path(url).split("/")[-1] if url else None
    series = []
    for entry in re.split(r",\s*(?=Part \d+ of )", rows.get("series", "")):
        part = re.fullmatch(r"Part (\d+) of (.+)", entry, re.I)
        if part:
            series.append({"title": part[2], "position": int(part[1])})
        elif entry:
            series.append({"title": entry})
    return {
        "schemaVersion": 2, "title": title, "author": author, "creators": creators, "summary": "",
        "rating": rows.get("rating") or None,
        **{name: [tag.strip() for tag in rows.get(name, "").split(",") if tag.strip()]
           for name in dict.fromkeys(TAG_FIELDS.values())},
        "language": language, "languageCode": LANGUAGE_CODES.get(language),
        "wordCount": words, "wordCountSource": "archive" if words is not None else None,
        "chaptersAvailable": None, "chaptersPosted": posted, "chaptersTotal": total,
        "completionStatus": ("complete" if posted == total else "in-progress") if posted else None,
        "publishedAt": read_date("Published"), "updatedAt": read_date("Updated|Last Updated"),
        "completedAt": read_date("Completed"),
        "source": {"archive": "ao3", "workId": work_id, "url": url} if work_id else None,
        "stats": {label.lower(): n for label in ("Hits", "Kudos", "Comments", "Bookmarks")
                  if (n := count(label)) is not None} or None,
        "series": series, "collections": [label.strip() for label in rows.get("collections", "").split(",")
                                         if label.strip()],
    }


def read_cover(lines, result):
    visible = [(i, line) for i, line in enumerate(lines) if not line.rule]
    anchor = next(((i, line) for i, line in visible[:10] if COVER.match(line.text)), None)
    title = ""
    start = 0
    url = ""
    if anchor:
        i, marker = anchor
        start = i + 1
        preceding = [line.text for j, line in visible if j < i and line.centered]
        title = " ".join(preceding)
        for item in [link.uri for link in marker.links] + WORK_URL.findall(marker.text):
            if re.fullmatch(r"/works/[1-9]\d*", ao3_path(item)):
                url = item
                break

    rows = defaultdict(list)
    active = None
    cursor = start
    for i, line in enumerate(lines[start:], start):
        if line.rule:
            continue
        key, separator, value = line.text.partition(":")
        label = FIELDS.get(key.casefold())
        if label and separator and line.left < 0.2 * line.width:
            rows[label].append(value.strip())
            active = label
        elif active and line.left > 0.23 * line.width and not (
            line.centered and (line.size >= 15.5 and "b" in font_style(line.font) or BY.match(line.text))
        ) and not (line.centered and title and line.text == title):
            rows[active].append(line.text)
        elif rows:
            break
        elif anchor:
            break
        else:
            continue
        cursor = i + 1
    if not anchor and len(rows) < 3:
        result.issue("unrecognized_cover", "review", 1)
        return None
    if not rows:
        result.issue("missing_cover_rows", "warning", 1)

    # The work heading and byline follow the cover, sometimes on a new page.
    while cursor < len(lines) and lines[cursor].rule:
        cursor += 1
    if cursor < len(lines):
        heading = lines[cursor]
        if (heading.centered and not BY.match(heading.text)
                and (heading.text == title or (heading.size >= 16 and "b" in font_style(heading.font)))):
            headings = [heading.text]
            cursor += 1
            while cursor < len(lines):
                line = lines[cursor]
                if (line.rule or not line.centered or line.size < 16 or "b" not in font_style(line.font)
                        or line.page != heading.page or line.y - heading.y > 2 * heading.size):
                    break
                headings.append(line.text)
                cursor += 1
            repeated = visible_join(headings)
            if title and title != repeated:
                result.issue("different_cover_and_work_title", "review", heading.page)
            title = repeated

    author = ""
    creators = []
    if cursor < len(lines) and BY.match(lines[cursor].text) and lines[cursor].centered:
        byline = [lines[cursor]]
        cursor += 1
        while cursor < len(lines):
            line = lines[cursor]
            if not line.centered or not any(ao3_path(link.uri).startswith("/users/") for link in line.links):
                break
            byline.append(line)
            cursor += 1
        author = visible_join([BY.sub("", byline[0].text), *(line.text for line in byline[1:])])
        links = list(dict.fromkeys(link.uri for line in byline for link in sorted(line.links, key=lambda l: l.left)
                                  if ao3_path(link.uri).startswith("/users/")))
        if author and len(links) < 2:
            creators = [{"name": author, **({"url": links[0]} if links else {})}]
        elif links:
            names = [unquote(ao3_path(uri).rstrip("/").split("/")[-1]) for uri in links]
            if all(name in author for name in names):
                creators = [{"name": name, "url": uri} for name, uri in zip(names, links)]
            else:
                result.issue("unresolved_creator_boundaries", "warning", byline[0].page)

    result.metadata = front_matter({key: visible_join(parts) for key, parts in rows.items()},
                                   title, author, creators, url)
    if not title:
        result.issue("missing_title", "review", 1)
    return cursor


def outline_titles(path):
    try:
        with path.open("rb") as source:
            pdf = PdfReader(source)
            return {(page + 1, item.title) for item in pdf.outline if not isinstance(item, list)
                    if (page := pdf.get_destination_page_number(item)) is not None and page >= 0}
    except Exception as error:
        # Outlines are optional. Visible headings and declared counts provide the other evidence.
        logging.getLogger(__name__).debug("Could not read outline (%s)", type(error).__name__)
        return set()


def starts_body(line, previous, profile):
    if line.rule:
        return False
    body_margin = line.width * (0.098 if profile == "qt" else 0.109)
    if abs(line.left - body_margin) > 6:
        return False
    if previous is None:
        return True
    if previous.page == line.page:
        return previous.left > body_margin + 9 and line.y - previous.y > 2.05 * line.size
    return line.y > 65 or previous.left > body_margin + 13


def parse_story(lines, result, outline):
    preface_summary = []
    section = "start"
    chapter = None
    footer_seen = False
    for index, line in enumerate(lines):
        label = line.text.casefold()
        previous = lines[index - 1] if index else None
        at_left = line.left < 0.088 * line.width
        if not line.rule and FOOTER.fullmatch(line.text) and line.page >= result.pages - 1:
            footer_seen = True
            section = "afterword"
            continue
        if section == "afterword":
            if footer_seen and not line.rule:
                result.issue("text_after_export_footer", "review", line.page)
            continue
        if at_left and label == "works inspired by this one" and chapter and line.page >= result.pages - 6:
            section = "afterword"
            continue
        if chapter is None and re.match(r"^Translation into .+ available:", line.text) and any(
            re.fullmatch(r"/works/\d+", ao3_path(link.uri)) for link in line.links
        ):
            section = "related_preface"
            continue

        heading = not line.rule and line.centered and line.size >= 14 and "b" in font_style(line.font)
        numbered = NUMBERED.fullmatch(line.text) if heading else None
        if heading or (line.page, line.text) in outline:
            chapter = Chapter((numbered[2] or "") if numbered else line.text,
                              int(numbered[1]) if numbered else None, line.page)
            result.chapters.append(chapter)
            section = "body"
            if line.links or VISIBLE_URL.search(line.text):
                result.issue("meaningful_link", "review", line.page)
            continue

        if at_left and label == "summary" and chapter is None and section == "start":
            section = "work_summary"
            continue
        if at_left and label == "notes" and chapter is None and section in {"start", "work_summary"}:
            section = "work_notes"
            continue
        if at_left and label in {"chapter summary", "chapter notes", "chapter end notes", "end notes"}:
            if label == "end notes":
                section = "work_end_notes"
            elif chapter is not None:
                section = {"chapter summary": "summary", "chapter notes": "notes",
                           "chapter end notes": "end_notes"}[label]
            else:
                result.issue("unresolved_chapter_section", "review", line.page)
            continue
        if (NOTE_JUMP.fullmatch(line.text) and section in {"work_summary", "work_notes", "summary", "notes", "body"}
                and line.size < 12 and (line.links or section != "body")):
            if section in {"work_summary", "work_notes", "notes"}:
                section = "start" if chapter is None else "body"
            continue
        if section == "related_preface":
            if not starts_body(line, previous, result.profile):
                if not line.rule and not line.links and not (previous and previous.links):
                    result.issue("unclassified_preface_text", "review", line.page)
                continue
            section = "start"

        if section in {"work_summary", "work_notes", "summary", "notes"} and starts_body(line, previous, result.profile):
            section = "body"
        if section == "start" and line.rule:
            continue
        if section == "start":
            section = "body"
        if line.links or VISIBLE_URL.search(line.text):
            result.issue("meaningful_link", "review", line.page)

        if section == "work_summary":
            preface_summary.append(line)
        elif section == "work_notes":
            result.work_notes.append(line)
        elif section == "work_end_notes":
            result.work_end_notes.append(line)
        else:
            if chapter is None:
                chapter = Chapter()
                result.chapters.append(chapter)
            getattr(chapter, section).append(line)

    result.metadata["summary"] = plain_text(preface_summary)
    if not footer_seen:
        evidence = result.metadata["wordCount"] is not None and result.metadata["chaptersPosted"] is not None
        result.issue("missing_export_footer", "warning" if evidence else "review", result.pages)
    notes = [preface_summary, result.work_notes, result.work_end_notes]
    notes.extend(lines for ch in result.chapters for lines in (ch.notes, ch.end_notes))
    matches = set()
    for block in notes:
        for index, line in enumerate(block):
            window = block[max(0, index - 2):index + 1]
            if REPOST.search(visible_join([part.text for part in window])):
                matches.add(line.page)
    if matches or any(REPOST.search(tag) for tag in result.metadata["additionalTags"]):
        result.repost = True
        result.issue("repost_restriction", "warning", *(matches or [1]))


def plain_text(lines):
    return "\n\n".join("".join(text for text, _ in block) if block else "" for block in join_lines(lines)).strip()


def validate(result, empty_pages, sparse_pages):
    chapter_text = [plain_text(ch.body) for ch in result.chapters]
    seen = {}
    for chapter, text in zip(result.chapters, chapter_text):
        page = chapter.heading_page or (chapter.body[0].page if chapter.body else None)
        key = " ".join(text.split())
        if not key:
            result.issue("empty_chapter", "review", page)
        elif key in seen:
            result.issue("duplicate_chapter_body", "review", seen[key], page)
        else:
            seen[key] = page
    available = sum(bool(text) for text in chapter_text)
    result.metadata["chaptersAvailable"] = available or None
    posted = result.metadata["chaptersPosted"]
    total = result.metadata["chaptersTotal"]
    if posted and available != posted:
        result.issue("chapter_count_mismatch", "review", *(ch.heading_page for ch in result.chapters))
    if total and posted > total:
        result.issue("invalid_chapter_fraction", "review", 1)
        result.metadata["completionStatus"] = None
    numbered = [ch for ch in result.chapters if ch.number is not None]
    for index, ch in enumerate(numbered):
        if (index and ch.number != numbered[index - 1].number + 1) or (index == 0 and ch.number not in {0, 1}):
            result.issue("chapter_number_out_of_sequence", "review", ch.heading_page)
    if not available:
        result.issue("no_narrative_text", "error")
    result.words = sum(len(text.split()) for text in chapter_text)
    source_count = result.metadata["wordCount"]
    if source_count is not None:
        difference = abs(source_count - result.words)
        if difference >= max(30, source_count * 0.07):
            level = "review" if difference >= max(55, source_count * 0.18) else "warning"
            result.issue("word_count_discrepancy", level)
    body_pages = {line.page for chapter in result.chapters for line in chapter.body}
    if body_pages:
        start, end = min(body_pages), max(body_pages)
        interior_empty = sorted(page for page in empty_pages if start < page < end)
        if interior_empty:
            result.issue("unexpected_empty_page", "review", *interior_empty)
        sparse = sorted((body_pages & sparse_pages) - {start, end})
        if sparse:
            result.issue("sparse_story_page", "warning", *sparse)


def convert(path):
    result = Conversion()
    with pdfplumber.open(path) as pdf:
        producer = str(pdf.metadata.get("Producer", "")).casefold()
        result.profile = "qt" if producer.startswith("qt ") else "skia" if "skia/pdf" in producer else None
        result.pages = len(pdf.pages)
        if not result.profile:
            result.issue("unsupported_export_profile", "review", 1)
            return result
        lines = []
        empty_pages = set()
        sparse_pages = set()
        fingerprints = {}
        for page in pdf.pages:
            page_lines = read_lines(page)
            page_text = " ".join(line.text for line in page_lines if not line.rule)
            if BAD_GLYPH.search(page_text):
                result.issue("unmapped_or_control_glyph", "review", page.page_number)
            if any(not char["upright"] and char["text"].strip() for char in page.chars):
                result.issue("rotated_text", "review", page.page_number)
            if page.images:
                result.issue("embedded_image", "review", page.page_number)
            if has_vector_art(page):
                result.issue("possible_vector_art", "review", page.page_number)
            text_lines = [line for line in page_lines if not line.rule]
            for previous, current in zip(text_lines, text_lines[1:]):
                if (current.y - previous.y < 0.55 * min(previous.size, current.size)
                        and min(previous.right, current.right) > max(previous.left, current.left)):
                    result.issue("overlapping_text_lines", "review", page.page_number)
            if any(bidirectional(char) in {"R", "AL"} for char in page_text):
                result.issue("right_to_left_text", "review", page.page_number)
            if not page_text.strip() and not page.images:
                empty_pages.add(page.page_number)
            elif len(page_text.strip()) < 90 and not page.images:
                sparse_pages.add(page.page_number)
            if len(page_text) >= 150:
                previous = fingerprints.setdefault(page_text, page.page_number)
                if previous != page.page_number:
                    result.issue("duplicate_page_text", "review", previous, page.page_number)
            lines.extend(page_lines)
            page.close()
    cursor = read_cover(lines, result)
    if cursor is not None:
        outline = outline_titles(path) if result.profile == "skia" else set()
        title = result.metadata["title"]
        outline = {(page, label) for page, label in outline if label not in {title, "Preface", "Afterword"}}
        parse_story(lines[cursor:], result, outline)
        validate(result, empty_pages, sparse_pages)
    return result


def has_vector_art(page):
    def in_page(shape):
        return shape["width"] >= 20 and shape["height"] >= 12 and 0 <= shape["top"] < shape["bottom"] <= page.height

    # The outlined metadata box and page frames are layout furniture.
    return (any(in_page(shape) for shape in page.curves)
            or any(in_page(shape) and shape.get("fill") and shape["width"] < 0.85 * page.width for shape in page.rects)
            or sum(in_page(shape) for shape in page.lines) >= 3)


def markdown_blocks(lines):
    blocks = []
    delimiters = {"": "", "i": "*", "b": "**", "bi": "***"}
    for spans in join_lines(lines, preserve_hard_breaks=True):
        if spans is None:
            blocks.append("---")
            continue
        runs = []
        for text, style in spans:
            if runs and runs[-1][1] == style:
                runs[-1][0].append(text)
            else:
                runs.append(([text], style))
        rendered = []
        for parts, style in runs:
            raw = "".join(parts)
            safe = re.sub(r"[\\&<>\[\]_*`{}#|~$]", lambda m: f"&#{ord(m[0])};", raw)
            safe = BAD_GLYPH.sub("\ufffd", safe).replace("\n", "  \n")
            if style and safe.strip():
                marker = delimiters[style]
                leading = safe[:len(safe) - len(safe.lstrip())]
                trailing = safe[len(safe.rstrip()):]
                safe = leading + marker + safe.strip() + marker + trailing
            rendered.append(safe)
        # Keep authored list-like lines and divider glyphs literal.
        blocks.append(re.sub(r"(?m)^(\d*)([+.:()=\-])(?=\s|[+.:()=\-]|$)",
                             lambda m: f"{m[1]}&#{ord(m[2])};", "".join(rendered)))
    return "\n\n".join(blocks)


def markdown(result):
    def yaml_value(value):
        # JSON quoted scalars and flow collections are accepted by Jekyll's YAML loader.
        encoded = json.dumps(value, ensure_ascii=False)
        return re.sub(r"[\x7f-\x9f\u2028\u2029]", lambda m: f"\\u{ord(m[0]):04x}", encoded)

    blocks = ["---\n" + "\n".join(f"{key}: {yaml_value(value)}" for key, value in result.metadata.items()) + "\n---"]
    for ordinal, chapter in enumerate(result.chapters, 1):
        title = re.sub(r"[\\&<>\[\]_*`{}#|~$]", lambda m: f"&#{ord(m[0])};", chapter.title)
        blocks.append(f"## Chapter {ordinal}" + (f": {title}" if title else ""))
        preface = [("Work Notes", result.work_notes if ordinal == 1 else []),
                   ("Chapter Summary", chapter.summary), ("Chapter Notes", chapter.notes)]
        if any(lines for _, lines in preface):
            blocks.append("### Notes")
            for label, lines in preface:
                if lines:
                    blocks.extend([f"#### {label}", markdown_blocks(lines)])
            blocks.append("### Text")
        if chapter.body:
            blocks.append(markdown_blocks(chapter.body))
        afterword = [("Chapter End Notes", chapter.end_notes),
                     ("Work End Notes", result.work_end_notes if ordinal == len(result.chapters) else [])]
        if any(lines for _, lines in afterword):
            blocks.append("### End Notes")
            for label, lines in afterword:
                if lines:
                    blocks.extend([f"#### {label}", markdown_blocks(lines)])
    return "\n\n".join(blocks) + "\n"
