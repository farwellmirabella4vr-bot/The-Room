#!/usr/bin/env node
/*
  process-textbook-video.js

  Turns an overhead "flip through the textbook" video into page images
  matched to Reading & Writing Farsi's lesson entries.

  Pipeline:
    1. ffmpeg's freezedetect finds still periods in the video (a page
       being held steady) and one JPEG is pulled from the middle of
       each still period.
    2. Each still is sent to the Anthropic API (vision) to read the
       visible page number and classify the still as book content vs.
       an instructional/activity aside ("get paper," "make a binder").
    3. Content stills get matched to a lesson by page number, against
       data/curriculum/fa/rw-farsi.json's own "pages" ranges.
    4. Everything lands in a report JSON first -- nothing is written
       into the curriculum file unless you pass --apply. Re-running is
       safe and cheap: stills already in the report are never
       reclassified (paid API calls), only newly-detected ones are.

  PREREQUISITES
    - ffmpeg on PATH (winget install Gyan.FFmpeg, then open a NEW
      terminal so PATH picks it up).
    - ANTHROPIC_API_KEY set as an environment variable. PowerShell:
        [Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "sk-ant-...", "User")
      then open a new terminal. Or just for one session:
        $env:ANTHROPIC_API_KEY = "sk-ant-..."

  USAGE
    node process-textbook-video.js <video-file> [options]

  OPTIONS
    --limit N        Only classify the first N detected stills (for a
                      cheap test run before committing to the whole book).
    --out DIR         Where extracted images are saved.
                       Default: data/curriculum/fa/textbook-images
    --report FILE     Where the classification report is saved/loaded.
                       Default: textbook-video-report.json
    --curriculum FILE The curriculum JSON to match pages against.
                       Default: data/curriculum/fa/rw-farsi.json
    --freeze-db N     freezedetect noise threshold, dB (more negative =
                       stricter about what counts as "still"). Default -30.
    --freeze-duration S  Minimum seconds of stillness to count as a
                          held page. Default 1.5.
    --model NAME      Anthropic model. Default claude-haiku-4-5-20251001
                       (cheap and plenty for reading a page number off
                       a photo -- this is a ~192-call batch job).
    --apply           After classifying, merge the report into the
                       curriculum file's lessons (content stills) and a
                       top-level activityPages array (activity stills).
    --force           Reclassify stills already present in the report
                       instead of skipping them.

  Extracted images are real photographs of copyrighted textbook pages --
  every language's textbook-images folder is gitignored, same as this
  project's existing audio/docs exclusions. Never remove that entry.
*/

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = __dirname;

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--force") args.force = true;
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--report") args.report = argv[++i];
    else if (a === "--curriculum") args.curriculum = argv[++i];
    else if (a === "--freeze-db") args.freezeDb = Number(argv[++i]);
    else if (a === "--freeze-duration") args.freezeDuration = Number(argv[++i]);
    else if (a === "--model") args.model = argv[++i];
    else args._.push(a);
  }
  return args;
}

function fail(msg) {
  console.error("Error: " + msg);
  process.exit(1);
}

// ============================================================
// Step 1 -- stillness detection + frame extraction
// ============================================================
// spawnSync (not execFileSync) throughout this file on purpose: it always
// returns {stdout, stderr, status} regardless of exit code, where
// execFileSync only exposes stderr via the thrown error's .stderr on a
// *non-zero* exit -- ffmpeg with `-f null -` exits 0 on a normal run, which
// silently discarded the freezedetect log the first version of this script
// relied on.
function runFfmpeg(args) {
  return spawnSync("ffmpeg", args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 64 });
}

function checkFfmpeg() {
  const res = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  if (res.error || res.status !== 0) {
    fail(
      "ffmpeg isn't on PATH. If you just installed it via winget, open a NEW " +
      "terminal window (PATH changes don't apply to already-open shells) and try again."
    );
  }
}

// Runs ffmpeg's freezedetect filter over the whole video and parses the
// freeze_start / freeze_duration lines it writes to stderr. Returns an
// array of {start, end, mid} in seconds, one per detected still period.
function detectFreezes(videoPath, noiseDb, minDuration) {
  console.log("Scanning for still (held-page) periods -- this decodes the whole video once, may take a while...");
  const res = runFfmpeg([
    "-i", videoPath,
    "-vf", "freezedetect=n=" + noiseDb + "dB:d=" + minDuration,
    "-map", "0:v",
    "-f", "null", "-",
  ]);
  const stderr = res.stderr || "";
  if (res.error) fail("Couldn't run ffmpeg: " + res.error.message);

  const starts = [...stderr.matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
  const durations = [...stderr.matchAll(/freeze_duration:\s*([\d.]+)/g)].map((m) => parseFloat(m[1]));
  const freezes = starts.map((start, i) => {
    const dur = durations[i] || minDuration;
    return { start, end: start + dur, mid: start + dur / 2 };
  });
  console.log("Found " + freezes.length + " still period(s).");
  return freezes;
}

function extractFrame(videoPath, timestampSeconds, outPath) {
  const res = runFfmpeg([
    "-y",
    "-ss", String(timestampSeconds),
    "-i", videoPath,
    "-frames:v", "1",
    "-vf", "scale='min(1568,iw)':-2",
    "-q:v", "3",
    outPath,
  ]);
  if (res.error || res.status !== 0) {
    throw new Error("ffmpeg frame extraction failed: " + (res.error ? res.error.message : res.stderr.slice(-300)));
  }
}

// ============================================================
// Step 2 -- Anthropic vision classification
// ============================================================
const CLASSIFY_PROMPT =
  "This is a still frame from a video of someone flipping through a language-learning " +
  "textbook, holding each page steady in front of an overhead webcam. Look at the image and respond " +
  "with ONLY a JSON object (no markdown fences, no other text), matching this exact shape:\n" +
  '{"type": "content" | "activity" | "unclear", "pageNumber": "<page number(s) visible, e.g. \\"20\\" or \\"20-21\\", or null if none visible>", ' +
  '"sectionLabel": "<any visible section/unit heading, or null>", "confidence": "high" | "medium" | "low", "notes": "<one short sentence, e.g. what made this hard to read, or empty string>"}\n\n' +
  '"content" means an actual textbook page (exercises, text, vocabulary, grammar tables). ' +
  '"activity" means the frame is NOT a book page but an instructional/aside note or a physical action being shown or referenced -- ' +
  'for example a handwritten note, a spoken instruction being demonstrated, or something like "get paper" or "make a binder." ' +
  '"unclear" means you genuinely cannot tell (blurry, mid-page-turn, empty desk, etc). ' +
  "Read the page number carefully -- if partially obscured by a hand or blurry, lower your confidence rather than guessing.";

async function classifyStill(imagePath, apiKey, model) {
  const imageBuffer = fs.readFileSync(imagePath);
  const base64 = imageBuffer.toString("base64");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 300,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
          { type: "text", text: CLASSIFY_PROMPT },
        ],
      }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error("API request failed (" + res.status + "): " + detail.slice(0, 300));
  }
  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || "").join("").trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Couldn't find JSON in the model's response: " + text.slice(0, 200));
  let parsed;
  try { parsed = JSON.parse(jsonMatch[0]); }
  catch (e) { throw new Error("Model's response wasn't valid JSON: " + text.slice(0, 200)); }
  return {
    type: parsed.type === "content" || parsed.type === "activity" ? parsed.type : "unclear",
    pageNumber: parsed.pageNumber || null,
    sectionLabel: parsed.sectionLabel || null,
    confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "low",
    notes: parsed.notes || "",
  };
}

// ============================================================
// Step 3 -- match a page number to a curriculum lesson
// ============================================================
// "20-21" -> [20,21]; "5-7" -> [5,7]; "32-34" -> [32,34]; anything
// non-numeric ("review", "110-121 + review") extracts what numbers it
// can and ignores the rest; totally non-numeric strings return null.
function parsePageRange(pagesStr) {
  if (!pagesStr || typeof pagesStr !== "string") return null;
  const nums = pagesStr.match(/\d+/g);
  if (!nums || !nums.length) return null;
  const values = nums.map(Number);
  return [Math.min(...values), Math.max(...values)];
}
function parseDetectedPage(pageNumberStr) {
  if (!pageNumberStr) return null;
  const nums = String(pageNumberStr).match(/\d+/g);
  if (!nums || !nums.length) return null;
  return Number(nums[0]);
}
function findLessonForPage(curriculum, pageNum) {
  if (pageNum == null) return null;
  for (const unit of curriculum.units) {
    for (const lesson of unit.lessons) {
      const range = parsePageRange(lesson.pages);
      if (range && pageNum >= range[0] && pageNum <= range[1]) {
        return { unitId: unit.id, lessonId: lesson.id, lessonTitle: lesson.title };
      }
    }
  }
  return null;
}

// ============================================================
// Report I/O
// ============================================================
function loadReport(reportPath) {
  if (!fs.existsSync(reportPath)) return { video: null, generatedAt: null, stills: [] };
  try { return JSON.parse(fs.readFileSync(reportPath, "utf8")); }
  catch (e) { fail("Existing report at " + reportPath + " isn't valid JSON -- move it aside or fix it before continuing."); }
}
function saveReport(reportPath, report) {
  report.generatedAt = new Date().toISOString();
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
}

// ============================================================
// Apply report -> curriculum file
// ============================================================
function applyReportToCurriculum(report, curriculumPath) {
  const curriculum = JSON.parse(fs.readFileSync(curriculumPath, "utf8"));
  const lessonIndex = {};
  curriculum.units.forEach((u) => u.lessons.forEach((l) => { lessonIndex[l.id] = l; }));

  curriculum.units.forEach((u) => u.lessons.forEach((l) => { if (!Array.isArray(l.pageImages)) l.pageImages = []; }));
  if (!Array.isArray(curriculum.activityPages)) curriculum.activityPages = [];

  let appliedContent = 0, appliedActivity = 0, skippedUnmatched = 0;

  report.stills.forEach((s) => {
    if (s.type === "content" && s.matchedLessonId && lessonIndex[s.matchedLessonId]) {
      const lesson = lessonIndex[s.matchedLessonId];
      if (!lesson.pageImages.includes(s.relPath)) {
        lesson.pageImages.push(s.relPath);
        appliedContent++;
      }
    } else if (s.type === "activity") {
      const already = curriculum.activityPages.some((a) => a.file === s.relPath);
      if (!already) {
        curriculum.activityPages.push({
          file: s.relPath,
          pageNumber: s.pageNumber,
          nearLessonId: s.matchedLessonId || null,
          notes: s.notes || "",
        });
        appliedActivity++;
      }
    } else {
      skippedUnmatched++;
    }
  });

  fs.writeFileSync(curriculumPath, JSON.stringify(curriculum, null, 2) + "\n", "utf8");
  console.log(
    "Applied to " + curriculumPath + ": " + appliedContent + " content page(s) added to lessons, " +
    appliedActivity + " activity page(s) recorded, " + skippedUnmatched + " still(s) skipped (unclear or no page match)."
  );
}

// ============================================================
// Main
// ============================================================
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const videoPath = args._[0];
  if (!videoPath) {
    fail("Usage: node process-textbook-video.js <video-file> [--limit N] [--apply] ...\nSee the comment at the top of this file for all options.");
  }
  if (!fs.existsSync(videoPath)) fail("Video file not found: " + videoPath);

  const outDir = path.resolve(ROOT, args.out || "data/curriculum/fa/textbook-images");
  const reportPath = path.resolve(ROOT, args.report || "textbook-video-report.json");
  const curriculumPath = path.resolve(ROOT, args.curriculum || "data/curriculum/fa/rw-farsi.json");
  const freezeDb = args.freezeDb != null ? args.freezeDb : -30;
  const freezeDuration = args.freezeDuration != null ? args.freezeDuration : 1.5;
  const model = args.model || "claude-haiku-4-5-20251001";

  if (!args.apply) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      fail(
        "ANTHROPIC_API_KEY isn't set. PowerShell, for this session only:\n" +
        '  $env:ANTHROPIC_API_KEY = "sk-ant-..."\n' +
        "Or permanently (then open a new terminal):\n" +
        '  [Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "sk-ant-...", "User")'
      );
    }
  }

  fs.mkdirSync(outDir, { recursive: true });
  checkFfmpeg();
  if (!fs.existsSync(curriculumPath)) fail("Curriculum file not found: " + curriculumPath);
  const curriculum = JSON.parse(fs.readFileSync(curriculumPath, "utf8"));

  const report = loadReport(reportPath);
  report.video = path.resolve(videoPath);
  const alreadyDone = new Set(args.force ? [] : report.stills.map((s) => s.timestamp));

  const freezes = detectFreezes(videoPath, freezeDb, freezeDuration);
  const toProcess = (args.limit ? freezes.slice(0, args.limit) : freezes)
    .filter((f) => !alreadyDone.has(f.mid));

  if (!toProcess.length) {
    console.log("Nothing new to process (report already covers every detected still -- pass --force to redo them).");
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  let done = 0;
  for (const freeze of toProcess) {
    done++;
    const filename = "page-" + String(Math.round(freeze.mid)).padStart(6, "0") + "s.jpg";
    const outPath = path.join(outDir, filename);
    const relPath = path.relative(ROOT, outPath).split(path.sep).join("/");
    process.stdout.write("[" + done + "/" + toProcess.length + "] " + filename + " ... ");

    try {
      extractFrame(videoPath, freeze.mid, outPath);
      const result = await classifyStill(outPath, apiKey, model);
      const pageNum = parseDetectedPage(result.pageNumber);
      const match = result.type === "content" ? findLessonForPage(curriculum, pageNum) : null;

      report.stills.push({
        timestamp: freeze.mid,
        relPath,
        type: result.type,
        pageNumber: result.pageNumber,
        sectionLabel: result.sectionLabel,
        confidence: result.confidence,
        notes: result.notes,
        matchedLessonId: match ? match.lessonId : null,
        matchedLessonTitle: match ? match.lessonTitle : null,
      });
      console.log(
        result.type + (result.pageNumber ? " p." + result.pageNumber : "") +
        (match ? " -> " + match.lessonId : result.type === "content" ? " -> NO MATCH" : "") +
        " (" + result.confidence + " confidence)"
      );
      saveReport(reportPath, report); // save after every still -- a crash mid-run loses nothing already paid for
    } catch (e) {
      console.log("FAILED: " + e.message);
    }
  }

  console.log("\nReport saved to " + reportPath + " (" + report.stills.length + " still(s) total).");
  const lowConfidence = report.stills.filter((s) => s.confidence !== "high");
  if (lowConfidence.length) {
    console.log(lowConfidence.length + " still(s) came back medium/low confidence -- worth a manual look before trusting them:");
    lowConfidence.forEach((s) => console.log("  " + s.relPath + " -- " + s.type + " p." + (s.pageNumber || "?") + ": " + s.notes));
  }
  const unmatchedContent = report.stills.filter((s) => s.type === "content" && !s.matchedLessonId);
  if (unmatchedContent.length) {
    console.log(unmatchedContent.length + " content still(s) didn't match any lesson's page range:");
    unmatchedContent.forEach((s) => console.log("  " + s.relPath + " -- read as page " + (s.pageNumber || "unreadable")));
  }

  if (args.apply) {
    applyReportToCurriculum(report, curriculumPath);
  } else {
    console.log("\nReview the report above, then re-run with --apply to write matched images into " + curriculumPath + ".");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
