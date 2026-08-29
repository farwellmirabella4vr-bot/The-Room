#!/usr/bin/env node
/*
  3-ocr-pages.js  --  Stage 3 of the book-video curriculum pipeline

  Runs Tesseract (Spanish) over every frame from Stage 2 and works out which
  printed page number each frame shows.

  OUTPUTS (all under tools\book-video\)
    ocr\page-000001.txt ...     one plain-text file per frame (raw OCR)
    pages.json                  [{ frame, ocrFile, detectedPage, candidates, textChars }]
    page-sequence-report.txt    a human-readable check of the page-number run:
                                gaps (missed pages), duplicates, out-of-order
                                jumps, and frames where no number could be read.

  READ page-sequence-report.txt before moving on. It's how you find out
  whether Stage 2 missed pages or produced extras.

  RUN
    node tools\book-video\3-ocr-pages.js

  OPTIONS
    --force   Re-OCR frames even if an ocr\*.txt already exists for them.
              (Without this, existing .txt files are reused -- fast re-runs.)

  Tesseract + the "spa" language pack must be installed (Stage 1 checks this).
*/

// ================================================================
// Editable settings
// ================================================================
const TESS_LANG = "spa"; // Spanish. Use "spa+eng" if your book mixes in English.
const TESS_PSM = "3"; //    Page segmentation mode. 3 = full automatic (default, good
//                          for a whole page). Try "4" (single column) or "6" (single
//                          block) if the OCR text comes out badly ordered.
const PAGE_NUMBER_MAX = 999; // ignore "numbers" bigger than this when hunting for a page number
const EDGE_LINES = 4; //       how many lines from the top and bottom of the page to search
// ================================================================

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DIR = __dirname;
const FRAMES_DIR = path.join(DIR, "frames");
const OCR_DIR = path.join(DIR, "ocr");
const PAGES_JSON = path.join(DIR, "pages.json");
const SEQ_REPORT = path.join(DIR, "page-sequence-report.txt");

function fail(msg) {
  console.error("\nStage 3 stopped: " + msg + "\n");
  process.exit(1);
}
function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv) (a === "--force" ? (args.force = true) : args._.push(a));
  return args;
}

// Pull a plausible printed page number out of one frame's OCR text.
// Looks only at the top and bottom few lines (where page numbers live) for a
// line that is basically just a number. Returns { detectedPage, candidates }.
function detectPageNumber(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const nonEmpty = lines.filter((l) => l.length);
  const top = nonEmpty.slice(0, EDGE_LINES);
  const bottom = nonEmpty.slice(-EDGE_LINES);
  const candidates = [];

  const scan = (arr, where) => {
    arr.forEach((l) => {
      // a line that is only a number, optionally wrapped in stray OCR punctuation
      const m = l.match(/^[^\dA-Za-zÀ-ÿ]*(\d{1,3})[^\dA-Za-zÀ-ÿ]*$/);
      if (m) {
        const n = Number(m[1]);
        if (n >= 1 && n <= PAGE_NUMBER_MAX) candidates.push({ n, where, line: l });
      }
    });
  };
  scan(bottom, "bottom");
  scan(top, "top");

  // Prefer a number found at the bottom, then the top. First match wins.
  const detectedPage = candidates.length ? candidates[0].n : null;
  return { detectedPage, candidates };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const check = spawnSync("tesseract", ["--version"], { encoding: "utf8" });
  if (check.error || check.status !== 0) fail("tesseract isn't on PATH. Run Stage 1 for install steps.");
  const langs = spawnSync("tesseract", ["--list-langs"], { encoding: "utf8" });
  if (!/(^|\s)spa(\s|$)/m.test((langs.stdout || "") + (langs.stderr || ""))) {
    fail('the Spanish pack ("spa") isn\'t installed for Tesseract. Run Stage 1 for the fix.');
  }

  if (!fs.existsSync(FRAMES_DIR)) fail("no frames\\ folder. Run Stage 2 first.");
  const frames = fs.readdirSync(FRAMES_DIR).filter((f) => /^page-\d+\.jpg$/i.test(f)).sort();
  if (!frames.length) fail("frames\\ has no page-*.jpg files. Run Stage 2 first.");

  fs.mkdirSync(OCR_DIR, { recursive: true });
  console.log("OCR over " + frames.length + " frame(s) with Tesseract (-l " + TESS_LANG + " --psm " + TESS_PSM + ")\n");

  const pages = [];
  let ocrRun = 0;
  let ocrReused = 0;

  frames.forEach((frame, i) => {
    const base = frame.replace(/\.jpg$/i, "");
    const outBase = path.join(OCR_DIR, base); // tesseract appends ".txt"
    const txtPath = outBase + ".txt";

    if (fs.existsSync(txtPath) && !args.force) {
      ocrReused++;
    } else {
      const res = spawnSync(
        "tesseract",
        [path.join(FRAMES_DIR, frame), outBase, "-l", TESS_LANG, "--psm", TESS_PSM],
        { encoding: "utf8" }
      );
      if (res.error || res.status !== 0) {
        console.log("  [" + (i + 1) + "/" + frames.length + "] " + frame + "  OCR FAILED: " +
          (res.error ? res.error.message : (res.stderr || "").split(/\r?\n/).slice(-2).join(" ")));
        fs.writeFileSync(txtPath, ""); // keep a placeholder so pages.json stays aligned
      }
      ocrRun++;
    }

    const text = fs.existsSync(txtPath) ? fs.readFileSync(txtPath, "utf8") : "";
    const { detectedPage, candidates } = detectPageNumber(text);
    pages.push({
      index: i + 1,
      frame,
      ocrFile: base + ".txt",
      detectedPage,
      candidates,
      textChars: text.trim().length,
    });

    if ((i + 1) % 20 === 0 || i === frames.length - 1) {
      process.stdout.write("\r  processed " + (i + 1) + "/" + frames.length + "   ");
    }
  });
  process.stdout.write("\n\n");

  fs.writeFileSync(PAGES_JSON, JSON.stringify(pages, null, 2) + "\n");
  console.log("  OCR text: " + OCR_DIR + "\\  (" + ocrRun + " newly run, " + ocrReused + " reused)");
  console.log("  Map:      " + PAGES_JSON + "\n");

  // ---- build the sequence report -------------------------------------
  const withNums = pages.filter((p) => p.detectedPage != null);
  const noNumber = pages.filter((p) => p.detectedPage == null);
  const lowText = pages.filter((p) => p.textChars < 40);

  // duplicates: same detected page on more than one frame
  const byNum = {};
  withNums.forEach((p) => (byNum[p.detectedPage] = byNum[p.detectedPage] || []).push(p));
  const duplicates = Object.keys(byNum).filter((n) => byNum[n].length > 1);

  // gaps + backwards jumps: walk frames in order
  const gaps = [];
  const backwards = [];
  let prev = null;
  withNums.forEach((p) => {
    if (prev != null) {
      const step = p.detectedPage - prev;
      if (step > 1) gaps.push({ after: prev, before: p.detectedPage, missing: p.detectedPage - prev - 1, frame: p.frame });
      if (step < 0) backwards.push({ from: prev, to: p.detectedPage, frame: p.frame });
    }
    prev = p.detectedPage;
  });

  const L = [];
  L.push("PAGE SEQUENCE REPORT");
  L.push("generated " + new Date().toISOString());
  L.push("");
  L.push("Frames in video order, with the printed page number read off each:");
  L.push("-".repeat(60));
  pages.forEach((p) => {
    const num = p.detectedPage != null ? String(p.detectedPage).padStart(4) : "  ??";
    const alt = p.candidates.length > 1
      ? "  (also saw: " + [...new Set(p.candidates.map((c) => c.n))].join(", ") + ")"
      : "";
    const thin = p.textChars < 40 ? "  <-- almost no text (blank / blurry / mid-flip?)" : "";
    L.push("  frame " + String(p.index).padStart(4) + "  " + p.frame + "   page " + num + alt + thin);
  });
  L.push("");
  L.push("=".repeat(60));
  L.push("FINDINGS");
  L.push("=".repeat(60));
  L.push("frames total ............... " + pages.length);
  L.push("page number read .......... " + withNums.length);
  L.push("no page number ............ " + noNumber.length + (noNumber.length ? "   frames: " + noNumber.map((p) => p.frame).join(", ") : ""));
  L.push("near-empty frames ......... " + lowText.length + (lowText.length ? "   frames: " + lowText.map((p) => p.frame).join(", ") : ""));
  L.push("");

  if (!gaps.length && !duplicates.length && !backwards.length) {
    L.push("No gaps, duplicates, or out-of-order jumps in the numbers that were read.");
    L.push("(Frames with no number still need a look -- they might be real pages the OCR");
    L.push(" just couldn't read a number on, or they might be junk to delete in Stage 5.)");
  } else {
    if (gaps.length) {
      L.push("GAPS -- page numbers jump forward, so pages in between were never captured:");
      gaps.forEach((g) => L.push("  after page " + g.after + " the next read is " + g.before +
        "  -> " + g.missing + " page(s) missing  (at " + g.frame + ")"));
      L.push("  Fix: LOWER SCENE_THRESHOLD in Stage 2 and re-run 2 and 3. Or, if those pages");
      L.push("       really are in a frame but the number just didn't OCR, fix it by hand in Stage 5.");
      L.push("");
    }
    if (duplicates.length) {
      L.push("DUPLICATES -- the same page number was read on more than one frame:");
      duplicates.forEach((n) => L.push("  page " + n + "  on  " + byNum[n].map((p) => p.frame).join(", ")));
      L.push("  Usually a doubled flip that slipped past the dedupe. Delete the extra frame(s)");
      L.push("  in Stage 5, or RAISE DEDUPE_HI / DEDUPE_LO in Stage 2 and re-run 2 and 3.");
      L.push("");
    }
    if (backwards.length) {
      L.push("OUT OF ORDER -- the page number went backwards:");
      backwards.forEach((b) => L.push("  from " + b.from + " to " + b.to + "  (at " + b.frame + ")"));
      L.push("  Often a misread number (e.g. 6 vs 9, 81 vs 18). Check those frames in Stage 5.");
      L.push("");
    }
  }
  L.push("");
  L.push("Next: node tools\\book-video\\4-extract-structure.js");
  fs.writeFileSync(SEQ_REPORT, L.join("\n") + "\n");

  // ---- console summary ----------------------------------------------
  const bar = "=".repeat(64);
  console.log(bar);
  console.log("  " + pages.length + " frames  |  " + withNums.length + " with a page number  |  " +
    noNumber.length + " without  |  " + gaps.length + " gap(s)  |  " + duplicates.length + " duplicate(s)");
  console.log(bar);
  console.log("\n  >>> READ THIS before Stage 4:  " + SEQ_REPORT + "\n");
  if (gaps.length) console.log("  It reports GAPS -- pages were missed. Consider re-running Stage 2 with a lower SCENE_THRESHOLD.\n");
  console.log("  Stage 4:  node tools\\book-video\\4-extract-structure.js\n");
}

main();
