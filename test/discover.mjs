#!/usr/bin/env node
/* What discovery matches, and what it must not.
 *
 * The browser half of discover.mjs cannot be tested here - it needs a real
 * YouTube. The deciding half can, and that is the half that was broken: the
 * old regex silently matched almost nothing, and the one thing it did match
 * was the YouTube header bar. Nothing about that failure was visible from the
 * outside, because "found nothing new" is also what success looks like.
 *
 * So every real renderer and element name in the shipped filter list is used
 * here as a fixture: if the matcher would not have found the ads we already
 * know about, it will not find their replacements either.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  words, suspicious, knownFrom, collectKeys, collectDom
} from "../tools/discover-match.mjs";
import { verdict } from "../tools/never-block.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let pass = 0;
let fail = 0;
const ok = (cond, what) => {
  if (cond) pass++;
  else { fail++; console.error(`  FAIL  ${what}`); }
};

/* ---------- word splitting ---------- */

ok(words("displayAdRenderer").join("|") === "display|ad|renderer", "camelCase splits");
ok(words("ytd-ad-slot-renderer").join("|") === "ytd|ad|slot|renderer", "hyphens split");
ok(words("videoMastheadAdV3Renderer").includes("ad"), "Ad found mid-name");
ok(words("ytp-ad-skip-button-slot").includes("ad"), "ad found mid-class");

/* ---------- things that must be caught ---------- */

const MUST_CATCH = [
  /* Every one of these is real, and every one of these was missed by the
   * regex this replaced. */
  "displayAdRenderer",
  "videoMastheadAdV3Renderer",
  "carouselAdRenderer",
  "actionCompanionAdRenderer",
  "instreamVideoAdRenderer",
  "playerLegacyDesktopWatchAdsRenderer",
  "compactPromotedVideoRenderer",
  "adSlotRenderer",
  "promotedSparklesWebRenderer",
  "mealbarPromoRenderer",
  "brandVideoShelfRenderer",
  "ytd-ad-slot-renderer",
  "ytd-in-feed-ad-layout-renderer",
  "ytd-display-ad-renderer",
  "ytd-promoted-video-renderer",
  "ytd-search-pyv-renderer",
  "ytp-ad-module",
  "ytp-ad-skip-button-slot",
  "ytd-enforcement-message-view-model"
];
for (const n of MUST_CATCH) ok(suspicious(n), `catches ${n}`);

/* ---------- things that must NOT be caught ---------- */

const MUST_NOT = [
  /* The header bar. The old matcher proposed this one, and only this one. */
  "ytd-masthead",
  "ytd-masthead-container",
  /* "ad" living inside an innocent word. */
  "adjacentVideoRenderer",
  "addToPlaylistRenderer",
  "downloadButtonRenderer",
  "adaptiveFormatsRenderer",
  "radioRenderer",
  "ytd-thumbnail-overlay-toggle-button-renderer",
  "ytd-watch-flexy",
  "ytd-rich-grid-renderer",
  "ytp-chrome-bottom",
  "ytd-guide-entry-renderer",
  "html5-video-player"
];
for (const n of MUST_NOT) ok(!suspicious(n), `leaves ${n} alone`);

/* ---------- the known-list lookups ---------- */

/* Against a fixture, not against src/filters/filters.js.
 *
 * These used to assert that the real filter list contained particular
 * entries - "ytd-ad-slot-renderer is in there, so the lookup must find it".
 * That was only ever true because the list grew and never shrank. Now that a
 * run rebuilds it from whatever YouTube happened to show that day, the same
 * assertions fail whenever a run does not happen to meet one of them, which
 * says nothing at all about whether knownFrom works.
 *
 * knownFrom is a pure function. Give it a known input and check the output;
 * what is in today's filter list is not this test's business. */
const FIXTURE = {
  hide: [
    "ytd-ad-slot-renderer",
    "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-ads']",
    ".ytp-ad-module",
    ".ytp-ad-overlay-container",
    "ytd-rich-item-renderer:has(ytd-ad-slot-renderer)",
    "#panels-full-bleed-container ytd-ad-slot-renderer"
  ],
  remove: ["ytd-enforcement-message-view-model"],
  response: {
    adMarkers: ["adSlotRenderer", "displayAdRenderer"],
    playerKeys: ["adPlacements", "playerAds"],
    adGateReasons: []
  }
};
const known = knownFrom(FIXTURE);

ok(known.tags.has("ytd-ad-slot-renderer"), "known tag list is populated");
ok(known.tags.has("ytd-engagement-panel-section-list-renderer"),
   "a tag with an [attribute] selector still registers");
/* This is the one that used to collapse to "". */
ok(known.classes.has("ytp-ad-module"), "known class list is populated");
ok(known.classes.has("ytp-ad-overlay-container"), "second known class registers");
ok(known.tags.has("ytd-enforcement-message-view-model"), "the remove list counts too");
ok(!known.tags.has(""), "no empty string leaked into the tag list");
ok(known.keys.has("adSlotRenderer") && known.keys.has("adPlacements"),
   "markers and player fields both count as known");

/* Whatever is in the real list, every entry of it must count as known -
 * otherwise a run re-proposes the whole filter list back at you. That claim
 * holds for any list, including an empty one, so it is safe to make here. */
const src = fs.readFileSync(path.join(ROOT, "src/filters/filters.js"), "utf8");
const F = new Function("var globalThis = {};" + src + "\nreturn CB_FILTERS;")();
const live = knownFrom(F);
const unknown = F.response.adMarkers.filter((k) => !live.keys.has(k));
ok(unknown.length === 0, `every shipped marker counts as known (${unknown.join(", ")})`);

/* ---------- walking a response ---------- */

const body = {
  contents: {
    twoColumnWatchNextResults: {
      results: { contents: [
        { videoDisplayAdV2Renderer: { id: "x" } },      // new, ad-shaped
        { adSlotRenderer: { id: "y" } },                // ad-shaped but known
        { adjacentVideoRenderer: { id: "z" } },         // innocent
        { addToPlaylistRenderer: { id: "w" } }          // innocent
      ] }
    }
  },
  playerAds: [{ brandNewPromoRenderer: { id: "p" } }],
  adPlacements: [{ nested: { deep: { superDuperAdsRenderer: { id: "q" } } } }]
};

const keys = new Map();
collectKeys(body, known, keys, new Map());

ok(keys.has("videoDisplayAdV2Renderer"), "finds a new renderer with a capital Ad");
ok(keys.has("brandNewPromoRenderer"), "finds a new promo renderer");
ok(keys.has("superDuperAdsRenderer"), "finds one nested several levels down");
ok(!keys.has("adSlotRenderer"), "does not re-propose one already shipped");
ok(!keys.has("adjacentVideoRenderer"), "does not propose adjacent…");
ok(!keys.has("addToPlaylistRenderer"), "does not propose addToPlaylist…");
ok(keys.size === 3, `proposes exactly 3, got ${keys.size}`);

/* ---------- folding DOM snapshots ---------- */

const tags = new Map();
const classes = new Map();

/* Two snapshots, as a real run takes: the ad overlay is only present in the
 * first, which is the entire reason discovery samples more than once. */
collectDom({
  tags: { "ytd-ad-slot-renderer": 3, "ytd-brand-lift-survey-renderer": 1, "ytd-masthead": 1 },
  classes: { "ytp-ad-module": 1, "ytp-ad-skip-button-slot": 1, "ytp-chrome-bottom": 1 }
}, known, tags, classes);

collectDom({
  tags: { "ytd-masthead": 1, "ytd-watch-flexy": 1 },
  classes: { "ytp-chrome-bottom": 1 }
}, known, tags, classes);

ok(tags.has("ytd-brand-lift-survey-renderer"), "keeps a new element seen once");
ok(!tags.has("ytd-ad-slot-renderer"), "drops an element already shipped");
ok(!tags.has("ytd-masthead"), "never proposes the header bar");
ok(!tags.has("ytd-watch-flexy"), "never proposes the page itself");
ok(classes.has("ytp-ad-skip-button-slot"), "keeps a new class");
ok(!classes.has("ytp-ad-module"), "drops a class already shipped");
ok(!classes.has("ytp-chrome-bottom"), "leaves the player furniture alone");
ok(tags.size === 1 && classes.size === 1, "nothing else came along for the ride");

/* Counts are a maximum across snapshots, not a sum - otherwise the number
 * just reports how long something sat on screen. */
collectDom({ tags: { "ytd-brand-lift-survey-renderer": 5 }, classes: {} },
           known, tags, classes);
ok(tags.get("ytd-brand-lift-survey-renderer") === 5, "count is the most seen at once");

/* ---------- default pages ---------- */

const dsrc = fs.readFileSync(path.join(ROOT, "tools/discover.mjs"), "utf8");
ok(/DEFAULT_PAGES[\s\S]{0,200}watch\?v=/.test(dsrc), "a watch page is visited first");

/* ---------- what may be added without being asked ---------- */

/* Filters are now added automatically, so the only thing standing between a
 * name matcher and a broken YouTube is this list. Every entry below is a real
 * name that a real run has proposed - the header bar and the scrubber dot
 * both got added for real before this existed. */
const MUST_REFUSE = [
  "ytd-masthead", "ytd-masthead-container",     // the whole top bar
  "yt-progress-bar-playhead",                    // the dot on the scrubber
  ".ytp-paid-content-overlay",                   // "Includes paid promotion"
  ".ytp-paid-content-overlay-link",
  ".ytp-skip-ad", ".ytp-skip-ad-button", ".ytp-skip-ad-button__text",
  ".ytp-chrome-bottom", ".ytp-progress-bar", ".ytp-play-button",
  ".ytp-time-current", ".ytp-volume-panel", ".ytp-fullscreen-button",
  /* Player state classes: named after ads, but they sit ON the player, so
   * hiding one hides the whole video. "ad-created" reached a real list. */
  ".ad-created", ".ad-showing", ".ad-interrupting", ".ytp-ad-showing",
  "ytd-watch-flexy", "ytd-app", "ytd-browse", "ytd-page-manager",
  "ytd-rich-grid-renderer", "ytd-rich-item-renderer", "ytd-video-renderer",
  "ytd-thumbnail", "ytd-player", "video", "body", "html", "*"
];
for (const s of MUST_REFUSE) ok(verdict(s) === "refuse", `refuses ${s}`);

const MUST_ADD = [
  "ytd-ad-slot-renderer", "ytd-in-feed-ad-layout-renderer",
  "ytd-promoted-video-renderer", "ytd-display-ad-renderer",
  "yt-mealbar-promo-renderer", ".ytp-ad-module", ".ytp-ad-overlay-container",
  ".ytwAdBadgeViewModelHost", ".ytwAdImageViewModelHostImageContainer",
  "adImageViewModel", "adPlacementRenderer", "displayAdRenderer",
  /* real ad containers inside the player - these must still get through */
  ".video-ads", ".ytp-ad-progress-list", ".ytp-ad-player-overlay-layout",
  /* the ad word is in the part that narrows it down, not the first name */
  "ytd-rich-item-renderer:has(ytd-ad-slot-renderer)",
  "#panels-full-bleed-container ytd-ad-slot-renderer",
  "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-ads']"
];
for (const s of MUST_ADD) ok(verdict(s) === "add", `adds ${s} unattended`);

/* Ad-shaped, but by a word that has lied before. Not refused - just not added
 * without a person looking. */
const MUST_SET_ASIDE = [
  ".ytp-featured-product", "brandVideoShelfRenderer", "ytd-search-pyv-renderer"
];
for (const s of MUST_SET_ASIDE) ok(verdict(s) === "unsure", `sets aside ${s}`);

/* A qualifier is what makes a structural name specific enough to block. The
 * bare name must stay refused even so. */
ok(verdict("ytd-rich-item-renderer") === "refuse", "a bare grid cell is refused");
ok(verdict("ytd-rich-item-renderer:has(ytd-ad-slot-renderer)") === "add",
   "...but an ad-only grid cell is not");

/* Nothing already shipped may be something this would now refuse - that would
 * mean the list contradicts itself. */
const shipped = F.hide.concat(F.remove).filter((s) => verdict(s) === "refuse");
ok(shipped.length === 0, `nothing shipped is refused (${shipped.join(", ")})`);

const bat = fs.readFileSync(path.join(ROOT, "1-get-filters.bat"), "utf8");
ok(/--auto/.test(bat), "1-get-filters.bat adds without asking");
ok(/--fresh/.test(bat), "...and rebuilds the list rather than piling onto it");

/* ---------- a fresh run must not lose what it cannot rediscover ---------- */

/* These are the reason a wipe is not simply "empty the file". Nothing on an
 * ordinary page mentions them, so no run can ever put them back. */
const reset = fs.readFileSync(path.join(ROOT, "tools/reset-filters.mjs"), "utf8");
ok(/rewriteArray\(src, "hide", \[\]\)/.test(reset), "reset clears the page filters");
ok(/rewriteArray\(next, "adMarkers", \[\]\)/.test(reset), "...and the field names");
ok(!/rewriteArray\([^)]*"playerKeys"/.test(reset), "reset never clears the player fields");
ok(!/rewriteArray\([^)]*"remove"/.test(reset), "reset never clears the removal rules");
ok(/playerKeys were touched|the player fields were touched/.test(reset),
   "...and it checks that they survived");

const adder = fs.readFileSync(path.join(ROOT, "tools/add-filters.mjs"), "utf8");
ok(/the player fields were touched/.test(adder),
   "a fresh run checks the player fields survived");
ok(/the removal rules were touched/.test(adder),
   "...and that the removal rules survived");

/* Discovery must report everything it sees, not only what is missing. If it
 * filtered against the current list, a fresh run would drop the filter for
 * every ad that is still on the page - the list would rot a little each time
 * it was refreshed. */
ok(/nothingKnown/.test(dsrc), "discovery reports ads it already covers too");
ok(/collectDom\([^,]+, nothingKnown/.test(dsrc), "...for elements");
ok(/collectKeys\([^,]+, nothingKnown/.test(dsrc), "...and for response fields");
ok(/DEFAULT_PAGES\.filter\(\(p\) => !isWatch\(p\)\)/.test(dsrc),
   "a link you give still visits the feeds afterwards");

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
