/* What must never end up in the filter list, and what is safe to add without
 * being asked.
 *
 * Adding filters automatically is only reasonable if the automatic part
 * cannot do the one thing that actually hurts. Everything that has gone wrong
 * so far went wrong the same way: something that was not an advert got added
 * because its name had an ad-ish word in it. The YouTube header bar
 * (ytd-masthead), the dot on the video scrubber (yt-progress-bar-playhead),
 * the "Includes paid promotion" disclosure. None of those are ads, and all of
 * them read like one to a name matcher.
 *
 * So this file answers two questions about each candidate:
 *
 *   1. Is it on the protected list? Then it is refused outright. Not asked
 *      about, not added - refused. The list covers page structure, the player
 *      and its controls, and the two things already taken back out by hand.
 *
 *   2. Is it unambiguously an advert? "ad", "promo" and "sponsor" in a name
 *      mean an advert essentially every time. "paid", "brand", "premium" and
 *      "offer" do not - that is where every false positive has come from - so
 *      those are set aside for a person to look at rather than added.
 *
 * Tested in test/discover.mjs against every real name this has met.
 */
import { words } from "./discover-match.mjs";

/* Page structure, the player, and its controls. Blocking any of these breaks
 * YouTube rather than cleaning it up. */
export const PROTECTED = new Set([
  /* the page itself */
  "html", "body", "ytd-app", "ytd-page-manager", "ytd-browse", "ytd-watch-flexy",
  "ytd-masthead", "ytd-masthead-container", "ytd-searchbox", "ytd-guide-renderer",
  "ytd-mini-guide-renderer", "ytd-topbar-menu-button-renderer",
  "content", "page-manager", "columns", "primary", "secondary", "container",
  /* the lists real videos live in */
  "ytd-rich-grid-renderer", "ytd-rich-grid-row", "ytd-rich-item-renderer",
  "ytd-rich-section-renderer", "ytd-item-section-renderer",
  "ytd-section-list-renderer", "ytd-shelf-renderer",
  "ytd-two-column-browse-results-renderer",
  "ytd-two-column-watch-next-results-renderer",
  /* real videos */
  "ytd-video-renderer", "ytd-compact-video-renderer", "ytd-grid-video-renderer",
  "ytd-thumbnail", "ytd-playlist-renderer", "ytd-channel-renderer",
  "ytd-watch-metadata", "ytd-comments", "ytd-live-chat-frame",
  /* the player */
  "ytd-player", "player", "movie_player", "html5-video-player", "video-stream",
  "video", "yt-progress-bar-playhead",
  /* things already taken back out by hand - they must not come back */
  "ytp-paid-content-overlay", "ytp-skip-ad", "ytp-skip-ad-button",

  /* Player STATE classes. These are the nastiest kind of false positive,
   * because they are named after ads but sit ON the player: YouTube adds them
   * to #movie_player while an ad exists, and takes them off afterwards.
   * Hiding one hides the entire player. The video keeps decoding, so the
   * sound carries on and the ambient glow keeps moving, and the only symptom
   * is that the picture is gone - which nothing reports as an error.
   *
   * "ad-created" got into a real filter list this way. */
  "ad-created", "ad-showing", "ad-interrupting", "ad-active", "ad-holiday",
  "ytp-ad-showing", "ytp-ad-interrupting", "ad-preview", "ad-enabled"
]);

/* Whole families of player furniture. A prefix here protects everything under
 * it, because YouTube adds variants of these constantly. */
export const PROTECTED_PREFIXES = [
  "ytp-chrome", "ytp-progress", "ytp-scrubber", "ytp-play-button", "ytp-time",
  "ytp-gradient", "ytp-volume", "ytp-settings", "ytp-fullscreen", "ytp-caption",
  "ytp-tooltip", "ytp-spinner", "ytp-bezel", "ytp-title", "ytp-watermark",
  "ytp-paid-content", "ytp-skip-ad", "ytd-masthead", "yt-progress-bar"
];

/* Words that mean "advert" essentially every time they appear in a YouTube
 * component name. */
export const STRONG = new Set([
  "ad", "ads", "advert", "adverts", "advertise", "advertiser", "advertisement",
  "promo", "promos", "promoted", "promotion", "promotions",
  "sponsor", "sponsors", "sponsored", "sponsorship", "mealbar"
]);

/* Words that often mean something else: a creator's paid-promotion notice, a
 * Premium upsell, a brand page. Ad-shaped, but not reliably an ad. */

/** The name part of a selector: ".ytp-ad-x" -> "ytp-ad-x", "#player-ads" -> "player-ads" */
export function bareName(selector) {
  const first = String(selector).trim().split(/[\s>+~,]/)[0];
  return first.replace(/^[.#]/, "").replace(/[:[].*$/, "");
}

export function isProtected(selector) {
  const s = String(selector).trim();
  if (!s || s === "*") return true;
  /* A compound selector is only as safe as every part of it:
   * "ytd-rich-item-renderer:has(ytd-ad-slot-renderer)" is fine, but a bare
   * "ytd-rich-item-renderer" is not, and the difference is the :has(). */
  const parts = s.split(/[\s>+~,]+/).filter(Boolean);
  for (const part of parts) {
    const name = bareName(part);
    if (!name) continue;
    /* A qualifier - :has(), an [attribute], a second class - narrows it to
     * something specific, so the bare name being structural is fine. */
    const qualified = /[:[.]/.test(part.replace(/^[.#]/, ""));
    if (!qualified && PROTECTED.has(name)) return true;
    if (PROTECTED_PREFIXES.some((p) => name === p || name.startsWith(p + "-"))) return true;
  }
  return false;
}

/* The whole selector, not just its first name. In
 * "ytd-rich-item-renderer:has(ytd-ad-slot-renderer)" and
 * "#panels-full-bleed-container ytd-ad-slot-renderer" the word that makes it
 * an advert is in the part that narrows it down, which is the point of
 * writing it that way. Protection is checked first, so scanning wider here
 * cannot rescue something structural. */
export function isStrong(selector) {
  return words(String(selector)).some((w) => STRONG.has(w));
}

/**
 * "refuse"  - never add this, it is page furniture
 * "add"     - unambiguously an advert, safe to add unattended
 * "unsure"  - ad-shaped but the word is one that lies; leave it to a person
 */
export function verdict(selector) {
  if (isProtected(selector)) return "refuse";
  return isStrong(selector) ? "add" : "unsure";
}
