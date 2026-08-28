# Utah Shia Resources — Sourcing/Verification Log

Date: 2026-08-25
Scope: Real, currently-operating Twelver Shia centers/mosques/orgs in Utah (SLC area), plus reputable online classes for absolute beginners. Web-only research, no local calls made.

## Method

For every candidate: (1) find it via web search, (2) fetch its own website directly when possible, (3) cross-check address/phone/denomination against at least one independent source (directory, news article, or social page), (4) only mark "verified" if the org's own current site or a clearly dated independent source confirms it's operating. Conservative bias: excluded anything I couldn't independently corroborate rather than padding the list.

## Physical centers — searched

Queries run: "Shia mosque Salt Lake City Utah", "Ahlul Bayt center Utah Shia community", "Twelver Shia Islamic center Utah", "Utah Shia Muslim community association Husseini Ashura Salt Lake", "Al-Rasool Islamic Center Taylorsville Facebook events 2026".

### Confirmed: Al-Rasool Islamic Center (AIC), Taylorsville, UT
- Fetched https://aicutah.org/about/ directly — states founded 1998 by Shia Muslims, current facility since 2008, address 1247 W 4800 S, Taylorsville, UT 84123, phone 801-512-0441.
- Cross-checked: active Facebook page (facebook.com/Alrasoolislamiccenter/), active Instagram (@alrasoolcenter), listed as a participant on the National Fund for Sacred Places (fundforsacredplaces.org), and named in a KSL.com news article about local Ashura commemorations. Multiple independent, differently-dated sources agree — high confidence this is real and currently active.

### Confirmed: Al-Zahra Islamic Center, South Salt Lake, UT
- Fetched https://www.alzahrautah.org/ directly — confirms Shia affiliation ("Learn Shia" nav section), address, phone, active building-fund campaign (goal by 2026, i.e. forward-looking/current).
- Cross-checked address/phone against barakahnetwork.com (independent mosque directory): agrees on 3832 S Main St, South Salt Lake, UT 84115 and (801) 979-7753.
- Cross-checked Shia affiliation against wocoshiac.org (World Council of Shia Centers, a Shia-specific directory) — confirms Shia, but this source's phone number (801-599-8788) did not match and could not be independently corroborated, so it was not used.
- Flagged discrepancy: Zabihah.com (a general mosque-finder site) labels this center's denomination "Sunni," which conflicts with the center's own site and the Shia-specific directory. Treated the official site + Shia-specific directory as authoritative; documented the conflict in the JSON notes so downstream consumers aren't misled by either source alone.
- Flagged discrepancy: the org's own site lists "3823 S. Main St" (likely a typo) vs. "3832" everywhere else (Yelp title, Barakah Network, Prayers Connect). Used the majority-corroborated "3832."

### Excluded: Islamic Society of Greater Salt Lake (ISGSL / utahmuslims.com)
- Came up repeatedly in searches, but is a general/mixed community mosque, not established as Shia-specific in anything I could fetch. Facebook page fetch returned no address/phone/sectarian info. Excluded rather than risk mislabeling a non-Shia mosque as a Shia resource. Listed in "unconfirmed."

### Not pursued further (clearly general/Sunni-oriented, not relevant to a Shia-specific list)
Muslim Community Center of Utah, Utah Islamic Center, Al-Huda Islamic Center, Khadeeja Islamic Center, Utah Valley Islamic Center, Utah Muslim Civic League — these are general Muslim community orgs; none surfaced any Shia-specific framing, so they were not chased down further (would be off-topic for this list even if verified).

## Online classes/teachers — searched

Queries run: "online Twelver Shia Islamic studies classes for beginners", "Islamic Seminary of America Shia online courses", "Al-Islam.org courses beginners Shia", "Zaynab Academy Shia online beginner course", "Mainstay Foundation Shia online Islamic studies course", "Imam Sadiq Academy free Shia courses beginners review", "Ahlul Bayt beginner course convert new Muslim Shia online free".

### Confirmed: The Mainstay Foundation (mainstay.us)
- Fetched https://www.mainstay.us/category/courses/ and https://www.mainstay.us/2026/08/20/fall26/ directly. Real nonprofit with a physical office (Dearborn, MI), listed phone/hours, Fall 2026 course announcement dated 2026-08-20 (i.e., currently active as of this research). "Foundations of Islamic Beliefs" course explicitly states no prior study required. Courses run both in-person and virtual, so usable by a Utah-based beginner. No pricing shown on the page — noted as a gap to confirm before recommending.

### Confirmed: Imam Sadiq Academy (imamsadiq.ac)
- Fetched https://imamsadiq.ac/en/classes?free=on and https://imamsadiq.ac/en/pages/about directly. Explicitly Twelver Shia (references Imam al-Mahdi, "the true Shia faith"). Free courses with named instructors, including "Learning Qur'an for Beginners" and "Islamic Beliefs (Aqaid)." Caveat noted: visible enrollment activity dated back to 2020 with no more-recent timestamp visible on the fetched page, so I could not directly confirm how recently the course library itself was updated (the organization's homepage/about page did load normally, which is why I still count the org as active, but flagged the course-freshness caveat in the JSON).

### Confirmed (as a reference library, not live classes): Al-Islam.org
- Direct fetch of al-islam.org returned HTTP 403 to the automated fetch tool (likely bot-blocking), so I verified via its Wikipedia entry (Ahlul Bayt Digital Islamic Library Project) instead, which confirms the site is operational, Twelver Shia, and a large free digital library. Included with an explicit note that this is self-study reading material, not instructor-led classes, since the task requires accuracy about what's actually offered.

### Excluded: The Islamic Seminary of America (TISA / islamicseminary.us)
- Verified real and active (2025-27 catalog, live semesters), but course content fetched (courses.islamicseminary.us) showed no Shia-specific framing (no mention of Twelver Islam, Ahlul Bayt, Imamate) and available on-demand courses are advanced-level (Aqidah, Akhlaq), not beginner-appropriate. Put in "unconfirmed" for ambiguous sectarian fit rather than assuming it's Shia.

### Excluded: Zaynab Academy Online
- Confirmed real and active, but its own materials state it teaches within the Sunni tradition ("Ahl al-Sunnah wal-Jama'ah"), which fails the Twelver-Shia-or-neutral requirement. Excluded, not included as "neutral."

### Excluded: cluster of "Shia Quran Academy" commercial tutoring sites
- A large number of near-identical template sites surfaced (alshiaquranacademy.com, onlineshiaacademy.com, shiaquranacademyonline.com, ahlulbaytquran.com, learnshiaquran.com, shiaonlinequranclass.com, shiahoza.com, alkosaronlinequranacademy.com, shiaseminary.com, shiaquranteacher.com, hubbealionlinequranclass.com, and more). These read as a marketing-template network (the same pattern is common among generic paid Quran-tutoring mills, Sunni and Shia alike) with no independently verifiable institutional backing, named/credentialed scholars, or third-party reviews found in search results. Rather than picking one arbitrarily and calling it "reputable," I excluded the entire cluster and noted it as a single unconfirmed group so the app doesn't present unvetted paid tutoring as vetted.

## Net result
- 2 confirmed physical centers (both Salt Lake City area, both independently corroborated).
- 3 confirmed online resources (1 nonprofit org with live/virtual classes, 1 free Shia academy, 1 reference library — clearly labeled as such).
- 4 unconfirmed entries with reasons, including one that represents a whole cluster of unverifiable commercial sites rather than listing each individually.

## Biggest caveat for anyone relying on this list
Utah has only two independently-corroborated Twelver Shia physical centers, both in the Salt Lake Valley (Taylorsville and South Salt Lake) — there is no confirmed presence anywhere else in the state (e.g., Utah County, St. George, Park City). A beginner outside the SLC metro will have no local option from this list and should rely on the online resources. No phone number was actually dialed and no address was physically confirmed — all verification here is website/directory/news-based, so a user should call ahead before visiting in person, especially given the noted address/phone discrepancies for Al-Zahra Islamic Center.
