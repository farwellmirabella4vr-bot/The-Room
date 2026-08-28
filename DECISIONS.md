# DECISIONS — Twelver Shia practice/study rebuild

Running log of every assumption, correction, and unresolved item from this build.
Fragments from parallel research agents (`DECISIONS-utah.md`, `DECISIONS-practice-sources.md`,
`DECISIONS-belief-sources.md`) are merged in at the end once those finish.

## Corrections to the original task prompt

The task prompt made a few claims about this codebase that turned out to be wrong on
inspection. Noting them here rather than silently working around them:

1. **"Existing backend/passcode auth setup used by the Calendar/Journal rooms"** — no such
   rooms or backend exist in this repo. There is no server-side backend at all (this project
   is intentionally static/serverless — see ROADMAP.md). The real existing cross-device
   mechanism is the `life-hub-sync.json` bundle (File System Access API on desktop,
   Export/Import fallback on iOS) plus a shared `life-hub-shared-handles` IndexedDB store for
   folder handles, used by Video Log / Nest of Knowledge / Beat Maker / Knowledge Center's
   "Log to Obsidian" feature. New progress/settings from this rebuild plug into *that* system
   instead of an imagined passcode backend.

2. **A "guided Hanafi prayer" feature already exists** (committed 2026-08-24, `data/salah/hanafi.json`,
   wired into `room.html`'s prayer overlay) — a full Sunni-Hanafi posture/phrase walkthrough with
   its own careful sourcing discipline. This directly conflicts with this task's Twelver Shia framing.
   **Asked the user** how to handle it — answer: **keep both, clearly separated.** The Hanafi
   walkthrough stays untouched as its own labeled path; a new Jafari/Shia walkthrough is added
   alongside it, and the room's tradition/school selector picks which one loads. Nothing about
   either implies the other is being corrected or deprecated.

3. **Knowledge Center is not a blank slate.** It already has a "My Path" feature: five
   structural placeholder "teachings" the user fills in by hand (one, "Patience (Sabr)" /
   Quran 2:153, already has real user-entered content — `isPlaceholder: false`), a "Quran Map"
   view, and JSON/Markdown export tied into the same Obsidian vault-writing system. This is a
   manual curation tool, not the sourced-curriculum system this task asks for. **Decision:**
   leave "My Path" and "Quran Map" completely alone (including the one real entry already in
   it) and add the new Practice/Belief tracks as new, separate toolbar views, so nothing the
   user already typed in gets touched or reorganized.

4. **`data/curriculum/` already exists but is the Language Hub's namespace** (Farsi/Arabic/Spanish
   lesson data, audio, worksheets) — unrelated to this task. New data lives under **`data/deen/`**
   instead, to avoid any collision.

## Architecture decisions

- New data root: `data/deen/curriculum.json`, `data/deen/knowledge-base.json` (or split further —
  see below once content lands), `data/deen/utah-resources.json`, `data/deen/sources.json`.
  Research agents write intermediate `_research-*.json` files here first; those get folded into
  the final curriculum files and deleted once merged (not shipped as-is).
- Prayer time engine: replacing the existing hand-rolled solar-position math in `room.html`
  (ISNA angles + hardcoded Hanafi Asr factor, hardcoded Salt Lake City lat/lon) with the real,
  tested **adhan.js** library (batoulapps/adhan-js), vendored locally at `lib/adhan.umd.min.js`
  (matches this project's existing no-CDN-at-runtime convention — see `travel-world/lib/three.module.min.js`)
  rather than loaded from unpkg at runtime.
  - adhan.js ships named methods (MuslimWorldLeague, Egyptian, Karachi, UmmAlQura, Dubai, Qatar,
    Kuwait, MoonsightingCommittee, Singapore, NorthAmerica, Tehran, Turkey, Other) — confirmed via
    the library's own METHODS.md. **It does not ship a method literally named "Jafari."** Its own
    docs call Tehran (Institute of Geophysics, University of Tehran — Fajr 17.7°, Isha 14°,
    Maghrib 4.5°) the closest built-in Shia-associated option.
  - The commonly published **Jafari method (Shia Ithna Ashari, Leva Institute, Qum)** uses
    Fajr 16°, Isha 14°, Maghrib 4° — confirmed via aladhan.com/calculation-methods and
    praytimes.org/calculation (both independently describing the same named method/institute).
    Implemented this as an explicit `CalculationMethod.Other()` parameter set (adhan.js supports
    custom angles) rather than approximating with Tehran, since the real published numbers were
    findable and citable. Labeled in the UI as "Jafari (Shia Ithna Ashari)" with the source
    named, not silently presented as an adhan.js built-in.
  - Asr: Jafari/Shafi'i shadow factor = 1 (adhan.js `Madhab.Shafi`); kept Hanafi's existing
    factor-2 behavior (`Madhab.Hanafi`) intact for the untouched Hanafi walkthrough's own timing.
  - Location is now a stored, user-editable Utah city (lat/lon), not hardcoded — see UI section.
- Hijri date: using the browser's built-in `Intl.DateTimeFormat` with the Islamic calendar
  (`islamic-umalqura` — Umm al-Qura, algorithmic/astronomical, not hand-rolled arithmetic) rather
  than vendoring a separate hijri library, since modern Chromium (this project's target browsers
  per its own device-sync notes) ships this natively via ICU. **Caveat surfaced in-app, per the
  task's own instruction:** real lunar months are set by moon sighting and can legitimately run a
  day ahead or behind any calculated calendar, Shia sighting committees included — displayed date
  is a calculated estimate, not an announcement.
- Design tokens: **extended, not replaced**, `design-system/tokens.css`. The existing palette
  file has a standing rule ("no figurative imagery, no calligraphy/religious text, no crescent-
  and-star") written for the *shared* cross-room system (Travel World, Nest of Knowledge, etc.).
  This task explicitly asks for shrine-architecture color (Najaf/Karbala/Kazimayn gold-turquoise-
  cobalt), calligraphic-style linework, and verified Arabic script for *this* room specifically.
  New tokens are added under their own clearly-commented section, scoped to the Shia practice/
  study rooms, rather than changing the shared tokens other rooms rely on. The "never depict the
  Prophet or any Imam visually" rule is absolute and applies everywhere, same as before.

## Outstanding as of this writing

All three research agents (Utah resources, Practice-track sourcing, Belief/History sourcing)
reported back and were merged into `data/deen/curriculum.json` / `data/deen/utah-resources.json`.
Their full fetch logs are preserved in `DECISIONS-utah.md`, `DECISIONS-practice-sources.md`, and
`DECISIONS-belief-sources.md` (kept as standalone files rather than pasted inline here, since
each is a substantial sourcing audit trail in its own right).

Only two entries in the final curriculum are `needs_source: true` (empty body, per the hard rule
of never asserting unsourced content):
- `practice-s1-new-muslim-guidance-gap` — "What a new Muslim should specifically do after saying
  the shahada." No source found/fetched for this specific question in this pass.
- `practice-s5-sawm-menstruation-travel-gap` — "Fasting rules for menstruation and travel." Same;
  a `risalah` ruling exists but wasn't fetched in this pass.

Known real gaps, carried forward for a future session:
- **No full step-by-step Jaʿfarī guided-prayer walkthrough** (the equivalent of
  `data/salah/hanafi.json`) exists yet. `room.html`'s prayer overlay shows an honest
  "not built yet" placeholder under Jaʿfarī and links to the Knowledge Center's Practice track
  instead of faking the depth. The practice track's `salah-s3-*` entries (niyyah through salam)
  now cover the same ground chapter-by-chapter with real per-step sourcing, so a future pass could
  restructure those into a `data/deen/salah-jafari.json` in the Hanafi file's shape rather than
  re-researching from scratch.
- **`belief_shia_sunni_divergence` is asymmetrically sourced** — see
  `DECISIONS-belief-sources.md` for the full explanation. The Shia side is live-fetched and cited;
  the Sunni side (Saqifah, shura, ijma, the common reading of "mawla" at Ghadir Khumm) is the
  researcher's own descriptive summary of uncontroversial Sunni-historical facts, not drawn from a
  fetched Sunni-authored source. Recommended follow-up: fetch a mainstream Sunni source for that
  paragraph specifically if it should be held to the same live-fetched bar as everything else.
- **Muharram mode wired up (2026-08-28).** `room.html` now checks the browser's own Hijri
  calendar (`isMuharramActive()`, same Umm al-Qura source as the date strip) every time
  `applyTimeOfDay()` ticks (once on load, then every 60s); on the first ten days of Muharram it
  sets `[data-muharram="on"]` on `<html>` (which mutes `--gold-bright`/`--ember` to
  `--muharram-gold-muted`) and mixes the live-blended sky/mountain colors 60% toward
  `--muharram-black`/`--muharram-green` instead of replacing them outright — so the real
  day/night cycle still shows through, just dimmed for the occasion. Verified the ICU month-name
  format and day-boundary logic against real dates (Muharram 1–10, 1447 AH ≈ 2025-06-26 through
  2025-07-05) in Node directly; the in-browser visual check couldn't be completed this session
  because the Chrome extension connection dropped mid-session — worth a quick look next time the
  room is open during Muharram, or by temporarily forcing `isMuharramActive()` to return `true`.
- Utah resources: only 2 independently-corroborated physical Twelver Shia centers exist in the
  state (both Salt Lake Valley). See `DECISIONS-utah.md` for the full verification method and the
  address/denomination discrepancies flagged for Al-Zahra Islamic Center.
