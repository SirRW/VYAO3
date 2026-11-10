"""Validate Markdown snapshots already exported by the RadioApple importer."""

import html
import json
import re

from .converter import BAD_GLYPH, REPOST, Chapter, Conversion, ao3_path, front_matter, validate
from .layout import Line


DEFAULTS = front_matter({}, "", "", [], "")
SNAPSHOT_PARSER_VERSION = 3
CHAPTER = re.compile(r"^## Chapter (\d+)(?:: .+)?[ \t]*$", re.M)
SNAPSHOT_NAME = re.compile(r"(ao3-[1-9][0-9]*|local-[0-9a-f]{20})--([0-9a-f]{64})")


class InvalidSnapshot(ValueError):
    pass


def read_metadata(header):
    values = {}
    for line in header.splitlines():
        key, separator, value = line.partition(": ")
        if not separator or key not in DEFAULTS or key in values:
            raise InvalidSnapshot("unsupported_snapshot_front_matter")
        try:
            values[key] = json.loads(value)
        except ValueError as error:
            raise InvalidSnapshot("unsupported_snapshot_front_matter") from error

    metadata = {**DEFAULTS, **values}
    if values.get("schemaVersion") != 2 or not isinstance(metadata["title"], str) or not metadata["title"].strip():
        raise InvalidSnapshot("missing_snapshot_title_or_schema")
    for key in ("chaptersAvailable", "chaptersPosted", "chaptersTotal", "wordCount"):
        value = metadata[key]
        if value is not None and (type(value) is not int or value < (0 if key == "wordCount" else 1)):
            raise InvalidSnapshot("invalid_snapshot_count")
    if metadata["chaptersTotal"] is not None and metadata["chaptersPosted"] is None:
        raise InvalidSnapshot("invalid_snapshot_count")
    for key in ("rating", "languageCode", "wordCountSource", "completionStatus", "publishedAt", "updatedAt", "completedAt"):
        if metadata[key] is not None and not isinstance(metadata[key], str):
            raise InvalidSnapshot("invalid_snapshot_metadata")
    for key, default in DEFAULTS.items():
        value = metadata[key]
        if (isinstance(default, str) and not isinstance(value, str)
                or isinstance(default, list) and not isinstance(value, list)):
            raise InvalidSnapshot("invalid_snapshot_metadata")
    for key, label, fields, prefix in (
        ("creators", "name", {"name", "pseud", "url"}, "/users/"),
        ("series", "title", {"title", "position", "url"}, "/series/"),
    ):
        if any(not isinstance(item, dict) or item.keys() - fields for item in metadata[key]):
            raise InvalidSnapshot("invalid_snapshot_metadata")
        for item in metadata[key]:
            if not isinstance(item.get(label), str):
                raise InvalidSnapshot("invalid_snapshot_metadata")
            url = item.get("url")
            if url is not None and (not isinstance(url, str) or "?" in url or "#" in url
                                    or not ao3_path(url).startswith(prefix)):
                raise InvalidSnapshot("invalid_snapshot_metadata")
    if any(not isinstance(tag, str) for key, value in metadata.items()
           if isinstance(value, list) and key not in {"creators", "series"} for tag in value):
        raise InvalidSnapshot("invalid_snapshot_metadata")
    stats = metadata["stats"]
    if stats is not None and (not isinstance(stats, dict)
                              or stats.keys() - {"hits", "kudos", "comments", "bookmarks", "asOf"}):
        raise InvalidSnapshot("invalid_snapshot_metadata")
    return metadata


def snapshot_id(path, metadata):
    named = SNAPSHOT_NAME.fullmatch(path.stem)
    source = metadata["source"]
    if source is None:
        if named and named[1] == f"local-{named[2][:20]}":
            return named[1]
        if named:
            raise InvalidSnapshot("snapshot_id_mismatch")
        return None
    if (not isinstance(source, dict) or source.keys() != {"archive", "workId", "url"}
            or source["archive"] != "ao3" or not isinstance(source["workId"], str)
            or not re.fullmatch(r"[1-9][0-9]*", source["workId"])
            or not isinstance(source["url"], str) or "?" in source["url"] or "#" in source["url"]
            or ao3_path(source["url"]) != f"/works/{source['workId']}"):
        raise InvalidSnapshot("invalid_snapshot_source")
    work_id = f"ao3-{source['workId']}"
    if named and named[1] != work_id:
        raise InvalidSnapshot("snapshot_id_mismatch")
    return work_id


def read_snapshot(path):
    data = path.read_bytes()
    document = data.decode("utf-8-sig").replace("\r\n", "\n")
    front = re.match(r"\A---\n(.*?)\n---\n(.*)\Z", document, re.S)
    if front is None:
        raise InvalidSnapshot("missing_snapshot_front_matter")
    if "{{" in document or "{%" in document or re.search(r"<[A-Za-z!/?]", front[2]):
        raise InvalidSnapshot("unsupported_snapshot_markup")
    metadata = read_metadata(front[1])
    work_id = snapshot_id(path, metadata)
    result = Conversion(profile="markdown", metadata=metadata)
    body = front[2]
    headings = list(CHAPTER.finditer(body))
    if not headings or body[:headings[0].start()].strip():
        raise InvalidSnapshot("missing_snapshot_chapter_markers")
    notes = [metadata["summary"], *metadata["additionalTags"]]
    for index, marker in enumerate(headings):
        section = body[marker.end():headings[index + 1].start() if index + 1 < len(headings) else len(body)]
        prose, _, end_notes = section.partition("\n### End Notes\n")
        notes.append(end_notes)
        if prose.lstrip().startswith("### Notes\n"):
            preface, separator, prose = prose.partition("\n### Text\n")
            notes.append(preface)
            if not separator:
                result.issue("missing_snapshot_text_marker", "review", index + 1)
        visible = html.unescape(prose)
        chapter = Chapter(number=int(marker[1]), heading_page=index + 1)
        if re.search(r"\w", visible):
            chapter.body.append(Line(index + 1, 0, 0, 80, 80, 0, 1, "", ((visible.strip(), ""),)))
        glyphs = BAD_GLYPH.findall(html.unescape(section))
        if glyphs:
            if set(glyphs) == {"\ufffd"} and not BAD_GLYPH.search(visible + html.unescape(marker[0])):
                result.issue("replacement_character_in_snapshot_notes", "warning", index + 1)
            else:
                result.issue("unmapped_or_control_glyph", "review", index + 1)
        result.chapters.append(chapter)

    result.repost = any(REPOST.search(" ".join(html.unescape(note).replace("\ufffd", "").split()))
                        for note in notes)
    if result.repost:
        result.issue("repost_restriction", "warning")
    declared_available = metadata["chaptersAvailable"]
    validate(result, set(), set())
    if declared_available is not None and declared_available != metadata["chaptersAvailable"]:
        result.issue("snapshot_available_count_mismatch", "review")
    result.pages = len(headings)
    return result, data, work_id
