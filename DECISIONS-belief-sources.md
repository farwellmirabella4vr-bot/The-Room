# Belief & History Track (Track B) — Sourcing Decisions Log

Research pass for `data/deen/_research-belief.json`, covering the five roots of religion (usul al-din), the Ahlul Bayt, Ghadir Khumm, the Twelve Imams, Karbala/Ashura, and a descriptive Shia/Sunni divergence entry.

All content below was produced by live browser fetches (`al-islam.org` blocks the automated WebFetch tool with HTTP 403, so the Chrome browser tool was used instead to actually load and read each page). No Qur'an ayah or hadith wording was written from memory; where an entry's `arabic` field is non-empty, that exact text was copied from a page fetched during this session and cited to that URL. Where a topic could only be grounded in English-translated Qur'an/hadith text on the fetched page (no Arabic script present), the `arabic` field was left blank rather than reconstructed from memory.

## Fetch log

| # | URL | Method | Result | Used for |
|---|-----|--------|--------|----------|
| 1 | al-islam.org/principles-faith-usul-al-din-husayn-wahid-khorasani/divine-unity-tawhid | WebFetch | 403 Forbidden | — |
| 1b | (same URL) | Chrome browser navigate + get_page_text | Success — full chapter text read | belief_tawhid |
| 2 | al-islam.org/principles-faith-usul-al-din-husayn-wahid-khorasani/common-prophethood-nabuwwat-ammah | WebFetch | 403 Forbidden | — |
| 2b | (same URL) | Chrome browser | Success — full chapter text read | belief_nubuwwah |
| 3 | al-islam.org/principles-faith-usul-al-din-husayn-wahid-khorasani/divine-justice-adl | WebFetch | 403 Forbidden | — |
| 3b | (same URL) | Chrome browser | Success — full chapter text read | belief_adalah |
| 4 | al-islam.org/principles-faith-usul-al-din-husayn-wahid-khorasani/return-maad | WebFetch | 403 Forbidden | — |
| 4b | (same URL) | Chrome browser | Success — full chapter text read | belief_maad |
| 5 | al-islam.org/origins-and-early-development-shia-islam-sayyid-husayn-muhammad-jafari/chapter-11-doctrine-imamate | WebFetch | 403 Forbidden | — |
| 5b | (same URL) | Chrome browser | Success — read as secondary/academic-historical source | belief_shia_sunni_divergence (secondary citation) |
| 6 | al-islam.org/shiite-encyclopedia/who-are-ahlul-bayt-part-1 | WebFetch | 403 Forbidden | — |
| 6b | (same URL) | Chrome browser | Success — full text read, including live Arabic Qur'an 33:33 text and Arabic hadith text from Sahih Muslim / Sunan al-Tirmidhi as quoted on the page | belief_ahlul_bayt (arabic field sourced here) |
| 7 | al-islam.org/ghadir-khumm | Chrome browser | 403 Forbidden (this specific short-URL variant) | — |
| 7b | al-islam.org/ghadir/incident.html | Chrome browser | Success — full "Event of Ghadir Khumm" page read | belief_ghadir_khumm |
| 8 | al-islam.org/principles-faith-usul-al-din-husayn-wahid-khorasani/divine-leadership-imamat | Chrome browser | Success — full chapter text read (long; includes the plain Sunni/Shia framing quoted in belief_imamah and belief_shia_sunni_divergence) | belief_imamah, belief_shia_sunni_divergence (primary) |
| 9 | al-islam.org/principles-faith-usul-al-din-husayn-wahid-khorasani/twelve-imams | Chrome browser | Success — full chapter text read, including the ordered list of the Twelve Imams with titles, and Sunni hadith citations (Bukhari, Muslim, Tirmidhi, Musnad Ahmad) on "twelve successors" | belief_twelve_imams |
| 10 | al-islam.org/articles/karbala-chain-events | Chrome browser | Success — full article read ("Karbala, the Chain of Events" by Ramzan Sabir) | belief_karbala_ashura |
| 11 | thaqalayn.net | Chrome browser navigate | Blocked — "Navigation to this domain is not allowed" by the browser extension's site permissions | — |
| 11b | thaqalayn.net | WebFetch | Success — confirmed the site is real and is described as "the comprehensive Shia library" hosting classical hadith/Qur'an/dua texts (al-Kafi, Man La Yahduruh al-Faqih, Tahdhib al-Ahkam, etc.) | Confirmed as a real, live site; not used as a citation for any specific entry (see gap note below) |
| 12 | thaqalayn.net/hadith/1 (guessed deep link) | WebFetch | 404 Not Found | — |

Several other al-islam.org search hits were reviewed via WebSearch result snippets only (not fetched as full pages) purely to decide which URL to fetch next: `al-islam.org/faith-imamiyyah-shiah-muhammad-ridha-al-muzaffar`, `al-islam.org/discovering-shii-islam-mohammad-ali-shomali/chapter-3-doctrines`, `al-islam.org/imamate-and-imams-ibrahim-amini/chapter-2-ahlul-bayt-quran-and-traditions`. None of these were used as a citation source since their full text was not read live.

## needs_source topics

None. All ten planned entries (Tawhid, Nubuwwah, Ma'ad, 'Adalah, Imamah, Ahlul Bayt, Ghadir Khumm, the Twelve Imams, Karbala/Ashura, and the Shia/Sunni divergence) were grounded in a page actually fetched and read during this session, so no entry was flagged `needs_source: true`. This is a genuine result, not a shortcut — see the gap noted below for the one place where sourcing is thinner than the rest.

## Known gap / caveat (read before shipping)

**`belief_shia_sunni_divergence` is asymmetrically sourced.** The Shia side of that entry (nass/divine designation, Ghadir Khumm, the Hadith of the Two Weighty Things) is grounded directly in the live-fetched "Divine Leadership (Imamat)" chapter, which itself states the core disagreement in neutral terms in its opening two paragraphs. The Sunni side of that entry (shura, the Saqifah proceedings, ijma, the "Rightly Guided Caliphs," and the more common Sunni reading of "mawla" at Ghadir Khumm as praise/affection rather than formal succession) is **not** drawn from a Sunni source fetched during this pass — al-islam.org and thaqalayn.net are both Shia institutional libraries and don't carry a comparable "here is the Sunni case" primary text, and finding+fetching a fair, live Sunni-authored page was out of scope for the two domains specified. That side of the entry is the researcher's own descriptive summary of well-established, uncontroversial Sunni historical doctrine (not disputed hadith wording or Qur'an text — just names, events, and terms like Saqifah/shura/ijma that are standard Islamic-history facts). No Qur'an or hadith text was invented for either side.

**Recommendation before this ships:** if the user wants the Sunni side of the divergence entry held to the exact same "live-fetched, cited" bar as everything else, a follow-up pass should fetch a Sunni-authored source (e.g., a mainstream Sunni site or an academic overview) specifically for that paragraph, and the `source` field should be split or a second reference added. As written, the entry is honest about this asymmetry in its own `source.reference` field, but it's worth flagging explicitly.

**Minor note on thaqalayn.net:** the site was confirmed live and legitimate (it hosts al-Kafi, Man La Yahduruh al-Faqih, Tahdhib al-Ahkam, etc.) but the browser tool's site-permission gate blocked direct navigation, and no specific deep-linked hadith page URL could be located and verified in the time available, so it was not used as a per-entry citation. All ten entries are sourced to al-islam.org only.
