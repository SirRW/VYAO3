"""Import local exports and optionally refresh the reader and Pages package."""

import argparse
import hashlib
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import webbrowser
from collections import Counter, defaultdict
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .books import docx, epub
from .converter import convert, markdown


ROOT = Path(__file__).resolve().parents[2]
STATE_DIR = ".radioapple-import"
DEFAULT_SOURCE = "Archive of MY own"
PUBLISH_INBOX = "Para publicar"
IMPORTERS = {".pdf": convert, ".epub": epub, ".docx": docx}
PARSER_VERSION = 2
READY = {"ready", "ready_with_missing_metadata"}
STATUSES = (*sorted(READY), "needs_review", "failed", "duplicate", "non_work")
GUIDE = "1 before using read this/disclaimers before using this drive.pdf"
ID = re.compile(r"(?:ao3-[1-9]\d*|local-[0-9a-f]{20})", re.ASCII)
SHA256 = re.compile(r"[0-9a-f]{64}", re.ASCII)


class ImportProblem(Exception):
    pass


def file_hash(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


@contextmanager
def locked(state):
    state.mkdir(parents=True, exist_ok=True)
    with (state / "import.lock").open("a+b") as lock:
        if not lock.tell():
            lock.write(b"\0")
            lock.flush()
        lock.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise ImportProblem("Another import is using the staging directory.") from error
        yield


def write_bytes(path, data, *, replace=False, temporary_dir=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=temporary_dir or path.parent, prefix=".import-",
                                     suffix=".tmp", delete=False) as file:
        temporary = Path(file.name)
    try:
        with temporary.open("wb") as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        if replace:
            os.replace(temporary, path)
        else:
            # Expose the complete file atomically and fail if the destination already exists.
            os.link(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def write_json(path, data, *, replace=False):
    payload = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    write_bytes(path, payload.encode("utf-8"), replace=replace)


def discover(source, selections):
    if not source.is_dir():
        raise ImportProblem(f"Source directory does not exist: {source}")
    found = set()
    for selection in selections or [source]:
        candidate = Path(selection)
        if not candidate.is_absolute():
            local = candidate.resolve()
            candidate = local if local.is_relative_to(source) and local.exists() else source / candidate
        candidate = candidate.resolve()
        if not candidate.is_relative_to(source):
            raise ImportProblem(f"Choose files or directories inside {source}, or set --source.")
        if candidate.is_dir():
            for directory, folders, files in os.walk(candidate, onerror=raise_walk_error):
                # Windows junctions can redirect a directory without being symlinks.
                folders[:] = [name for name in folders if Path(directory, name).resolve() == Path(directory, name)]
                for filename in files:
                    path = Path(directory, filename)
                    if path.suffix.casefold() in IMPORTERS and not path.is_symlink():
                        found.add(path)
        elif candidate.is_file() and candidate.suffix.casefold() in IMPORTERS:
            found.add(candidate)
        else:
            raise ImportProblem(f"Expected a PDF, EPUB, DOCX or directory: {candidate}")
    return sorted(found, key=lambda path: (path.as_posix().casefold(), path.as_posix()))


def raise_walk_error(error):
    raise error


def approvals_from(path):
    approvals = {}
    for number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        parts = line.partition("#")[0].split()
        if not parts:
            continue
        if len(parts) != 2 or not ID.fullmatch(parts[0]) or not SHA256.fullmatch(parts[1]):
            raise ImportProblem(f"Invalid approval at line {number}. Use a work ID followed by its SHA-256.")
        work_id, digest = parts
        if work_id in approvals and approvals[work_id] != digest:
            raise ImportProblem(f"The approval file lists more than one snapshot of {work_id}.")
        approvals[work_id] = digest
    if not approvals:
        raise ImportProblem("The approval file has no work IDs and hashes.")
    return approvals


def get_manifest(path):
    if not path.exists():
        return {"schemaVersion": 1, "entries": {}}
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
        entries = manifest["entries"]
        if manifest["schemaVersion"] == 1 and isinstance(entries, dict) and all(
            valid_manifest_entry(digest, record) for digest, record in entries.items()
        ):
            return manifest
    except (ValueError, KeyError, TypeError):
        pass
    raise ImportProblem("The import manifest is invalid. Keep a copy and repair it before importing.")


def valid_manifest_entry(digest, record):
    if (not SHA256.fullmatch(digest) or not isinstance(record, dict) or record.get("sha256") != digest
            or not isinstance(record.get("sourcePath"), str) or record.get("status") not in STATUSES
            or not isinstance(record.get("parserVersion"), int)):
        return False
    return ("stagedPath" not in record or bool(ID.fullmatch(record.get("workId", ""))
            and SHA256.fullmatch(record.get("markdownSha256", ""))))


def staged_path(state, work_id, digest):
    if not ID.fullmatch(work_id) or not SHA256.fullmatch(digest):
        raise ImportProblem("Invalid work identity in staging.")
    return state / "works" / f"{work_id}--{digest}.md"


def add_issue(record, code, severity):
    issues = record.get("issues", [])
    if any(issue["code"] == code for issue in issues):
        return record
    return {**record, "issues": [*issues, {"code": code, "severity": severity, "pages": []}]}


def convert_record(path, relative, digest, state, dry_run):
    extension = path.suffix.casefold()
    record = {"sourcePath": relative, "sha256": digest, "parserVersion": PARSER_VERSION,
              "status": "non_work", "issues": []}
    if relative.casefold() == GUIDE:
        return record
    try:
        result = IMPORTERS[extension](path)
    except (OSError, ValueError) as error:
        return add_issue({**record, "status": "failed"}, f"{extension[1:]}_read_{type(error).__name__}", "error")
    except Exception as error:
        # Malformed exports can raise parser-specific exceptions. Continue the batch.
        return add_issue({**record, "status": "failed"}, f"{extension[1:]}_extraction_{type(error).__name__}", "error")
    if file_hash(path) != digest:
        return add_issue({**record, "status": "failed"}, "source_changed_during_import", "error")

    metadata = result.metadata
    source = metadata.get("source")
    work_id = f"ao3-{source['workId']}" if source else f"local-{digest[:20]}"
    chapters = []
    for chapter in result.chapters:
        pages = [line.page for lines in (chapter.summary, chapter.notes, chapter.body, chapter.end_notes)
                 for line in lines]
        if chapter.heading_page is not None:
            pages.append(chapter.heading_page)
        chapters.append({"startPage": min(pages) if pages else None, "endPage": max(pages) if pages else None})
    record.update({"status": result.status, "format": result.profile, "workId": work_id,
                   "title": metadata.get("title"), "author": metadata.get("author"),
                   "pageCount": result.pages, "missingMetadata": result.missing,
                   "declaredChapters": metadata.get("chaptersPosted"),
                   "extractedChapters": metadata.get("chaptersAvailable"), "chapterPages": chapters,
                   "declaredWords": metadata.get("wordCount"), "extractedWords": result.words,
                   "publication": "repost_restricted" if result.repost else "approval_required",
                   "issues": [{"code": code, "severity": severity, "pages": sorted(pages)}
                              for (code, severity), pages in sorted(result.issues.items())]})
    if result.chapters and result.status != "failed":
        data = markdown(result).encode("utf-8")
        output = staged_path(state, work_id, digest)
        generated_hash = hashlib.sha256(data).hexdigest()
        record["markdownSha256"] = generated_hash
        record["stagedPath"] = output.relative_to(state).as_posix()
        if output.exists() and file_hash(output) != generated_hash:
            return add_issue({**record, "status": "needs_review"}, "staged_file_differs", "review")
        if not dry_run and not output.exists():
            write_bytes(output, data)
    return record


def check_staging(record, state):
    if "stagedPath" not in record:
        return record
    path = staged_path(state, record["workId"], record["sha256"])
    if not path.is_file():
        return None
    if file_hash(path) != record["markdownSha256"]:
        return add_issue({**record, "status": "needs_review"}, "staged_file_differs", "review")
    return record


def record_for(path, source, state, entries, seen, dry_run):
    relative = path.relative_to(source).as_posix()
    try:
        digest = file_hash(path)
        previous = entries.get(digest)
        cached = None
        if previous and previous["parserVersion"] == PARSER_VERSION and previous["status"] != "failed":
            cached = check_staging(previous, state)
        if cached is None:
            record = convert_record(path, relative, digest, state, dry_run)
            if not any(issue["code"] == "staged_file_differs" for issue in record["issues"]):
                entries[digest] = record
        else:
            record = {**cached, "unchanged": cached == previous}
        first = seen.setdefault(digest, relative)
        if record["status"] not in {"non_work", "failed"} and relative != first:
            return {**record, "sourcePath": relative, "status": "duplicate", "duplicateOf": first}
        if cached is not None and cached["sourcePath"] != relative:
            record["sameContentAs"] = cached["sourcePath"]
        return {**record, "sourcePath": relative}
    except OSError as error:
        return add_issue({"sourcePath": relative, "status": "failed"},
                         f"io_{type(error).__name__}", "error")


def apply_identity_checks(records, entries):
    snapshots = defaultdict(set)
    similar = defaultdict(set)
    restricted = set()
    for record in entries.values():
        if "markdownSha256" in record:
            snapshots[record["workId"]].add(record["markdownSha256"])
            if record.get("title") and record.get("author"):
                similar[record["title"].casefold(), record["author"].casefold()].add(record["workId"])
        if record.get("publication") == "repost_restricted":
            restricted.add(record["workId"])

    reviewed = []
    for record in records:
        work_id = record.get("workId")
        if work_id in restricted:
            record = {**record, "publication": "repost_restricted"}
        if record["status"] in READY | {"needs_review"}:
            title = (record.get("title") or "").casefold()
            author = (record.get("author") or "").casefold()
            candidates = similar[title, author]
            if len(snapshots[work_id]) > 1:
                record = add_issue({**record, "status": "needs_review"}, "conflicting_snapshots", "review")
            if len(candidates) > 1 and any(candidate.startswith("local-") for candidate in candidates):
                record = add_issue({**record, "status": "needs_review"}, "possible_identity_match", "review")
        reviewed.append(record)
    return reviewed


def promote(root, state, records, approvals):
    candidates = {(record.get("workId"), record.get("sha256")): record for record in records
                  if record["status"] != "duplicate"}
    fics = root / "_fics"
    if not fics.is_dir() or fics.is_symlink() or fics.resolve().parent != root:
        raise ImportProblem("The repository's _fics directory is missing or redirected.")
    outcomes = []
    for work_id, digest in sorted(approvals.items()):
        outcome = {"workId": work_id, "sha256": digest, "status": "held"}
        outcomes.append(outcome)
        record = candidates.get((work_id, digest))
        if not record:
            outcome["reason"] = "approved_source_not_selected"
        elif record.get("publication") != "approval_required" or record["status"] not in READY:
            outcome["reason"] = ("repost_restricted" if record.get("publication") == "repost_restricted"
                                 else record["status"])
        else:
            source = staged_path(state, work_id, digest)
            destination = fics / f"{work_id}.md"
            try:
                data = source.read_bytes()
                if hashlib.sha256(data).hexdigest() != record["markdownSha256"]:
                    outcome["reason"] = "staged_file_differs"
                    continue
                write_bytes(destination, data, temporary_dir=state)
                outcome["status"] = "promoted"
            except FileExistsError:
                if destination.is_file() and not destination.is_symlink() and file_hash(destination) == record["markdownSha256"]:
                    outcome["status"] = "already_present"
                else:
                    outcome["reason"] = "existing_work_preserved"
            except OSError as error:
                outcome["reason"] = f"io_{type(error).__name__}"
    return outcomes


def report_summary(records, promotions):
    counts = Counter(record["status"] for record in records)
    return {"scanned": len(records), "converted": sum(counts[status] for status in READY),
            "missing_metadata": sum(bool(record.get("missingMetadata")) for record in records
                                    if record["status"] != "duplicate"),
            **{status: counts[status] for status in STATUSES},
            "promoted": sum(outcome["status"] == "promoted" for outcome in promotions),
            "promotion_held": sum(outcome["status"] == "held" for outcome in promotions)}


def page_ranges(pages):
    ranges = []
    for number in pages:
        if ranges and ranges[-1][-1] + 1 == number:
            ranges[-1][-1] = number
        else:
            ranges.append([number, number])
    return ", ".join(str(start) if start == end else f"{start}-{end}" for start, end in ranges)


def write_reports(state, records, promotions, dry_run):
    summary = report_summary(records, promotions)
    totals = ", ".join(f"{name.replace('_', ' ')} {count}" for name, count in summary.items())
    lines = ["RadioApple import" + (" (dry run)" if dry_run else ""), totals, ""]
    for record in records:
        lines.append(f"[{record['status']}] {record['sourcePath']}")
        if record.get("format"):
            lines.append(f"  Export: {record['format']}. Work: {record['workId']}. SHA-256: {record['sha256']}")
        if record.get("stagedPath"):
            action = "Would stage" if dry_run and not record.get("unchanged") else "Staging path"
            lines.append(f"  {action}: {record['stagedPath']}")
        other = record.get("duplicateOf") or record.get("sameContentAs")
        if other:
            lines.append(f"  Same source file as: {other}")
        if record.get("declaredChapters") is not None or record.get("extractedChapters") is not None:
            lines.append(f"  Chapters: {record.get('extractedChapters') or 0} extracted, "
                         f"{record.get('declaredChapters') or 'unknown'} declared")
        if record.get("declaredWords") is not None:
            lines.append(f"  Words: {record['extractedWords']} extracted, {record['declaredWords']} declared")
        if record.get("publication") == "repost_restricted":
            lines.append("  Promotion blocked by a repost restriction.")
        if record.get("missingMetadata"):
            lines.append("  Missing: " + ", ".join(record["missingMetadata"]))
        for issue in record.get("issues", []):
            pages = page_ranges(issue["pages"])
            location = "EPUB sections" if record.get("format") == "epub" else "PDF pages"
            lines.append(f"  {issue['severity']}: {issue['code'].replace('_', ' ')}" +
                         (f" ({location} {pages})" if pages else ""))
        lines.append("")
    for outcome in promotions:
        lines.append(f"Promotion {outcome['workId']}: {outcome['status']} {outcome.get('reason', '')}".rstrip())
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    report = state / "reports" / f"{run_id}.json"
    write_json(report, {"dryRun": dry_run, "summary": summary, "results": records, "promotion": promotions})
    write_bytes(report.with_suffix(".txt"), ("\n".join(lines) + "\n").encode("utf-8"))
    return summary, totals, report


def inbox_approvals(root, source, records):
    inbox = root / DEFAULT_SOURCE / PUBLISH_INBOX
    if inbox.resolve() != inbox:
        return {}
    candidates = {}
    for record in records:
        path = source / record["sourcePath"]
        if path.is_relative_to(inbox) and record.get("workId") and record["status"] != "non_work":
            candidates.setdefault(record["workId"], record["sha256"])
    return candidates


def build_library(root, mode):
    if os.name == "nt":
        command = ["cmd.exe", "/d", "/c", "Atualizar biblioteca.cmd", mode, "--build-only"]
    else:
        command = ["ruby", str(root / "tools" / "build-library.rb"), mode]
    if subprocess.run(command, cwd=root).returncode:
        raise ImportProblem(f"Could not build the library ({mode}). Check the Jekyll output above.")


def run(root, source, paths, dry_run=False, approvals=None, *, library=False, open_reader=False):
    root = root.resolve()
    source = source.resolve()
    state = root / STATE_DIR
    state_path = state.resolve()
    if state_path != state or state_path.is_relative_to(source) or source.is_relative_to(state_path):
        raise ImportProblem("Use a source separate from the local staging directory.")
    output_dirs = ("works", "reports", "preview") if library else ("works", "reports")
    if any((state / name).resolve() != state / name for name in output_dirs):
        raise ImportProblem("The local import output directories must not be redirected.")
    if source.is_relative_to(root) and not source.is_relative_to(root / DEFAULT_SOURCE):
        raise ImportProblem(f"Choose a source outside the repository or inside {DEFAULT_SOURCE}.")
    files = discover(source, paths)
    manifest_path = state / "manifest.json"
    with locked(state):
        manifest = get_manifest(manifest_path)
        entries = manifest["entries"]
        seen = {}
        records = []
        for path in files:
            print(f"Checking {path.relative_to(source)}", flush=True)
            record = record_for(path, source, state, entries, seen, dry_run)
            records.append(record)
        records = apply_identity_checks(records, entries)
        if not dry_run and files:
            data = json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
            if not manifest_path.exists() or manifest_path.read_bytes() != data.encode("utf-8"):
                write_bytes(manifest_path, data.encode("utf-8"), replace=True)
        if library and not dry_run:
            approvals = inbox_approvals(root, source, records)
        outcomes = promote(root, state, records, approvals) if approvals and not dry_run else []
        summary, totals, report = write_reports(state, records, outcomes, dry_run)
        print(totals, flush=True)
        print(f"Reports: {report.with_suffix('.txt')} and {report}", flush=True)
        if library and not dry_run:
            build_library(root, "--preview")
            preview = state / "preview" / "index.html"
            print(f"Private library: {preview}", flush=True)
            if open_reader:
                if os.name == "nt":
                    os.startfile(str(preview))
                else:
                    webbrowser.open(preview.as_uri())
            if any(outcome["status"] in {"promoted", "already_present"} for outcome in outcomes):
                build_library(root, "--pages")
    return summary, report


def main(argv=None):
    parser = argparse.ArgumentParser(description="Import PDF, EPUB and DOCX exports into RadioApple.")
    parser.add_argument("paths", nargs="*", help="source files or directories inside the source folder")
    parser.add_argument("--source", type=Path, default=ROOT / DEFAULT_SOURCE, help="override the source directory")
    actions = parser.add_mutually_exclusive_group()
    actions.add_argument("--dry-run", action="store_true", help="validate and report without staging Markdown")
    actions.add_argument("--promote", type=Path, metavar="APPROVALS", help="stage, then promote exact approved snapshots")
    actions.add_argument("--library", action="store_true", help="import, rebuild and open the library")
    parser.add_argument("--build-only", action="store_true", help="with --library, do not open the browser")
    args = parser.parse_args(argv)
    logging.getLogger("pdfminer").setLevel(logging.ERROR)
    try:
        approval_path = args.promote.resolve() if args.promote else None
        if approval_path and approval_path.is_relative_to(ROOT) and not approval_path.is_relative_to(ROOT / STATE_DIR):
            raise ImportProblem(f"Keep the approval file outside the repository or inside {STATE_DIR}.")
        approvals = approvals_from(approval_path) if approval_path else None
        summary, _ = run(ROOT, args.source, args.paths, args.dry_run, approvals,
                         library=args.library, open_reader=args.library and not args.build_only)
    except (ImportProblem, OSError) as error:
        print(f"Import stopped: {error}", file=sys.stderr)
        return 2
    return int(bool(summary["failed"] or summary["promotion_held"]))


if __name__ == "__main__":
    raise SystemExit(main())
