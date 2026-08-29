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

const src = fs.readFileSync(path.join(ROOT, "src/filters/filters.js"), "utf8");
const F = new Function("var globalThis = {};" + src + "\nreturn CB_FILTERS;")();
const known = knownFrom(F);

ok(known.tags.has("ytd-ad-slot-renderer"), "known tag list is populated");
ok(known.tags.has("ytd-engagement-panel-section-list-renderer"),
   "a tag with an [attribute] selector still registers");
/* This is the one that used to collapse to "". */
ok(known.classes.has("ytp-ad-module"), "known class list is populated");
ok(known.classes.has("ytp-ad-overlay-container"), "second known class registers");
ok(!known.tags.has(""), "no empty string leaked into the tag list");

/* Everything already shipped must count as known, or every run re-proposes
 * the entire filter list back to you. */
for (const k of F.response.adMarkers) ok(known.keys.has(k), `${k} counts as known`);

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

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
