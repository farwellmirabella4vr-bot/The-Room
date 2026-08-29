#!/usr/bin/env node
/*
  4-extract-structure.js  --  Stage 4 of the book-video curriculum pipeline

  Reads the OCR text from Stage 3 and asks the Anthropic API to pull out ONLY
  the book's factual structure -- chapter and section titles, the page range of
  each, the grammar/vocabulary topic each section covers, and the count and
  type of exercises in each. It writes book-structure.json.

  THREE HARD RULES (in the system prompt AND enforced in code after every reply)
    1. Every entry carries the page number it was read from. No page number ->
       the field is nulled and the item is added to an "unresolved" list.
    2. Anything that can't be read straight from the OCR text is null and goes
       on the unresolved list. The model is told never to guess or fill from
       general knowledge of Spanish textbooks -- and the code re-checks every
       page number against the pages we actually OCR'd and strips ones we
       didn't.
    3. No passages, no exercise wording, no explanatory prose is stored --
       titles, headings, short topic labels, and counts only. The video stays
       your source for the actual content. The code caps label length and
       drops any key that isn't on the allow-list.

  OUTPUT (tools\book-video\)
    book-structure.json     { generatedAt, model, sourcePages, chapters[], unresolved[] }
    .batches\               cached per-batch results, so a re-run only pays for
                            batches that failed or changed. Delete it to redo all.

  RUN
    node tools\book-video\4-extract-structure.js
      [--limit N]     only process the first N batches (cheap test run)
      [--force]       ignore the .batches cache and redo every batch

  Needs ANTHROPIC_API_KEY (Stage 1 shows how to set it).
*/

// ================================================================
// Editable settings
// ================================================================

// Which model reads the OCR text. Structure extraction with strict
// anti-guessing rules rewards a strong model, and this is a one-time job of
// ~10-20 calls, not a big batch. Swap to "claude-sonnet-5" or
// "claude-haiku-4-5" if you want it cheaper and your OCR text is clean.
const MODEL = "claude-opus-5";

// How much OCR text goes in one API call. Lower this if you hit context or
// rate-limit errors; raise it to make fewer, bigger calls.
const MAX_CHARS_PER_BATCH = 45000;

// A section topic / title longer than this is treated as prose that leaked in:
// the field is nulled and flagged, not stored.
const MAX_LABEL_LEN = 120;

const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 8000;
// ================================================================

const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const OCR_DIR = path.join(DIR, "ocr");
const PAGES_JSON = path.join(DIR, "pages.json");
const OUT_PATH = path.join(DIR, "book-structure.json");
const CACHE_DIR = path.join(DIR, ".batches");

function fail(msg) {
  console.error("\nStage 4 stopped: " + msg + "\n");
  process.exit(1);
}
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") args.force = true;
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else args._.push(a);
  }
  return args;
}

// ----------------------------------------------------------------
// system prompt -- the three hard rules, stated for the model
// ----------------------------------------------------------------
const SYSTEM_PROMPT = [
  "You extract the FACTUAL STRUCTURE of a Spanish-language textbook from noisy OCR text.",
  "The OCR text comes from frames of a video of the physical book; it may have errors, gaps, and junk.",
  "",
  "You will be given the OCR text of a run of pages, each block prefixed with its printed page number.",
  "Return ONLY a JSON object (no markdown fences, no commentary) with this exact shape:",
  "{",
  '  "chapters": [',
  "    {",
  '      "title": string|null,',
  '      "titlePage": integer|null,',
  '      "sections": [',
  "        {",
  '          "heading": string|null,',
  '          "headingPage": integer|null,',
  '          "startPage": integer|null,',
  '          "endPage": integer|null,',
  '          "topicType": "grammar"|"vocabulary"|"mixed"|"other"|null,',
  '          "topic": string|null,',
  '          "exercises": [ { "type": string|null, "count": integer|null, "page": integer|null } ],',
  '          "unresolved": [ string ]',
  "        }",
  "      ],",
  '      "unresolved": [ string ]',
  "    }",
  "  ],",
  '  "unresolved": [ string ]',
  "}",
  "",
  "HARD RULES -- follow every one:",
  "1. EVERY chapter, section, and exercise must carry the printed page number it was read from",
  "   (titlePage / headingPage+startPage / page). If you cannot see a page number for it in the",
  "   provided text, set that number field to null and add a short note to the nearest",
  '   "unresolved" array, e.g. "section \'El pretérito\' has no readable page number".',
  "2. Use ONLY what is in the OCR text provided. NEVER guess. NEVER fill anything in from general",
  "   knowledge of how Spanish textbooks are usually organised. If a chapter title, heading, topic,",
  "   or exercise count is not legibly present in the text, it is null and goes on an unresolved list.",
  "   A plausible-but-unverified value is worse than null.",
  "3. Do NOT reproduce book content. No sentences, passages, example items, exercise instructions,",
  "   answer keys, vocabulary lists, or explanatory prose. Only: chapter/section titles as printed,",
  "   a SHORT topic label you may summarise in a few words (e.g. \"ser vs estar\", \"numbers 0-100\",",
  "   \"preterite of regular -ar verbs\"), the exercise TYPE as a short label (e.g. \"fill in the blank\",",
  "   \"matching\", \"translation\"), and integer counts and page numbers.",
  '4. "topic" and every title/heading must be at most ' + MAX_LABEL_LEN + " characters. If the real",
  "   heading is longer, use null and note it as unresolved rather than paraphrasing a passage.",
  "5. If a page in the text is clearly not a content page (cover, blank, table of contents, mid-flip",
  "   blur), just ignore it -- do not invent a chapter for it.",
].join("\n");

// ----------------------------------------------------------------
// build page blocks + batches
// ----------------------------------------------------------------
function loadPageBlocks() {
  if (!fs.existsSync(PAGES_JSON)) fail("no pages.json -- run Stage 3 first.");
  const pages = JSON.parse(fs.readFileSync(PAGES_JSON, "utf8"));
  const blocks = [];
  const detected = [];
  for (const p of pages) {
    const txtPath = path.join(OCR_DIR, p.ocrFile);
    if (!fs.existsSync(txtPath)) continue;
    const raw = fs.readFileSync(txtPath, "utf8").trim();
    if (raw.length < 25) continue; // skip near-empty frames
    if (p.detectedPage != null) detected.push(p.detectedPage);
    const label = p.detectedPage != null
      ? "PAGE " + p.detectedPage
      : "PAGE UNKNOWN (frame " + p.frame + ")";
    blocks.push({ page: p.detectedPage, frame: p.frame, text: "--- " + label + " ---\n" + raw });
  }
  if (!blocks.length) fail("no usable OCR text found. Did Stage 3 finish?");
  const pageMin = detected.length ? Math.min(...detected) : null;
  const pageMax = detected.length ? Math.max(...detected) : null;
  return { blocks, pageSet: new Set(detected), pageMin, pageMax, detectedCount: detected.length };
}

function makeBatches(blocks) {
  const batches = [];
  let cur = [];
  let curLen = 0;
  for (const b of blocks) {
    if (curLen + b.text.length > MAX_CHARS_PER_BATCH && cur.length) {
      batches.push(cur);
      cur = [];
      curLen = 0;
    }
    cur.push(b);
    curLen += b.text.length + 2;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

// ----------------------------------------------------------------
// Anthropic call (raw fetch -- same style as process-textbook-video.js)
// ----------------------------------------------------------------
async function callAnthropic(apiKey, userText) {
  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (attempt === 3) throw new Error("network error calling the API: " + e.message);
      await sleep(1500 * attempt);
      continue;
    }
    if (res.ok) {
      const data = await res.json();
      return (data.content || []).map((c) => c.text || "").join("").trim();
    }
    const detail = await res.text().catch(() => "");
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 2000 * attempt;
      console.log("    API " + res.status + ", retrying in " + Math.round(wait / 1000) + "s...");
      await sleep(wait);
      continue;
    }
    throw new Error("API request failed (" + res.status + "): " + detail.slice(0, 300));
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ----------------------------------------------------------------
// clean + enforce the hard rules on one raw reply
// ----------------------------------------------------------------
function parseJsonObject(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON object in the model reply: " + text.slice(0, 160));
  return JSON.parse(m[0]);
}

function makePageValidator(pageSet, pageMin, pageMax) {
  // A cited page is accepted only if it's an integer we actually OCR'd, OR at
  // least sits inside the span of pages we OCR'd. Anything else -> null + flag.
  return function validPageOrNull(v, noteSink, what) {
    if (v == null) return null;
    const n = Number(v);
    if (!Number.isInteger(n)) {
      noteSink.push(what + ": page value \"" + v + "\" isn't an integer -> dropped");
      return null;
    }
    if (pageSet.has(n)) return n;
    if (pageMin != null && n >= pageMin && n <= pageMax) return n; // within OCR'd span, allow
    noteSink.push(what + ": cites page " + n + " which is outside the OCR'd page range -> dropped");
    return null;
  };
}

function cleanLabel(v, noteSink, what) {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.length > MAX_LABEL_LEN) {
    noteSink.push(what + ": value was " + s.length + " chars (looks like prose, not a label) -> dropped");
    return null;
  }
  return s;
}

const TOPIC_TYPES = ["grammar", "vocabulary", "mixed", "other"];

function cleanReply(rawText, validPage) {
  const parsed = parseJsonObject(rawText);
  const topUnresolved = Array.isArray(parsed.unresolved) ? parsed.unresolved.map(String) : [];
  const chapters = [];

  for (const ch of Array.isArray(parsed.chapters) ? parsed.chapters : []) {
    const chNotes = Array.isArray(ch.unresolved) ? ch.unresolved.map(String) : [];
    const title = cleanLabel(ch.title, chNotes, "chapter title");
    const titlePage = validPage(ch.titlePage, chNotes, "chapter \"" + (title || "?") + "\"");
    if (title == null && titlePage == null && !(Array.isArray(ch.sections) && ch.sections.length)) continue;
    if (title == null) chNotes.push("a chapter here has no readable title");
    if (titlePage == null) chNotes.push("chapter \"" + (title || "?") + "\" has no readable page number");

    const sections = [];
    for (const sc of Array.isArray(ch.sections) ? ch.sections : []) {
      const scNotes = Array.isArray(sc.unresolved) ? sc.unresolved.map(String) : [];
      const heading = cleanLabel(sc.heading, scNotes, "section heading");
      const topic = cleanLabel(sc.topic, scNotes, "section topic");
      const headingPage = validPage(sc.headingPage, scNotes, "section \"" + (heading || "?") + "\"");
      const startPage = validPage(sc.startPage, scNotes, "section \"" + (heading || "?") + "\" startPage");
      const endPage = validPage(sc.endPage, scNotes, "section \"" + (heading || "?") + "\" endPage");
      let topicType = TOPIC_TYPES.includes(sc.topicType) ? sc.topicType : null;

      const exercises = [];
      for (const ex of Array.isArray(sc.exercises) ? sc.exercises : []) {
        const exNotes = [];
        const type = cleanLabel(ex.type, exNotes, "exercise type");
        const cappedType = type && type.length > 40 ? null : type;
        const count = Number.isInteger(Number(ex.count)) && Number(ex.count) >= 0 ? Number(ex.count) : null;
        const page = validPage(ex.page, exNotes, "an exercise in section \"" + (heading || "?") + "\"");
        if (page == null && count == null && cappedType == null) continue; // nothing usable
        if (page == null) scNotes.push("an exercise (" + (cappedType || "type?") + ") has no readable page number");
        exercises.push({ type: cappedType, count, page });
        scNotes.push(...exNotes);
      }

      if (heading == null && topic == null && startPage == null && !exercises.length) continue;
      if (heading == null) scNotes.push("a section here has no readable heading");
      if (startPage == null && headingPage == null) scNotes.push("section \"" + (heading || "?") + "\" has no readable page number");

      sections.push({
        heading,
        headingPage,
        startPage: startPage != null ? startPage : headingPage,
        endPage,
        topicType,
        topic,
        exercises,
        unresolved: [...new Set(scNotes)],
      });
    }

    chapters.push({ title, titlePage, sections, unresolved: [...new Set(chNotes)] });
  }

  return { chapters, unresolved: topUnresolved };
}

// ----------------------------------------------------------------
// merge cleaned batch results
// ----------------------------------------------------------------
function normTitle(t) {
  return String(t || "").toLowerCase().replace(/[^a-z0-9áéíóúñü]+/gi, "").trim();
}
function chapterSortKey(ch) {
  if (ch.titlePage != null) return ch.titlePage;
  const firstStart = ch.sections.map((s) => s.startPage).filter((n) => n != null).sort((a, b) => a - b)[0];
  return firstStart != null ? firstStart : Number.MAX_SAFE_INTEGER;
}
function sectionSortKey(s) {
  return s.startPage != null ? s.startPage : (s.headingPage != null ? s.headingPage : Number.MAX_SAFE_INTEGER);
}

function mergeResults(results) {
  const byKey = new Map(); // normTitle -> chapter
  const untitled = [];
  const globalUnresolved = [];

  for (const r of results) {
    globalUnresolved.push(...r.unresolved);
    for (const ch of r.chapters) {
      const key = normTitle(ch.title) || (ch.titlePage != null ? "p" + ch.titlePage : "");
      if (!key) {
        untitled.push(ch);
        continue;
      }
      if (!byKey.has(key)) {
        byKey.set(key, { title: ch.title, titlePage: ch.titlePage, sections: [], unresolved: [] });
      }
      const tgt = byKey.get(key);
      if (tgt.title == null) tgt.title = ch.title;
      if (tgt.titlePage == null) tgt.titlePage = ch.titlePage;
      tgt.sections.push(...ch.sections);
      tgt.unresolved.push(...ch.unresolved);
    }
  }

  const chapters = [...byKey.values(), ...untitled].map((ch) => {
    // de-dupe sections that appear in two overlapping batches (same heading + start page)
    const seen = new Set();
    const sections = ch.sections
      .filter((s) => {
        const k = normTitle(s.heading) + "@" + (s.startPage != null ? s.startPage : "?");
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .sort((a, b) => sectionSortKey(a) - sectionSortKey(b));
    return {
      title: ch.title,
      titlePage: ch.titlePage,
      sections,
      unresolved: [...new Set(ch.unresolved)],
    };
  }).sort((a, b) => chapterSortKey(a) - chapterSortKey(b));

  return { chapters, unresolved: [...new Set(globalUnresolved)] };
}

// ----------------------------------------------------------------
// main
// ----------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    fail(
      "ANTHROPIC_API_KEY isn't set in this terminal.\n" +
      '  This session only:   $env:ANTHROPIC_API_KEY = "sk-ant-..."\n' +
      '  Permanent (new term): [Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "sk-ant-...", "User")'
    );
  }
  if (typeof fetch !== "function") fail("this Node is too old for built-in fetch. Use Node 18+ (you likely have 20+).");

  const { blocks, pageSet, pageMin, pageMax, detectedCount } = loadPageBlocks();
  const batches = makeBatches(blocks);
  const validPage = makePageValidator(pageSet, pageMin, pageMax);

  console.log("Model: " + MODEL);
  console.log("Pages with OCR text: " + blocks.length + "  (" + detectedCount + " had a detected number, range " +
    (pageMin ?? "?") + "-" + (pageMax ?? "?") + ")");
  console.log("Batches: " + batches.length + (args.limit ? "  (running first " + args.limit + ")" : "") + "\n");

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const results = [];
  const toRun = args.limit ? batches.slice(0, args.limit) : batches;

  for (let i = 0; i < toRun.length; i++) {
    const batch = toRun[i];
    const first = batch.find((b) => b.page != null);
    const last = [...batch].reverse().find((b) => b.page != null);
    const span = (first ? first.page : "?") + "-" + (last ? last.page : "?");
    const cachePath = path.join(CACHE_DIR, "batch-" + String(i + 1).padStart(3, "0") + ".json");

    if (fs.existsSync(cachePath) && !args.force) {
      results.push(JSON.parse(fs.readFileSync(cachePath, "utf8")));
      console.log("[" + (i + 1) + "/" + toRun.length + "] pp. " + span + "  (cached)");
      continue;
    }

    process.stdout.write("[" + (i + 1) + "/" + toRun.length + "] pp. " + span + "  calling API ... ");
    const userText =
      "OCR text for a run of textbook pages follows. Extract the structure per your instructions.\n\n" +
      batch.map((b) => b.text).join("\n\n");

    try {
      const raw = await callAnthropic(apiKey, userText);
      const cleaned = cleanReply(raw, validPage);
      fs.writeFileSync(cachePath, JSON.stringify(cleaned, null, 2) + "\n");
      results.push(cleaned);
      const nSec = cleaned.chapters.reduce((a, c) => a + c.sections.length, 0);
      console.log("ok  (" + cleaned.chapters.length + " chapter(s), " + nSec + " section(s))");
    } catch (e) {
      console.log("FAILED: " + e.message);
      console.log("    (re-run the script to retry just this batch -- finished batches are cached.)");
    }
  }

  if (!results.length) fail("no batches succeeded. Nothing written.");

  const merged = mergeResults(results);
  const nSections = merged.chapters.reduce((a, c) => a + c.sections.length, 0);
  const nExercises = merged.chapters.reduce((a, c) => a + c.sections.reduce((x, s) => x + s.exercises.length, 0), 0);
  const nUnresolved =
    merged.unresolved.length +
    merged.chapters.reduce((a, c) => a + c.unresolved.length + c.sections.reduce((x, s) => x + s.unresolved.length, 0), 0);

  const out = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    note: "Structure and topic labels only -- by design this file holds no passages, exercise text, or explanatory prose. The video is the source for actual content.",
    sourcePages: { min: pageMin, max: pageMax, ocrPagesWithText: blocks.length },
    chapters: merged.chapters,
    unresolved: merged.unresolved,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");

  const bar = "=".repeat(64);
  console.log("\n" + bar);
  console.log("  " + merged.chapters.length + " chapter(s)  |  " + nSections + " section(s)  |  " +
    nExercises + " exercise group(s)  |  " + nUnresolved + " unresolved note(s)");
  console.log(bar);
  console.log("\n  Written: " + OUT_PATH);
  console.log("\n  Unresolved notes are things the OCR text didn't support -- you'll see and fix");
  console.log("  them next to the source frames in Stage 5. Nothing was guessed to fill them.\n");
  console.log("  Stage 5:  node tools\\book-video\\5-review-server.js\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
