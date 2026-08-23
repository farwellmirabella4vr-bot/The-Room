# Roadmap

Where this project could grow from here. Nothing in here is built yet —
this is just the plan, staged from "basically free" to "needs a real
backend." Current priority: **daily learning + in-app reminders**, and
those are entirely in the free tier, so they can start any time.

Ground rule carried through the whole roadmap: **stay static/serverless
for as long as possible.** Only the real-time collaboration branch of
the music space actually requires a backend — everything else here can
be built as plain HTML/CSS/JS, same as every room today.

---

## Stage 1 — Free (current priority lives here)

Pure client-side work: new localStorage-backed features on existing
rooms, or a new single-file room. No new infrastructure, no accounts.

- **Daily learning, expanded.** A small daily-habit tracker (did I study,
  did I read, did I journal) alongside what Language Hub and Knowledge
  Center already track — likely folded into home.html's "Today at a
  Glance" rather than a whole new room.
- **In-app reminders.** Nudges that show up when you open the site —
  e.g. "you haven't logged today's language practice yet," "3 Knowledge
  Center notes are due for review." No push notifications, no email —
  just badges/banners driven by the data already sitting in
  localStorage. This is what "in-app only" unlocks: zero new
  infrastructure at all.
- **Spaced-repetition-style resurfacing.** Occasionally resurface an
  older Knowledge Center note or Language Hub vocab item instead of
  only ever showing the newest — plain Date math against existing data.
- **Beat Maker → "pocket sampler" redesign.** Rework the layout so it
  feels like a compact, game-like handheld sampler instead of eight
  stacked panels you scroll through — tabbed or paged screens (Pads +
  Sequencer / FX + Chop / Saved Beats + Radio), tighter and more
  tactile, leaning further into the retro-game aesthetic it already
  has. **Every existing feature stays** — this is a layout/information-
  architecture rework, not a feature cut. Also sets up a much better
  foundation for the collaboration work in Stage 3.
- **Finance Hub, deeper.** More budget categories, recurring-transaction
  templates, more chart views on top of the ones already there.

## Stage 2 — Still free, bigger lifts

Same static/serverless model, just larger builds.

- ~~**Cross-device backup via export/import**~~ — **Done (2026-08-23).**
  Built as a single "Sync Across Devices" panel in Nest of Knowledge
  rather than per-room export/import buttons: bundles habits, Finance
  Hub, Language Hub, Knowledge Center, Content Hub, Beat Maker
  patterns, and Video Log entries into one `life-hub-sync.json`,
  merged by unioning each collection's existing ids so additions from
  either device survive a sync (same-id edits on both sides: the
  more-recently-exported side wins — no per-field conflict resolution).
  On desktop Chrome/Edge, "Connect Sync Folder" gets silent read/write
  via the File System Access API, same as the existing media/notes
  folder connects. iOS Safari has no such API, so it falls back to
  Import (Files picker) / Export (download → Save to Files) — both
  pointed at the same iCloud Drive/Dropbox folder so the file itself
  stays in sync without AirDrop or email. API keys and OAuth tokens are
  deliberately excluded from the bundle; media blobs (photos, audio,
  video) stay device-local in each room's own IndexedDB.
- **Beat sharing, file-based.** Export a full beat "project" (pattern +
  referenced samples) as a bundle a friend can drop into their own
  Beat Maker and keep working on — real sharing, still zero backend,
  just a file handed off manually (like emailing someone a project
  file). This is the natural first step toward collaboration before
  committing to real infrastructure.

## Stage 3 — Needs a real backend

This is the only stage that breaks the "just static files" model. Two
independent reasons you'd end up here, listed separately since they're
not both required at once:

- **Real-time collaboration in Beat Maker** — multiple people actively
  working on the *same* project *at the same time* (not just trading
  files). Needs a real-time sync layer (something like Firebase
  Realtime Database/Supabase Realtime) and at least lightweight
  accounts so the app knows who's who. This is the expensive one — a
  genuine architecture change, not an extension of the current file.
- **Reminders that reach you outside the app** (push notifications,
  email, text) — only relevant if "in-app only" stops being enough
  later. Needs a scheduler running somewhere other than your browser,
  since a static page can't send anything while it's closed.

If/when the collaboration piece becomes a real priority, the open
question to answer first is how many people and how "live" it needs to
be — the file-based sharing in Stage 2 covers "a few people trading
beats," and only real simultaneous co-editing actually requires
Stage 3's infrastructure. Worth deciding that only once it's actually
next in line, not now.

---

## Not staged yet

Money tracking's growth beyond Stage 1/2 (e.g. linking a real bank
account) isn't laid out here in detail since it wasn't the current
priority — flag it when it becomes relevant and this doc can grow a
Stage 3 entry for it too.
