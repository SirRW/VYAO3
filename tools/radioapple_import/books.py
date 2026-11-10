"""Read structured EPUB and DOCX exports into the reader's chapter model."""

import posixpath
import re
from pathlib import PurePosixPath
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from .converter import (
    BAD_GLYPH, BY, COVER, FIELDS, NOTE_JUMP, NUMBERED, REPOST, WORK_URL,
    Chapter, Conversion, ao3_path, front_matter, plain_text, validate,
)
from .layout import Line


def name(node):
    return node.tag.rsplit("}", 1)[-1]


def text(node):
    return " ".join("".join(node.itertext()).split())


def children(node, tag):
    return [child for child in node if name(child) == tag]


def find(node, tag):
    return next((child for child in node.iter() if name(child) == tag), None)


def field(node, tag):
    child = find(node, tag)
    return text(child) if child is not None else ""


def has_class(node, label):
    return label in node.get("class", "").split()


def work_url(value):
    for candidate in WORK_URL.findall(value):
        if re.fullmatch(r"/works/[1-9]\d*", ao3_path(candidate)):
            return candidate
    return ""


def paragraph(spans, section, index, *, rule=False):
    return Line(section, index * 3, 0, 80, 80, 0, 1, "", tuple(spans), rule=rule)


def new_chapter(label, section):
    numbered = NUMBERED.fullmatch(label)
    return Chapter(title=(numbered[2] or "") if numbered else label,
                   number=int(numbered[1]) if numbered else None, heading_page=section)


def finish(result, summary):
    result.metadata["summary"] = plain_text(summary)
    notes = [summary, result.work_notes, result.work_end_notes]
    notes.extend(block for chapter in result.chapters for block in (chapter.notes, chapter.end_notes))
    result.repost = any(REPOST.search(" ".join(plain_text(block).split())) for block in notes)
    result.repost |= any(REPOST.search(tag) for tag in result.metadata["additionalTags"])
    if result.repost:
        result.issue("repost_restriction", "warning")
    validate(result, set(), set())
    result.chapters[:] = [chapter for chapter in result.chapters if chapter.body]
    if result.words and result.metadata["wordCount"] is None:
        result.metadata["wordCount"] = result.words
        result.metadata["wordCountSource"] = "derived"
    return result


def part_path(base, target):
    parsed = urlsplit(target)
    part = posixpath.normpath(posixpath.join(posixpath.dirname(base), unquote(parsed.path).lstrip("/")))
    if parsed.path.startswith("/"):
        part = posixpath.normpath(unquote(parsed.path).lstrip("/"))
    if parsed.scheme or parsed.netloc or part in {"", ".", ".."} or ".." in PurePosixPath(part).parts or "\\" in part:
        raise ValueError("Invalid package part")
    return part


def book_xml(package, member):
    if package.getinfo(member).file_size > 64 * 1024 * 1024:
        raise ValueError("Package part is too large")
    return ET.fromstring(package.read(member))


def html_lines(node, result, section):
    spans = []
    lines = []
    block_tags = {"p", "div", "section", "article", "blockquote", "li", "ul", "ol",
                  "h1", "h2", "h3", "h4", "h5", "h6", "pre", "tr", "td", "th", "dd", "dt"}

    def flush():
        if any(value.strip() for value, _ in spans):
            lines.append(paragraph(spans, section, len(lines)))
        spans.clear()

    def visit(element, style=""):
        tag = name(element)
        if tag in {"script", "style", "nav", "head"} or has_class(element, "endnote-link"):
            return
        if tag in {"img", "svg", "object", "video", "audio", "math"}:
            result.issue("unsupported_embedded_content", "review", section)
            return
        if tag == "table":
            result.issue("table_layout_simplified", "review", section)
        if tag == "hr":
            flush()
            lines.append(paragraph((), section, len(lines), rule=True))
            return
        if tag == "br":
            spans.append(("\n", ""))
            return
        if tag in block_tags:
            flush()
        if tag in {"strong", "b"}:
            style = "b" + style.replace("b", "")
        if tag in {"em", "i"} and "i" not in style:
            style += "i"
        if tag == "a" and element.get("href", "").strip().casefold().startswith(("http:", "https:", "//")):
            result.issue("meaningful_link", "review", section)
        if element.text:
            spans.append((re.sub(r"[\t\r\n ]+", " ", element.text), style))
        for child in element:
            visit(child, style)
            if child.tail:
                spans.append((re.sub(r"[\t\r\n ]+", " ", child.tail), style))
        if tag in block_tags:
            flush()

    visit(node)
    flush()
    return lines


def epub_preface(container, result, section, targets):
    label = None
    for node in container:
        if name(node) in {"p", "h3", "h4"} and text(node).rstrip(":").casefold() in targets:
            label = text(node).rstrip(":").casefold()
        elif label and name(node) == "blockquote":
            targets[label].extend(html_lines(node, result, section))
            label = None


def epub(path):
    result = Conversion(profile="epub")
    with ZipFile(path) as package:
        if "META-INF/encryption.xml" in package.namelist():
            result.issue("encrypted_epub", "error")
            return result
        opf_path = find(book_xml(package, "META-INF/container.xml"), "rootfile").attrib["full-path"]
        opf = book_xml(package, part_path("", opf_path))
        metadata = find(opf, "metadata")
        title = field(metadata, "title") or path.stem.replace("_", " ")
        creators = [{"name": text(node)} for node in children(metadata, "creator") if text(node)]
        url = work_url(field(metadata, "source")) or work_url(field(metadata, "identifier"))
        manifest = {node.attrib["id"]: node for node in children(find(opf, "manifest"), "item")}
        spine = children(find(opf, "spine"), "itemref")
        rows = {}
        tags = {}
        summary = []
        for section, entry in enumerate(spine, 1):
            item = manifest[entry.attrib["idref"]]
            if entry.get("linear") == "no" or "nav" in item.get("properties", "").split():
                continue
            if item.get("media-type") not in {"application/xhtml+xml", "text/html"}:
                result.issue("unsupported_epub_spine_item", "review", section)
                continue
            body = find(book_xml(package, part_path(opf_path, item.attrib["href"])), "body")
            if body is None:
                raise ValueError("Missing EPUB content")
            preface = next((node for node in body.iter() if node.get("id") == "preface"), None)
            if preface is not None:
                cover = find(preface, "dl")
                if cover is not None:
                    label = None
                    for node in cover:
                        if name(node) == "dt":
                            label = FIELDS.get(text(node).rstrip(":").casefold())
                        elif name(node) == "dd" and label:
                            rows[label] = text(node)
                            links = [text(link) for link in node.iter() if name(link) == "a" and text(link)]
                            if links:
                                tags[label] = links
                    posted = next((text(node) for node in preface.iter()
                                   if name(node) == "p" and COVER.match(text(node))), "")
                    url = url or work_url(posted)
                for container in preface.iter():
                    epub_preface(container, result, section, {"summary": summary, "notes": result.work_notes})
            chapters = [node for node in body.iter() if node.get("id") == "chapters"]
            if chapters:
                for container in chapters:
                    read_epub_chapters(container, result, section)
            elif (afterword := next((node for node in body.iter() if node.get("id") == "afterword"), None)) is not None:
                for container in afterword.iter():
                    epub_preface(container, result, section, {"end notes": result.work_end_notes})
            elif preface is None:
                heading = next((node for node in body.iter() if name(node) in {"h1", "h2"}), None)
                label = text(heading) if heading is not None else ""
                if heading is not None:
                    # A spine heading is already shown in the chapter index.
                    parent = next(node for node in body.iter() if heading in list(node))
                    parent.remove(heading)
                lines = html_lines(body, result, section)
                if lines and (label or not result.chapters):
                    result.chapters.append(new_chapter(label if label != title else "", section))
                if lines:
                    result.chapters[-1].body.extend(lines)
        result.pages = len(spine)
        result.metadata = front_matter(rows, title, ", ".join(creator["name"] for creator in creators), creators, url)
        for label, values in tags.items():
            if isinstance(result.metadata.get(label), list) and label != "series":
                result.metadata[label] = values
        language = field(metadata, "language")
        if re.fullmatch(r"[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*", language):
            result.metadata["languageCode"] = language
        if not summary and (description := field(metadata, "description")):
            summary.append(paragraph([(description, "")], 1, 0))
    return finish(result, summary)


def read_epub_chapters(container, result, section):
    for node in container:
        heading = next((child for child in node if name(child) in {"h1", "h2"}), None)
        if heading is not None:
            result.chapters.append(new_chapter(text(heading), section))
            chapter = result.chapters[-1]
            epub_preface(node, result, section, {"chapter summary": chapter.summary, "summary": chapter.summary,
                                                "chapter notes": chapter.notes, "notes": chapter.notes})
        elif name(node) in {"h1", "h2"}:
            result.chapters.append(new_chapter(text(node), section))
        elif node.get("id", "").startswith("endnotes") and result.chapters:
            for note in children(node, "blockquote"):
                result.chapters[-1].end_notes.extend(html_lines(note, result, section))
        elif (any(re.fullmatch(r"userstuff\d*", label) for label in node.get("class", "").split())
              or name(node) in {"p", "hr"}):
            if not result.chapters:
                result.chapters.append(new_chapter("", section))
            result.chapters[-1].body.extend(html_lines(node, result, section))
        elif node.get("id", "").startswith("endnotes") and result.chapters:
            for note in children(node, "blockquote"):
                result.chapters[-1].end_notes.extend(html_lines(note, result, section))
        elif node.get("id", "").startswith("chapter-") or has_class(node, "chapter"):
            read_epub_chapters(node, result, section)


WORD = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
RELATIONSHIP = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
VML_RULE = "{urn:schemas-microsoft-com:office:office}hr"
DOCX_FIELDS = re.compile(r"\b(" + "|".join(sorted(FIELDS, key=len, reverse=True)) + r"):\s*", re.I)


def word_spans(node):
    for run in node.iter(WORD + "r"):
        props = run.find(WORD + "rPr")
        style = ""
        if props is not None:
            for tag, marker in (("b", "b"), ("i", "i")):
                setting = props.find(WORD + tag)
                if setting is not None and setting.get(WORD + "val", "1") not in {"0", "false", "off"}:
                    style += marker
        for child in run:
            if name(child) == "t":
                yield child.text or "", style
            elif name(child) in {"br", "cr", "tab"}:
                yield ("\t" if name(child) == "tab" else "\n"), ""


def docx_cover_fields(node):
    pieces = []
    links = []
    offset = 0
    for child in node:
        value = "".join(value for value, _ in word_spans(child))
        pieces.append(value)
        if name(child) == "hyperlink":
            links.append((offset, value))
        offset += len(value)
    raw = "".join(pieces)
    labels = list(DOCX_FIELDS.finditer(raw))
    labels = [label for label in labels
              if not any(start <= label.start() < start + len(value) for start, value in links)]
    rows = {}
    tags = {}
    for i, label in enumerate(labels):
        end = labels[i + 1].start() if i + 1 < len(labels) else len(raw)
        key = FIELDS[label[1].casefold()]
        rows[key] = raw[label.end():end].strip()
        linked = [value.strip() for start, value in links if label.start() < start < end and value.strip()]
        if linked:
            tags[key] = linked
    return rows, tags


def docx(path):
    result = Conversion(profile="docx")
    with ZipFile(path) as package:
        relations = book_xml(package, "_rels/.rels")
        document_part = next((node.attrib["Target"] for node in relations
                              if node.get("Type", "").endswith("/officeDocument") and
                              node.get("TargetMode", "Internal") == "Internal"), None)
        if document_part is None:
            raise ValueError("Missing main document")
        body = find(book_xml(package, part_path("", document_part)), "body")
        core = book_xml(package, "docProps/core.xml") if "docProps/core.xml" in package.namelist() else ET.Element("metadata")
    paragraphs = list(body.iter(WORD + "p"))
    if find(body, "tbl") is not None:
        result.issue("table_layout_simplified", "review")
    if any(find(body, tag) is not None for tag in ("footnoteReference", "endnoteReference", "del", "ins", "altChunk")):
        result.issue("unsupported_document_markup", "review")
    spans = [tuple(word_spans(node)) for node in paragraphs]
    labels = ["".join(value for value, _ in block).strip() for block in spans]
    preface = bool(labels and labels[0].casefold() == "preface")
    title = field(core, "title") or (labels[1] if preface and len(labels) > 1 else path.stem.replace("_", " "))
    author = field(core, "creator")
    rows = {}
    tags = {}
    url = ""
    start = 2 if preface else 0
    summary = []
    if preface:
        for i, label in enumerate(labels[:30]):
            if COVER.match(label):
                url = work_url(label)
                start = i + 1
            if DOCX_FIELDS.match(label):
                fields, linked = docx_cover_fields(paragraphs[i])
                rows.update(fields)
                tags.update(linked)
                start = i + 1
            if BY.match(label):
                author = author or BY.sub("", label).strip()
                start = i + 1
            if label.casefold().rstrip(":") in {"summary", "notes"} or NUMBERED.fullmatch(label):
                start = i
                break
    result.metadata = front_matter(rows, title, author, [{"name": author}] if author else [], url)
    for key, values in tags.items():
        if isinstance(result.metadata.get(key), list) and key != "series":
            result.metadata[key] = values
    target = None
    chapter = None
    for i in range(start, len(paragraphs)):
        node, label = paragraphs[i], labels[i]
        style = node.find(f"{WORD}pPr/{WORD}pStyle")
        heading = style is not None and re.fullmatch(r"Heading[1-9]", style.get(WORD + "val", ""), re.I)
        if preface and heading and label.casefold() == "afterword":
            break
        if NUMBERED.fullmatch(label) or (heading and label and not preface):
            chapter = new_chapter(label, None)
            result.chapters.append(chapter)
            target = chapter.body
            continue
        key = label.casefold().rstrip(":")
        if preface and NOTE_JUMP.fullmatch(label):
            continue
        if preface and key in {"summary", "notes", "chapter summary", "chapter notes", "end notes", "chapter end notes"}:
            if chapter is None:
                target = summary if key == "summary" else result.work_notes
            elif key.endswith("summary"):
                target = chapter.summary
            elif "end notes" in key:
                target = chapter.end_notes
            else:
                target = chapter.notes
            continue
        pictures = list(node.iter(WORD + "pict"))
        rule = bool(pictures) and all(any(child.get(VML_RULE) in {"t", "true", "1"} for child in picture)
                                     for picture in pictures)
        if (pictures and not rule) or find(node, "drawing") is not None:
            result.issue("unsupported_embedded_content", "review")
        if not label and not rule:
            if chapter and target and (target is chapter.notes or target is chapter.summary):
                target = chapter.body
            continue
        if target is None:
            chapter = new_chapter("", None)
            result.chapters.append(chapter)
            target = chapter.body
        if any(link.get(RELATIONSHIP + "id") for link in node.iter(WORD + "hyperlink")):
            result.issue("meaningful_link", "review")
        if BAD_GLYPH.search(label):
            result.issue("unmapped_or_control_glyph", "review")
        target.append(paragraph(spans[i], 1, i, rule=rule and not label))
    return finish(result, summary)
