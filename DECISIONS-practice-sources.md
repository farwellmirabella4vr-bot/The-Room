# Practice track (Track A) sourcing — decisions and fetch log

Scope: shahada, taharah/wudu, salah mechanics, praying without Arabic yet, fasting, khums/zakat.
Output: `data/deen/_research-practice.json` (14 entries).

## What worked

sistani.org fetches directly (no blocking observed):
- `/english/book/48/` — table of contents, confirmed real chapter URL structure.
- `/english/book/48/2147/` — Islam/shahadatayn, Ruling 205, quoted verbatim.
- `/english/book/48/2118/` — Purification chapter overview.
- `/english/book/48/2154/` — Ablution overview, Rulings 235–259.
- `/english/book/48/2157/` — Laws of Wudu (doubts), Rulings 298–314, Ruling 299 quoted verbatim.
- `/english/book/48/2208/` — Obligatory Daily Prayers, structure/rakah counts near Ruling 716.
- `/english/book/48/2277/` — Fasting chapter intro.
- `/english/book/48/2279/` — Things that invalidate a fast, Ruling 1551, full list captured.
- `/english/book/48/2305/` — Khums chapter, Ruling 1768.
- `/english/book/48/2314/` — Zakat chapter, Ruling 1871.
- `/english/book/48/2315/` — Conditions for zakat, Rulings 1872–1879.

al-islam.org: direct WebFetch of specific article/media/ask pages consistently returned **HTTP 403** (tried `/media/how-pray`, `/media/shahadah-understanding-testimony-faith`, `/ask/if-i-dont-yet-know-arabic-...`, `/articles/laws-practices-how-perform-daily-prayers` — all blocked). WebSearch still surfaced real titles/URLs and short snippets for these same pages, so they're cited by verified URL + title, with body text written as an honest paraphrase of the snippet rather than a quotation. If a future session has a way to actually fetch al-islam.org (different tool, or the block lifts), these should be revisited and, where useful, given verbatim quotes with page-section references.

## needs_source: true (left with empty body, per the hard rule)

- **tayammum-01** (`sistani.org/english/book/48/2195/`) — confirmed the URL/title exist via the book/48 table of contents, but did not fetch the page's actual ruling content in this pass, so no ruling detail is asserted. Real URL, unverified content — next pass should fetch it directly.
- **salah-02** ("Full step-by-step walkthrough — not yet built") — no source at all. See "Biggest gap" below.

## Biggest gap

The mega-prompt calls for "the mechanics of salah step by step." `data/salah/hanafi.json` (the existing Hanafi guided-prayer feature) is a ~40-entry phrase-by-phrase walkthrough (each posture and each recited phrase, with Arabic, transliteration, meaning, and a real ruling/source per line) — reproducing that same depth for Jafari fiqh from Sistani's risalah would take a comparable number of individual page fetches (each phrase and posture has its own ruling or is scattered across several), which is out of scope for this sourcing pass alone. What's delivered here is the chapter-level skeleton (rakah counts, which chapter covers what) plus the two topics the mega-prompt specifically named outside the core step sequence (Arabic-fallback guidance, tayammum). A dedicated follow-up pass building `data/deen/salah-jafari.json` in the same shape as `hanafi.json` — fetching sistani.org's actual dua/tashahhud/tasbih rulings phrase by phrase — is the right next step before the Knowledge Center's salah entry can go beyond an overview card.

## marja_specific flagging

Marked `true` on anything where the specific wording/threshold/ordering came from Sistani's risalah specifically (wudu steps and doubts, fasting invalidators, khums/zakat rulings and thresholds) since another marja's risalah may state these differently. Left `false` on genuinely cross-marja-agreed facts (five daily prayers exist with these rakah counts; what the shahada conceptually means; general Arabic-fallback guidance) and on pure chapter-overview entries that don't assert a specific ruling.
