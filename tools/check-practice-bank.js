#!/usr/bin/env node
/*
 * check-practice-bank.js -- read every banked set and flag items that would
 * mislead someone studying from them.
 *
 * The generator occasionally "thinks out loud" in an answer field ("actually the
 * correct spelling is...", "Correct answer: ...?") or leaves a fill-in-the-blank
 * with no blank in it. Those are wrong on the page, not just untidy, so they get
 * found here rather than at the desk with a pen.
 *
 *   node tools/check-practice-bank.js            # report
 *   node tools/check-practice-bank.js --units    # just the unit/mode list, to feed --units
 */
const fs = require("fs");
const path = require("path");
const REPO = path.resolve(__dirname, "..");

// Only signals that mean the item is wrong on the page, not merely untidy. Two
// looser drafts of this list flagged sixteen healthy items -- any answer with the
// word "wait" in it, any two-option translation ending in "?" -- and buried the
// three real breakages, so it is deliberately narrow now.
const SELF_CORRECTION = [
  /\bactually\b/i, /\bthe intended (target|word|answer)\b/i, /\bI mean\b/i, /\bignore (that|the above)\b/i,
];

function problems(item) {
  const found = [];
  const a = String(item.answer || "").trim();
  if (!a) found.push("empty answer");
  if (/^placeholder\.?$/i.test(a)) found.push('answer is the literal word "placeholder"');
  if (SELF_CORRECTION.some((re) => re.test(a))) found.push("answer argues with itself mid-sentence");
  if (/\.\.\.\s*"?\s*$/.test(a)) found.push("answer trails off");
  return found;
}

let sets = 0, items = 0;
const flagged = [];
const index = JSON.parse(fs.readFileSync(path.join(REPO, "data/curriculum/index.json"), "utf8"));
for (const entry of index.modules) {
  const mod = JSON.parse(fs.readFileSync(path.join(REPO, "data/curriculum", entry.file), "utf8"));
  const bankPath = path.join(REPO, "data/curriculum", mod.languageId, "practice", mod.id + ".json");
  if (!fs.existsSync(bankPath)) { console.log(entry.id + ": no bank yet"); continue; }
  const bank = JSON.parse(fs.readFileSync(bankPath, "utf8"));
  const unitCount = (mod.units || []).length;
  let covered = 0;
  for (const unit of mod.units || []) {
    const u = bank.units[unit.id];
    if (u && (u.homework || []).some(Boolean) && (u.test || []).some(Boolean)) covered++;
    for (const mode of ["homework", "test"]) {
      for (const set of (u && u[mode]) || []) {
        if (!set || !set.items) continue;
        sets++;
        for (const it of set.items) {
          items++;
          const probs = problems(it);
          if (probs.length) flagged.push({ module: mod.id, unit: unit.id, mode, n: it.n, probs, answer: String(it.answer || "").slice(0, 90) });
        }
      }
    }
  }
  console.log(entry.id + ": " + covered + "/" + unitCount + " units have both a homework set and a test");
}

console.log("\n" + sets + " sets, " + items + " items, " + flagged.length + " item(s) flagged.");
const byUnit = {};
for (const f of flagged) {
  const key = f.module + " " + f.unit + " " + f.mode;
  (byUnit[key] = byUnit[key] || []).push(f);
}
if (process.argv.includes("--units")) {
  for (const key of Object.keys(byUnit)) console.log(key);
} else {
  for (const key of Object.keys(byUnit)) {
    console.log("\n" + key);
    for (const f of byUnit[key]) console.log("  item " + f.n + " [" + f.probs.join("; ") + "] " + f.answer);
  }
}
