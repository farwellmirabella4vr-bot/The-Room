#!/usr/bin/env node
/*
  build-spanish-1.js  --  one-off builder for the SPANISH 1 curriculum module

  Reads the hand-verified table-of-contents structure at
    tools\book-video\book-structure.json
  (captured from photographs of the actual Contents pages -- NOT OCR) and
  writes
    data\curriculum\es\spanish-1.json
  in the exact shape of the Farsi module (data\curriculum\fa\rw-farsi.json),
  then adds/updates the module's entry in data\curriculum\index.json.

  Rules baked in (per the module spec):
    - Straight book order, no resequencing. One unit per chapter,
      Book 1 Ch 1 ... Book 4 Ch 8.  (31 units.)
    - Every unit carries bookNumber / bookTitle / chapterNumber / title /
      pages / topic, all copied verbatim from book-structure.json. Nothing
      is invented -- no title, page, or topic that isn't in that file.
    - Each unit: a daily objective naming the pages to read in the physical
      book, one read-through lesson (chapter sections listed verbatim as
      objectives), and a chapter-test checkpoint.
    - Homework and tests are NOT stored here. They're generated fresh at
      request time in language-hub.html from only the topic label + page
      range. This file carries no exercises, passages, or book text.
    - Book 5 (Appendixes A-D) is reference, not units: an additive
      `appendixes` array the Farsi renderer ignores and language-hub.html
      renders as a non-gated reference block.
    - Rough pace sizing only. No target dates anywhere.

  Re-runnable: safe to run again if book-structure.json is corrected later
  (e.g. the Book 4 Ch 5 "sections after page 422 not visible" note).

  RUN
    node tools\book-video\build-spanish-1.js
*/

const fs = require("fs");
const path = require("path");

const DIR = __dirname;
const ROOT = path.resolve(DIR, "..", "..");
const SRC = path.join(DIR, "book-structure.json");
const OUT = path.join(ROOT, "data", "curriculum", "es", "spanish-1.json");
const INDEX = path.join(ROOT, "data", "curriculum", "index.json");

const MODULE_ID = "es-spanish-1";
const MODULE_TITLE = "SPANISH 1"; // editable later via the rename button in language-hub.html
const PASS_MARK = 80;
const MIN_PER_PAGE = 4; // rough reading estimate
const HOMEWORK_MIN = 30; // rough per-chapter notebook practice estimate

function fail(m) {
  console.error("\nbuild-spanish-1 stopped: " + m + "\n");
  process.exit(1);
}
function enDash(a, b) {
  return a === b ? String(a) : a + "–" + b;
}
function pageRange(a, b) {
  return a === b ? String(a) : a + "-" + b;
}

// crude, defensible skill tag from the chapter's own topic wording
const GRAMMAR_HINT = /(verb|tense|conjugat|pronoun|gender|article|adjective|adverb|preposition|conjunction|subjunctive|imperative|conditional|passive|participle|plural|possession|question|negat|preterit|imperfect|future|reflexive|progressive|compound|mood|parts of speech)/i;
const SPEAK_HINT = /(greeting|conversation|ordering|restaurant|shopping|travel|directions|hotel|interview|vocabulary|talking|profile|weather|numbers|time|dates|caregiv|healthcare|domestic|garden|law enforcement|educator|office|personnel)/i;
function skillsForTopic(topic) {
  const s = ["reading"];
  if (GRAMMAR_HINT.test(topic)) s.push("writing");
  if (SPEAK_HINT.test(topic)) s.push("speaking");
  return [...new Set(s)];
}

function main() {
  if (!fs.existsSync(SRC)) fail("can't find " + SRC);
  const src = JSON.parse(fs.readFileSync(SRC, "utf8"));
  if (!Array.isArray(src.books)) fail("book-structure.json has no books[]");

  const contentBooks = src.books.filter((b) => Number(b.bookNumber) >= 1 && Number(b.bookNumber) <= 4);
  const appendixBook = src.books.find((b) => Number(b.bookNumber) === 5);

  const units = [];
  const booksSummary = [];
  let n = 0;

  contentBooks
    .sort((a, b) => a.bookNumber - b.bookNumber)
    .forEach((book) => {
      const unitIds = [];
      (book.chapters || [])
        .slice()
        .sort((a, b) => a.startPage - b.startPage)
        .forEach((ch) => {
          n += 1;
          const uid = "u" + n;
          unitIds.push(uid);
          const pages = pageRange(ch.startPage, ch.endPage);
          const pagesDash = enDash(ch.startPage, ch.endPage);
          const secObjectives = (ch.sections || []).map(
            (s) => s.title + " (p. " + s.page + ")"
          );

          const lesson = {
            id: uid + "l1",
            title: "Read Book " + book.bookNumber + " · Ch " + ch.chapterNumber + " — " + ch.title,
            pages,
            estMinutes: Math.round((ch.endPage - ch.startPage + 1) * MIN_PER_PAGE + HOMEWORK_MIN),
            skills: skillsForTopic(ch.topic || ""),
            audio: [],
            objectives: [
              "Read pages " + pagesDash + " in your copy of the book — Book " +
                book.bookNumber + " (" + book.title + "), Chapter " + ch.chapterNumber + ".",
            ].concat(
              secObjectives.length
                ? ["Sections covered (check each page as you reach it):"].concat(secObjectives)
                : []
            ),
            tasks: [
              {
                id: uid + "l1t1",
                type: "read",
                text:
                  "Read pages " + pagesDash + " (Book " + book.bookNumber + ", Chapter " +
                  ch.chapterNumber + ": “" + ch.title + "”) in your copy of Spanish All-In-One For Dummies.",
              },
              {
                id: uid + "l1t2",
                type: "practice",
                text:
                  "Click “Generate homework” below, work the items by hand in your notebook, " +
                  "and check each one against the book page it cites.",
              },
              {
                id: uid + "l1t3",
                type: "review",
                text:
                  "When the chapter feels solid, generate the chapter test, do it in your notebook, " +
                  "self-mark it, then click “Mark unit reviewed” to unlock the next chapter.",
              },
            ],
            vocab: [],
          };

          const unit = {
            id: uid,
            number: n,
            bookNumber: book.bookNumber,
            bookTitle: book.title,
            chapterNumber: ch.chapterNumber,
            title: ch.title,
            pages,
            topic: ch.topic || "",
            goal:
              "Read pages " + pagesDash + " of Spanish All-In-One For Dummies — Book " +
              book.bookNumber + ", Chapter " + ch.chapterNumber + " “" + ch.title + "”: " +
              (ch.topic || "this chapter") + ".",
            unlocks: null, // set after the full pass
            lessons: [lesson],
            checkpoint: {
              id: uid + "cp",
              title: "Book " + book.bookNumber + " · Ch " + ch.chapterNumber + " test — " + ch.title,
              passMark: PASS_MARK,
              sections: String(ch.topic || "")
                .split(/,\s*/)
                .map((s) => s.trim())
                .filter(Boolean),
              mode: "generated-self-marked",
            },
          };
          if (Array.isArray(ch.unresolved) && ch.unresolved.length) {
            unit.reviewNote = ch.unresolved.join(" ");
          }
          units.push(unit);
        });
      booksSummary.push({
        bookNumber: book.bookNumber,
        title: book.title,
        pages: pageRange(book.startPage, book.endPage),
        unitIds,
      });
    });

  // chain unlocks in straight order
  units.forEach((u, i) => {
    u.unlocks = i < units.length - 1 ? units[i + 1].id : null;
  });

  // Book 5 -> reference, not units
  const appendixes = appendixBook
    ? (appendixBook.chapters || []).map((a) => {
        const entry = {
          appendix: a.appendix,
          title: a.title,
          pages: pageRange(a.startPage, a.endPage),
          pagesLabel: enDash(a.startPage, a.endPage),
          topic: a.topic || "",
          reference: true,
        };
        if (Array.isArray(a.sections) && a.sections.length) {
          entry.sections = a.sections.map((s) => ({ title: s.title, page: s.page }));
        }
        // Appendix A is verb-conjugation tables -- genuinely drillable
        if (a.appendix === "A") {
          entry.drill = {
            topic: "regular, stem-changing, spelling-change, and irregular verb conjugation",
            pageStart: a.startPage,
            pageEnd: a.endPage,
          };
        }
        return entry;
      })
    : [];
  if (appendixBook) {
    booksSummary.push({
      bookNumber: appendixBook.bookNumber,
      title: appendixBook.title,
      pages: pageRange(appendixBook.startPage, appendixBook.endPage),
      reference: true,
    });
  }

  const totalMinutes = units.reduce((a, u) => a + u.lessons.reduce((x, l) => x + l.estMinutes, 0), 0);
  const authors = Array.isArray(src.source.authors) ? src.source.authors.join(" & ") : String(src.source.authors || "");

  const mod = {
    id: MODULE_ID,
    languageId: "es",
    title: MODULE_TITLE,
    source: {
      book: src.source.title,
      edition: src.source.edition || "",
      authors,
      publisher: src.source.publisher || "",
      isbn: src.source.isbn_print || src.source.isbn || "",
      pages: src.index && src.index.startPage ? src.index.startPage - 1 : (appendixBook ? appendixBook.endPage : 0),
    },
    estTotalHours: Math.round(totalMinutes / 60),
    pace: {
      mode: "flexible",
      targetDates: false,
      note:
        "No target dates. Study whenever you can, for as long as you can. The per-unit minute " +
        "figures and the ~" + Math.round(totalMinutes / 60) + "h total are rough sizing only, not a schedule. " +
        "Passing each chapter test is what moves you forward, not the calendar.",
    },
    notebookOnly: true,
    practiceGeneration: {
      onDemand: true,
      note:
        "Homework and chapter tests are generated fresh by language-hub.html at request time, " +
        "from only the topic label and page range below. No exercises, passages, or book text are " +
        "stored in this file or sent to the generator. Every generated item cites a source page to " +
        "check against the physical book.",
    },
    generatedFrom: "tools/book-video/book-structure.json (hand-verified from Contents photographs)",
    generatedAt: new Date().toISOString(),
    books: booksSummary,
    units,
    appendixes,
  };

  // ---- validate against what the language-hub renderer needs ----
  const problems = [];
  if (typeof mod.source.authors !== "string" || typeof mod.source.publisher !== "string")
    problems.push("source.authors/publisher must be strings");
  if (!units.length) problems.push("no units");
  units.forEach((u) => {
    if (typeof u.goal !== "string") problems.push(u.id + ": goal not a string");
    if (typeof u.pages !== "string") problems.push(u.id + ": pages not a string");
    if (!u.checkpoint || typeof u.checkpoint.passMark !== "number") problems.push(u.id + ": bad checkpoint");
    if (!Array.isArray(u.lessons) || !u.lessons.length) problems.push(u.id + ": no lessons");
    u.lessons.forEach((l) => {
      ["objectives", "tasks", "vocab", "skills", "audio"].forEach((k) => {
        if (!Array.isArray(l[k])) problems.push(l.id + ": " + k + " not an array");
      });
      if (typeof l.estMinutes !== "number") problems.push(l.id + ": estMinutes not a number");
      if (typeof l.pages !== "string") problems.push(l.id + ": pages not a string");
      if (!l.tasks.length) problems.push(l.id + ": zero tasks");
      l.tasks.forEach((t) => {
        if (!t.id || !t.type || typeof t.text !== "string") problems.push(l.id + ": malformed task");
      });
    });
  });
  if (problems.length) {
    console.error("Validation failed, nothing written:");
    problems.forEach((p) => console.error("  - " + p));
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(mod, null, 2) + "\n");

  // ---- index.json ----
  const index = JSON.parse(fs.readFileSync(INDEX, "utf8"));
  index.modules = Array.isArray(index.modules) ? index.modules : [];
  const entry = {
    id: MODULE_ID,
    languageId: "es",
    title: MODULE_TITLE,
    subtitle:
      authors.split(",")[0].trim() + " et al., " + (src.source.publisher || "") +
      " — " + mod.source.pages + " pages, " + booksSummary.length + " books / " + units.length + " chapter-units",
    file: "es/spanish-1.json",
    addedOn: new Date().toISOString().slice(0, 10),
  };
  const i = index.modules.findIndex((m) => m.id === MODULE_ID);
  if (i >= 0) index.modules[i] = entry;
  else index.modules.push(entry);
  fs.writeFileSync(INDEX, JSON.stringify(index, null, 2) + "\n");

  // ---- report ----
  const bar = "=".repeat(64);
  console.log(bar);
  console.log("  SPANISH 1 built");
  console.log("  " + units.length + " chapter-units across Books 1–4  |  " +
    appendixes.length + " reference appendixes (Book 5)  |  ~" + mod.estTotalHours + " h rough total");
  console.log(bar);
  booksSummary.forEach((b) => {
    console.log("  Book " + b.bookNumber + " — " + b.title + "  (pp. " + b.pages + ")" +
      (b.reference ? "  [reference]" : "  " + b.unitIds.length + " units: " + b.unitIds[0] + "–" + b.unitIds[b.unitIds.length - 1]));
  });
  console.log("\n  Wrote:   " + OUT);
  console.log("  Updated: " + INDEX + "  (entry \"" + MODULE_ID + "\")\n");
}

main();
