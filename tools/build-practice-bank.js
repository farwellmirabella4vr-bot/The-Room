#!/usr/bin/env node
/*
 * build-practice-bank.js -- pre-generate every homework set and chapter test
 * once, and save them into the repo so the Language Hub never has to call the
 * API while you're trying to study.
 *
 * Why this exists: the hub used to generate practice on click. That meant every
 * device needed its own API key pasted in, every set needed a working
 * connection, and a busy moment on Anthropic's side (HTTP 529) killed the set
 * you were about to work. Generating once and committing the result removes all
 * three problems -- the page just reads JSON.
 *
 *   node tools/build-practice-bank.js                     # everything, 3 sets each
 *   node tools/build-practice-bank.js --dry-run           # show the plan + cost, call nothing
 *   node tools/build-practice-bank.js --module es-spanish-1
 *   node tools/build-practice-bank.js --module es-spanish-1 --units u2,u3
 *   node tools/build-practice-bank.js --sets 5 --model claude-opus-5
 *
 * Safe to stop and re-run: finished sets are written as they land and skipped
 * on the next run. Use --force to regenerate ones that already exist.
 *
 * Needs ANTHROPIC_API_KEY in the environment (a fresh terminal picks up the
 * permanent User env var set on this PC).
 *
 * Output: data/curriculum/<lang>/practice/<moduleId>.json, which IS committed --
 * it's original generated practice, not book content.
 */

const fs = require("fs");
const path = require("path");
const PracticePrompt = require("../practice-prompt.js");

const REPO = path.resolve(__dirname, "..");
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 8000;
const CONCURRENCY = 4;
const MAX_ATTEMPTS = 6;

// $ per million tokens, for the running tally only.
const PRICING = {
  "claude-sonnet-5": { in: 2, out: 10 },
  "claude-opus-5": { in: 5, out: 25 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

// The language names the prompt uses. Mirrors the LANGUAGES array in
// language-hub.html; a module can override with `practiceLanguageName`.
const LANGUAGES = [
  { id: "es", name: "Spanish" },
  { id: "fa", name: "Dari" },
  { id: "ar", name: "Arabic" },
  { id: "pt", name: "Portuguese" },
];

// ----------------------------------------------------------------
// args
// ----------------------------------------------------------------
function parseArgs(argv) {
  const out = { sets: 3, model: DEFAULT_MODEL, dryRun: false, force: false, module: null, units: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--force") out.force = true;
    else if (a === "--sets") out.sets = Number(argv[++i]);
    else if (a === "--model") out.model = argv[++i];
    else if (a === "--module") out.module = argv[++i];
    else if (a === "--units") out.units = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else { console.error("Unknown argument: " + a); process.exit(1); }
  }
  if (!Number.isInteger(out.sets) || out.sets < 1 || out.sets > 20) {
    console.error("--sets must be a whole number from 1 to 20.");
    process.exit(1);
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p); // never leave a half-written bank behind
}

// ----------------------------------------------------------------
// one API call, with the retry behaviour the in-page version never had
// ----------------------------------------------------------------
const usageTotal = { input: 0, output: 0, calls: 0, retries: 0 };

async function generateSet(apiKey, model, spec) {
  const { system, user } = PracticePrompt.buildMessages(spec);
  const body = {
    model: model,
    max_tokens: MAX_TOKENS,
    system: system,
    messages: [{ role: "user", content: user }],
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: PracticePrompt.responseSchema() },
    },
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
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
      if (attempt === MAX_ATTEMPTS) throw new Error("network error: " + e.message);
      usageTotal.retries++;
      await sleep(backoffMs(attempt, null));
      continue;
    }

    // 429 rate limit, 529 overloaded, and 5xx are all worth waiting out --
    // 529 in particular is Anthropic being busy, not anything wrong with us.
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      if (attempt === MAX_ATTEMPTS) {
        throw new Error("gave up after " + MAX_ATTEMPTS + " attempts (last status " + res.status + ")");
      }
      const wait = backoffMs(attempt, res.headers.get("retry-after"));
      usageTotal.retries++;
      console.log("      " + res.status + " " + (res.status === 529 ? "overloaded" : "busy") +
                  " -- retrying in " + Math.round(wait / 1000) + "s (attempt " + attempt + ")");
      await sleep(wait);
      continue;
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error("HTTP " + res.status + ": " + detail.slice(0, 300));
    }

    const data = await res.json();
    if (data.usage) {
      usageTotal.input += data.usage.input_tokens || 0;
      usageTotal.output += data.usage.output_tokens || 0;
      usageTotal.calls++;
    }
    if (data.stop_reason === "refusal") throw new Error("the model declined this request");
    if (data.stop_reason === "max_tokens") throw new Error("hit max_tokens -- output was cut off");

    const text = (data.content || []).map((c) => c.text || "").join("").trim();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("no JSON in the reply: " + text.slice(0, 160));
      parsed = JSON.parse(m[0]);
    }
    const items = PracticePrompt.normalizeItems(parsed, spec);
    if (!items.length) throw new Error("no usable items came back");
    return items;
  }
}

// Exponential backoff with jitter, capped at a minute; honours retry-after.
function backoffMs(attempt, retryAfterHeader) {
  const header = Number(retryAfterHeader);
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 60000);
  const base = Math.min(2000 * Math.pow(2, attempt - 1), 60000);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

// ----------------------------------------------------------------
// work list
// ----------------------------------------------------------------
function planFor(mod, opts, existingBank) {
  const jobs = [];
  for (const unit of mod.units || []) {
    if (opts.units && opts.units.indexOf(unit.id) === -1) continue;
    const base = PracticePrompt.specForUnit(mod, unit, LANGUAGES);
    if (!base) continue; // no topic label, or no parseable page range
    for (const mode of ["homework", "test"]) {
      for (let variant = 1; variant <= opts.sets; variant++) {
        const banked = ((existingBank.units[unit.id] || {})[mode] || [])[variant - 1];
        if (banked && banked.items && banked.items.length && !opts.force) continue;
        jobs.push(Object.assign({}, base, { mode: mode, variant: variant }));
      }
    }
  }
  return jobs;
}

function emptyBank(mod, opts) {
  return {
    moduleId: mod.id,
    languageId: mod.languageId,
    note:
      "Pre-generated practice. Original items written for this topic label and page range only -- " +
      "no text, exercises, or examples from the book are stored here. Rebuild with " +
      "tools/build-practice-bank.js.",
    model: opts.model,
    setsPerMode: opts.sets,
    generatedAt: new Date().toISOString().slice(0, 10),
    units: {},
  };
}

function storeSet(bank, spec, items) {
  if (!bank.units[spec.unitId]) bank.units[spec.unitId] = {};
  if (!bank.units[spec.unitId][spec.mode]) bank.units[spec.unitId][spec.mode] = [];
  bank.units[spec.unitId][spec.mode][spec.variant - 1] = {
    id: spec.unitId + "-" + spec.mode + "-" + spec.variant,
    pageLabel: spec.pageLabel,
    pagesEstimated: spec.pagesEstimated,
    items: items,
  };
}

// ----------------------------------------------------------------
// run a job list with a small pool, saving as results land
// ----------------------------------------------------------------
async function runPool(jobs, worker, concurrency) {
  let next = 0;
  const runners = [];
  for (let i = 0; i < Math.min(concurrency, jobs.length); i++) {
    runners.push((async () => {
      while (next < jobs.length) {
        const idx = next++;
        await worker(jobs[idx], idx);
      }
    })());
  }
  await Promise.all(runners);
}

function costSoFar(model) {
  const p = PRICING[model];
  if (!p) return null;
  return (usageTotal.input / 1e6) * p.in + (usageTotal.output / 1e6) * p.out;
}

// ----------------------------------------------------------------
// main
// ----------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey && !opts.dryRun) {
    console.error(
      "ANTHROPIC_API_KEY is not set in this shell.\n" +
      "It's a permanent User env var on this PC, so a NEW terminal will have it.\n" +
      "Or run with --dry-run to see the plan and the cost estimate without calling anything."
    );
    process.exit(1);
  }

  const index = readJson(path.join(REPO, "data/curriculum/index.json"));
  const entries = index.modules.filter((m) => !opts.module || m.id === opts.module);
  if (!entries.length) {
    console.error("No module matched --module " + opts.module);
    process.exit(1);
  }

  console.log("Practice bank build");
  console.log("  model      " + opts.model);
  console.log("  sets/mode  " + opts.sets);
  console.log("  modules    " + entries.map((e) => e.id).join(", "));
  console.log("");

  let grandTotalJobs = 0;
  const failures = [];

  for (const entry of entries) {
    const mod = readJson(path.join(REPO, "data/curriculum", entry.file));
    const outPath = path.join(REPO, "data/curriculum", mod.languageId, "practice", mod.id + ".json");

    let bank = emptyBank(mod, opts);
    if (fs.existsSync(outPath)) {
      try {
        const prev = readJson(outPath);
        if (prev && prev.units) bank = Object.assign(bank, { units: prev.units, generatedAt: prev.generatedAt });
      } catch (e) {
        console.log("  (existing bank for " + mod.id + " was unreadable -- starting fresh)");
      }
    }
    bank.model = opts.model;
    bank.setsPerMode = Math.max(bank.setsPerMode || 0, opts.sets);

    const jobs = planFor(mod, opts, bank);
    const skippable = (mod.units || []).filter((u) => !PracticePrompt.specForUnit(mod, u, LANGUAGES));
    grandTotalJobs += jobs.length;

    console.log(mod.id + " -- " + (mod.units || []).length + " units, " + jobs.length + " sets to generate" +
                (skippable.length ? " (" + skippable.length + " unit(s) skipped: no topic/page range)" : ""));
    if (!jobs.length) { console.log("  nothing to do -- already banked\n"); continue; }
    if (opts.dryRun) {
      for (const j of jobs.slice(0, 6)) console.log("    " + j.unitId + " " + j.mode + " #" + j.variant + " -- " + j.topic.slice(0, 60));
      if (jobs.length > 6) console.log("    ... and " + (jobs.length - 6) + " more");
      console.log("");
      continue;
    }

    let done = 0;
    let sinceSave = 0;
    await runPool(jobs, async (spec) => {
      try {
        const items = await generateSet(apiKey, opts.model, spec);
        storeSet(bank, spec, items);
        done++;
        sinceSave++;
        const cost = costSoFar(opts.model);
        console.log("  [" + done + "/" + jobs.length + "] " + spec.unitId + " " + spec.mode + " #" + spec.variant +
                    " -- " + items.length + " items" + (cost != null ? "  ($" + cost.toFixed(2) + " so far)" : ""));
        if (sinceSave >= 5) { writeJson(outPath, bank); sinceSave = 0; }
      } catch (e) {
        failures.push({ module: mod.id, unit: spec.unitId, mode: spec.mode, variant: spec.variant, error: e.message });
        console.log("  !! " + spec.unitId + " " + spec.mode + " #" + spec.variant + " FAILED: " + e.message);
      }
    }, CONCURRENCY);

    writeJson(outPath, bank);
    console.log("  wrote " + path.relative(REPO, outPath) + "\n");
  }

  const cost = costSoFar(opts.model);
  if (opts.dryRun) {
    // Rough, from observed averages: ~700 input and ~2000 output tokens per set.
    const p = PRICING[opts.model];
    const est = p ? (grandTotalJobs * 700 / 1e6) * p.in + (grandTotalJobs * 2000 / 1e6) * p.out : null;
    console.log("Dry run: " + grandTotalJobs + " sets would be generated" +
                (est != null ? ", roughly $" + est.toFixed(2) : "") + ". Nothing was called.");
    return;
  }

  console.log("Done. " + usageTotal.calls + " API calls, " + usageTotal.retries + " retries.");
  console.log("Tokens: " + usageTotal.input.toLocaleString() + " in, " + usageTotal.output.toLocaleString() + " out" +
              (cost != null ? "  =  about $" + cost.toFixed(2) : ""));
  if (failures.length) {
    console.log("\n" + failures.length + " set(s) failed -- re-run the same command to retry just those:");
    for (const f of failures.slice(0, 20)) console.log("  " + f.module + " " + f.unit + " " + f.mode + " #" + f.variant + ": " + f.error);
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
