# Architecture Notes — data model & sync, for next session

Written during overnight maintenance (2026-08-24) instead of building any sync
code, per instruction. Covers what's actually in the codebase right now, so
the backend/sync design conversation can start from real facts.

## Important: cross-device sync already exists (serverless)

Before reading the data inventory below: a "Sync Across Devices" panel
already shipped in `nest-of-knowledge.html` (committed 2026-08-23, see
`git log --oneline | grep -i sync`). It bundles every room's localStorage
data into one `life-hub-sync.json`, merges by unioning each collection's
items by id, and moves the file via either a one-time File System Access API
folder connection (desktop Chrome/Edge) or manual Export/Import (iOS Safari,
which has no such API) — both pointed at the same iCloud Drive/Dropbox
folder so the file itself stays in sync without AirDrop or email.

This solves **personal cross-device sync** (one person, multiple devices)
entirely within the static/serverless model. It does **not** solve
**multi-user collaboration** (several different people editing the same
Beat Maker project live) — that's a different, harder problem: it needs
real-time transport and at least lightweight accounts so the app knows who's
who, which a synced JSON file can't provide. The original Platform Roadmap
note's "real backend + accounts" line was written with that collaboration
goal in mind, not the personal-sync problem, which is why it's worth
re-scoping before designing anything: **decide first whether tonight's
solved problem (personal sync) is actually enough for now, or whether
multi-user collaboration is a live near-term goal** — that answer changes
the whole design.

If multi-user collaboration *is* still wanted, `local-server.js`'s current
shape (below) is nowhere close — it would need to become a real API server
with persistent storage and some notion of identity, not an extension of
the static file server.

## `local-server.js` — current capabilities

Zero-dependency Node `http` server, no framework. ~60 lines. Serves static
files from the repo root over `http://localhost:5500`, MIME-typed by
extension (html/js/css/json/images/audio/video/fonts). Redirects `/` to
`/home.html`. No routing, no API endpoints, no persistence, no auth — it
exists solely so `fetch()`-dependent rooms (Video Log, Travel World) and
IndexedDB work correctly, since those fail under a bare `file://` URL. Not
started automatically; run manually (`node local-server.js` or double-click
`Start Local Site.bat`) for local testing, not used in production —
production is GitHub Pages, which serves the same static files with no
server-side code at all.

## Data inventory — what each room stores, and where

All storage is `localStorage` (small structured data) or `IndexedDB` (larger
blobs: audio, images, video). Everything is same-origin, so any room's script
can technically read any other room's localStorage key directly (several
already do, e.g. Nest of Knowledge's "Life at a Glance" reads every room's
data for its dashboard) — there's no per-room isolation boundary today.

| Room | localStorage key(s) | IndexedDB | Shape notes |
|---|---|---|---|
| home.html | `home-habits-v1`, `home-streak-v1` | — | habits: `{habits:[{id,name}], completions:{isoDate:[habitId,...]}}` |
| Finance Hub | `room-finance-hub-v1` | — | `{budget:{transactions:[{id,type,amount,date,description}], goalTarget}}` |
| Language Hub | `room-language-hub-v1` | — | `{sessions:[{date,seconds,skillId}], videoJournal:[...], library:[{id,title,type,url,languageId}]}` |
| Knowledge Center | `room-knowledge-center-v2` | — | `{entries:[...], unlockedCount}` — Quran-study path progress |
| Content Hub | `content-hub-cards-v1`, `content-hub-notes-v1` | `content-hub-media` (files store, blob per card) | cards reference media by id, not inline |
| Beat Maker | `beat-maker-banks-v2` (live; `-v1` is an abandoned migration source, don't sync it), `beat-maker-pad-collections-v1` (live; `beat-maker-pads-v1` likewise abandoned), `beat-maker-bank-lock-v1`, `beat-maker-radio-tray-v1`, `beat-maker-sequencer-v1` | `beat-maker-db` (`samples`, `beats` stores, audio blobs) | patterns/sequences are localStorage; actual audio is IndexedDB |
| Video Log | `video-log-editor-v1` (editor draft) | media referenced by filename in `/video-log/media/`, not blobbed | `{entries:{month:{day:{title,did,watched[],spoke[],listened[],learned,media[]}}}}`; `video-log/data.json` is the *published* snapshot `index.html` fetches — editor's localStorage and this file are not auto-synced, Export/Import bridges them manually |
| Nest of Knowledge | reads everything above (read-only) for its dashboard; own key: `life-hub-obsidian-log-count` (a counter) | — | also `life-hub-shared-handles` IndexedDB stores FileSystemDirectoryHandles for the notes folder and (new) sync folder, keyed by purpose id |
| Travel World | own destination data under `travel-world/destinations/*/info.json` (static files, not localStorage) | — | not part of the localStorage sync bundle at all |

**Deliberately excluded from any sync/backup mechanism, security-sensitive:**
`life-hub-anthropic-api-key`, `life-hub-spotify-client-id`,
`life-hub-spotify-pkce-verifier`, `life-hub-spotify-tokens` — these are
per-device credentials and shouldn't end up in a file that leaves the
device, synced or not.

## Obsidian bridge (read-only, one-way, do not touch the plugin or reverse this)

`nest-of-knowledge/synced-notes/notes/*.json` is written by the
`obsidian-plugin/nest-of-knowledge-sync` plugin — Obsidian is source of
truth, the sync is one-way (Obsidian → this bridge folder), and nothing in
this repo writes back into the vault except the explicit "Log to Obsidian"
buttons in various rooms (Finance Hub, Language Hub, Knowledge Center, Video
Log, Beat Maker), which write *new* notes, never edit synced ones.

**Found but not fixed (out of scope tonight, flagging for awareness):** the
synced note files' filenames don't match their own `title`/`content`
fields — e.g. `Markdown_Design System.json` actually contains the "Video Log
UI Mismatch" note, `Markdown_Video Log UI Mismatch.json` actually contains
the "Learned Tab Style Guide" note, and so on, consistently shuffled across
every file in that folder. The JSON *content* is trustworthy (title/content
fields are internally consistent), only the filename-to-title mapping is
wrong — looks like a bug in the sync plugin itself, not a one-off. Worth a
look next session since it could make notes hard to find by filename, but
it's inside `obsidian-plugin/` territory and wasn't touched per instruction.
