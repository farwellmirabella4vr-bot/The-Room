/*
 * practice-prompt.js -- the one definition of how a homework set or chapter test
 * is asked for, shared by two callers:
 *
 *   - tools/build-practice-bank.js  (Node, run by hand on the PC with an API key)
 *     bulk-generates every set once and writes them into the repo.
 *   - language-hub.html             (browser)
 *     reads those saved sets with no key and no network call, and can still ask
 *     for one live set if a unit has nothing banked yet.
 *
 * Both must send the model the same thing, so it lives here rather than being
 * written twice. Loaded in the browser with a plain <script> tag (sets
 * window.PracticePrompt) and in Node with require() -- no build step, no deps,
 * matching the rest of this project.
 *
 * What the model is given, deliberately: a topic label, a chapter title, and a
 * page range from the table of contents. Never a scanned page, never book text.
 * It is told to write its own items and to cite a page to check against the
 * physical copy.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PracticePrompt = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Turns a curriculum `pages` string into concrete ranges. Handles both the
  // plain "71-77" form and the workbook style ("51-64, 122-124, 134",
  // "110-121 + review"), so a unit that reaches into an appendix still gets its
  // page citations validated against the pages it actually covers.
  function parsePageRanges(pages) {
    const ranges = [];
    const re = /(\d+)\s*(?:[-–]\s*(\d+))?/g;
    let m;
    while ((m = re.exec(String(pages || "")))) {
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : start;
      if (Number.isInteger(start) && Number.isInteger(end) && end >= start) ranges.push({ start: start, end: end });
    }
    return ranges;
  }

  function pageInRanges(ranges, n) {
    return Number.isInteger(n) && (ranges || []).some((r) => n >= r.start && n <= r.end);
  }

  function rangesLabel(ranges) {
    return (ranges || []).map((r) => (r.start === r.end ? String(r.start) : r.start + "-" + r.end)).join(", ");
  }

  // How to write items for a given language, as opposed to what the book
  // contains -- which is why this is here and not in the curriculum JSON.
  const SCRIPT_HINTS = {
    ar: "Write every Arabic word or sentence in Arabic script, immediately followed by a Latin-letter " +
        "transliteration in parentheses, and the English where the item needs it. The learner is still " +
        "building reading fluency, so never give Arabic script on its own.",
    fa: "Write every Farsi word or sentence in Farsi (Perso-Arabic) script, immediately followed by a " +
        "Latin-letter transliteration in parentheses, and the English where the item needs it. Include " +
        "short-vowel diacritics on new or tricky words, the way a beginner workbook does.",
  };

  // Everything the generator learns about a unit comes from the module's own
  // metadata. `languages` is the LANGUAGES array from language-hub.html, or any
  // [{id, name}] list; Node passes a small stand-in.
  function specForUnit(mod, unit, languages) {
    const ranges = parsePageRanges(unit.pages);
    if (!ranges.length || !unit.topic) return null;
    const lang = (languages || []).find((l) => l.id === mod.languageId);
    return {
      moduleId: mod.id,
      unitId: unit.id,
      languageId: mod.languageId,
      languageName: mod.practiceLanguageName || (lang ? lang.name : mod.languageId),
      bookNumber: unit.bookNumber != null ? unit.bookNumber : null,
      bookTitle: unit.bookTitle || (mod.source && mod.source.book) || mod.title || "",
      chapterLabel: unit.chapterNumber != null
        ? "Chapter " + unit.chapterNumber
        : (unit.appendix ? "Appendix " + unit.appendix : "Unit " + unit.number),
      title: unit.title,
      topic: unit.topic,
      pageLabel: rangesLabel(ranges),
      ranges: ranges,
      pagesEstimated: !!mod.pageRangesNote,
    };
  }

  function itemCount(spec) {
    return spec.mode === "test" ? 12 : 8;
  }

  // Structured output schema -- the model is constrained to return exactly this,
  // so neither caller needs to scrape JSON out of prose.
  function responseSchema() {
    return {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              n: { type: "integer" },
              type: { type: "string" },
              skill: { type: "string", enum: ["grammar", "vocabulary", "reading", "writing"] },
              prompt: { type: "string" },
              answer: { type: "string" },
              checkPage: { type: "integer" },
            },
            required: ["n", "type", "skill", "prompt", "answer", "checkPage"],
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
    };
  }

  // `variant` (1-based) only nudges the model away from repeating itself across
  // the sets banked for one unit; it is not part of what the book contains.
  function buildMessages(spec) {
    const isTest = spec.mode === "test";
    const count = itemCount(spec);
    const scriptHint = SCRIPT_HINTS[spec.languageId] || "";
    const system =
      "You generate original " + spec.languageName + " practice for a self-studying adult learner. You are " +
      "given ONLY a topic label and a page range from the table of contents of a " + spec.languageName + " " +
      "textbook. You do NOT have the book. Do not recall, quote, paraphrase, or reconstruct the book's " +
      "explanations, examples, exercises, word lists, or passages. Write your own fresh items on the topic, " +
      "pitched at a learner who has just read those pages. Never reproduce copyrighted text. " +
      (scriptHint ? scriptHint + " " : "") +
      "Every item must have one clear, checkable answer. Check each item against its own answer " +
      "before you write it: if the item offers a choice of forms, the correct one has to be among " +
      "the choices; if it asks for a blank to be filled, the blank has to appear in the prompt. " +
      "Never write an answer that corrects, doubts, or argues with your own question -- rewrite the " +
      "question until the answer is simply the answer.";
    const bookLine = spec.bookNumber != null
      ? "Book " + spec.bookNumber + " \"" + spec.bookTitle + "\", "
      : (spec.bookTitle ? "\"" + spec.bookTitle + "\", " : "");
    const user =
      "Make " + (isTest ? "a chapter test" : "a homework set") + ": " + count + " items on the topic \"" +
      spec.topic + "\".\n" +
      "Calibration context (do NOT try to match the book's wording): " + bookLine + spec.chapterLabel +
      " \"" + spec.title + "\", pages " + spec.pageLabel + ".\n" +
      (spec.pagesEstimated
        ? "Those page numbers are an estimate, so pitch difficulty by the topic rather than by an exact page.\n"
        : "") +
      (spec.variant > 1
        ? "This is set " + spec.variant + " of several on the same topic for the same learner. Cover the same " +
          "ground from different angles, with different vocabulary and different sentences than an obvious " +
          "first pass would use.\n"
        : "") +
      "Mix item types: fill-in-the-blank, conjugate the verb, translate a short phrase (either direction), " +
      "correct the error, short answer. The learner writes answers by hand in a notebook -- no multiple " +
      "choice, nothing that needs a screen.\n" +
      "Every checkPage must be a page that actually falls inside " + spec.pageLabel + ".";
    return { system: system, user: user };
  }

  // Clamps whatever came back into the shape the renderer expects. A checkPage
  // outside the unit's real pages becomes null rather than sending the learner
  // to the wrong page.
  function normalizeItems(parsed, spec) {
    return (parsed && Array.isArray(parsed.items) ? parsed.items : [])
      .map((it, i) => ({
        n: i + 1,
        type: String(it.type || "").slice(0, 40),
        skill: String(it.skill || "").slice(0, 20),
        prompt: String(it.prompt || "").slice(0, 700),
        answer: String(it.answer || "").slice(0, 700),
        checkPage: pageInRanges(spec.ranges, it.checkPage) ? it.checkPage : null,
      }))
      .filter((it) => it.prompt);
  }

  return {
    parsePageRanges: parsePageRanges,
    pageInRanges: pageInRanges,
    rangesLabel: rangesLabel,
    SCRIPT_HINTS: SCRIPT_HINTS,
    specForUnit: specForUnit,
    itemCount: itemCount,
    responseSchema: responseSchema,
    buildMessages: buildMessages,
    normalizeItems: normalizeItems,
  };
});
