"""Extract the positioned text and PDF objects used by the converter."""

import re
from collections import Counter
from dataclasses import dataclass
from statistics import median

from pdfplumber.utils import cluster_objects


@dataclass(frozen=True)
class Link:
    uri: str
    left: float
    right: float
    top: float
    bottom: float


@dataclass(frozen=True)
class Line:
    page: int
    y: float
    left: float
    right: float
    width: float
    height: float
    size: float
    font: str
    spans: tuple[tuple[str, str], ...]
    links: tuple[Link, ...] = ()
    rule: bool = False
    first_word_width: float = 0

    @property
    def text(self):
        return "".join(text for text, _ in self.spans)

    @property
    def centered(self):
        return abs(self.left + self.right - self.width) < self.width * 0.045


def font_style(font):
    font = font.lower().split("+")[-1]
    bold = any(name in font for name in ("bold", "medi", "semibold", "demi", "black"))
    italic = any(name in font for name in ("ital", "obliq"))
    return ("b" if bold else "") + ("i" if italic else "")


def read_links(page):
    for annot in page.annots:
        data = annot["data"]
        if getattr(data.get("Subtype"), "name", None) == "Link":
            yield Link(annot.get("uri") or "", annot["x0"], annot["x1"], annot["top"], annot["bottom"])


def read_lines(page):
    """Group glyphs by baseline to keep mixed fonts on the same printed line."""
    links = tuple(read_links(page))
    chars = [char for char in page.chars if char["upright"]]
    groups = cluster_objects(chars, lambda char: char["matrix"][5], tolerance=1.8)
    lines = []
    for group in groups:
        group.sort(key=lambda char: char["x0"])
        first = group[0]
        y = median(page.height - char["matrix"][5] for char in group)
        spans = []
        previous = None
        first_word_end = None
        seen = set()
        for char in group:
            text = char["text"]
            glyph = (round(char["x0"], 1), round(char["matrix"][5], 1), text)
            if glyph in seen:
                continue
            seen.add(glyph)
            spaced = previous and char["x0"] - previous["x1"] > max(0.9, min(char["size"], previous["size"]) * 0.18)
            if spaced:
                spans.append((" ", ""))
            if previous and first_word_end is None and (spaced or text.isspace()):
                first_word_end = previous["x1"]
            spans.append((text, font_style(char["fontname"])))
            previous = char
        spans = trim_spans(spans)
        if not spans:
            continue
        right = max(char["x1"] for char in group)
        hits = tuple(link for link in links if link.top - 2 <= y <= link.bottom + 3
                     and link.left < right and link.right > first["x0"])
        fonts = Counter(char["fontname"] for char in group if char["text"].strip())
        lines.append(Line(page.page_number, y, first["x0"], right, page.width, page.height,
                          median(char["size"] for char in group), fonts.most_common(1)[0][0], spans, hits,
                          first_word_width=(first_word_end or right) - first["x0"]))
    for edge in page.horizontal_edges:
        y = edge["top"]
        if not 0 < y < page.height or edge["width"] < page.width * 0.18:
            continue
        # Tag underlines, page-size rectangles, and rules overlapping text are layout objects.
        if (edge.get("height", 0) > 3
                or any(abs(line.y - y) < 4 for line in lines)
                or any(link.top - 2 <= y <= link.bottom + 2 for link in links)):
            continue
        lines.append(Line(page.page_number, y, edge["x0"], edge["x1"], page.width, page.height,
                          0, "", (), rule=True))
    return sorted(lines, key=lambda line: line.y)


def trim_spans(spans):
    """Collapse PDF spacing within a line while retaining character styles."""
    trimmed = []
    for text, style in spans:
        if text in (" ", "\t"):
            if trimmed and trimmed[-1][0] != " ":
                trimmed.append((" ", style))
        elif text:
            trimmed.append((text, style))
    if trimmed and trimmed[-1][0] == " ":
        trimmed.pop()
    return tuple(trimmed)


def join_lines(lines, *, preserve_hard_breaks=False):
    """Return paragraphs as span lists. None is a drawn separator."""
    paragraphs = []
    paragraph = []
    previous = None
    for line in lines:
        if line.rule:
            if paragraph:
                paragraphs.append(paragraph)
            paragraphs.append(None)
            paragraph = []
            previous = None
            continue
        if previous:
            gap = line.y - previous.y
            leading = max(line.size, previous.size)
            # AO3's text box is inset on both sides. Notes can be narrower than prose.
            right_margin = previous.width - previous.left
            short = right_margin - previous.right > max(40, 3.4 * previous.size, line.first_word_width + 5)
            same_indent = abs(line.left - previous.left) < 5
            if line.page == previous.page:
                new_paragraph = gap > 1.58 * leading or (not same_indent and short)
            else:
                new_paragraph = (line.page != previous.page + 1 or short or not same_indent
                                 or previous.height - previous.y > 75 or line.y > 76)
            if new_paragraph:
                paragraphs.append(paragraph)
                paragraph = []
            elif preserve_hard_breaks and short:
                paragraph.append(("\n", ""))
            elif not (re.search(r"\w[-\u00ad]$", previous.text) and line.text[:1].isalpha()):
                paragraph.append((" ", ""))
            elif paragraph and paragraph[-1][0] == "\u00ad":
                paragraph.pop()
        paragraph.extend(line.spans)
        previous = line
    if paragraph:
        paragraphs.append(paragraph)
    return paragraphs
