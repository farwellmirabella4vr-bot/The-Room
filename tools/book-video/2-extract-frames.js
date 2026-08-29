#!/usr/bin/env node
/*
  2-extract-frames.js  --  Stage 2 of the book-video curriculum pipeline

  Takes your "flip through the Spanish textbook" video and pulls ONE image
  per page into tools\book-video\frames\.

  HOW IT WORKS
    Pass 1  ffmpeg's scene-change filter (select='gt(scene,N)') writes a
            frame every time the picture changes a lot -- i.e. every page
            flip. The very first frame (page 1) is forced in too, because
            nothing "changes" before it. These land in frames\_raw\.
    Pass 2  A page flip often trips the scene filter twice (two near-identical
            frames of the same new page, or one clean frame plus a blurred
            mid-flip frame). ffmpeg's mpdecimate filter walks the raw frames
            in order and drops any frame that's almost identical to the one
            before it. The survivors are renumbered into frames\page-000001.jpg,
            page-000002.jpg, ...

  At the end it prints the final frame count. COMPARE THAT NUMBER against the
  real page count of the physical book (flip to the last page and read it,
  and remember to count any unnumbered front matter you filmed). They should
  be close. If they're not, edit the two thresholds below and re-run.

  RUN
    node tools\book-video\2-extract-frames.js "C:\path\to\your-video.mp4"

  OPTIONS
    --force   Delete any existing frames\ contents first (otherwise the
              script stops if frames\ already has pages in it).

  ffmpeg must be on PATH (Stage 1 checks this).
*/

// ================================================================
// EDIT THESE IF THE FRAME COUNT COMES OUT WRONG
// ================================================================

// Pass 1 -- scene-change sensitivity. This is the N in select='gt(scene,N)'.
// It's a 0..1 "how different is this frame from the last one" score; a frame
// is kept when the score is ABOVE this number.
//
//   TOO FEW frames (pages missing, count came out low)  -> LOWER this
//        e.g. 0.11 -> 0.08 -> 0.05   (more sensitive, catches smaller changes)
//   TOO MANY frames (lots of duplicates, count came out high)  -> RAISE this
//        e.g. 0.11 -> 0.15 -> 0.20   (less sensitive, ignores small changes)
//
// For handheld / phone footage, values below ~0.08 mostly pick up camera
// shake and sensor noise, not page turns -- a real page flip is a big change
// and scores ~0.10-0.20. Steady tripod/overhead footage can go lower.
// Sensible range is about 0.05 (twitchy) to 0.30 (only big changes).
const SCENE_THRESHOLD = 0.11;

// Also require at least this many seconds since the last kept frame. A page
// flip takes a fraction of a second but trips the scene filter on several
// consecutive frames; this keeps just one per flip without relying on the
// dedupe pass. Set it a bit below your fastest real page-hold time.
//   Two frames of the SAME spread getting through -> raise it (1.0 -> 1.5)
//   A fast flip being skipped entirely            -> lower it (1.0 -> 0.6)
const MIN_SECONDS_BETWEEN_FRAMES = 1.0;

// Pass 2 -- the dedupe pass (ffmpeg mpdecimate). These decide when a frame
// counts as "basically the same as the previous one" and gets dropped.
// Bigger numbers = drop MORE aggressively = FEWER frames out.
//
//   Still getting doubled pages after a run  -> raise DEDUPE_HI / DEDUPE_LO
//        (try x16 / x7, then x20 / x9)
//   Losing real, distinct pages to the dedupe -> lower them
//        (try x9 / x4)
//
// DEDUPE_FRAC is the share of 8x8 blocks that must have changed for a frame
// to be KEPT. Raise it to drop more; lower it to keep more.
const DEDUPE_HI = 64 * 12; // 768
const DEDUPE_LO = 64 * 5; //  320
const DEDUPE_FRAC = 0.33;

// JPEG quality for the saved frames: 2 = best/bigger, 5 = smaller/softer.
// 3 is plenty for OCR.
const JPEG_QUALITY = 3;

// ================================================================
// nothing below here normally needs editing
// ================================================================

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DIR = __dirname;
const FRAMES_DIR = path.join(DIR, "frames");
const RAW_DIR = path.join(FRAMES_DIR, "_raw");
const REPORT_PATH = path.join(FRAMES_DIR, "_extract-report.json");

function fail(msg) {
  console.error("\nStage 2 stopped: " + msg + "\n");
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv) {
    if (a === "--force") args.force = true;
    else args._.push(a);
  }
  return args;
}

function ffmpeg(args) {
  const res = spawnSync("ffmpeg", args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 128 });
  if (res.error) fail("couldn't run ffmpeg (" + res.error.message + "). Is it on PATH? Re-run Stage 1.");
  return res;
}

function listFrames(dir, prefix) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && /\.jpg$/i.test(f)).sort();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const videoPath = args._[0];
  if (!videoPath) fail('give me the video path:\n  node tools\\book-video\\2-extract-frames.js "C:\\path\\to\\your-video.mp4"');
  if (!fs.existsSync(videoPath)) fail("video file not found: " + videoPath);

  // ffmpeg present?
  const check = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (check.error || check.status !== 0) fail("ffmpeg isn't on PATH. Run Stage 1 (1-check-setup.js) for install steps.");

  // frames/ already populated?
  const existing = listFrames(FRAMES_DIR, "page-");
  if (existing.length && !args.force) {
    fail(
      "frames\\ already has " + existing.length + " page image(s).\n" +
      "  Re-run with  --force  to wipe frames\\ and start over, or move the folder aside first."
    );
  }

  // clean
  if (fs.existsSync(FRAMES_DIR)) fs.rmSync(FRAMES_DIR, { recursive: true, force: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });

  // ---- Pass 1: scene-change extraction ------------------------------------
  console.log("Pass 1/2  scene-change extraction (threshold " + SCENE_THRESHOLD +
    ", min " + MIN_SECONDS_BETWEEN_FRAMES + "s apart)");
  console.log("  Decoding the whole video once -- this can take several minutes for a long clip.\n");
  const rawPattern = path.join(RAW_DIR, "raw-%06d.jpg");
  const p1 = ffmpeg([
    "-y",
    "-i", videoPath,
    // eq(n,0) forces the very first frame (page 1) in. Otherwise: keep a frame only
    // when the picture changed a lot (gt(scene,N)) AND at least MIN seconds have
    // passed since the last kept frame -- so one clean frame per page flip.
    "-vf", "select='eq(n\\,0)+gt(scene\\," + SCENE_THRESHOLD +
      ")*gt(t-prev_selected_t\\," + MIN_SECONDS_BETWEEN_FRAMES + ")',scale='min(2000,iw)':-2",
    "-fps_mode", "vfr",
    "-q:v", String(JPEG_QUALITY),
    rawPattern,
  ]);
  const rawFrames = listFrames(RAW_DIR, "raw-");
  if (!rawFrames.length) {
    console.error(p1.stderr ? p1.stderr.split(/\r?\n/).slice(-15).join("\n") : "");
    fail(
      "Pass 1 produced no frames. Most likely the scene threshold is too high for this video.\n" +
      "  Lower SCENE_THRESHOLD near the top of this file (try 0.015) and re-run with --force."
    );
  }
  console.log("  Pass 1 kept " + rawFrames.length + " raw frame(s).\n");

  // ---- Pass 2: dedupe near-identical consecutive frames ------------------
  console.log("Pass 2/2  dropping near-identical consecutive frames (mpdecimate " +
    "hi=" + DEDUPE_HI + " lo=" + DEDUPE_LO + " frac=" + DEDUPE_FRAC + ")");
  const pagePattern = path.join(FRAMES_DIR, "page-%06d.jpg");
  const p2 = ffmpeg([
    "-y",
    "-framerate", "2",
    "-i", rawPattern,
    "-vf", "mpdecimate=hi=" + DEDUPE_HI + ":lo=" + DEDUPE_LO + ":frac=" + DEDUPE_FRAC,
    "-fps_mode", "vfr",
    "-q:v", String(JPEG_QUALITY),
    pagePattern,
  ]);
  const pageFrames = listFrames(FRAMES_DIR, "page-");
  if (!pageFrames.length) {
    console.error(p2.stderr ? p2.stderr.split(/\r?\n/).slice(-15).join("\n") : "");
    fail("Pass 2 produced no frames. Lower DEDUPE_HI / DEDUPE_LO and re-run with --force.");
  }

  // keep _raw/ around -- Stage 5's review page and a re-run of Pass 2 both use it.
  const dropped = rawFrames.length - pageFrames.length;

  const report = {
    generatedAt: new Date().toISOString(),
    video: path.resolve(videoPath),
    sceneThreshold: SCENE_THRESHOLD,
    dedupe: { hi: DEDUPE_HI, lo: DEDUPE_LO, frac: DEDUPE_FRAC },
    rawFrameCount: rawFrames.length,
    finalFrameCount: pageFrames.length,
    droppedByDedupe: dropped,
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n");

  // ---- summary ---------------------------------------------------------
  const line = "=".repeat(64);
  console.log("\n" + line);
  console.log("  FINAL FRAME COUNT:  " + pageFrames.length +
    "   (raw " + rawFrames.length + " minus " + dropped + " dropped as duplicates)");
  console.log(line);
  console.log("\n  Frames are in:  " + FRAMES_DIR + "\\page-000001.jpg ...");
  console.log("  Report:         " + REPORT_PATH + "\n");
  console.log("  >>> NOW: compare " + pageFrames.length + " against the REAL page count of the book.");
  console.log("      Flip to the last page of the physical book and read its number; add any");
  console.log("      unnumbered front matter you filmed.\n");
  console.log("      Within a few pages          -> good, go to Stage 3.");
  console.log("      Final count is LOWER (pages missing) -> LOWER  SCENE_THRESHOLD, re-run: --force");
  console.log("      Final count is HIGHER (duplicates)   -> RAISE  SCENE_THRESHOLD (and/or DEDUPE_HI/LO), re-run: --force");
  console.log("      A few blurry mid-flip frames are fine -- you'll delete those by hand in Stage 5.\n");
  console.log("  Stage 3:  node tools\\book-video\\3-ocr-pages.js\n");
}

main();
