#!/usr/bin/env node
/*
  ingest-textbook-section.js

  Takes a folder shaped like:
    <section-folder>/
      pages/           real photographs of textbook pages
      audio/           (optional) the audio files named in manifest.audioTracksAvailable
      manifest.json    per-page metadata (see the format below)

  ...and:
    1. Copies pages/*.jpg into data/curriculum/<lang>/textbook-images/<sectionId>/
       (a file that's already there and unchanged is skipped -- safe to re-run).
       A page whose image file is missing from pages/ is NOT skipped silently --
       its metadata still merges in (so you can review instructions/topics
       before the photo exists), but it's called out clearly at the end.
    2. If manifest.audioTracksAvailable is present, copies audio/*.mp3 into
       data/curriculum/<lang>/audio/<audioDir>/ and merges each track's id/file
       into data/curriculum/<lang>/audio-index.json (created fresh if it
       doesn't exist yet; existing tracks and sections are preserved, not
       overwritten -- safe to re-run, and safe to run again for a later
       section of the same book).
    3. Matches each page to an EXISTING lesson in the target curriculum file by
       page-number containment against that lesson's own `pages` range. This
       script never invents or renames a lesson -- if a page doesn't fall in
       any existing lesson's range, it's reported as unmatched, not guessed.
    4. Merges into each matched lesson's new `bookPages` array (one entry per
       photographed page, in book order, including `thingsToRemember` if the
       manifest provides it) -- every other existing field on that lesson is
       left exactly as it was.

  Boundary pages (a book page that falls inside TWO existing lessons' ranges,
  e.g. page 14 is inside both u2l2's "13-14" and u2l3's "14-15") are
  genuinely ambiguous and this script refuses to guess -- pass
  --override <page>:<lessonId> (repeatable) to resolve them explicitly.

  USAGE
    node ingest-textbook-section.js <section-folder> [options]

  OPTIONS
    --curriculum FILE   Curriculum JSON to merge into.
                         Default: data/curriculum/fa/rw-farsi.json
    --section-id ID     Used for the destination image folder name.
                         Default: the section folder's own directory name.
    --audio-dir NAME    Used for the destination audio folder name
                         (data/curriculum/<lang>/audio/<NAME>/).
                         Default: the curriculum's own id with its language
                         prefix stripped (e.g. "ar-arabic-for-dummies" -> "arabic-for-dummies").
    --override P:L      Force page P to lesson id L (repeatable), for
                         boundary pages more than one lesson's range claims.
    --dry-run           Report the mapping without writing anything.
*/

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;

function parseArgs(argv) {
  const args = { _: [], overrides: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--curriculum") args.curriculum = argv[++i];
    else if (a === "--section-id") args.sectionId = argv[++i];
    else if (a === "--audio-dir") args.audioDir = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--override") {
      const [page, lessonId] = String(argv[++i]).split(":");
      args.overrides[Number(page)] = lessonId;
    } else args._.push(a);
  }
  return args;
}

function fail(msg) {
  console.error("Error: " + msg);
  process.exit(1);
}

function parsePageRange(pagesStr) {
  if (!pagesStr || typeof pagesStr !== "string") return null;
  const nums = pagesStr.match(/\d+/g);
  if (!nums || !nums.length) return null;
  const values = nums.map(Number);
  return [Math.min(...values), Math.max(...values)];
}

// Every existing lesson whose page range contains pageNum -- there can be
// more than one at a boundary, which is exactly the case --override exists for.
function findCandidateLessons(curriculum, pageNum) {
  const candidates = [];
  curriculum.units.forEach((unit) => {
    unit.lessons.forEach((lesson) => {
      const range = parsePageRange(lesson.pages);
      if (range && pageNum >= range[0] && pageNum <= range[1]) {
        candidates.push({ unitId: unit.id, lessonId: lesson.id, lessonTitle: lesson.title });
      }
    });
  });
  return candidates;
}

function findLessonObject(curriculum, lessonId) {
  for (const unit of curriculum.units) {
    const lesson = unit.lessons.find((l) => l.id === lessonId);
    if (lesson) return lesson;
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sectionFolder = args._[0];
  if (!sectionFolder) fail("Usage: node ingest-textbook-section.js <section-folder> [--curriculum FILE] [--section-id ID] [--override P:L ...] [--dry-run]");
  if (!fs.existsSync(sectionFolder)) fail("Section folder not found: " + sectionFolder);

  const manifestPath = path.join(sectionFolder, "manifest.json");
  if (!fs.existsSync(manifestPath)) fail("No manifest.json found in " + sectionFolder);
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); }
  catch (e) { fail("manifest.json isn't valid JSON: " + e.message); }
  if (!Array.isArray(manifest.pages) || !manifest.pages.length) fail("manifest.json has no pages[] array.");

  const curriculumPath = path.resolve(ROOT, args.curriculum || "data/curriculum/fa/rw-farsi.json");
  if (!fs.existsSync(curriculumPath)) fail("Curriculum file not found: " + curriculumPath);
  const curriculum = JSON.parse(fs.readFileSync(curriculumPath, "utf8"));
  const languageId = curriculum.languageId;

  const sectionId = args.sectionId || path.basename(path.resolve(sectionFolder));
  const destDir = path.resolve(ROOT, "data/curriculum/" + languageId + "/textbook-images/" + sectionId);
  const destRelBase = "data/curriculum/" + languageId + "/textbook-images/" + sectionId;

  console.log("Section: " + sectionId + " (" + manifest.pages.length + " page(s)) -> " + curriculumPath);
  console.log("Images will land in: " + destRelBase + "/\n");

  // ---- Step 1: resolve each page to a lesson (or flag it) ----
  const resolved = []; // {pageEntry, lessonId, lessonTitle}
  const unresolved = [];
  manifest.pages.forEach((p) => {
    if (args.overrides[p.page]) {
      const lesson = findLessonObject(curriculum, args.overrides[p.page]);
      if (!lesson) { unresolved.push({ page: p.page, reason: "override points at unknown lesson id " + args.overrides[p.page] }); return; }
      resolved.push({ pageEntry: p, lessonId: lesson.id, lessonTitle: lesson.title });
      return;
    }
    const candidates = findCandidateLessons(curriculum, p.page);
    if (candidates.length === 0) {
      unresolved.push({ page: p.page, reason: "no existing lesson's page range contains page " + p.page });
    } else if (candidates.length > 1) {
      unresolved.push({
        page: p.page,
        reason: "ambiguous -- claimed by " + candidates.map((c) => c.lessonId).join(" and ") +
          "; resolve with --override " + p.page + ":<lessonId>",
      });
    } else {
      resolved.push({ pageEntry: p, lessonId: candidates[0].lessonId, lessonTitle: candidates[0].lessonTitle });
    }
  });

  console.log("Resolved " + resolved.length + " page(s):");
  resolved.forEach((r) => console.log("  p." + r.pageEntry.page + " (" + r.pageEntry.pageType + ") -> " + r.lessonId + " \"" + r.lessonTitle + "\""));
  if (unresolved.length) {
    console.log("\n" + unresolved.length + " page(s) could NOT be resolved automatically:");
    unresolved.forEach((u) => console.log("  p." + u.page + " -- " + u.reason));
  }

  if (args.dryRun) {
    console.log("\n--dry-run: nothing written.");
    return;
  }
  if (!resolved.length) {
    console.log("\nNothing to merge.");
    return;
  }

  // ---- Step 2: copy images (warn, don't crash, on anything missing) ----
  fs.mkdirSync(destDir, { recursive: true });
  const missingImages = [];
  const copied = [];
  resolved.forEach((r) => {
    const srcPath = path.join(sectionFolder, "pages", r.pageEntry.image);
    const destPath = path.join(destDir, r.pageEntry.image);
    r.destRelPath = destRelBase + "/" + r.pageEntry.image;
    if (!fs.existsSync(srcPath)) { missingImages.push(r.pageEntry.image); return; }
    if (!fs.existsSync(destPath) || fs.statSync(srcPath).size !== fs.statSync(destPath).size) {
      fs.copyFileSync(srcPath, destPath);
      copied.push(r.pageEntry.image);
    }
  });
  console.log("\nImages: " + copied.length + " copied, " +
    (resolved.length - copied.length - missingImages.length) + " already present, " +
    missingImages.length + " missing from " + path.join(sectionFolder, "pages") + "/.");
  if (missingImages.length) {
    console.log("  Missing: " + missingImages.join(", "));
    console.log("  Metadata for these still merges below -- re-run this script once the photos are in place to pick up the images.");
  }

  // ---- Step 2b: copy audio + merge audio-index.json (only if the manifest names any tracks) ----
  const audioTracks = Array.isArray(manifest.audioTracksAvailable) ? manifest.audioTracksAvailable : [];
  if (audioTracks.length) {
    const audioDirName = args.audioDir || String(curriculum.id || "").replace(new RegExp("^" + languageId + "-"), "");
    const audioDestDir = path.resolve(ROOT, "data/curriculum/" + languageId + "/audio/" + audioDirName);
    const audioIndexPath = path.resolve(ROOT, "data/curriculum/" + languageId + "/audio-index.json");
    fs.mkdirSync(audioDestDir, { recursive: true });

    const missingAudio = [];
    const copiedAudio = [];
    audioTracks.forEach((t) => {
      const srcPath = path.join(sectionFolder, "audio", t.file);
      const destPath = path.join(audioDestDir, t.file);
      if (!fs.existsSync(srcPath)) { missingAudio.push(t.file); return; }
      if (!fs.existsSync(destPath) || fs.statSync(srcPath).size !== fs.statSync(destPath).size) {
        fs.copyFileSync(srcPath, destPath);
        copiedAudio.push(t.file);
      }
    });
    console.log("\nAudio: " + copiedAudio.length + " copied, " +
      (audioTracks.length - copiedAudio.length - missingAudio.length) + " already present, " +
      missingAudio.length + " missing from " + path.join(sectionFolder, "audio") + "/.");
    if (missingAudio.length) console.log("  Missing: " + missingAudio.join(", "));

    let audioIndex;
    if (fs.existsSync(audioIndexPath)) {
      audioIndex = JSON.parse(fs.readFileSync(audioIndexPath, "utf8"));
      audioIndex.tracks = audioIndex.tracks || {};
      audioIndex.sections = audioIndex.sections || {};
    } else {
      audioIndex = {
        book: (manifest.source && manifest.source.book) || curriculum.title,
        generatedOn: new Date().toISOString().slice(0, 10),
        audioPath: "audio/" + audioDirName + "/",
        sections: {},
        tracks: {},
      };
    }
    let tracksAdded = 0;
    audioTracks.forEach((t) => {
      if (!audioIndex.tracks[t.id]) tracksAdded++;
      audioIndex.tracks[t.id] = t.file;
    });
    audioIndex.sections[sectionId] = audioTracks.map((t) => t.id);
    audioIndex.generatedOn = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(audioIndexPath, JSON.stringify(audioIndex, null, 2) + "\n", "utf8");
    console.log("Audio index: " + tracksAdded + " new track(s) merged into " + audioIndexPath);
  }

  // ---- Step 3: merge into the curriculum file, grouped by lesson ----
  const byLesson = {};
  resolved.forEach((r) => { (byLesson[r.lessonId] = byLesson[r.lessonId] || []).push(r); });

  let lessonsTouched = 0, pagesAdded = 0, pagesUpdated = 0;
  Object.keys(byLesson).forEach((lessonId) => {
    const lesson = findLessonObject(curriculum, lessonId);
    if (!Array.isArray(lesson.bookPages)) lesson.bookPages = [];
    lessonsTouched++;
    byLesson[lessonId]
      .sort((a, b) => a.pageEntry.page - b.pageEntry.page)
      .forEach((r) => {
        const p = r.pageEntry;
        const entry = {
          page: p.page,
          image: r.destRelPath,
          pageType: p.pageType || "study",
          title: p.title || "",
          topics: Array.isArray(p.topics) ? p.topics : [],
          audio: Array.isArray(p.audio) ? p.audio : [],
          materials: Array.isArray(p.materials) ? p.materials : [],
          needsNotebook: !!p.needsNotebook,
          estMinutes: typeof p.estMinutes === "number" ? p.estMinutes : null,
          thingsToRemember: Array.isArray(p.thingsToRemember) ? p.thingsToRemember : [],
          instructions: Array.isArray(p.instructions) ? p.instructions : [],
          isAssessment: !!p.isAssessment,
        };
        const existingIdx = lesson.bookPages.findIndex((bp) => bp.page === p.page);
        if (existingIdx === -1) { lesson.bookPages.push(entry); pagesAdded++; }
        else { lesson.bookPages[existingIdx] = entry; pagesUpdated++; }
      });
    lesson.bookPages.sort((a, b) => a.page - b.page);
  });

  fs.writeFileSync(curriculumPath, JSON.stringify(curriculum, null, 2) + "\n", "utf8");
  console.log(
    "\nMerged into " + curriculumPath + ": " + lessonsTouched + " lesson(s) touched, " +
    pagesAdded + " page(s) added, " + pagesUpdated + " page(s) updated."
  );
  console.log("Every other existing field on those lessons is untouched -- only bookPages changed.");
}

main();
