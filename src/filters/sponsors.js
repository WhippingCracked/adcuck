/* AdCuck - what SponsorBlock can skip, and what is on to begin with.
 *
 * DELIBERATELY NOT PART OF THE FILTER LIST.
 *
 * This used to live inside filters.js. Nothing was ever wrong with the
 * behaviour - the published feed never carried these and the updater writes
 * to a different storage area entirely - but "your skip settings live in the
 * file we push to everyone" is a sentence that should not be true, and a
 * layout that invites a mistake eventually gets one. Someone edits the wrong
 * array, or a future feed grows a field, and a filter push starts changing
 * what people's players skip.
 *
 * So it sits here instead, in a file the feed builder does not read and the
 * update client cannot write. test/sponsors.mjs holds that line: it fails if
 * a sponsor setting ever appears in the built feed.
 *
 * These are DEFAULTS - what a brand new install starts with. Once someone has
 * chosen for themselves, their choice is in chrome.storage.sync and nothing
 * here is consulted again.
 *
 * Isolated-world global: not visible to youtube.com's own scripts.
 */
var CB_SPONSORS = {
  minVotes: 0,

  /* Everything SponsorBlock can label, with what to call it and whether it is
   * on to begin with. Only actual advertising defaults to on - intros, outros
   * and tangents are the creator's own video, and skipping those uninvited
   * would surprise people.
   *
   * The highlight is not in here: it is not a thing to skip, it is the moment
   * everyone scrubs forward to, and it has its own switch.
   *
   * The on/off values must match DEFAULT_CATEGORIES in
   * src/background/sponsors.js - one list is what the popup draws, the other
   * is what the background asks for before the popup has ever been opened.
   * test/sponsors.mjs fails if they drift apart. */
  available: [
    { id: "sponsor", label: "Sponsors", on: true },
    { id: "selfpromo", label: "Self-promotion", on: true },
    { id: "interaction", label: "Subscribe reminders", on: true },
    { id: "intro", label: "Intros", on: false },
    { id: "outro", label: "Outros and endcards", on: false },
    { id: "filler", label: "Tangents and filler", on: false },
    { id: "music_offtopic", label: "Non-music sections", on: false },
    { id: "preview", label: "Recaps and previews", on: false }
  ]
};
