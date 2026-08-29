/* Unit tests for the sponsor lookup.
 *
 * These live outside the browser suite on purpose: the browser harness cannot
 * intercept a service worker's network calls, so an "it works" there would be
 * meaningless. Here the fetch is a stub, and every claim is checkable -
 * including the one that matters most, that the video id never leaves.
 */
import crypto from "node:crypto";
import {
  sponsorSegments, hashPrefix, buildUrl, buildQuery, normalise,
  DEFAULT_CATEGORIES, HIGHLIGHT, clearCache
} from "../src/background/sponsors.js";

const results = [];
const check = (name, pass, detail = "") => {
  results.push(pass);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`);
};

const VIDEO = "dQw4w9WgXcQ";
const REPLY = [
  { videoID: VIDEO, segments: [
      { UUID: "a", segment: [30, 45], category: "sponsor", votes: 5, actionType: "skip" },
      { UUID: "b", segment: [4, 12], category: "selfpromo", votes: 2, actionType: "skip" },
      { UUID: "c", segment: [50, 60], category: "music_offtopic", votes: 9, actionType: "skip" },
      { UUID: "d", segment: [70, 80], category: "sponsor", votes: 1, actionType: "mute" },
      { UUID: "e", segment: [90, 90], category: "sponsor", votes: 1, actionType: "skip" },
      { UUID: "f", segment: ["x", 5], category: "sponsor", actionType: "skip" },
      /* A highlight: a single moment, zero length, its own action type. */
      { UUID: "h", segment: [126, 126], category: "poi_highlight", votes: 4, actionType: "poi" },
      { UUID: "h2", segment: [300, 300], category: "poi_highlight", votes: 1, actionType: "poi" }
  ]},
  { videoID: "otherVideo", segments: [
      { UUID: "z", segment: [0, 999], category: "sponsor", votes: 9, actionType: "skip" }
  ]}
];

const CFG = { categories: DEFAULT_CATEGORIES, highlight: false, minVotes: 0 };

let asked = [];
const fakeFetch = async (url) => {
  asked.push(url);
  return { ok: true, status: 200, json: async () => REPLY };
};

/* --- the privacy guarantee ------------------------------------------- */
const expected = crypto.createHash("sha256").update(VIDEO).digest("hex").slice(0, 4);
const prefix = await hashPrefix(VIDEO);
check("The prefix is a real SHA-256 of the video id", prefix === expected, `${prefix} vs ${expected}`);
check("...and only four characters of it", prefix.length === 4, prefix);

clearCache();
asked = [];
const { segments: segs } = await sponsorSegments(VIDEO, CFG, fakeFetch);
check("The video id never appears in the request", !asked[0].includes(VIDEO), asked[0]);
check("Only the hash prefix identifies it", new URL(asked[0]).pathname.endsWith("/" + expected));

/* --- what comes back -------------------------------------------------- */
check("Sponsor and self-promotion are kept", segs.length === 2, JSON.stringify(segs));
check("...in playing order", segs[0].start === 4 && segs[1].start === 30, JSON.stringify(segs.map(s => s.start)));
check("...as plain seconds", segs[0].end === 12 && segs[0].category === "selfpromo");
check("Non-advertising categories are dropped", !segs.some((s) => s.category === "music_offtopic"));
check("Segments meant to be muted, not skipped, are dropped", !segs.some((s) => s.uuid === "d"));
check("Zero-length segments are dropped", !segs.some((s) => s.uuid === "e"));
check("Malformed timings are dropped", !segs.some((s) => s.uuid === "f"));
check("Another video in the same bucket is ignored", !segs.some((s) => s.end === 999));

/* --- caching: one bucket, one request --------------------------------- */
asked = [];
await sponsorSegments(VIDEO, CFG, fakeFetch);
check("A repeat lookup does not hit the network again", asked.length === 0, `${asked.length} requests`);

/* --- the ordinary failures -------------------------------------------- */
clearCache();
const empty = await sponsorSegments("noSegmentsHere", CFG, async () => ({ ok: false, status: 404 }));
check("A bucket nobody has submitted to is not an error", empty.segments.length === 0 && empty.highlight === null);

clearCache();
let threw = false;
try {
  await sponsorSegments(VIDEO, CFG, async () => ({ ok: false, status: 500 }));
} catch (e) { threw = true; }
check("A server error is reported, not silently swallowed", threw);

check("Nothing is requested without a video id", (await sponsorSegments("", CFG, fakeFetch)).segments.length === 0);
check("Junk in place of a reply yields nothing", normalise("not an array", VIDEO, CFG).segments.length === 0);

/* --- chosen categories ------------------------------------------------ */
clearCache();
const onlySponsor = await sponsorSegments(
  VIDEO,
  { categories: { sponsor: true, selfpromo: false, interaction: false }, minVotes: 0 },
  fakeFetch
);
check(
  "Turning a category off leaves it in the video",
  onlySponsor.segments.length === 1 && onlySponsor.segments[0].category === "sponsor",
  JSON.stringify(onlySponsor.segments.map((s) => s.category))
);

clearCache();
const withIntro = await sponsorSegments(
  VIDEO,
  { categories: { sponsor: true, music_offtopic: true }, minVotes: 0 },
  fakeFetch
);
check(
  "Turning one on starts skipping it",
  withIntro.segments.some((s) => s.category === "music_offtopic")
);

/* The reply depends on what was asked for, so a changed setting must not be
 * served the previous answer. */
asked = [];
await sponsorSegments(VIDEO, { categories: { sponsor: true }, minVotes: 0 }, fakeFetch);
check("A different set of categories is looked up afresh", asked.length === 1, `${asked.length} requests`);

/* --- the highlight ---------------------------------------------------- */
clearCache();
const noHl = await sponsorSegments(VIDEO, CFG, fakeFetch);
check("No highlight comes back unless asked for", noHl.highlight === null);

clearCache();
asked = [];
const withHl = await sponsorSegments(
  VIDEO,
  { categories: DEFAULT_CATEGORIES, highlight: true, minVotes: 0 },
  fakeFetch
);
check("The highlight is a single moment, not a range", withHl.highlight === 126, String(withHl.highlight));
check("...the earliest one, if a video has several", withHl.highlight === 126);
check("...and it is asked for by name", decodeURIComponent(asked[0]).includes(HIGHLIGHT), asked[0]);
check("...using its own action type", decodeURIComponent(asked[0]).includes("poi"), asked[0]);
check(
  "A zero-length highlight is not mistaken for something to skip",
  !withHl.segments.some((s) => s.category === HIGHLIGHT)
);

const q = buildQuery({ categories: { sponsor: true }, highlight: false });
check("Without the highlight, poi is never requested", !q.actions.includes("poi"), q.actions.join(","));

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
