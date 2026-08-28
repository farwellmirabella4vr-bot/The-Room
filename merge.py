#!/usr/bin/env python3
"""merge.py -- fold textbook page objects from a manifest into a curriculum JSON.

Usage:
    python merge.py <curriculum.json> <manifest.json> [--dry-run]

For every page object in the manifest's page list, find the lesson whose "pages"
range covers that page's "page" number and append the object to that lesson's
"bookPages" array, keeping the array sorted by "page".

The manifest's page list is taken from manifest["bookPages"] if present, else
manifest["pages"] (the key used by the source-drop manifests).

Rules:
  * Lessons are never created. A page no lesson covers is reported and skipped.
  * No existing field is modified. The only write is appending to a lesson's own
    "bookPages" list (created empty only if the lesson doesn't have one yet).
  * A page whose number is already in the target lesson's "bookPages" is skipped,
    so re-running is safe (idempotent).
  * --dry-run prints the mapping and writes nothing.
  * Before writing, the curriculum file is copied to "<curriculum.json>.bak".
    No backup is written on a dry run or when there is nothing to add.
"""

import argparse
import json
import re
import shutil
import sys


def parse_ranges(spec):
    """'11-12, 131' -> [(11, 12), (131, 131)]. Blank / unparseable segments are ignored."""
    ranges = []
    for seg in str(spec).split(","):
        seg = seg.strip()
        if not seg:
            continue
        m = re.fullmatch(r"(\d+)\s*-\s*(\d+)", seg)
        if m:
            lo, hi = int(m.group(1)), int(m.group(2))
            ranges.append((min(lo, hi), max(lo, hi)))
            continue
        m = re.fullmatch(r"(\d+)", seg)
        if m:
            n = int(m.group(1))
            ranges.append((n, n))
    return ranges


def covers(spec, page):
    return any(lo <= page <= hi for lo, hi in parse_ranges(spec))


def iter_lessons(curriculum):
    for unit in curriculum.get("units", []):
        for lesson in unit.get("lessons", []):
            yield lesson


def lesson_label(lesson):
    return lesson.get("id") or lesson.get("title") or "?"


def manifest_page_list(manifest):
    for key in ("bookPages", "pages"):
        value = manifest.get(key)
        if isinstance(value, list):
            return key, value
    sys.exit("error: manifest has no 'bookPages' (or 'pages') array")


def page_number(entry):
    if not isinstance(entry, dict) or "page" not in entry:
        return None
    try:
        return int(entry["page"])
    except (TypeError, ValueError):
        return None


def sort_key(entry):
    n = page_number(entry)
    return (0, n) if n is not None else (1, 0)


def main():
    ap = argparse.ArgumentParser(
        description="Merge a manifest's book pages into a curriculum JSON."
    )
    ap.add_argument("curriculum", help="path to the curriculum JSON")
    ap.add_argument("manifest", help="path to the manifest JSON")
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="print the mapping and write nothing",
    )
    args = ap.parse_args()

    with open(args.curriculum, encoding="utf-8") as f:
        curriculum = json.load(f)
    with open(args.manifest, encoding="utf-8") as f:
        manifest = json.load(f)

    src_key, entries = manifest_page_list(manifest)
    lessons = list(iter_lessons(curriculum))

    added = []       # (page, lesson label)
    skipped = []     # (page, lesson label) -- already present
    unmatched = []   # page
    ambiguous = []   # (page, [labels]) -- covered by >1 lesson; first wins
    invalid = 0      # manifest entries with no usable "page"

    for entry in entries:
        page = page_number(entry)
        if page is None:
            invalid += 1
            continue

        matches = [lsn for lsn in lessons if covers(lsn.get("pages", ""), page)]
        if not matches:
            unmatched.append(page)
            continue
        if len(matches) > 1:
            ambiguous.append((page, [lesson_label(lsn) for lsn in matches]))

        lesson = matches[0]
        label = lesson_label(lesson)
        book_pages = lesson.get("bookPages")
        present = set()
        if isinstance(book_pages, list):
            for existing in book_pages:
                n = page_number(existing)
                if n is not None:
                    present.add(n)

        if page in present:
            skipped.append((page, label))
            continue

        if not args.dry_run:
            if not isinstance(book_pages, list):
                book_pages = []
                lesson["bookPages"] = book_pages
            book_pages.append(entry)
            book_pages.sort(key=sort_key)
        added.append((page, label))

    # ---- report ----
    def row(page, label):
        return "  p{:<4} -> {}".format(page, label)

    print("manifest pages read from: {}  ({} entries)".format(src_key, len(entries)))
    print("\n{} ({}):".format("would add" if args.dry_run else "added", len(added)))
    for page, label in added:
        print(row(page, label))
    if skipped:
        print("\nalready present, skipped ({}):".format(len(skipped)))
        for page, label in skipped:
            print(row(page, label))
    if ambiguous:
        print("\nWARNING -- covered by more than one lesson, assigned to the first ({}):".format(len(ambiguous)))
        for page, labels in ambiguous:
            print("  p{:<4} -> {}   (also matched: {})".format(page, labels[0], ", ".join(labels[1:])))
    if unmatched:
        print("\nWARNING -- no lesson covers these, skipped ({}):".format(len(unmatched)))
        print("  " + ", ".join("p{}".format(p) for p in unmatched))
    if invalid:
        print("\nWARNING -- manifest entries with no usable 'page', skipped: {}".format(invalid))

    if args.dry_run:
        print("\ndry run -- no files written")
        return
    if not added:
        print("\nnothing to add -- curriculum unchanged, no backup written")
        return

    backup = args.curriculum + ".bak"
    shutil.copy2(args.curriculum, backup)
    with open(args.curriculum, "w", encoding="utf-8") as f:
        json.dump(curriculum, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("\nbacked up -> {}".format(backup))
    print("wrote      -> {}  (+{} pages)".format(args.curriculum, len(added)))


if __name__ == "__main__":
    main()
