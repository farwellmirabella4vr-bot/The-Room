#!/usr/bin/env node
/*
  1-check-setup.js  --  Stage 1 of the book-video curriculum pipeline

  Checks that everything the later stages need is installed and reachable,
  and prints exact, copy-paste install steps (PowerShell, Windows) for
  anything that's missing. It changes nothing on your machine -- it only
  looks and reports.

  WHAT THE PIPELINE NEEDS
    - ffmpeg        Stage 2 (pull one frame per page out of the video)
    - Tesseract OCR Stage 3 (read the text off each frame)
    - Spanish data  Stage 3 (the "spa" language pack for Tesseract)
    - Node.js       every stage (you're running this, so it's fine)
    - ANTHROPIC_API_KEY   Stage 4 (structure extraction via the Anthropic API)

  RUN
    node tools\book-video\1-check-setup.js

  You can re-run it as many times as you like. When every line says OK,
  move on to Stage 2.
*/

const { spawnSync } = require("child_process");
const os = require("os");

// ------------------------------------------------------------------
// small helpers
// ------------------------------------------------------------------
function run(cmd, args) {
  // Returns { ok, out } -- ok is true only if the program exists and exits 0.
  const res = spawnSync(cmd, args, { encoding: "utf8" });
  if (res.error) return { ok: false, out: String(res.error.message) };
  return { ok: res.status === 0, out: (res.stdout || "") + (res.stderr || "") };
}

function firstLine(s) {
  return String(s || "").split(/\r?\n/).find((l) => l.trim().length) || "";
}

const results = []; // { name, ok, detail }
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log((ok ? "  OK    " : "  MISSING ") + name + (detail ? "  --  " + detail : ""));
}

const HR = "-".repeat(64);
function section(title) {
  console.log("\n" + HR + "\n" + title + "\n" + HR);
}

// ------------------------------------------------------------------
// checks
// ------------------------------------------------------------------
console.log("Stage 1 setup check  --  nothing on your machine is being changed.\n");

section("Node.js  (needed by every stage)");
record("Node.js " + process.version, true, "you're running it now");

section("ffmpeg  (Stage 2 -- frame extraction)");
const ff = run("ffmpeg", ["-version"]);
record("ffmpeg", ff.ok, ff.ok ? firstLine(ff.out) : "not found on PATH");

section("Tesseract OCR  (Stage 3 -- reading text off each frame)");
const ts = run("tesseract", ["--version"]);
record("tesseract", ts.ok, ts.ok ? firstLine(ts.out) : "not found on PATH");

let hasSpanish = false;
if (ts.ok) {
  const langs = run("tesseract", ["--list-langs"]);
  hasSpanish = /(^|\s)spa(\s|$)/m.test(langs.out || "");
  record("Spanish language pack (spa)", hasSpanish,
    hasSpanish ? "found" : "installed languages: " + firstLine(langs.out.replace(/^List of available.*$/m, "").trim()));
} else {
  record("Spanish language pack (spa)", false, "can't check until Tesseract is installed");
}

section("Anthropic API key  (Stage 4 -- structure extraction)");
const key = process.env.ANTHROPIC_API_KEY;
record("ANTHROPIC_API_KEY", !!key, key ? "set (" + key.slice(0, 7) + "..., length " + key.length + ")" : "not set in this terminal");

// ------------------------------------------------------------------
// install instructions for whatever failed
// ------------------------------------------------------------------
const missing = results.filter((r) => !r.ok).map((r) => r.name);

if (!missing.length) {
  section("RESULT");
  console.log("Everything is ready. Move on to Stage 2:\n");
  console.log('  node tools\\book-video\\2-extract-frames.js "C:\\path\\to\\your-spanish-book-video.mp4"\n');
  process.exit(0);
}

section("WHAT'S MISSING: " + missing.join(", "));
console.log(
  "\nFollow only the sections below that match a MISSING line above.\n" +
  "After any install that changes PATH, CLOSE this PowerShell window and open a\n" +
  "NEW one before re-running the check -- PATH changes never reach an already-open shell.\n"
);

if (!ff.ok) {
  console.log(HR);
  console.log("INSTALL ffmpeg");
  console.log(HR);
  console.log(`
Option A -- winget (simplest):

  winget install --id Gyan.FFmpeg -e --source winget

  Close this window, open a new PowerShell, then verify:

  ffmpeg -version

Option B -- manual (if winget is blocked or you want a fixed location):

  1. Download "ffmpeg-release-full.7z" from:
       https://www.gyan.dev/ffmpeg/builds/
  2. Extract it. Move the inner folder so that this path exists:
       C:\\ffmpeg\\bin\\ffmpeg.exe
  3. Add C:\\ffmpeg\\bin to your PATH (PowerShell, permanent, just for you):

       [Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\\ffmpeg\\bin", "User")

  4. Close this window, open a new PowerShell, then verify:

       ffmpeg -version

VERIFY (one line): ffmpeg -version
`);
}

if (!ts.ok) {
  console.log(HR);
  console.log("INSTALL Tesseract OCR  (get the Spanish pack at the same time)");
  console.log(HR);
  console.log(`
Option A -- official Windows installer (recommended, lets you pick Spanish):

  1. Download the latest "tesseract-ocr-w64-setup-....exe" from:
       https://github.com/UB-Mannheim/tesseract/wiki
  2. Run it. Keep the default install location:
       C:\\Program Files\\Tesseract-OCR
  3. IMPORTANT: on the "Select components" screen, expand
       "Additional language data (download)"
     and tick "Spanish".  (If you forget, see "ADD SPANISH LATER" below.)
  4. Finish the installer, then add Tesseract to your PATH
     (PowerShell, permanent, just for you):

       [Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\\Program Files\\Tesseract-OCR", "User")

  5. Close this window, open a new PowerShell, then verify:

       tesseract --version
       tesseract --list-langs      (you should see "spa" in the list)

Option B -- winget (installs the engine; Spanish pack added separately below):

  winget install --id UB-Mannheim.TesseractOCR -e --source winget
  [Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\\Program Files\\Tesseract-OCR", "User")

VERIFY (one line): tesseract --version
`);
}

if (ts.ok && !hasSpanish) {
  console.log(HR);
  console.log("ADD THE SPANISH PACK to an already-installed Tesseract");
  console.log(HR);
  console.log(`
Tesseract is installed but the Spanish data file isn't. Get it:

  1. Download this file (right-click, Save link as):
       https://github.com/tesseract-ocr/tessdata_best/raw/main/spa.traineddata
  2. Put it in Tesseract's "tessdata" folder:
       C:\\Program Files\\Tesseract-OCR\\tessdata\\spa.traineddata
     Copying into "Program Files" needs an Administrator prompt -- click Continue.

     PowerShell one-liner (run PowerShell as Administrator), assuming the file
     downloaded to your Downloads folder:

       Copy-Item "$env:USERPROFILE\\Downloads\\spa.traineddata" "C:\\Program Files\\Tesseract-OCR\\tessdata\\"

  3. Verify:
       tesseract --list-langs      (you should now see "spa")

VERIFY (one line): tesseract --list-langs
`);
}

if (!key) {
  console.log(HR);
  console.log("SET ANTHROPIC_API_KEY  (only Stage 4 needs it -- you can do this later)");
  console.log(HR);
  console.log(`
Get a key from  https://console.anthropic.com/  (Settings -> API Keys).

Permanent (survives new terminals and reboots) -- then open a NEW PowerShell:

  [Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "sk-ant-...", "User")

Just for the current terminal (gone when you close it):

  $env:ANTHROPIC_API_KEY = "sk-ant-..."

VERIFY (one line):
  node -e "console.log(process.env.ANTHROPIC_API_KEY ? 'API key set' : 'API key MISSING')"
`);
}

console.log(HR);
console.log("Re-run this check in a NEW PowerShell window once you've done the above:");
console.log("  node tools\\book-video\\1-check-setup.js");
console.log(HR);
process.exit(1);
