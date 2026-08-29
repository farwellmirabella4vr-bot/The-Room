# tools\book-video — video-sourced Spanish curriculum pipeline

Turn a video that flips through every page of a Spanish textbook into a
structured curriculum module for the Language Hub, shaped like the existing
Farsi module (`data\curriculum\fa\rw-farsi.json`).

Six stages. **Each stage is a separate script you run one at a time**, so you
can check the output before continuing. Slow is fine. Nothing later in the
pipeline runs until you've reviewed and confirmed the structure by hand
(Stage 5).

Run every command from the repo root: `C:\Projects\dev-team`
Open PowerShell there (in File Explorer, type `powershell` in the address bar
while inside `C:\Projects\dev-team`).

---

## What's in this folder

| File | What it is |
|---|---|
| `1-check-setup.js` | Stage 1 — checks tools are installed, prints exact install steps |
| `2-extract-frames.js` | Stage 2 — video → one image per page in `frames\` |
| `3-ocr-pages.js` | Stage 3 — OCR each frame → `ocr\`, build `pages.json` + a sequence report |
| `4-extract-structure.js` | Stage 4 — Anthropic API reads the OCR text → `book-structure.json` |
| `5-review-server.js` + `review-ui.html` | Stage 5 — local review page; you fix things and confirm |
| `6-build-module.js` | Stage 6 — confirmed structure → `data\curriculum\es\<name>.json` |

Created as you go (all git-ignored):
`frames\`, `ocr\`, `pages.json`, `page-sequence-report.txt`,
`book-structure.json`, `book-structure.confirmed.json`, `.batches\`.

---

## Stage 1 — Setup

```powershell
node tools\book-video\1-check-setup.js
```

It changes nothing. It tells you, line by line, what's installed and what
isn't, and prints copy-paste install steps for anything missing. On your
machine right now: **ffmpeg and Node are already installed**; you need
**Tesseract OCR + the Spanish pack**, and (only for Stage 4) an
**`ANTHROPIC_API_KEY`**.

### Install Tesseract OCR + Spanish

Fastest (no admin prompt for the engine):
```powershell
winget install --id UB-Mannheim.TesseractOCR -e --accept-package-agreements --accept-source-agreements
```
This installs the engine to `C:\Program Files\Tesseract-OCR` but **without**
the Spanish data. The Stage 3 script auto-finds `tesseract.exe` even if it's
not on PATH, and it looks for Spanish in `tools\book-video\tessdata\` — so
just drop the language file there (no admin needed):
```powershell
mkdir tools\book-video\tessdata
curl.exe -L -o tools\book-video\tessdata\spa.traineddata https://github.com/tesseract-ocr/tessdata_best/raw/main/spa.traineddata
```

Or use the GUI installer from <https://github.com/UB-Mannheim/tesseract/wiki>
and tick **Spanish** under "Additional language data" during setup; then add
`C:\Program Files\Tesseract-OCR` to PATH and restart the terminal.

Verify either way:
```powershell
node tools\book-video\1-check-setup.js
```

### Set your Anthropic API key (Stage 4 only — you can do this later)

Get a key at <https://console.anthropic.com/> → Settings → API Keys.

```powershell
# permanent — then open a NEW PowerShell window
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "sk-ant-...", "User")

# or just for the current window
$env:ANTHROPIC_API_KEY = "sk-ant-..."
```

Verify:
```powershell
node -e "console.log(process.env.ANTHROPIC_API_KEY ? 'API key set' : 'API key MISSING')"
```

**Re-run `1-check-setup.js` in a new window until every line says OK.**

---

## Stage 2 — Frame extraction

```powershell
node tools\book-video\2-extract-frames.js "C:\path\to\your-spanish-book-video.mp4"
```

- **Pass 1** uses ffmpeg's scene-change filter to grab a frame at every page
  flip (plus the very first frame), keeping only one frame per flip via a
  minimum time gap (`MIN_SECONDS_BETWEEN_FRAMES`).
- **Pass 2** runs a dedupe (ffmpeg `mpdecimate`) as a safety net for any
  near-identical frames that still slip through.
- Output: `frames\page-000001.jpg`, `page-000002.jpg`, …
- It prints the **final frame count**. **Compare that to the real page count
  of the physical book** (flip to the last page, read the number, add any
  unnumbered front matter you filmed). Note: books are usually filmed as
  two-page spreads, so expect roughly *half* the page count in frames.

### If the count is wrong

Open `2-extract-frames.js` and edit the variables at the top, then re-run
with `--force`:

- **Too few frames / pages missing** → lower `SCENE_THRESHOLD`
  (`0.11` → `0.08` → `0.05`), or lower `MIN_SECONDS_BETWEEN_FRAMES` if fast
  flips are being skipped.
- **Too many frames / duplicates** → raise `SCENE_THRESHOLD`
  (`0.11` → `0.15` → `0.20`), or raise `MIN_SECONDS_BETWEEN_FRAMES`.
  Handheld/phone footage below ~0.08 mostly catches camera shake, not flips.
- Each variable has a comment saying which way to move it.

A few blurry mid-flip frames are fine — you'll delete those by hand in
Stage 5.

```powershell
node tools\book-video\2-extract-frames.js "C:\path\to\video.mp4" --force
```

---

## Stage 3 — OCR

```powershell
node tools\book-video\3-ocr-pages.js
```

- Runs Tesseract (`-l spa`) over every frame → one `ocr\page-XXXXXX.txt`
  per frame.
- Builds `pages.json` — for each frame, the printed page number it found
  (from the top/bottom lines of the page).
- Writes **`page-sequence-report.txt`**. **Read it.** It flags:
  - **Gaps** — page numbers jump forward → pages were missed in Stage 2.
  - **Duplicates** — the same page number on two frames → a doubled flip.
  - **Out-of-order** jumps — usually a misread number.
  - Frames with **no readable number** or almost no text.

If the report shows gaps, go back to Stage 2 with a lower `SCENE_THRESHOLD`.
Small problems (a few misreads) you can just fix in Stage 5.

Re-running is cheap — existing `.txt` files are reused. Force a full re-OCR
with `--force`.

---

## Stage 4 — Structure extraction (uses the Anthropic API)

```powershell
node tools\book-video\4-extract-structure.js
```

Sends the OCR text to the Anthropic API in batches and writes
**`book-structure.json`**: chapter titles, section headings, the page range
of each, the grammar/vocabulary topic of each section, and the count + type
of exercises in each.

**Three hard rules — in the system prompt and re-enforced in code:**

1. Every chapter / section / exercise carries the **page number** it was read
   from. No page number → the field is `null` and the item goes on an
   `unresolved` list.
2. **Only what's in the OCR text.** No guessing, no filling in from general
   knowledge of Spanish textbooks. The code re-checks every page number
   against the pages you actually OCR'd and strips ones it can't.
3. **No book content stored** — no passages, no exercise wording, no
   explanations. Titles, short topic labels, and counts only. The video stays
   your source for the actual content.

Cheap test run first:
```powershell
node tools\book-video\4-extract-structure.js --limit 2
```
Finished batches are cached in `.batches\`, so a re-run only pays for what
failed. `--force` redoes everything. To use a cheaper model, edit `MODEL` at
the top of the script.

---

## Stage 5 — Review

```powershell
node tools\book-video\5-review-server.js
```

Opens a local page (`http://localhost:4599/`) — nothing leaves your machine.
Left side: the extracted structure, every field editable. Right side: the
source frame. Click into any page-number box and the frame jumps to that
page.

- Fix wrong titles, page numbers, topics, exercise counts.
- Clear each **unresolved note** once you've checked it against the frame.
- **Save draft** → overwrites `book-structure.json` (stop and come back
  later).
- **Confirm & write confirmed file** → writes
  **`book-structure.confirmed.json`**.

**Stage 6 will not run until `book-structure.confirmed.json` exists.**

Press `Ctrl+C` in the PowerShell window to stop the server.

---

## Stage 6 — Curriculum module

```powershell
node tools\book-video\6-build-module.js --name "Your Module Name"
```

Builds `data\curriculum\es\<name>.json` from the confirmed structure and adds
it to `data\curriculum\index.json`. Same shape as the Farsi module:

- one **unit** per chapter, in page order;
- one **lesson** (“a study day”) per section, each with a **daily
  objective**, **homework** tasks (all *“in your notebook”* — no worksheets
  are generated), and a **study** task pointing at the video;
- a **checkpoint** per unit = the **unit test**;
- **pace-based estimates** — minutes per lesson, days/weeks total — and
  **no calendar dates**;
- every unit carries its **book page range**.

Options:

| Option | Default | |
|---|---|---|
| `--name "..."` | *(required)* | the module name — **you choose it** |
| `--id es-my-slug` | slug of `--name` | module id |
| `--pace relaxed\|normal\|intensive` | `normal` | changes minutes/lesson and the week estimate |
| `--book` `--authors` `--publisher` `--isbn` `--pages` | placeholders | book metadata (the OCR can't read these reliably — fill in from the video) |
| `--passmark 80` | `80` | unit-test pass mark |
| `--force` | | overwrite an existing module with the same id |

After it runs, open `data\curriculum\es\<name>.json` and set the `authors` /
`publisher` placeholders. Then start the local site (`Start Local Site.bat`),
open `language-hub.html`, and go to the **Curriculum** tab — the new module
appears on the shelf.

---

## Redoing part of it later

- New/adjusted thresholds → re-run **Stage 2 `--force`**, then 3, 4, 5.
- Just a few structure fixes → edit in **Stage 5** and re-confirm, then
  re-run **Stage 6 `--force`**.
- Cheaper/different extraction model → edit `MODEL` in `4-extract-structure.js`,
  delete `.batches\`, re-run Stage 4.

## Copyright

`frames\` and `ocr\` hold content from a copyrighted book (your own video).
They're git-ignored, like the project's other textbook-derived folders. The
only thing committed is the finished module in `data\curriculum\es\`, which
by design contains structure and topic labels only — not book content.
