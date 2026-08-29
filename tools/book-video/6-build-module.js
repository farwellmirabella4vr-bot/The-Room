#!/usr/bin/env node
/*
  6-build-module.js  --  Stage 6 of the book-video curriculum pipeline

  Turns tools\book-video\book-structure.confirmed.json (the file you wrote in
  Stage 5) into a Spanish curriculum module for the Language Hub, in the same
  shape as the existing Farsi module (data\curriculum\fa\rw-farsi.json):

      module -> units -> lessons -> tasks, plus a checkpoint (the "test") per unit.

  WHAT IT PRODUCES
    - one unit per confirmed chapter, in page order
    - one lesson ("a study day") per confirmed section, with:
        * a daily objective
        * homework tasks that point at the exercise groups you confirmed,
          all done "in your notebook" (no worksheets are generated)
        * a study task that points at the video for the actual content
    - a checkpoint per unit = the unit test
    - pace-based rough estimates (minutes per lesson, days/weeks total) --
      NO calendar dates
    - every unit carries its book page range

  It refuses to run until book-structure.confirmed.json exists.

  RUN
    node tools\book-video\6-build-module.js --name "My Spanish Course"
      [--id es-my-spanish-course]     module id (default: slug of --name, es- prefixed)
      [--pace relaxed|normal|intensive]   default: normal
      [--book "Title"] [--authors "..."] [--publisher "..."] [--isbn "..."] [--pages 320]
      [--passmark 80]
      [--force]     overwrite an existing module file / index entry with the same id

  Writes:
    data\curriculum\es\<slug>.json
    updates data\curriculum\index.json  (adds/updates this module's entry)
*/

// ================================================================
// Editable settings -- pace presets
// ================================================================
const PACES = {
  //            minutesPerDay: your rough daily budget (shown, not enforced)
  //            lessonBase:    baseline minutes for a lesson before exercises
  //            perExercise:   extra minutes per confirmed exercise group
  relaxed: { minutesPerDay: 20, lessonBase: 25, perExercise: 6, daysPerWeek: 4 },
  normal: { minutesPerDay: 35, lessonBase: 35, perExercise: 8, daysPerWeek: 5 },
  intensive: { minutesPerDay: 60, lessonBase: 45, perExercise: 10, daysPerWeek: 6 },
};
const DEFAULT_PASSMARK = 80;
// ================================================================

const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const ROOT = path.resolve(DIR, "..", "..");
const CONFIRMED_PATH = path.join(DIR, "book-structure.confirmed.json");
const ES_DIR = path.join(ROOT, "data", "curriculum", "es");
const INDEX_PATH = path.join(ROOT, "data", "curriculum", "index.json");

function fail(msg) {
  console.error("\nStage 6 stopped: " + msg + "\n");
  process.exit(1);
}
function parseArgs(argv) {
  const args = { _: [] };
  const take = ["name", "id", "pace", "book", "authors", "publisher", "isbn", "pages", "passmark"];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force") args.force = true;
    else if (a.startsWith("--") && take.includes(a.slice(2))) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip accents: café -> cafe
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .replace(/-+/g, "-");
}
function rangeStr(a, b) {
  if (a == null && b == null) return null;
  if (a == null) return String(b);
  if (b == null || b === a) return String(a);
  return a + "-" + b;
}
function labelFor(section) {
  return section.heading || section.topic || (section.startPage != null ? "pp. " + section.startPage : "this section");
}
function skillsFor(topicType) {
  switch (topicType) {
    case "grammar": return ["reading", "writing"];
    case "vocabulary": return ["reading", "listening", "speaking"];
    case "mixed": return ["reading", "writing", "speaking"];
    default: return ["reading"];
  }
}

// ---- turn one confirmed section into a lesson --------------------
function buildLesson(section, unitNum, lessonNum, pace) {
  const uid = "u" + unitNum + "l" + lessonNum;
  const start = section.startPage != null ? section.startPage : section.headingPage;
  const end = section.endPage != null ? section.endPage : start;
  const pagesStr = rangeStr(start, end) || "?";
  const label = labelFor(section);
  const exercises = Array.isArray(section.exercises) ? section.exercises : [];

  const estMinutes = pace.lessonBase + exercises.length * pace.perExercise;

  const objectives = [];
  objectives.push("Study " + label + " on pp. " + pagesStr + " using the video.");
  const totalCount = exercises.reduce((a, e) => a + (Number.isInteger(e.count) ? e.count : 0), 0);
  const exTypes = [...new Set(exercises.map((e) => e.type).filter(Boolean))];
  if (exercises.length) {
    objectives.push(
      "Complete " + (totalCount ? totalCount + " " : "the ") +
      (exTypes.length ? exTypes.join(" / ") + " " : "") + "exercise" + (totalCount === 1 ? "" : "s") + " in your notebook."
    );
  }
  objectives.push("Be able to explain " + label + " from memory before moving on.");

  const tasks = [];
  tasks.push({
    id: uid + "t1",
    type: "study",
    text: "Watch the video for pp. " + pagesStr + " and follow the explanation of " + label + ".",
  });
  let t = 2;
  if (exercises.length) {
    exercises.forEach((e) => {
      const where = e.page != null ? "p. " + e.page : "pp. " + pagesStr;
      const what =
        (Number.isInteger(e.count) ? e.count + " " : "the ") +
        (e.type ? e.type + " " : "") +
        "exercise" + (e.count === 1 ? "" : "s");
      tasks.push({ id: uid + "t" + t++, type: "homework", text: "In your notebook, do " + what + " on " + where + "." });
    });
  } else {
    tasks.push({
      id: uid + "t" + t++,
      type: "homework",
      text: "In your notebook, write out your own examples for " + label + " from pp. " + pagesStr + ".",
    });
  }
  tasks.push({ id: uid + "t" + t++, type: "review", text: "Check your notebook work against the video, then mark this lesson done." });

  return {
    id: uid,
    title: section.heading || section.topic || ("Section " + lessonNum),
    pages: pagesStr,
    estMinutes,
    skills: skillsFor(section.topicType),
    audio: [],
    objectives,
    tasks,
    vocab: [], // by design this pipeline stores no book vocabulary -- the video is the source
    topicType: section.topicType || null,
    fromReview: {
      headingPage: section.headingPage != null ? section.headingPage : null,
      unresolved: Array.isArray(section.unresolved) ? section.unresolved : [],
    },
  };
}

// ---- turn one confirmed chapter into a unit ---------------------
function buildUnit(chapter, unitNum, totalUnits, pace, passMark) {
  let sections = Array.isArray(chapter.sections) ? chapter.sections.slice() : [];
  sections.sort((a, b) => {
    const ka = a.startPage != null ? a.startPage : (a.headingPage != null ? a.headingPage : 1e9);
    const kb = b.startPage != null ? b.startPage : (b.headingPage != null ? b.headingPage : 1e9);
    return ka - kb;
  });

  // chapter with no sections -> one lesson covering the whole chapter
  if (!sections.length) {
    sections = [{
      heading: chapter.title || "Chapter " + unitNum,
      headingPage: chapter.titlePage,
      startPage: chapter.titlePage,
      endPage: null,
      topicType: null,
      topic: null,
      exercises: [],
      unresolved: ["chapter had no readable sections in the OCR -- this is a single catch-all lesson"],
    }];
  }

  const lessons = sections.map((s, i) => buildLesson(s, unitNum, i + 1, pace));

  const starts = lessons.map((l) => Number(String(l.pages).split("-")[0])).filter((n) => !isNaN(n));
  const ends = lessons.map((l) => {
    const parts = String(l.pages).split("-");
    return Number(parts[1] || parts[0]);
  }).filter((n) => !isNaN(n));
  const unitStart = chapter.titlePage != null ? Math.min(chapter.titlePage, ...(starts.length ? starts : [chapter.titlePage])) : (starts.length ? Math.min(...starts) : null);
  const unitEnd = ends.length ? Math.max(...ends) : unitStart;
  const pagesStr = rangeStr(unitStart, unitEnd) || "?";

  const topics = sections.map((s) => s.topic || s.heading).filter(Boolean);
  const goal = topics.length
    ? "Work through pp. " + pagesStr + " in the video: " + topics.join("; ") + "."
    : "Work through pp. " + pagesStr + " in the video.";

  const unit = {
    id: "u" + unitNum,
    number: unitNum,
    title: chapter.title || ("Unit " + unitNum),
    pages: pagesStr,
    goal,
    estDays: lessons.length,
    estMinutes: lessons.reduce((a, l) => a + l.estMinutes, 0),
    checkpoint: {
      id: "u" + unitNum + "cp",
      title: "Unit " + unitNum + " test" + (chapter.title ? ": " + chapter.title : ""),
      passMark: passMark,
      kind: "self", // no vocab bank is stored, so this checkpoint is a self-assessment
    },
    lessons,
  };
  if (unitNum < totalUnits) unit.unlocks = "u" + (unitNum + 1);
  if (Array.isArray(chapter.unresolved) && chapter.unresolved.length) unit.reviewNotes = chapter.unresolved;
  return unit;
}

// ---- validate against what the Language Hub renderer needs -----
function validate(mod) {
  const problems = [];
  if (!mod.id || !mod.languageId || !mod.title) problems.push("module is missing id / languageId / title");
  if (!mod.source || typeof mod.source.authors !== "string" || typeof mod.source.publisher !== "string")
    problems.push("module.source.authors / .publisher must be strings");
  if (!Array.isArray(mod.units) || !mod.units.length) problems.push("module has no units");
  (mod.units || []).forEach((u) => {
    if (!u.id || !u.title) problems.push(u.id + ": missing id/title");
    if (typeof u.goal !== "string") problems.push(u.id + ": goal must be a string");
    if (typeof u.pages !== "string") problems.push(u.id + ": pages must be a string");
    if (!u.checkpoint || !u.checkpoint.id || typeof u.checkpoint.passMark !== "number")
      problems.push(u.id + ": checkpoint id/passMark missing");
    if (!Array.isArray(u.lessons) || !u.lessons.length) problems.push(u.id + ": no lessons");
    (u.lessons || []).forEach((l) => {
      if (!l.id || !l.title) problems.push((l.id || "?") + ": missing id/title");
      if (typeof l.estMinutes !== "number") problems.push(l.id + ": estMinutes must be a number");
      if (typeof l.pages !== "string") problems.push(l.id + ": pages must be a string");
      if (!Array.isArray(l.objectives) || !l.objectives.length) problems.push(l.id + ": no objectives");
      if (!Array.isArray(l.tasks) || !l.tasks.length) problems.push(l.id + ": no tasks");
      if (!Array.isArray(l.vocab)) problems.push(l.id + ": vocab must be an array");
      (l.tasks || []).forEach((t) => {
        if (!t.id || !t.type || typeof t.text !== "string") problems.push(l.id + ": a task is missing id/type/text");
      });
    });
  });
  return problems;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.name) fail('give the module a name:\n  node tools\\book-video\\6-build-module.js --name "My Spanish Course"');
  if (!fs.existsSync(CONFIRMED_PATH)) {
    fail(
      "book-structure.confirmed.json doesn't exist yet.\n" +
      "  Run Stage 5 (node tools\\book-video\\5-review-server.js), review the structure,\n" +
      "  and click Confirm. Stage 6 only runs after that."
    );
  }

  const pace = PACES[args.pace || "normal"];
  if (!pace) fail("--pace must be one of: " + Object.keys(PACES).join(", "));
  const passMark = args.passmark != null ? Number(args.passmark) : DEFAULT_PASSMARK;
  if (isNaN(passMark) || passMark < 1 || passMark > 100) fail("--passmark must be 1-100");

  const confirmed = JSON.parse(fs.readFileSync(CONFIRMED_PATH, "utf8"));
  const chapters = (confirmed.chapters || []).slice().sort((a, b) => {
    const ka = a.titlePage != null ? a.titlePage : 1e9;
    const kb = b.titlePage != null ? b.titlePage : 1e9;
    if (ka !== kb) return ka - kb;
    return 0;
  });
  if (!chapters.length) fail("the confirmed structure has no chapters. Nothing to build.");

  const baseSlug = slugify(args.id ? args.id.replace(/^es-/, "") : args.name);
  if (!baseSlug) fail("couldn't make a filename from --name/--id; pass --id es-something");
  const moduleId = args.id ? (args.id.startsWith("es-") ? args.id : "es-" + args.id) : "es-" + baseSlug;
  const fileRel = "es/" + baseSlug + ".json";
  const filePath = path.join(ES_DIR, baseSlug + ".json");

  const units = chapters.map((ch, i) => buildUnit(ch, i + 1, chapters.length, pace, passMark));

  const allPages = [];
  units.forEach((u) => String(u.pages).split("-").forEach((n) => { const v = Number(n); if (!isNaN(v)) allPages.push(v); }));
  const maxPage = allPages.length ? Math.max(...allPages) : null;
  const minPage = allPages.length ? Math.min(...allPages) : null;
  const totalLessons = units.reduce((a, u) => a + u.lessons.length, 0);
  const totalMinutes = units.reduce((a, u) => a + u.estMinutes, 0);

  const mod = {
    id: moduleId,
    languageId: "es",
    title: args.name,
    source: {
      book: args.book || args.name,
      authors: args.authors || "(add author — from the video)",
      publisher: args.publisher || "(add publisher — from the video)",
      isbn: args.isbn || "",
      pages: args.pages != null ? Number(args.pages) : (maxPage || 0),
      derivedFrom: "video page-flip -> OCR -> confirmed structure (tools/book-video)",
    },
    estTotalHours: Math.round(totalMinutes / 60),
    pace: {
      mode: args.pace || "normal",
      minutesPerDay: pace.minutesPerDay,
      studyDaysPerWeek: pace.daysPerWeek,
      estimatedStudyDays: totalLessons,
      estimatedWeeks: Math.ceil(totalLessons / pace.daysPerWeek),
      note: "Rough estimate: one lesson per study day. No fixed dates — move at your own pace; the unit tests gate progress, not the calendar.",
    },
    bookPageRange: rangeStr(minPage, maxPage),
    notebookOnly: true,
    generatedAt: new Date().toISOString(),
    generatedFrom: "tools/book-video/book-structure.confirmed.json",
    units,
  };

  const problems = validate(mod);
  if (problems.length) {
    console.error("\nThe generated module failed validation (not written):");
    problems.forEach((p) => console.error("  - " + p));
    console.error("\nUsually this means the confirmed structure has sections with no page numbers.");
    console.error("Re-open Stage 5, fill those in, re-confirm, and run Stage 6 again.\n");
    process.exit(1);
  }

  // write module file
  fs.mkdirSync(ES_DIR, { recursive: true });
  if (fs.existsSync(filePath) && !args.force) {
    fail("a module file already exists:\n  " + filePath + "\n  Re-run with --force to overwrite it, or choose a different --id.");
  }
  fs.writeFileSync(filePath, JSON.stringify(mod, null, 2) + "\n");

  // update index.json
  const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  index.modules = Array.isArray(index.modules) ? index.modules : [];
  const subtitle =
    mod.source.authors + " — " + (mod.source.pages ? mod.source.pages + " pages, " : "") +
    units.length + " units, pp. " + (mod.bookPageRange || "?");
  const entry = {
    id: moduleId,
    languageId: "es",
    title: mod.title,
    subtitle,
    file: fileRel,
    addedOn: new Date().toISOString().slice(0, 10),
  };
  const existingIdx = index.modules.findIndex((m) => m.id === moduleId);
  if (existingIdx >= 0) {
    if (!args.force) fail("index.json already lists a module with id " + moduleId + ". Re-run with --force to update it.");
    index.modules[existingIdx] = entry;
  } else {
    index.modules.push(entry);
  }
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + "\n");

  // summary
  const unresolvedCount =
    (confirmed.unresolved || []).length +
    chapters.reduce((a, c) => a + (c.unresolved || []).length +
      (c.sections || []).reduce((x, s) => x + (s.unresolved || []).length, 0), 0);

  const bar = "=".repeat(64);
  console.log(bar);
  console.log("  Built module: " + moduleId);
  console.log("  " + units.length + " units · " + totalLessons + " lessons · ~" + mod.estTotalHours + " h · pace \"" + (args.pace || "normal") + "\"");
  console.log("  Book page range: pp. " + mod.bookPageRange);
  console.log(bar);
  console.log("\n  Wrote:   " + filePath);
  console.log("  Updated: " + INDEX_PATH + "  (entry \"" + moduleId + "\")");
  if (unresolvedCount) {
    console.log("\n  Note: the confirmed structure still had " + unresolvedCount + " unresolved note(s).");
    console.log("  They're carried into the module as unit.reviewNotes / lesson.fromReview.unresolved");
    console.log("  so you can see them in context, but they don't block anything.");
  }
  console.log("\n  Check the two placeholder fields in source (authors / publisher) in:");
  console.log("    " + filePath);
  console.log("\n  Then open the Language Hub and go to the Curriculum tab:");
  console.log("    (start the local site, e.g.  \"Start Local Site.bat\", then open language-hub.html)\n");
}

main();
